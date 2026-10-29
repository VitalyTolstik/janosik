import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { AuthUser } from "@/auth/auth.types";
import type { PrismaService } from "@/common/prisma/prisma.service";
import { LIMITS } from "@janosik/shared";
import { AttachmentsService } from "./attachments.service";
import type { UploadedBlob } from "./attachments.service";
import { StorageService } from "./storage.service";

/**
 * TASK-156 (item 7): multer streams the body into a `.tmp-*` scratch file and
 * `persist` renames it into the blob tree *before* the row is committed. A
 * failure after that rename — the lost quota race inside the board lock, a
 * transaction timeout (P2028) or a feature-flag read that throws — must
 * leave neither the renamed blob nor the `.tmp-*` file behind, or the disk
 * fills with orphans until the sweep notices. Conversely, once the row has
 * committed, the blob *is* the attachment and a later failure must not
 * reclaim it.
 */
describe("AttachmentsService.create — blob cleanup after the rename (TASK-156, item 7)", () => {
  const user: AuthUser = {
    id: "user-1",
    email: "user@example.com",
    displayName: "U",
    avatarColor: null,
    avatarPath: null,
    createdAt: 0,
  };

  // A real PNG signature: `sniffMime` must accept the bytes as image/png.
  const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  // A minimal ISO-box header (size + "ftyp" + "isom" brand) → video/mp4,
  // so the upload takes the `flags.isEnabled` branch.
  const MP4 = Buffer.alloc(16);
  MP4.write("ftyp", 4, "latin1");
  MP4.write("isom", 8, "latin1");

  let root: string;
  let storage: StorageService;
  let boardWriteRun: jest.Mock;
  let flags: { isEnabled: jest.Mock };
  let service: AttachmentsService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "janosik-attachments-"));
    storage = new StorageService(root);
    // Deterministic blob names so the assertions can name the exact path.
    jest.spyOn(storage, "storedName").mockReturnValue("probe.bin");
    const prisma = {
      card: {
        findFirst: jest.fn().mockResolvedValue({
          id: "card-1",
          column: { boardId: "board-1" },
        }),
      },
      // The fast-fail pre-check passes; the authoritative one refuses below.
      attachment: { count: jest.fn().mockResolvedValue(0) },
    };
    boardWriteRun = jest.fn();
    flags = { isEnabled: jest.fn().mockResolvedValue(false) };
    service = new AttachmentsService(
      prisma as unknown as PrismaService,
      { run: boardWriteRun } as never,
      storage,
      { publish: jest.fn() } as never,
      { enqueue: jest.fn() } as never,
      { enqueue: jest.fn() } as never,
      flags as never,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** A multer-shaped `.tmp-*` scratch file inside the blob root. */
  async function tempFile(bytes: Buffer, ext: string): Promise<UploadedBlob> {
    const tmpPath = path.join(root, `.tmp-probe${ext}`);
    await writeFile(tmpPath, bytes);
    return {
      originalname: `probe${ext}`,
      mimetype: ext === ".mp4" ? "video/mp4" : "image/png",
      size: bytes.length,
      path: tmpPath,
    };
  }

  /** The blob tree after a failed upload: no blob, no `.tmp-*` scratch. */
  const onlyDirsLeft = async (): Promise<string[]> =>
    (await readdir(root)).sort();

  it("removes the renamed blob when the in-lock quota check refuses (lost race)", async () => {
    boardWriteRun.mockImplementation(
      (_boardId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          attachment: {
            // The authoritative count under the board lock is at the cap.
            count: jest.fn().mockResolvedValue(LIMITS.attachmentsPerCard),
          },
        }),
    );
    const file = await tempFile(PNG, ".png");

    await expect(service.create("card-1", user, file)).rejects.toThrow(
      BadRequestException,
    );

    expect(await onlyDirsLeft()).toEqual(["avatars"]);
  });

  it("removes the renamed blob when the board transaction times out (P2028)", async () => {
    boardWriteRun.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Transaction timed out", {
        code: "P2028",
        clientVersion: "test",
      }),
    );
    const file = await tempFile(PNG, ".png");

    await expect(service.create("card-1", user, file)).rejects.toThrow();

    expect(await onlyDirsLeft()).toEqual(["avatars"]);
  });

  it("removes the renamed blob when the feature-flag read throws (video path)", async () => {
    flags.isEnabled.mockRejectedValue(new Error("flag store down"));
    const file = await tempFile(MP4, ".mp4");

    await expect(service.create("card-1", user, file)).rejects.toThrow(
      "flag store down",
    );

    expect(await onlyDirsLeft()).toEqual(["avatars"]);
  });

  it("keeps the blob once the row committed, even when a later step fails", async () => {
    const row = {
      id: "att-1",
      cardId: "card-1",
      fileName: "probe.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
      uploadedById: user.id,
      transcodeStatus: "none",
      createdAt: new Date(),
    };
    boardWriteRun.mockImplementation(
      (_boardId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          attachment: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue(row),
          },
          card: { update: jest.fn() },
          activity: { create: jest.fn().mockResolvedValue({ id: "act-1" }) },
        }),
    );
    const file = await tempFile(PNG, ".png");

    await expect(service.create("card-1", user, file)).resolves.toMatchObject({
      id: "att-1",
    });

    // The blob is the attachment now: nothing may reclaim it. The `.tmp-*`
    // scratch is gone either way (the rename consumed it).
    expect(existsSync(storage.attachmentPath("probe.bin"))).toBe(true);
    expect(existsSync(file.path)).toBe(false);
    expect(await onlyDirsLeft()).toEqual(["avatars", "probe.bin"]);
  });
});
