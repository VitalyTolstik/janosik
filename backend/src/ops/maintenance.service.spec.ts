import type { PrismaService } from "@/common/prisma/prisma.service";
import type { StorageService } from "@/attachments/storage.service";
import type { OpsSettingsService } from "./ops-settings.service";
import { MaintenanceService } from "./maintenance.service";

function makePrisma(): PrismaService {
  const tx = {
    attachment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    comment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    checklistItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    checklist: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cardLink: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    column: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    label: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    card: { findMany: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  };
  return {
    attachment: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as unknown[]),
    ),
    emailVerificationCode: {
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    emailChangeCode: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
    adminRefreshToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    boardShare: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    boardMember: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    dataExport: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaService;
}

const storageMock = {
  attachmentPath: (name: string) => `/blobs/${name}`,
  remove: jest.fn().mockResolvedValue(undefined),
  listBlobs: jest.fn().mockResolvedValue([]),
} as unknown as StorageService;

const opsMock = {
  retentionDays: jest.fn().mockResolvedValue(30),
} as unknown as OpsSettingsService;

describe("MaintenanceService", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (storageMock.listBlobs as jest.Mock).mockResolvedValue([]);
    (storageMock.remove as jest.Mock).mockResolvedValue(undefined);
  });

  it("counts every sweep under 'all'", async () => {
    const service = new MaintenanceService(makePrisma(), storageMock, opsMock);
    const results = await service.run("all");
    const total = results.reduce((sum, entry) => sum + entry.removed, 0);
    // codes 2+1, tokens 4+1, shares 3, invitations 5.
    expect(total).toBe(16);
    expect(results.map((entry) => entry.job)).toContain("sweep-codes");
  });

  it("deletes expired export artifacts", async () => {
    const prisma = makePrisma();
    (prisma.dataExport.findMany as jest.Mock).mockResolvedValue([
      { id: "exp-1", storedName: "export-1.json" },
    ]);
    const service = new MaintenanceService(prisma, storageMock, opsMock);
    const removed = await service.sweepExports();
    expect(removed).toBe(1);
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/export-1.json");
  });

  it("removes blobs no row references", async () => {
    const prisma = makePrisma();
    (prisma.attachment.findMany as jest.Mock).mockResolvedValue([
      { storedName: "keep.bin", thumbnailName: null, posterName: null },
    ]);
    (storageMock.listBlobs as jest.Mock).mockResolvedValue([
      { name: "keep.bin", avatar: false, absPath: "/blobs/keep.bin" },
      { name: "orphan.bin", avatar: false, absPath: "/blobs/orphan.bin" },
    ]);
    const service = new MaintenanceService(prisma, storageMock, opsMock);
    const removed = await service.sweepOrphanBlobs();
    expect(removed).toBe(1);
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/orphan.bin");
  });
});
