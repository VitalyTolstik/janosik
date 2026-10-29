import type { PrismaService } from "@/common/prisma/prisma.service";
import type { StorageService } from "@/attachments/storage.service";
import type { AdminService } from "./admin.service";
import { ExportsService } from "./exports.service";

function makePrisma() {
  return {
    dataExport: {
      findUnique: jest.fn().mockResolvedValue({ id: "exp-1", userId: "u-1" }),
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
});
