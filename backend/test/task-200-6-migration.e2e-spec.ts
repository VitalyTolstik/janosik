import { PrismaClient } from "@prisma/client";

/**
 * TASK-200.6 migration backfill: an existing board starts at
 * `aggregateRevision = 0`; the migration sets it to the current command
 * maximum so the first post-deploy ETag is not lower than the content it
 * already served. The SQL is the exact statement from
 * `20261123100000_task_200_6_board_aggregate_revision/migration.sql`.
 */
describe("TASK-200.6 aggregate revision backfill (e2e)", () => {
  const prisma = new PrismaClient();
  const boardId = "task-200-6-backfill-board";
  const userId = "task-200-6-backfill-user";

  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();
    await prisma.user.create({
      data: { id: userId, email: "task-200-6-backfill@example.com" },
    });
    await prisma.board.create({
      data: { id: boardId, title: "Backfill board" },
    });
    for (const type of ["RENAME_BOARD", "ADD_COLUMN"]) {
      await prisma.command.create({
        data: {
          id: `${type}-${boardId}`,
          boardId,
          actorId: userId,
          type,
          payload: { type },
          result: {},
          touches: [],
        },
      });
    }
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function cleanup(): Promise<void> {
    await prisma.command.deleteMany({ where: { boardId } });
    await prisma.board.deleteMany({ where: { id: boardId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  it("backfills the revision from the current command maximum", async () => {
    const before = await prisma.board.findUniqueOrThrow({
      where: { id: boardId },
      select: { aggregateRevision: true },
    });
    expect(before.aggregateRevision).toBe(0n);

    const max = await prisma.command.aggregate({
      where: { boardId },
      _max: { seq: true },
    });
    expect(max._max.seq).not.toBeNull();

    // Same statement as the migration; the Board trigger preserves a higher
    // NEW value, so this remains exactly the command maximum.
    await prisma.$executeRaw`
      UPDATE "Board" b
      SET "aggregateRevision" = COALESCE(
        (SELECT MAX(c."seq") FROM "Command" c WHERE c."boardId" = b."id"),
        0
      )
      WHERE b."id" = ${boardId}
    `;

    const after = await prisma.board.findUniqueOrThrow({
      where: { id: boardId },
      select: { aggregateRevision: true },
    });
    expect(after.aggregateRevision).toBe(max._max.seq);
  });
});
