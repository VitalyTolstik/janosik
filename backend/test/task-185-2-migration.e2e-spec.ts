import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import "@/config/env";

/**
 * TASK-185.2 migration: `Activity.commentId` is added, the legacy string is
 * backfilled for every comment event (including deleted comments) and the
 * redundant JSON expression index is dropped. A throwaway schema keeps the
 * run off application tables.
 */
const MIGRATION = "20261122120000_task_185_2_activity_comment_id";

function migrationStatements(name: string): string[] {
  const migration = readFileSync(
    join(__dirname, `../prisma/migrations/${name}/migration.sql`),
    "utf8",
  );
  return migration
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

describe("TASK-185.2 Activity commentId migration (e2e)", () => {
  const prisma = new PrismaClient();
  const schema = `task185_2_mig_${Date.now()}_${process.pid}`;
  const quote = (name: string): string => `"${name}"`;

  async function applyMigration(target: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quote(target)}`);
      for (const statement of migrationStatements(MIGRATION)) {
        await tx.$executeRawUnsafe(statement);
      }
    });
  }

  async function createBaseSchema(target: string): Promise<void> {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${quote(target)}`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${quote(target)}."Board" (
        "id" TEXT NOT NULL,
        CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${quote(target)}."Column" (
        "id" TEXT NOT NULL,
        "boardId" TEXT NOT NULL,
        CONSTRAINT "Column_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${quote(target)}."Card" (
        "id" TEXT NOT NULL,
        "columnId" TEXT NOT NULL,
        CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${quote(target)}."Comment" (
        "id" TEXT NOT NULL,
        "cardId" TEXT NOT NULL,
        CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${quote(target)}."Activity" (
        "id" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "boardId" TEXT NOT NULL,
        "cardId" TEXT,
        "details" JSONB,
        CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
      )
    `);
    // The expression index the 185.1 migration created; 185.2 drops it.
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "Activity_commentId_expr_idx"
         ON ${quote(target)}."Activity" ((("details"->>'commentId')))`,
    );
  }

  beforeAll(async () => {
    await createBaseSchema(schema);
    await prisma.$executeRawUnsafe(`
      INSERT INTO ${quote(schema)}."Board" ("id") VALUES ('board-a'), ('board-b')
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO ${quote(schema)}."Column" ("id", "boardId") VALUES
        ('col-a', 'board-a'), ('col-b', 'board-b')
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO ${quote(schema)}."Card" ("id", "columnId") VALUES
        ('card-a', 'col-a'), ('card-b', 'col-b')
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO ${quote(schema)}."Comment" ("id", "cardId") VALUES
        ('c-added', 'card-a'),
        ('c-deleted', 'card-a'),
        ('c-updated', 'card-a'),
        ('c-other', 'card-b')
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO ${quote(schema)}."Activity"
        ("id", "type", "boardId", "cardId", "details") VALUES
        ('added', 'comment_added', 'board-a', 'card-a',
          '{"commentId":"c-added","text":"hello"}'),
        ('deleted', 'comment_deleted', 'board-a', 'card-a',
          '{"commentId":"c-deleted","text":"gone"}'),
        ('updated', 'comment_updated', 'board-a', 'card-a',
          '{"commentId":"c-updated","revisionId":"rev-1","beforeText":"a","afterText":"b","text":"b"}'),
        ('foreign', 'member_invited', 'board-a', 'card-a',
          '{"commentId":"not-a-comment","email":"a@b.c"}'),
        ('missing', 'comment_added', 'board-a', 'card-a', NULL),
        ('no-id', 'comment_updated', 'board-a', 'card-a', '{"text":"no id"}'),
        ('non-string', 'comment_added', 'board-a', 'card-a',
          '{"commentId":42,"text":"n"}'),
        ('cross-board', 'comment_added', 'board-a', 'card-a',
          '{"commentId":"c-other","text":"not this board"}')
    `);
  });

  afterAll(async () => {
    await prisma
      .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`)
      .catch(() => undefined);
    await prisma.$disconnect();
  });

  it("backfills only string comment ids for comment events", async () => {
    await applyMigration(schema);
    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; commentId: string | null; type: string }>
    >(
      `SELECT "id", "type", "commentId"
         FROM ${quote(schema)}."Activity"
        ORDER BY "id"`,
    );
    expect(
      Object.fromEntries(rows.map((row) => [row.id, row.commentId])),
    ).toEqual({
      added: "c-added",
      "cross-board": null,
      deleted: "c-deleted",
      foreign: null,
      missing: null,
      "no-id": null,
      "non-string": null,
      updated: "c-updated",
    });
    // Event type and stored details are preserved verbatim.
    const added = await prisma.$queryRawUnsafe<Array<{ details: unknown }>>(
      `SELECT "details" FROM ${quote(schema)}."Activity" WHERE "id" = 'added'`,
    );
    expect(added[0]!.details).toMatchObject({
      commentId: "c-added",
      text: "hello",
    });
  });

  it("adds the typed index and drops the expression index", async () => {
    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = '${schema}'
          AND tablename = 'Activity'
        ORDER BY indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toContain(
      "Activity_commentId_idx",
    );
    expect(indexes.map((row) => row.indexname)).not.toContain(
      "Activity_commentId_expr_idx",
    );
  });

  it("applies to an empty database", async () => {
    const empty = `task185_2_empty_${Date.now()}_${process.pid}`;
    await createBaseSchema(empty);
    try {
      await applyMigration(empty);
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS "count" FROM ${quote(empty)}."Activity"`,
      );
      expect(rows[0]!.count).toBe(0n);
    } finally {
      await prisma
        .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quote(empty)} CASCADE`)
        .catch(() => undefined);
    }
  });
});
