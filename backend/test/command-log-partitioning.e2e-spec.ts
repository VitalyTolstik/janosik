import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import "@/config/env";
import { readCommandLogStats } from "@/admin/command-log-stats";
import {
  addMonths,
  commandPartitionName,
  monthSuffix,
  utcMonthStart,
} from "@/commands/command-log-partitions";
import { commandDetailMap } from "@/commands/command-detail-store";
import { MaintenanceService } from "@/ops/maintenance.service";
import { wipeAll } from "./support/wipe";

/**
 * TASK-200.11 — the migrated command log behaves like the old table for the
 * correctness paths that matter, and like a partitioned log for retention:
 *
 * - Command/detail/pre-image rows route to their monthly partition;
 * - a time-bounded read is pruned to one partition by the planner;
 * - the global CommandKey registry releases ids with the command/partition;
 * - the details side table batches by commandId and board scope;
 * - deleting a command removes its side row through the key cascade;
 * - whole-month retention drops all three partitions and their keys;
 * - the composite PK and the parent indexes exist on every partition.
 *
 * The heavier replay/resync/undo/admin coverage lives in the existing
 * `events`, `runs`, `admin` and `commands-*` suites, which now run on this
 * same partitioned schema.
 */
describe("TASK-200.11 command log partitions (e2e)", () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const userId = `cmdlog-user-${suffix}`;
  const boardId = `cmdlog-board-${suffix}`;
  const now = new Date();
  const current = utcMonthStart(now);
  const previous = addMonths(current, -1);
  const archived = utcMonthStart(new Date("2020-02-10T00:00:00Z"));

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: { id: userId, email: `cmdlog-${suffix}@example.com` },
    });
    await prisma.board.create({
      data: { id: boardId, title: "Command log partitions" },
    });
    for (const month of [previous, current, archived]) {
      await prisma.$queryRawUnsafe(
        `SELECT janosik_ensure_command_partition($1::date)`,
        `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}-01`,
      );
    }
  });

  afterAll(async () => {
    await prisma.command.deleteMany({ where: { boardId } });
    await prisma.commandDetail.deleteMany({
      where: { boardId },
    });
    await prisma.commandKey.deleteMany({ where: { boardId } });
    await prisma.commandPreimage.deleteMany({ where: { boardId } });
    await prisma.board.deleteMany({ where: { id: boardId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$queryRawUnsafe(
      `SELECT janosik_drop_command_partition($1::date)`,
      "2020-02-01",
    );
    await prisma.$disconnect();
  });

  async function createCommand(
    key: string,
    createdAt: Date,
    withDetail = true,
  ): Promise<void> {
    await prisma.command.create({
      data: {
        id: `cmdlog-${suffix}-${key}`,
        boardId,
        actorId: userId,
        actorType: "agent",
        type: "UPDATE_CARD",
        payload: { type: "UPDATE_CARD", cardId: "card-x", at: 1 },
        result: {},
        touches: ["card:card-x"],
        createdAt,
      },
    });
    if (withDetail) {
      await prisma.commandDetail.create({
        data: {
          commandId: `cmdlog-${suffix}-${key}`,
          boardId,
          createdAt,
          data: {
            changes: [{ field: "description", from: "before", to: "after" }],
          },
        },
      });
    }
  }

  it("routes command, detail and pre-image rows to the month partition", async () => {
    await createCommand("current", new Date(current.getTime() + 3_600_000));
    await prisma.commandPreimage.create({
      data: {
        commandId: `cmdlog-${suffix}-current`,
        boardId,
        runId: `run-${suffix}`,
        data: { schemaVersion: 1, entities: [] },
        createdAt: new Date(current.getTime() + 3_600_000),
      },
    });

    const rows = await prisma.$queryRawUnsafe<
      Array<{ command_part: string; detail_part: string; pre_part: string }>
    >(
      `SELECT c.tableoid::regclass::text AS command_part,
              d.tableoid::regclass::text AS detail_part,
              p.tableoid::regclass::text AS pre_part
         FROM "Command" c
         JOIN "CommandDetail" d ON d."commandId" = c."id"
         JOIN "CommandPreimage" p ON p."commandId" = c."id"
        WHERE c."id" = $1`,
      `cmdlog-${suffix}-current`,
    );
    const expected = monthSuffix(current);
    expect(rows[0]!.command_part).toContain(`Command_${expected}`);
    expect(rows[0]!.detail_part).toContain(`CommandDetail_${expected}`);
    expect(rows[0]!.pre_part).toContain(`CommandPreimage_${expected}`);
  });

  it("prunes a time-bounded read to the current month", async () => {
    // A row in the previous month makes pruning observable.
    await createCommand("previous", new Date(previous.getTime() + 3_600_000));

    const plan = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": unknown }>>(
      `EXPLAIN (FORMAT JSON)
       SELECT * FROM "Command"
        WHERE "createdAt" >= $1::timestamp AND "createdAt" < $2::timestamp`,
      current.toISOString().slice(0, 19).replace("T", " "),
      addMonths(current, 1).toISOString().slice(0, 19).replace("T", " "),
    );
    const text = JSON.stringify(plan);
    expect(text).toContain(`Command_${monthSuffix(current)}`);
    expect(text).not.toContain(`Command_${monthSuffix(previous)}`);
    expect(text).not.toContain("Command_default");
  });

  it("batches display details by commandId", async () => {
    const details = await commandDetailMap(prisma, boardId, [
      `cmdlog-${suffix}-current`,
      `cmdlog-${suffix}-previous`,
      `cmdlog-${suffix}-missing`,
    ]);
    expect(details.size).toBe(2);
    expect(details.get(`cmdlog-${suffix}-current`)).toEqual({
      changes: [{ field: "description", from: "before", to: "after" }],
    });
  });

  it("deletes the side row with its command through the trigger", async () => {
    await prisma.command.deleteMany({
      where: { id: `cmdlog-${suffix}-previous` },
    });
    expect(
      await prisma.commandDetail.count({
        where: { commandId: `cmdlog-${suffix}-previous` },
      }),
    ).toBe(0);
  });

  it("drops a whole month, including detail and pre-image partitions", async () => {
    await createCommand("archive", new Date(archived.getTime() + 3_600_000));
    await prisma.commandPreimage.create({
      data: {
        commandId: `cmdlog-${suffix}-archive`,
        boardId,
        runId: `run-${suffix}`,
        data: { schemaVersion: 1, entities: [] },
        createdAt: new Date(archived.getTime() + 3_600_000),
      },
    });
    await prisma.$queryRawUnsafe(
      `SELECT janosik_drop_command_partition($1::date)`,
      "2020-02-01",
    );

    const tables = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM pg_class WHERE relname IN
         ('Command_202002', 'CommandDetail_202002', 'CommandPreimage_202002')`,
    );
    expect(tables[0]!.n).toBe(0);
    expect(
      await prisma.command.count({
        where: { id: `cmdlog-${suffix}-archive` },
      }),
    ).toBe(0);
  });

  it("keeps the composite PK and one parent-style index set per partition", async () => {
    const table = commandPartitionName("Command", current);
    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = $1`,
      table,
    );
    const names = indexes.map((row) => row.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        `${table}_pkey`,
        `${table}_boardId_seq_idx`,
        `${table}_boardId_createdAt_seq_idx`,
        `${table}_touches_idx`,
        `${table}_createdAt_idx`,
        `${table}_actorId_createdAt_idx`,
        `${table}_type_createdAt_idx`,
        `${table}_apiTokenId_createdAt_idx`,
        `${table}_agentSessionId_createdAt_idx`,
        `${table}_runId_idx`,
      ]),
    );
    expect(names).toHaveLength(10);
    const pk = await prisma.$queryRawUnsafe<Array<{ columns: string[] }>>(
      `SELECT array_agg(a.attname::text ORDER BY k.ord) AS columns
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = k.attnum
        WHERE rel.relname = $1 AND con.contype = 'p'`,
      table,
    );
    expect(pk[0]!.columns).toEqual(["id", "createdAt"]);
    const commandFks = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = '"Command"'::regclass AND contype = 'f'
        ORDER BY conname`,
    );
    expect(commandFks.map((row) => row.conname)).toEqual([
      "Command_actorId_fkey",
      "Command_boardId_fkey",
    ]);
  });

  it("scopes detail reads by board and does not cascade on a key delete", async () => {
    const fks = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n
         FROM pg_constraint
        WHERE conrelid = '"CommandDetail"'::regclass AND contype = 'f'`,
    );
    expect(fks[0]!.n).toBe(0);
    const index = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM pg_class
        WHERE relname = 'CommandDetail_boardId_commandId_idx'`,
    );
    expect(index[0]!.n).toBe(1);
    const leaked = await commandDetailMap(prisma, `other-board-${suffix}`, [
      `cmdlog-${suffix}-current`,
    ]);
    expect(leaked.size).toBe(0);

    await createCommand("nocascade", current, true);
    await prisma.commandKey.deleteMany({
      where: { id: `cmdlog-${suffix}-nocascade` },
    });
    expect(
      await prisma.commandDetail.count({
        where: { commandId: `cmdlog-${suffix}-nocascade` },
      }),
    ).toBe(1);
    await prisma.command.deleteMany({
      where: { id: `cmdlog-${suffix}-nocascade` },
    });
    expect(
      await prisma.commandDetail.count({
        where: { commandId: `cmdlog-${suffix}-nocascade` },
      }),
    ).toBe(0);
  });

  it("continues the shared seq sequence across partitions", async () => {
    const before = await prisma.command.aggregate({
      where: { boardId },
      _max: { seq: true },
    });
    await createCommand(
      "sequence",
      new Date(current.getTime() + 7_200_000),
      false,
    );
    const after = await prisma.command.findFirstOrThrow({
      where: { id: `cmdlog-${suffix}-sequence` },
      select: { seq: true },
    });
    expect(Number(after.seq)).toBeGreaterThan(Number(before._max.seq));
  });

  it("skips a wedged default month and reports exact default rows", async () => {
    const wedged = new Date(Date.UTC(2019, 7, 15, 12, 0, 0));
    await createCommand("wedged", wedged, false);
    const status = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT janosik_ensure_command_partition($1::date) AS status`,
      "2019-08-01",
    );
    expect(status[0]!.status).toMatch(/^skipped:/);
    const stats = await readCommandLogStats(prisma, 30);
    expect(stats.available).toBe(true);
    expect(stats.defaultRows).toBeGreaterThanOrEqual(1);
    expect(stats.registry).toBeDefined();
    expect(stats.registry?.sizeBytes).toBeGreaterThan(0);
    expect(
      stats.partitions.some((part) => part.name === "Command_201908"),
    ).toBe(false);
    await prisma.command.deleteMany({
      where: { id: `cmdlog-${suffix}-wedged` },
    });
  });

  it("drops a month while a reader is between Command and CommandDetail", async () => {
    await prisma.$queryRawUnsafe(
      `SELECT janosik_ensure_command_partition($1::date)`,
      "2019-03-01",
    );
    await createCommand(
      "locked",
      new Date(Date.UTC(2019, 2, 15, 12, 0, 0)),
      true,
    );
    const reader = new PrismaClient();
    try {
      const read = reader.$transaction(async (tx) => {
        // Same order as a board read: Command first, then CommandDetail.
        await tx.$queryRawUnsafe(
          `SELECT 1 FROM "Command" WHERE "id" = $1`,
          `cmdlog-${suffix}-locked`,
        );
        await tx.$executeRawUnsafe(`SELECT pg_sleep(0.5)`);
        await tx.$queryRawUnsafe(
          `SELECT 1 FROM "CommandDetail" WHERE "commandId" = $1`,
          `cmdlog-${suffix}-locked`,
        );
      });
      await delay(100);
      const dropped = await prisma.$queryRawUnsafe<Array<{ removed: bigint }>>(
        `SELECT janosik_drop_command_partition($1::date) AS removed`,
        "2019-03-01",
      );
      await read;
      expect(Number(dropped[0]!.removed)).toBeGreaterThanOrEqual(0);
      const gone = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM pg_class WHERE relname IN
           ('Command_201903', 'CommandDetail_201903', 'CommandPreimage_201903')`,
      );
      expect(gone[0]!.n).toBe(0);
      expect(
        await prisma.commandKey.count({
          where: { id: `cmdlog-${suffix}-locked` },
        }),
      ).toBe(1);
      await prisma.commandKey.deleteMany({
        where: { id: `cmdlog-${suffix}-locked` },
      });
    } finally {
      await reader.$disconnect();
    }
  });

  it("moves a command's key and detail when createdAt crosses a month", async () => {
    for (const date of ["2019-04-01", "2019-05-01"]) {
      await prisma.$queryRawUnsafe(
        `SELECT janosik_ensure_command_partition($1::date)`,
        date,
      );
    }
    const id = `cmdlog-${suffix}-moved`;
    const from = new Date(Date.UTC(2019, 3, 15, 12, 0, 0));
    const to = new Date(Date.UTC(2019, 4, 15, 12, 0, 0));
    await createCommand("moved", from, true);
    await prisma.command.updateMany({
      where: { id, createdAt: from },
      data: { createdAt: to },
    });
    const routed = await prisma.$queryRawUnsafe<
      Array<{ command_part: string; detail_part: string; key_created: Date }>
    >(
      `SELECT c.tableoid::regclass::text AS command_part,
              d.tableoid::regclass::text AS detail_part,
              k."createdAt" AS key_created
         FROM "Command" c
         JOIN "CommandDetail" d ON d."commandId" = c."id" AND d."boardId" = c."boardId"
         JOIN "CommandKey" k ON k."id" = c."id" AND k."boardId" = c."boardId"
        WHERE c."id" = $1`,
      id,
    );
    expect(routed[0]!.command_part).toContain("Command_201905");
    expect(routed[0]!.detail_part).toContain("CommandDetail_201905");
    expect(new Date(routed[0]!.key_created).toISOString()).toBe(
      to.toISOString(),
    );

    await prisma.$queryRawUnsafe(
      `SELECT janosik_drop_command_partition($1::date)`,
      "2019-04-01",
    );
    expect(await prisma.commandDetail.count({ where: { commandId: id } })).toBe(
      1,
    );
    expect(await prisma.commandKey.count({ where: { id } })).toBe(1);
    await prisma.$queryRawUnsafe(
      `SELECT janosik_drop_command_partition($1::date)`,
      "2019-05-01",
    );
    // Keys are swept separately now; clean the moved command's key.
    await prisma.commandKey.deleteMany({ where: { id } });
  });

  it("sweeps orphan keys but preserves a stale key that still has a command", async () => {
    const id = `cmdlog-${suffix}-live-key`;
    const orphan = `cmdlog-${suffix}-orphan-key`;
    const old = new Date("2020-01-01T00:00:00Z");
    await createCommand("live-key", current, true);
    await prisma.commandKey.update({
      where: { id },
      data: { createdAt: old },
    });
    await prisma.commandKey.create({
      data: { id: orphan, boardId, createdAt: old },
    });
    const service = new MaintenanceService(
      prisma as never,
      {} as never,
      { retentionDays: async () => 30 } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.sweepCommands();
    expect(await prisma.commandKey.count({ where: { id } })).toBe(1);
    expect(await prisma.commandKey.count({ where: { id: orphan } })).toBe(0);
    await prisma.commandKey.deleteMany({ where: { id } });
  });

  it("handles a bulk command delete through deferred detail cleanup", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const key = `bulk-${index}`;
      ids.push(`cmdlog-${suffix}-${key}`);
      await createCommand(key, current, true);
    }
    await prisma.command.deleteMany({ where: { id: { in: ids } } });
    expect(
      await prisma.commandDetail.count({ where: { commandId: { in: ids } } }),
    ).toBe(0);
    // Keys are released by the orphan sweep, not the delete trigger.
    expect(await prisma.commandKey.count({ where: { id: { in: ids } } })).toBe(
      ids.length,
    );
    await prisma.commandKey.deleteMany({ where: { id: { in: ids } } });
  });

  it("builds the key board index concurrently and recovers an invalid leftover", async () => {
    const service = new MaintenanceService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await prisma.$executeRawUnsafe(
      'DROP INDEX CONCURRENTLY IF EXISTS "CommandKey_boardId_idx"',
    );
    await service.ensureCommandKeyIndex();
    const valid = await prisma.$queryRawUnsafe<Array<{ valid: boolean }>>(
      `SELECT i.indisvalid AS valid
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'CommandKey_boardId_idx'`,
    );
    expect(valid[0]?.valid).toBe(true);

    await prisma.$executeRawUnsafe(
      `UPDATE pg_index SET indisvalid = false
        WHERE indexrelid = '"CommandKey_boardId_idx"'::regclass`,
    );
    await service.ensureCommandKeyIndex();
    const recovered = await prisma.$queryRawUnsafe<Array<{ valid: boolean }>>(
      `SELECT i.indisvalid AS valid
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'CommandKey_boardId_idx'`,
    );
    expect(recovered[0]?.valid).toBe(true);
  });

  it("purges a board with more than one command page without unbounded deletes", async () => {
    const userIdForPurge = `purge-user-${suffix}`;
    const boardIdForPurge = `purge-board-${suffix}`;
    await prisma.user.create({
      data: { id: userIdForPurge, email: `${userIdForPurge}@example.com` },
    });
    await prisma.board.create({
      data: {
        id: boardIdForPurge,
        title: "Purge board",
        deletedAt: new Date(Date.now() - 2 * 86_400_000),
      },
    });
    const commands = Array.from({ length: 620 }, (_, index) => ({
      id: `${boardIdForPurge}-cmd-${index}`,
      boardId: boardIdForPurge,
      actorId: userIdForPurge,
      type: "RENAME_BOARD",
      payload: { type: "RENAME_BOARD", title: "Purged", at: 1 },
      result: {},
      touches: [],
      createdAt: new Date(current.getTime() + index),
    }));
    await prisma.command.createMany({ data: commands });
    await prisma.commandDetail.createMany({
      data: commands.map((command) => ({
        commandId: command.id,
        boardId: boardIdForPurge,
        createdAt: command.createdAt,
        data: { changes: [] },
      })),
    });
    const service = new MaintenanceService(
      prisma as never,
      { remove: async () => undefined } as never,
      { retentionDays: async () => 30 } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.purgeSoftDeleted(1);
    expect(
      await prisma.board.findUnique({ where: { id: boardIdForPurge } }),
    ).toBeNull();
    expect(
      await prisma.command.count({ where: { boardId: boardIdForPurge } }),
    ).toBe(0);
    expect(
      await prisma.commandDetail.count({ where: { boardId: boardIdForPurge } }),
    ).toBe(0);
    expect(
      await prisma.commandKey.count({ where: { boardId: boardIdForPurge } }),
    ).toBe(0);
    await prisma.user.deleteMany({ where: { id: userIdForPurge } });
  });

  it("leaves no command, detail or key rows after the e2e wipe", async () => {
    await createCommand("wipe", current, true);
    await wipeAll(prisma);
    expect(await prisma.command.count()).toBe(0);
    expect(await prisma.commandDetail.count()).toBe(0);
    expect(await prisma.commandKey.count()).toBe(0);
  });
});
