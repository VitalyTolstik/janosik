import type { PrismaService } from "@/common/prisma/prisma.service";
import type { StorageService } from "@/attachments/storage.service";
import type { OpsSettingsService } from "./ops-settings.service";
import { MaintenanceService, PURGE_CHUNK } from "./maintenance.service";

function makePrisma(): PrismaService {
  const purgeable = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  });
  const sweepable = (count: number) => ({
    findMany: jest
      .fn()
      .mockResolvedValue(count > 0 ? [{ id: `row-${count}` }] : []),
    deleteMany: jest.fn().mockResolvedValue({ count }),
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
    board: purgeable(),
    activity: sweepable(0),
    adminAuditLog: sweepable(0),
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (t: unknown) => unknown)({})
        : Promise.all(arg as unknown[]),
    ),
    emailVerificationCode: sweepable(2),
    emailChangeCode: sweepable(1),
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
    command: sweepable(0),
    reminderSent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as PrismaService;
}

const storageMock = {
  attachmentPath: (name: string) => `/blobs/${name}`,
  remove: jest.fn().mockResolvedValue(undefined),
  listBlobs: jest.fn().mockResolvedValue([]),
  listTempBlobs: jest.fn().mockResolvedValue([]),
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
    (storageMock.listTempBlobs as jest.Mock).mockResolvedValue([]);
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
    (prisma.dataExport.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
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
    (prisma.command.findMany as jest.Mock).mockResolvedValue([{ id: "cmd-1" }]);
    (prisma.command.deleteMany as jest.Mock).mockResolvedValue({ count: 7 });
    const service = new MaintenanceService(prisma, storageMock, opsMock);
    const removed = await service.sweepCommands();
    expect(removed).toBe(7);
    const call = (prisma.command.findMany as jest.Mock).mock.calls[0][0] as {
      where: { createdAt: { lt: Date } };
    };
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it("purges stale boards with their rows, feed, log, shares and blobs (TASK-148)", async () => {
    const prisma = makePrisma();
    (prisma.board.findMany as jest.Mock).mockResolvedValue([{ id: "b1" }]);
    (prisma.board.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    // The per-card passes have nothing left; only the board chunk sees rows.
    (prisma.card.findMany as jest.Mock).mockImplementation(
      async (args: { where: { column?: unknown } }) =>
        args.where.column ? [{ id: "c1" }] : [],
    );
    (prisma.attachment.findMany as jest.Mock).mockImplementation(
      async (args: { where: { cardId?: unknown } }) =>
        args.where.cardId
          ? [
              {
                storedName: "gone.bin",
                thumbnailName: "t.jpg",
                posterName: null,
              },
            ]
          : [],
    );
    (prisma.activity.findMany as jest.Mock).mockResolvedValue([
      { id: "act-1" },
    ]);
    (prisma.activity.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.command.findMany as jest.Mock).mockResolvedValue([{ id: "cmd-1" }]);
    (prisma.command.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    const service = new MaintenanceService(prisma, storageMock, opsMock);

    const removed = await service.purgeSoftDeleted();

    expect(removed).toBe(1);
    // The feed and log go in pages by row id before the final transaction
    // (TASK-156), not as one boardId batch inside it.
    expect(prisma.command.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["cmd-1"] } },
    });
    expect(prisma.boardShare.deleteMany).toHaveBeenCalledWith({
      where: { boardId: { in: ["b1"] }, mode: "live" },
    });
    expect(prisma.activity.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["act-1"] } },
    });
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/gone.bin");
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/t.jpg");
  });

  it("purges a stale board's feed and command log in bounded pages before the final board transaction (TASK-156)", async () => {
    const prisma = makePrisma();
    const ids = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
    (prisma.board.findMany as jest.Mock).mockResolvedValue([{ id: "b1" }]);
    (prisma.board.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    // The earlier passes reclaimed the cards; the board chunk only has
    // feed/log work — a full PURGE_CHUNK page, then a short one.
    (prisma.activity.findMany as jest.Mock)
      .mockResolvedValueOnce(ids(PURGE_CHUNK, "act-a"))
      .mockResolvedValueOnce(ids(120, "act-b"));
    (prisma.activity.deleteMany as jest.Mock)
      .mockResolvedValueOnce({ count: PURGE_CHUNK })
      .mockResolvedValueOnce({ count: 120 });
    (prisma.command.findMany as jest.Mock)
      .mockResolvedValueOnce(ids(PURGE_CHUNK, "cmd-a"))
      .mockResolvedValueOnce(ids(40, "cmd-b"));
    (prisma.command.deleteMany as jest.Mock)
      .mockResolvedValueOnce({ count: PURGE_CHUNK })
      .mockResolvedValueOnce({ count: 40 });
    const service = new MaintenanceService(prisma, storageMock, opsMock);

    const removed = await service.purgeSoftDeleted();

    // The board itself is deleted exactly once, by the final transaction.
    expect(removed).toBe(1);
    expect(prisma.board.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] } },
    });
    // Feed and log go as two pages by row id — never one unbounded
    // boardId batch inside the transaction.
    expect(
      (prisma.activity.deleteMany as jest.Mock).mock.calls.map(
        (call) => call[0].where.id.in.length,
      ),
    ).toEqual([PURGE_CHUNK, 120]);
    expect(
      (prisma.activity.deleteMany as jest.Mock).mock.calls.every(
        (call) => call[0].where.boardId === undefined,
      ),
    ).toBe(true);
    expect(
      (prisma.command.deleteMany as jest.Mock).mock.calls.map(
        (call) => call[0].where.id.in.length,
      ),
    ).toEqual([PURGE_CHUNK, 40]);
    // Each page is read with a take bound and a boardId filter.
    expect((prisma.activity.findMany as jest.Mock).mock.calls).toHaveLength(2);
    expect((prisma.activity.findMany as jest.Mock).mock.calls[0][0]).toEqual({
      where: { boardId: { in: ["b1"] } },
      select: { id: true },
      take: PURGE_CHUNK,
    });
    // The card pages found nothing, so the only transaction left is the
    // small final one that deletes the subtree tail and the board.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("deletes expired and long-revoked board shares (TASK-148)", async () => {
    const prisma = makePrisma();
    (prisma.boardShare.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
    const service = new MaintenanceService(prisma, storageMock, opsMock);

    const removed = await service.sweepShares();

    expect(removed).toBe(2);
    const where = (prisma.boardShare.deleteMany as jest.Mock).mock.calls[0][0]
      .where as { OR: Array<Record<string, unknown>> };
    expect(where.OR[0]).toEqual({
      expiresAt: { not: null, lt: expect.any(Date) },
    });
    expect(where.OR[1]).toEqual({
      revokedAt: { not: null, lt: expect.any(Date) },
      OR: [{ boardId: null }, { board: { deletedAt: null } }],
    });
  });

  it("keeps a revoked share while its board is soft-deleted inside the restore window (TASK-156)", async () => {
    const prisma = makePrisma();
    (prisma.boardShare.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    const service = new MaintenanceService(prisma, storageMock, opsMock);

    const removed = await service.sweepShares();

    // A long-revoked share on a live board still goes; a share revoked by
    // the board delete (source soft-deleted, restorable for the retention
    // window) must survive, or a day-2..30 restore silently loses it.
    expect(removed).toBe(1);
    const revoked = (prisma.boardShare.deleteMany as jest.Mock).mock.calls[0][0]
      .where.OR[1] as {
      revokedAt: unknown;
      OR: Array<Record<string, unknown>>;
    };
    expect(revoked.revokedAt).toEqual({
      not: null,
      lt: expect.any(Date),
    });
    // The clause may only match shares whose source board is live/archived
    // (deletedAt null) or detached by the purge (boardId null) — never one
    // hanging on a soft-deleted, still restorable board.
    expect(revoked.OR).toEqual([
      { boardId: null },
      { board: { deletedAt: null } },
    ]);
  });

  it("trims the activity feed to the retention window (TASK-148)", async () => {
    const prisma = makePrisma();
    (prisma.activity.findMany as jest.Mock).mockResolvedValue([{ id: "a-1" }]);
    (prisma.activity.deleteMany as jest.Mock).mockResolvedValue({ count: 9 });
    const service = new MaintenanceService(prisma, storageMock, opsMock);

    const removed = await service.sweepActivity();

    expect(removed).toBe(9);
    const call = (prisma.activity.findMany as jest.Mock).mock.calls[0][0] as {
      where: { createdAt: { lt: Date } };
    };
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it("trims the admin audit log on its own window (TASK-148)", async () => {
    const prisma = makePrisma();
    (prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue([
      { id: "audit-1" },
    ]);
    (prisma.adminAuditLog.deleteMany as jest.Mock).mockResolvedValue({
      count: 4,
    });
    const service = new MaintenanceService(prisma, storageMock, opsMock);

    const removed = await service.sweepAudit();

    expect(removed).toBe(4);
    const call = (prisma.adminAuditLog.findMany as jest.Mock).mock
      .calls[0][0] as { where: { createdAt: { lt: Date } } };
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it("removes abandoned .tmp- blobs but spares fresh ones (TASK-148)", async () => {
    const prisma = makePrisma();
    (storageMock.listTempBlobs as jest.Mock).mockResolvedValue([
      {
        name: ".tmp-old.jpg",
        absPath: "/blobs/.tmp-old.jpg",
        mtimeMs: LONG_AGO,
      },
      {
        name: ".tmp-live.jpg",
        absPath: "/blobs/.tmp-live.jpg",
        mtimeMs: Date.now(),
      },
    ]);
    const service = new MaintenanceService(prisma, storageMock, opsMock);

    const removed = await service.sweepOrphanBlobs();

    expect(removed).toBe(1);
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/.tmp-old.jpg");
    expect(storageMock.remove).not.toHaveBeenCalledWith("/blobs/.tmp-live.jpg");
  });
});
