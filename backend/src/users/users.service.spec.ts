import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import { StorageService } from "@/attachments/storage.service";
import type { UploadedBlob } from "@/attachments/attachments.service";
import type { PrismaService } from "@/common/prisma/prisma.service";
import type { PresenceService } from "@/realtime/presence.service";
import type { RealtimeService } from "@/realtime/realtime.service";
import { UsersService } from "./users.service";

const prismaMock = {
  user: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  boardMember: {
    findMany: jest.fn(),
  },
} as unknown as PrismaService & {
  user: Record<"update" | "findUnique", jest.Mock>;
  boardMember: Record<"findMany", jest.Mock>;
};

const presenceMock = {
  updateUser: jest.fn(),
} as unknown as PresenceService & { updateUser: jest.Mock };

const realtimeMock = {
  publish: jest.fn(),
} as unknown as RealtimeService & { publish: jest.Mock };

const storageMock = {} as unknown as StorageService;

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "user@example.com",
  passwordHash: "",
  displayName: null,
  avatarColor: null,
  avatarPath: null,
  disabledAt: null,
  emailVerifiedAt: null,
  notifyDigest: true,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

describe("UsersService", () => {
  let service: UsersService;

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.boardMember.findMany.mockResolvedValue([]);
    service = new UsersService(
      prismaMock,
      presenceMock,
      realtimeMock,
      storageMock,
    );
  });

  describe("updateProfile", () => {
    it("writes only the provided keys and returns the fresh projection", async () => {
      prismaMock.user.update.mockResolvedValue(
        makeUser({ displayName: "Vera", avatarColor: "pink" }),
      );

      const result = await service.updateProfile("user-1", {
        displayName: "Vera",
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { displayName: "Vera" },
      });
      expect(result).toEqual({
        id: "user-1",
        email: "user@example.com",
        displayName: "Vera",
        avatarColor: "pink",
        avatarPath: null,
        emailVerifiedAt: null,
        createdAt: new Date("2026-09-01T00:00:00Z").getTime(),
      });
    });

    it("clears a field with null", async () => {
      prismaMock.user.update.mockResolvedValue(makeUser());

      await service.updateProfile("user-1", {
        displayName: null,
        avatarColor: null,
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { displayName: null, avatarColor: null },
      });
    });

    it("passes an empty patch through untouched", async () => {
      prismaMock.user.update.mockResolvedValue(makeUser());

      await service.updateProfile("user-1", {});

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {},
      });
    });

    it("rewrites live identities and refreshes every board's directory", async () => {
      prismaMock.user.update.mockResolvedValue(
        makeUser({ displayName: "Vera", avatarColor: "pink" }),
      );
      prismaMock.boardMember.findMany.mockResolvedValue([
        { boardId: "board-1" },
        { boardId: "board-2" },
      ]);

      await service.updateProfile("user-1", {
        displayName: "Vera",
        avatarColor: "pink",
      });

      expect(presenceMock.updateUser).toHaveBeenCalledWith("user-1", {
        displayName: "Vera",
        avatarColor: "pink",
        avatarPath: null,
      });
      expect(prismaMock.boardMember.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1", acceptedAt: { not: null } },
        select: { boardId: true },
      });
      expect(realtimeMock.publish).toHaveBeenCalledTimes(2);
      expect(realtimeMock.publish).toHaveBeenCalledWith("board-1", {
        type: "membership",
        boardId: "board-1",
        userId: "user-1",
        change: "updated",
      });
      expect(realtimeMock.publish).toHaveBeenCalledWith("board-2", {
        type: "membership",
        boardId: "board-2",
        userId: "user-1",
        change: "updated",
      });
    });

    it("keeps an empty patch silent for presence and members", async () => {
      prismaMock.user.update.mockResolvedValue(makeUser());

      await service.updateProfile("user-1", {});

      expect(presenceMock.updateUser).not.toHaveBeenCalled();
      expect(prismaMock.boardMember.findMany).not.toHaveBeenCalled();
      expect(realtimeMock.publish).not.toHaveBeenCalled();
    });
  });

  describe("uploadAvatar — blob cleanup after the rename (TASK-156, item 7)", () => {
    // A real PNG signature: `sniffMime` must accept the bytes as image/png.
    const PNG = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    let root: string;
    let storage: StorageService;
    let avatarService: UsersService;

    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "janosik-avatar-"));
      storage = new StorageService(root);
      // Deterministic blob names so the assertions can name the exact path.
      jest.spyOn(storage, "storedName").mockReturnValue("probe-avatar.png");
      avatarService = new UsersService(
        prismaMock,
        presenceMock,
        realtimeMock,
        storage,
      );
      prismaMock.user.findUnique.mockResolvedValue({ avatarPath: null });
      prismaMock.boardMember.findMany.mockResolvedValue([]);
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    /** A multer-shaped `.tmp-*` scratch file inside the upload root. */
    const tempAvatar = async (): Promise<UploadedBlob> => {
      const tmpPath = path.join(root, ".tmp-avatar");
      await writeFile(tmpPath, PNG);
      return {
        originalname: "avatar.png",
        mimetype: "image/png",
        size: PNG.length,
        path: tmpPath,
      };
    };

    it("removes the renamed avatar when the profile write fails (P2028)", async () => {
      // A previous avatar exists — the row still points at it, so it must
      // survive the failed re-upload.
      const previousPath = storage.avatarPath("previous.png");
      await mkdir(path.dirname(previousPath), { recursive: true });
      await writeFile(previousPath, PNG);
      prismaMock.user.findUnique.mockResolvedValue({
        avatarPath: "previous.png",
      });
      prismaMock.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Transaction timed out", {
          code: "P2028",
          clientVersion: "test",
        }),
      );
      const file = await tempAvatar();

      await expect(
        avatarService.uploadAvatar("user-1", file),
      ).rejects.toThrow();

      expect(existsSync(storage.avatarPath("probe-avatar.png"))).toBe(false);
      expect(existsSync(file.path)).toBe(false);
      expect(existsSync(previousPath)).toBe(true);
    });

    it("keeps the avatar once the row points at it, even when the fan-out fails", async () => {
      prismaMock.user.update.mockResolvedValue(makeUser());
      prismaMock.boardMember.findMany.mockRejectedValue(new Error("boom"));
      const file = await tempAvatar();

      await expect(avatarService.uploadAvatar("user-1", file)).rejects.toThrow(
        "boom",
      );

      // The user row references the blob now — a post-commit failure must
      // not reclaim it. The `.tmp-*` scratch is gone either way.
      expect(existsSync(storage.avatarPath("probe-avatar.png"))).toBe(true);
      expect(existsSync(file.path)).toBe(false);
    });
  });
});
