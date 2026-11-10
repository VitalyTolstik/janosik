import { GoneException } from "@nestjs/common";
import { PayloadTooLargeException } from "@nestjs/common";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaService } from "@/common/prisma/prisma.service";
import type { StorageService } from "@/attachments/storage.service";
import type { AdminService } from "./admin.service";
import { assertExportBundleSize, ExportsService } from "./exports.service";

function makePrisma() {
  return {
    dataExport: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: "exp-1", userId: "u-1", status: "pending" }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
}

const storageMock = {
  ensureDirs: jest.fn().mockResolvedValue(undefined),
  attachmentPath: (name: string) => `/blobs/${name}`,
  remove: jest.fn().mockResolvedValue(undefined),
} as unknown as StorageService;

const adminMock = {
  buildUserBundle: jest.fn(),
} as unknown as AdminService;

/**
 * TASK-148 (B21): a failed build must reach BullMQ while attempts remain, so
 * the retry policy actually runs, and settle on `failed` only at the end.
 */
describe("ExportsService retry (TASK-148)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (adminMock.buildUserBundle as jest.Mock).mockRejectedValue(
      new Error("db hiccup"),
    );
  });

  it("rethrows and leaves the row pending while attempts remain", async () => {
    const prisma = makePrisma();
    const service = new ExportsService(prisma, adminMock, storageMock);

    await expect(
      service.build("exp-1", { attemptsMade: 0, attempts: 3 }),
    ).rejects.toThrow("db hiccup");
    expect(prisma.dataExport.update).not.toHaveBeenCalled();
  });

  it("settles on failed and rethrows on the final attempt", async () => {
    const prisma = makePrisma();
    const service = new ExportsService(prisma, adminMock, storageMock);

    await expect(
      service.build("exp-1", { attemptsMade: 2, attempts: 3 }),
    ).rejects.toThrow("db hiccup");
    expect(prisma.dataExport.update).toHaveBeenCalledWith({
      where: { id: "exp-1" },
      data: { status: "failed", error: "db hiccup" },
    });
  });

  it("marks failed on the inline path, which never retries", async () => {
    const prisma = makePrisma();
    const service = new ExportsService(prisma, adminMock, storageMock);

    await expect(service.build("exp-1")).rejects.toThrow("db hiccup");
    expect(prisma.dataExport.update).toHaveBeenCalledWith({
      where: { id: "exp-1" },
      data: { status: "failed", error: "db hiccup" },
    });
  });

  it("bounds the bundle before writing the artifact", () => {
    expect(() => assertExportBundleSize(50 * 1024 * 1024)).not.toThrow();
    expect(() => assertExportBundleSize(50 * 1024 * 1024 + 1)).toThrow(
      PayloadTooLargeException,
    );
  });

  it("does not retry an oversized queued build", async () => {
    const prisma = makePrisma();
    (adminMock.buildUserBundle as jest.Mock).mockRejectedValue(
      new PayloadTooLargeException("too large"),
    );
    const service = new ExportsService(prisma, adminMock, storageMock);

    await expect(
      service.build("exp-1", { attemptsMade: 0, attempts: 3 }),
    ).resolves.toBeUndefined();
    expect(prisma.dataExport.update).toHaveBeenCalledWith({
      where: { id: "exp-1" },
      data: { status: "failed", error: "too large" },
    });
  });

  it("does nothing when the row is already ready or failed", async () => {
    const prisma = makePrisma();
    (prisma.dataExport.findUnique as jest.Mock).mockResolvedValue({
      id: "exp-1",
      userId: "u-1",
      status: "ready",
    });
    const service = new ExportsService(prisma, adminMock, storageMock);

    await service.build("exp-1");
    expect(adminMock.buildUserBundle).not.toHaveBeenCalled();
  });

  it("keeps the previous ready artifact when the new build fails", async () => {
    const prisma = makePrisma();
    (adminMock.buildUserBundle as jest.Mock).mockRejectedValue(
      new Error("db hiccup"),
    );
    (prisma.dataExport.findMany as jest.Mock).mockResolvedValue([
      { id: "old-ready", storedName: "old.json" },
    ]);
    const service = new ExportsService(prisma, adminMock, storageMock);

    await expect(service.build("exp-1")).rejects.toThrow("db hiccup");
    expect(prisma.dataExport.deleteMany).not.toHaveBeenCalled();
    expect(storageMock.remove).not.toHaveBeenCalled();
  });

  it("cleans only ready artifacts older than the one that just finished", async () => {
    const prisma = makePrisma();
    const createdAt = new Date("2026-11-10T00:00:00Z");
    (prisma.dataExport.findUnique as jest.Mock).mockResolvedValue({
      id: "exp-1",
      userId: "u-1",
      status: "pending",
      createdAt,
    });
    (adminMock.buildUserBundle as jest.Mock).mockResolvedValue({
      email: "u@example.com",
      generatedAt: 1,
      filename: "new.json",
      data: { ok: true },
    });
    const dir = await mkdtemp(join(tmpdir(), "janosik-export-clean-"));
    const storage = {
      ensureDirs: jest.fn().mockResolvedValue(undefined),
      attachmentPath: (name: string) => join(dir, name),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as StorageService;
    const service = new ExportsService(prisma, adminMock, storage);

    await service.build("exp-1");
    expect(prisma.dataExport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { lt: createdAt },
        }),
      }),
    );
  });

  it("answers 410 when the ready artifact file is missing", async () => {
    const prisma = makePrisma();
    (prisma.dataExport.findUnique as jest.Mock).mockResolvedValue({
      id: "exp-1",
      userId: "u-1",
      status: "ready",
      storedName: "missing.json",
      filename: "missing.json",
      sizeBytes: 2,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new ExportsService(prisma, adminMock, {
      attachmentPath: () => "/definitely/missing/export.json",
    } as never);

    await expect(service.download("exp-1")).rejects.toThrow(GoneException);
  });

  it("refuses to download a legacy artifact above the bundle limit", async () => {
    const prisma = makePrisma();
    (prisma.dataExport.findUnique as jest.Mock).mockResolvedValue({
      id: "exp-1",
      userId: "u-1",
      status: "ready",
      storedName: "old.json",
      filename: "old.json",
      sizeBytes: 51 * 1024 * 1024,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const dir = await mkdtemp(join(tmpdir(), "janosik-export-"));
    const absPath = join(dir, "old.json");
    await writeFile(absPath, "{}");
    const service = new ExportsService(prisma, adminMock, {
      attachmentPath: () => absPath,
    } as never);

    await expect(service.download("exp-1")).rejects.toThrow(
      PayloadTooLargeException,
    );
  });
});
