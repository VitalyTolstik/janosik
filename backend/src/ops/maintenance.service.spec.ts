import type { PrismaService } from "@/common/prisma/prisma.service";
import type { StorageService } from "@/attachments/storage.service";
import type { AccountDeletionService } from "@/users/account-deletion.service";
import type { OpsSettingsService } from "./ops-settings.service";
import {
  MaintenanceService,
  MAINTENANCE_JOBS,
  PURGE_BOARD_TX_MAX_WAIT_MS,
  PURGE_BOARD_TX_TIMEOUT_MS,
  PURGE_CHUNK,
} from "./maintenance.service";

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
  const prisma = {
    attachment: purgeable(),
    comment: purgeable(),
    commentRevision: purgeable(),
    checklistItem: purgeable(),
    checklist: purgeable(),
    cardLink: purgeable(),
    cardLabel: purgeable(),
    card: {
      ...purgeable(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    column: purgeable(),
    label: purgeable(),
    board: purgeable(),
    activity: sweepable(0),
    adminAuditLog: sweepable(0),
    securityAuditLog: sweepable(0),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
    emailVerificationCode: sweepable(2),
    emailChangeCode: sweepable(1),
    passwordResetToken: sweepable(0),
    refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
    adminRefreshToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    boardShare: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    boardShareSnapshotBlob: purgeable(),
    boardMember: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    dataExport: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    command: sweepable(0),
    commandDetail: sweepable(0),
    commandKey: sweepable(0),
    commandPreimage: sweepable(0),
    agentRun: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    reminderSent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    attentionNotification: sweepable(0),
    notificationMail: sweepable(0),
    approvalRequest: purgeable(),
    agentSession: {
      ...purgeable(),
      findUnique: jest
        .fn()
        .mockResolvedValue({ name: "agent", clientName: null }),
    },
    idempotencyRecord: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaService;
  // Interactive callbacks see the same client, as Prisma's `tx` would.
  (
    prisma as unknown as {
      $transaction: (arg: unknown) => Promise<unknown>;
    }
  ).$transaction = jest.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (t: unknown) => unknown)(prisma)
      : Promise.all(arg as unknown[]),
  );
  return prisma;
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

const accountDeletionMock = {
  usersDueForDeletion: jest.fn().mockResolvedValue([]),
  deleteAccount: jest.fn(),
  reapOrphanBoards: jest.fn().mockResolvedValue(0),
} as unknown as AccountDeletionService & {
  usersDueForDeletion: jest.Mock;
  deleteAccount: jest.Mock;
  reapOrphanBoards: jest.Mock;
};

const attentionMock = {
  notifyClaimExpired: jest.fn().mockResolvedValue(undefined),
} as never;

const approvalsMock = { expireOverdue: jest.fn() } as never;

/** Epoch mtime — unambiguously older than any grace window. */
const LONG_AGO = 0;

describe("MaintenanceService", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (
      approvalsMock as { expireOverdue: jest.Mock }
    ).expireOverdue.mockResolvedValue(0);
    (storageMock.listBlobs as jest.Mock).mockResolvedValue([]);
    (storageMock.listTempBlobs as jest.Mock).mockResolvedValue([]);
    (storageMock.remove as jest.Mock).mockResolvedValue(undefined);
    (accountDeletionMock.usersDueForDeletion as jest.Mock).mockResolvedValue(
      [],
    );
    (accountDeletionMock.reapOrphanBoards as jest.Mock).mockResolvedValue(0);
  });

  it("counts every sweep under 'all'", async () => {
    const service = new MaintenanceService(
      makePrisma(),
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );
    const results = await service.run("all");
    const total = results.reduce((sum, entry) => sum + entry.removed, 0);
    // codes 2+1, tokens 4+1, shares 3, invitations 5.
    expect(total).toBe(16);
    expect(results.map((entry) => entry.job)).toContain("sweep-codes");
  });

  it("prunes finished notification mail, including terminal failures, at the retention cutoff", async () => {
    const prisma = makePrisma();
    (opsMock.retentionDays as jest.Mock).mockResolvedValue(2);
    jest.useFakeTimers({ now: new Date("2026-11-19T12:00:00Z") });
    try {
      await new MaintenanceService(
        prisma,
        storageMock,
        opsMock,
        accountDeletionMock,
        attentionMock,
        approvalsMock,
      ).sweepAttention();
      expect(prisma.notificationMail.deleteMany).toHaveBeenCalledWith({
        where: { finishedAt: { lt: new Date("2026-11-17T12:00:00Z") } },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("clears a lapsed claim, notifies once and is idempotent on re-run", async () => {
    const prisma = makePrisma();
    const leaseUntil = new Date(Date.now() - 60_000);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      {
        id: "card-1",
        title: "Task",
        claimedBy: "user-1",
        claimedByTokenId: "token-1",
        claimedBySessionId: "session-1",
        leaseUntil,
        column: { boardId: "board-1" },
      },
    ]);
    (prisma.card.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const notify = jest.fn().mockResolvedValue(undefined);
    (
      attentionMock as unknown as { notifyClaimExpired: jest.Mock }
    ).notifyClaimExpired = notify;
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

    expect(await service.sweepClaims()).toBe(1);
    expect(prisma.card.updateMany).toHaveBeenCalledWith({
      where: { id: "card-1", leaseUntil: { lte: expect.any(Date) } },
      data: {
        claimedBy: null,
        claimedByTokenId: null,
        claimedBySessionId: null,
        leaseUntil: null,
      },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: "board-1",
        cardId: "card-1",
        claimedBy: "user-1",
        leaseUntil,
      }),
    );

    // A concurrent/fresh claim makes the conditional update a no-op: the
    // sweep reports zero and does not send a second notification.
    (prisma.card.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    expect(await service.sweepClaims()).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("sweeps expired idempotency records (TASK-166.4)", async () => {
    const prisma = makePrisma();
    (prisma.idempotencyRecord.deleteMany as jest.Mock).mockResolvedValue({
      count: 2,
    });
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );
    expect(await service.sweepIdempotency()).toBe(2);
    expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: expect.any(Date) } },
    });
  });

  it("deletes expired export artifacts", async () => {
    const prisma = makePrisma();
    (prisma.dataExport.findMany as jest.Mock).mockResolvedValue([
      { id: "exp-1", storedName: "export-1.json" },
    ]);
    (prisma.dataExport.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );
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
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );
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
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );
    const removed = await service.sweepOrphanBlobs();
    expect(removed).toBe(0);
    expect(storageMock.remove).not.toHaveBeenCalled();
  });

  it("uses an explicit retention window for a panel purge (QA-A1)", async () => {
    const prisma = makePrisma();
    jest.useFakeTimers({ now: new Date("2026-11-19T12:00:00Z") });
    try {
      const service = new MaintenanceService(
        prisma,
        storageMock,
        opsMock,
        accountDeletionMock,
        attentionMock,
        approvalsMock,
      );
      await service.purgeSoftDeleted(365);
      const call = (prisma.card.findMany as jest.Mock).mock.calls[0][0] as {
        where: { deletedAt: { lte: Date } };
      };
      expect(call.where.deletedAt.lte).toEqual(
        new Date("2025-11-19T12:00:00Z"),
      );
      // The stored setting must not override the window the owner confirmed.
      expect(opsMock.retentionDays).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("purges stale cards in bounded chunks, each in its own transaction (B-7)", async () => {
    const prisma = makePrisma();
    const ids = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
    const firstCards = ids(500, "a").map((row) => ({
      ...row,
      column: { boardId: "b1" },
    }));
    const secondCards = ids(120, "b").map((row) => ({
      ...row,
      column: { boardId: "b1" },
    }));
    (prisma.card.findMany as jest.Mock)
      .mockResolvedValueOnce(ids(500, "a"))
      .mockResolvedValueOnce(firstCards)
      .mockResolvedValueOnce(ids(500, "a"))
      .mockResolvedValueOnce(ids(120, "b"))
      .mockResolvedValueOnce(secondCards)
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
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

    const removed = await service.purgeSoftDeleted();

    expect(removed).toBe(620);
    // Two card chunks → two transactions (500 + the 120 remainder).
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    const firstChunk = (prisma.card.deleteMany as jest.Mock).mock.calls[0][0]
      .where.id.in as string[];
    expect(firstChunk).toHaveLength(500);
    // TASK-185.1: the card path removes revisions and comment snapshots
    // before the parent comment rows.
    expect(prisma.commentRevision.deleteMany).toHaveBeenCalledWith({
      where: { comment: { cardId: { in: firstChunk } } },
    });
    expect(
      (prisma.commentRevision.deleteMany as jest.Mock).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      (prisma.comment.deleteMany as jest.Mock).mock.invocationCallOrder[0]!,
    );
    // A purged card's attachment blobs are removed with it.
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/card-blob.bin");
  });

  it("deletes revisions and comment snapshots before a hard comment purge (TASK-185.1)", async () => {
    const prisma = makePrisma();
    (prisma.comment.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: "cm-1" }])
      .mockResolvedValueOnce([
        { id: "cm-1", card: { column: { boardId: "b1" } } },
      ])
      .mockResolvedValueOnce([{ id: "cm-1" }])
      .mockResolvedValue([]);
    (prisma.comment.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

    const removed = await service.purgeSoftDeleted();

    expect(removed).toBe(1);
    expect(prisma.commentRevision.deleteMany).toHaveBeenCalledWith({
      where: { commentId: { in: ["cm-1"] } },
    });
    expect(
      (prisma.commentRevision.deleteMany as jest.Mock).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      (prisma.comment.deleteMany as jest.Mock).mock.invocationCallOrder[0]!,
    );
    // The Activity cleanup goes through the JSON-key helper.
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("trims the command log to the retention window (TASK-84)", async () => {
    const prisma = makePrisma();
    (prisma.command.findMany as jest.Mock).mockResolvedValue([
      { id: "cmd-1", boardId: "board-1" },
    ]);
    (prisma.command.deleteMany as jest.Mock).mockResolvedValue({ count: 7 });
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );
    const removed = await service.sweepCommands();
    expect(removed).toBe(7);
    const call = (prisma.command.findMany as jest.Mock).mock.calls[0][0] as {
      where: { createdAt: { lt: Date } };
    };
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
    expect(prisma.command.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ id: "cmd-1", boardId: "board-1" }] },
    });
  });

  it("deletes stale pre-images before their commands (ADR §6.14)", async () => {
    const prisma = makePrisma();
    const order: string[] = [];
    (prisma.commandPreimage.findMany as jest.Mock).mockResolvedValue([
      { commandId: "cmd-1" },
    ]);
    (prisma.commandPreimage.deleteMany as jest.Mock).mockImplementation(
      async () => {
        order.push("preimage");
        return { count: 2 };
      },
    );
    (prisma.command.findMany as jest.Mock).mockResolvedValue([
      { id: "cmd-1", boardId: "board-1" },
    ]);
    (prisma.command.deleteMany as jest.Mock).mockImplementation(async () => {
      order.push("command");
      return { count: 7 };
    });
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

    expect(await service.sweepCommands()).toBe(9);
    expect(order).toEqual(["preimage", "command"]);
    expect(prisma.commandPreimage.deleteMany).toHaveBeenCalledWith({
      where: { commandId: { in: ["cmd-1"] } },
    });
    const preimageCall = (prisma.commandPreimage.findMany as jest.Mock).mock
      .calls[0][0] as { where: { createdAt: { lt: Date } } };
    expect(preimageCall.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it("sweeps only keys without a live command, in a bounded query (TASK-200.11)", async () => {
    const prisma = makePrisma();
    (prisma.$queryRaw as jest.Mock).mockImplementation(
      async (sql: { strings: string[] }) => {
        const text = sql.strings.join("?");
        if (text.includes("CommandKey")) return [{ id: "orphan-key" }];
        return [];
      },
    );
    (prisma.commandKey.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.commandKey.deleteMany as jest.Mock).mockResolvedValue({
      count: 1,
    });
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );
    expect(await service.sweepCommands()).toBe(1);
    const keyDelete = (prisma.$executeRaw as jest.Mock).mock.calls
      .map((call) => call[0] as { strings: string[] })
      .find((sql) =>
        sql.strings.join("?").includes('DELETE FROM "CommandKey"'),
      );
    expect(keyDelete?.strings.join("?")).toContain("NOT EXISTS");
    expect(keyDelete?.strings.join("?")).toContain('c."boardId"');
    expect(prisma.commandKey.deleteMany).not.toHaveBeenCalled();
    const keyQuery = (prisma.$queryRaw as jest.Mock).mock.calls
      .map((call) => call[0] as { strings: string[] })
      .find((sql) => sql.strings.join("?").includes("CommandKey"));
    expect(keyQuery?.strings.join("?")).toContain("NOT EXISTS");
    expect(keyQuery?.strings.join("?")).toContain('c."boardId"');
    expect(keyQuery?.strings.join("?")).toContain("LIMIT");
    expect(prisma.commandKey.findMany).not.toHaveBeenCalled();
  });

  it("creates the current and future command-log partitions (TASK-200.11)", async () => {
    const prisma = makePrisma();
    jest.useFakeTimers({ now: new Date("2026-11-23T12:00:00Z") });
    try {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { created: "Command_202611" },
      ]);
      const service = new MaintenanceService(
        prisma,
        storageMock,
        opsMock,
        accountDeletionMock,
        attentionMock,
        approvalsMock,
      );
      const result = await service.ensureCommandPartitions();
      // Previous month + current + three future months.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(5);
      expect(result.removed).toBe(0);
      expect(result.detail).toContain("created");
      expect(result.detail).toContain("Command_202611");
      const firstSql = (prisma.$queryRaw as jest.Mock).mock.calls[0]![0] as {
        strings: string[];
      };
      expect(firstSql.strings.join("?")).toContain(
        "janosik_ensure_command_partition",
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports a default-partition skip and keeps later months running (TASK-200.11)", async () => {
    const prisma = makePrisma();
    jest.useFakeTimers({ now: new Date("2026-11-23T12:00:00Z") });
    try {
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ created: "skipped:Command_default=2;" }])
        .mockResolvedValue([{ created: "Command_202612" }]);
      const service = new MaintenanceService(
        prisma,
        storageMock,
        opsMock,
        accountDeletionMock,
        attentionMock,
        approvalsMock,
      );
      const result = await service.ensureCommandPartitions();
      expect(result.removed).toBe(0);
      expect(result.detail).toContain("skipped");
      expect(result.detail).toContain("Command_default=2");
      expect(result.detail).toContain("created Command_202612");
      // The skipped month did not stop the remaining four calls.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(5);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not recreate a month already dropped by a short retention window (TASK-200.11)", async () => {
    const prisma = makePrisma();
    jest.useFakeTimers({ now: new Date("2026-11-23T12:00:00Z") });
    try {
      (opsMock.retentionDays as jest.Mock).mockResolvedValue(7);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      const service = new MaintenanceService(
        prisma,
        storageMock,
        opsMock,
        accountDeletionMock,
        attentionMock,
        approvalsMock,
      );
      await service.ensureCommandPartitions();
      // October is fully outside a 7-day window; only Nov..Feb are ensured.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
      (opsMock.retentionDays as jest.Mock).mockResolvedValue(30);
    }
  });

  it("keeps later maintenance jobs running when one sweep fails", async () => {
    const prisma = makePrisma();
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );
    const dispatch = jest
      .spyOn(
        service as unknown as {
          dispatch: (job: string) => Promise<number>;
        },
        "dispatch",
      )
      .mockImplementation(async (job: string) => {
        if (job === "ensure-command-partitions") {
          throw new Error("default partition wedged");
        }
        return 0;
      });
    const results = await service.run("all");
    expect(results).toHaveLength(MAINTENANCE_JOBS.length);
    expect(
      results.find((row) => row.job === "ensure-command-partitions"),
    ).toMatchObject({ removed: 0, detail: expect.stringContaining("failed:") });
    expect(results.some((row) => row.job === "sweep-commands")).toBe(true);
    dispatch.mockRestore();
  });

  it("drops whole expired command-log months before row chunks (TASK-200.11)", async () => {
    const prisma = makePrisma();
    jest.useFakeTimers({ now: new Date("2026-11-23T12:00:00Z") });
    try {
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([
          { name: "Command_202001" },
          { name: "CommandDetail_202001" },
          { name: "Command_202611" },
        ])
        .mockResolvedValueOnce([{ removed: 123n }]);
      const service = new MaintenanceService(
        prisma,
        storageMock,
        opsMock,
        accountDeletionMock,
        attentionMock,
        approvalsMock,
      );
      expect(await service.sweepCommands()).toBe(123);
      // One catalog read, one drop, one orphan-key probe; the current month
      // stays.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
      const dropSql = (prisma.$queryRaw as jest.Mock).mock.calls[1]![0] as {
        strings: string[];
      };
      expect(dropSql.strings.join("?")).toContain(
        "janosik_drop_command_partition",
      );
      expect(prisma.command.findMany).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("retries a lock-contended partition drop without failing the sweep (TASK-200.11)", async () => {
    const prisma = makePrisma();
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([{ name: "Command_202001" }])
      .mockResolvedValueOnce([{ removed: -1n }])
      .mockResolvedValueOnce([{ removed: -1n }])
      .mockResolvedValueOnce([{ removed: 7n }]);
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );
    expect(
      await service.dropExpiredCommandPartitions(new Date(Date.now())),
    ).toBe(7);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it("sweeps stale empty runs but keeps runs with commands (ADR §6.14)", async () => {
    const prisma = makePrisma();
    const old = new Date(Date.now() - 90 * 86_400_000);
    (prisma.agentRun.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: "run-old",
          kind: "batch",
          status: "applied",
          revertsRunId: null,
          createdAt: old,
        },
        {
          id: "run-live",
          kind: "batch",
          status: "applied",
          revertsRunId: null,
          createdAt: old,
        },
      ])
      .mockResolvedValueOnce([]);
    (prisma.command.findMany as jest.Mock).mockResolvedValue([
      { runId: "run-live" },
    ]);
    (prisma.agentRun.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

    expect(await service.sweepRuns()).toBe(1);
    expect(prisma.agentRun.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["run-old"] } },
    });
  });

  it("deletes a reverted original together with its revert child", async () => {
    const prisma = makePrisma();
    const old = new Date(Date.now() - 90 * 86_400_000);
    (prisma.agentRun.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: "run-orig",
          kind: "batch",
          status: "reverted",
          revertsRunId: null,
          createdAt: old,
        },
        {
          id: "run-revert",
          kind: "revert",
          status: "applied",
          revertsRunId: "run-orig",
          createdAt: old,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "run-revert",
          kind: "revert",
          status: "applied",
          revertsRunId: "run-orig",
          createdAt: old,
        },
      ])
      .mockResolvedValueOnce([{ id: "run-orig" }])
      .mockResolvedValueOnce([]);
    (prisma.command.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.agentRun.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

    expect(await service.sweepRuns()).toBe(2);
    expect(prisma.agentRun.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["run-orig", "run-revert"] } },
    });
  });

  it("purges stale boards with their rows, feed, log, shares and blobs (TASK-148)", async () => {
    const prisma = makePrisma();
    (prisma.board.findMany as jest.Mock).mockResolvedValue([{ id: "b1" }]);
    (prisma.board.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    // The per-card passes have nothing left; only the board chunk sees rows.
    (prisma.card.findMany as jest.Mock).mockImplementation(
      async (args: { where: { column?: unknown } }) =>
        args.where.column ? [{ id: "c1", column: { boardId: "b1" } }] : [],
    );
    (prisma.attachment.findMany as jest.Mock).mockImplementation(
      async (args: { where: { cardId?: unknown; card?: unknown } }) =>
        args.where.cardId || args.where.card
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
    (prisma.commandPreimage.findMany as jest.Mock).mockResolvedValue([
      { commandId: "pre-1" },
    ]);
    (prisma.commandPreimage.deleteMany as jest.Mock).mockResolvedValue({
      count: 1,
    });
    (prisma.command.findMany as jest.Mock).mockResolvedValue([
      { id: "cmd-1", boardId: "board-1" },
    ]);
    (prisma.command.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

    const removed = await service.purgeSoftDeleted();

    expect(removed).toBe(1);
    // ADR §6.14 order: preimages → commands → runs.
    expect(prisma.commandPreimage.deleteMany).toHaveBeenCalledWith({
      where: { commandId: { in: ["pre-1"] }, boardId: "b1" },
    });
    expect(prisma.agentRun.deleteMany).toHaveBeenCalledWith({
      where: { boardId: "b1" },
    });
    expect(
      (prisma.commandPreimage.deleteMany as jest.Mock).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      (prisma.command.deleteMany as jest.Mock).mock.invocationCallOrder[0]!,
    );
    // The feed and log go in pages before the final transaction (TASK-156),
    // with the board id repeated on the command delete (defence in depth).
    expect(prisma.command.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["cmd-1"] }, boardId: "b1" },
    });
    expect(prisma.boardShare.deleteMany).toHaveBeenCalledWith({
      where: { boardId: "b1", mode: "live" },
    });
    expect(prisma.activity.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["act-1"] } },
    });
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/gone.bin");
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/t.jpg");
  });

  it("purges a stale board's feed and command log in bounded pages under the board lock (TASK-156)", async () => {
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
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

    const removed = await service.purgeSoftDeleted();

    // The board itself is deleted exactly once, by the final transaction.
    expect(removed).toBe(1);
    expect(prisma.board.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "b1" }),
    });
    // TASK-185.1: the board fallback removes revisions before comments.
    expect(prisma.commentRevision.deleteMany).toHaveBeenCalledWith({
      where: { comment: { card: { column: { boardId: "b1" } } } },
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
    expect(
      (prisma.commandDetail.deleteMany as jest.Mock).mock.calls.map(
        (call) => call[0].where.commandId.in.length,
      ),
    ).toEqual([PURGE_CHUNK, 40]);
    expect(
      (prisma.commandKey.deleteMany as jest.Mock).mock.calls.map(
        (call) => call[0].where.id.in.length,
      ),
    ).toEqual([PURGE_CHUNK, 40]);
    // No purge statement carries more than one chunk, and every key/detail
    // statement is scoped by a board or command id.
    for (const call of [
      ...(prisma.command.deleteMany as jest.Mock).mock.calls,
      ...(prisma.commandDetail.deleteMany as jest.Mock).mock.calls,
      ...(prisma.commandKey.deleteMany as jest.Mock).mock.calls,
    ]) {
      const list = call[0].where.id?.in ?? call[0].where.commandId?.in;
      expect(list.length).toBeLessThanOrEqual(PURGE_CHUNK);
    }
    expect(prisma.commandKey.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ids(PURGE_CHUNK, "cmd-a").map((row) => row.id) },
        boardId: "b1",
      },
    });
    // Each page is read with a take bound and a boardId filter.
    expect((prisma.activity.findMany as jest.Mock).mock.calls).toHaveLength(2);
    expect((prisma.activity.findMany as jest.Mock).mock.calls[0][0]).toEqual({
      where: { boardId: "b1" },
      select: { id: true },
      take: PURGE_CHUNK,
    });
    // The whole board subtree runs in one board-locked transaction with a
    // generous bound instead of Prisma's 5 s default.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: PURGE_BOARD_TX_MAX_WAIT_MS,
      timeout: PURGE_BOARD_TX_TIMEOUT_MS,
    });
  });

  it("deletes expired and long-revoked board shares (TASK-148)", async () => {
    const prisma = makePrisma();
    (prisma.boardShare.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

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
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

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
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

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
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

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
    const service = new MaintenanceService(
      prisma,
      storageMock,
      opsMock,
      accountDeletionMock,
      attentionMock,
      approvalsMock,
    );

    const removed = await service.sweepOrphanBlobs();

    expect(removed).toBe(1);
    expect(storageMock.remove).toHaveBeenCalledWith("/blobs/.tmp-old.jpg");
    expect(storageMock.remove).not.toHaveBeenCalledWith("/blobs/.tmp-live.jpg");
  });
});
