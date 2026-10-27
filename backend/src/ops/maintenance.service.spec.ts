import type { PrismaService } from "@/common/prisma/prisma.service";
import type { StorageService } from "@/attachments/storage.service";
import type { OpsSettingsService } from "./ops-settings.service";
import { MaintenanceService } from "./maintenance.service";

function makePrisma(): PrismaService {
  const purgeable = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  });
  return {
    attachment: purgeable(),
    comment: purgeable(),
    checklistItem: purgeable(),
    checklist: purgeable(),
    cardLink: purgeable(),
    cardLabel: purgeable(),
    card: purgeable(),
    column: purgeable(),
    label: purgeable(),
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (t: unknown) => unknown)({})
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
    command: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    reminderSent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
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

/** Epoch mtime — unambiguously older than any grace window. */
const LONG_AGO = 0;

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
      {
        name: "keep.bin",
        avatar: false,
        absPath: "/blobs/keep.bin",
        mtimeMs: LONG_AGO,
      },
      {
        name: "orphan.bin",
        avatar: false,
        absPath: "/blobs/orphan.bin",
        mtimeMs: LONG_AGO,
      },
    ]);
    const service = new MaintenanceService(prisma, storageMock, opsMock);
    const removed = await service.sweepOrphanBlobs();
    expect(removed).toBe(1);
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/orphan.bin");
  });

  it("spares unreferenced blobs written inside the grace window (TASK-77)", async () => {
    const prisma = makePrisma();
    (storageMock.listBlobs as jest.Mock).mockResolvedValue([
      {
        name: "in-flight.bin",
        avatar: false,
        absPath: "/blobs/in-flight.bin",
        mtimeMs: Date.now(),
      },
    ]);
    const service = new MaintenanceService(prisma, storageMock, opsMock);
    const removed = await service.sweepOrphanBlobs();
    expect(removed).toBe(0);
    expect(storageMock.remove).not.toHaveBeenCalled();
  });

  it("purges stale cards in bounded chunks, each in its own transaction (B-7)", async () => {
    const prisma = makePrisma();
    const ids = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
    (prisma.card.findMany as jest.Mock)
      .mockResolvedValueOnce(ids(500, "a"))
      .mockResolvedValueOnce(ids(120, "b"));
    (prisma.card.deleteMany as jest.Mock)
      .mockResolvedValueOnce({ count: 500 })
      .mockResolvedValueOnce({ count: 120 });
    (prisma.attachment.findMany as jest.Mock).mockImplementation(
      async (args: { where: { cardId?: unknown } }) =>
        args.where.cardId
          ? [
              {
                storedName: "card-blob.bin",
                thumbnailName: null,
                posterName: null,
              },
            ]
          : [],
    );
    const service = new MaintenanceService(prisma, storageMock, opsMock);

    const removed = await service.purgeSoftDeleted();

    expect(removed).toBe(620);
    // Two card chunks → two transactions (500 + the 120 remainder).
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    const firstChunk = (prisma.card.deleteMany as jest.Mock).mock.calls[0][0]
      .where.id.in as string[];
    expect(firstChunk).toHaveLength(500);
    // A purged card's attachment blobs are removed with it.
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/card-blob.bin");
  });

  it("trims the command log to the retention window (TASK-84)", async () => {
    const prisma = makePrisma();
    (prisma.command.deleteMany as jest.Mock).mockResolvedValue({ count: 7 });
    const service = new MaintenanceService(prisma, storageMock, opsMock);
    const removed = await service.sweepCommands();
    expect(removed).toBe(7);
    const call = (prisma.command.deleteMany as jest.Mock).mock.calls[0][0] as {
      where: { createdAt: { lt: Date } };
    };
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
  });
});
