import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import "@/config/env";

/**
 * TASK-185.1 migration regression: the real migration must give every
 * existing comment one shared cutover timestamp, copy `editedAt` into the
 * verified pair without inventing revisions and mark a pre-release edit as
 * `legacy_cutover`. New rows get the fence from the database default.
 *
 * A throwaway schema keeps the run off every application table: the
 * pre-migration `User`/`Comment` shapes are created there and the exact
 * statements from `migration.sql` run under `SET LOCAL search_path`.
 */
const MIGRATION = "20261122100000_task_185_1_comment_history";
const INDEX_MIGRATION = "20261122110000_task_185_1_activity_history_indexes";

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

describe("TASK-185.1 comment history migration (e2e)", () => {
  const prisma = new PrismaClient();
  const schema = `task185_1_mig_${Date.now()}_${process.pid}`;
  const quote = (name: string): string => `"${name}"`;

  async function applyMigration(
    target: string,
    name: string = MIGRATION,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quote(target)}`);
      for (const statement of migrationStatements(name)) {
        await tx.$executeRawUnsafe(statement);
      }
    });
  }

  async function createBaseSchema(target: string): Promise<void> {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${quote(target)}`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${quote(target)}."User" (
        "id" TEXT NOT NULL,
        CONSTRAINT "User_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${quote(target)}."Comment" (
        "id" TEXT NOT NULL,
        "text" TEXT NOT NULL,
        "editedAt" TIMESTAMP(3),
        CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${quote(target)}."Activity" (
        "id" TEXT NOT NULL,
        "details" JSONB,
        CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
      )
    `);
  }

  beforeAll(async () => {
    await createBaseSchema(schema);
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${quote(schema)}."User" ("id") VALUES ('user-1')`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${quote(schema)}."Comment" ("id", "text", "editedAt")
       VALUES
         ('edited', 'pre-release text', '2026-01-01 12:00:00'),
         ('never-edited', 'untouched text', NULL)`,
    );
  });

  afterAll(async () => {
    await prisma
      .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`)
      .catch(() => undefined);
    await prisma.$disconnect();
  });

  it("backfills the fence and legacy markers, then defaults new rows", async () => {
    await applyMigration(schema);

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        historyCutoverAt: Date;
        historyVerifiedEditedAt: Date | null;
        historyVerifiedRevisionNumber: number | null;
        lastRevisionNumber: number;
        historyIncompleteReason: string | null;
      }>
    >(
      `SELECT "id", "historyCutoverAt", "historyVerifiedEditedAt",
              "historyVerifiedRevisionNumber", "lastRevisionNumber",
              "historyIncompleteReason"
         FROM ${quote(schema)}."Comment"
        ORDER BY "id"`,
    );
    expect(rows).toHaveLength(2);
    expect(
      new Set(rows.map((row) => row.historyCutoverAt.getTime())).size,
    ).toBe(1);
    const edited = rows.find((row) => row.id === "edited")!;
    expect(edited.historyIncompleteReason).toBe("legacy_cutover");
    expect(edited.historyVerifiedEditedAt?.toISOString()).toBe(
      new Date("2026-01-01T12:00:00.000Z").toISOString(),
    );
    expect(edited.historyVerifiedRevisionNumber).toBeNull();
    expect(edited.lastRevisionNumber).toBe(0);
    const untouched = rows.find((row) => row.id === "never-edited")!;
    expect(untouched.historyIncompleteReason).toBeNull();
    expect(untouched.historyVerifiedEditedAt).toBeNull();
    expect(untouched.historyVerifiedRevisionNumber).toBeNull();

    await prisma.$executeRawUnsafe(
      `INSERT INTO ${quote(schema)}."Comment" ("id", "text")
       VALUES ('new-row', 'new text')`,
    );
    const created = await prisma.$queryRawUnsafe<
      Array<{
        historyCutoverAt: Date;
        lastRevisionNumber: number;
        historyIncompleteReason: string | null;
      }>
    >(
      `SELECT "historyCutoverAt", "lastRevisionNumber",
              "historyIncompleteReason"
         FROM ${quote(schema)}."Comment"
        WHERE "id" = 'new-row'`,
    );
    expect(created[0]!.historyCutoverAt).toBeInstanceOf(Date);
    expect(created[0]!.lastRevisionNumber).toBe(0);
    expect(created[0]!.historyIncompleteReason).toBeNull();
    const revisions = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS "count"
         FROM ${quote(schema)}."CommentRevision"`,
    );
    expect(revisions[0]!.count).toBe(0n);
  });

  it("applies to an empty database without creating revisions", async () => {
    const empty = `task185_1_empty_${Date.now()}_${process.pid}`;
    await createBaseSchema(empty);
    try {
      await applyMigration(empty);
      const comments = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS "count"
           FROM ${quote(empty)}."Comment"`,
      );
      const revisions = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS "count"
           FROM ${quote(empty)}."CommentRevision"`,
      );
      expect(comments[0]!.count).toBe(0n);
      expect(revisions[0]!.count).toBe(0n);
    } finally {
      await prisma
        .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quote(empty)} CASCADE`)
        .catch(() => undefined);
    }
  });

  it("applies the Activity JSON expression indexes idempotently", async () => {
    const indexed = `task185_1_idx_${Date.now()}_${process.pid}`;
    await createBaseSchema(indexed);
    try {
      await applyMigration(indexed);
      await applyMigration(indexed, INDEX_MIGRATION);
      // Re-running is a no-op thanks to IF NOT EXISTS.
      await applyMigration(indexed, INDEX_MIGRATION);
      const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname
          FROM pg_indexes
         WHERE schemaname = ${indexed}
           AND indexname IN (
             'Activity_commentId_expr_idx',
             'Activity_revisionId_expr_idx'
           )
         ORDER BY indexname
      `;
      expect(indexes.map((row) => row.indexname)).toEqual([
        "Activity_commentId_expr_idx",
        "Activity_revisionId_expr_idx",
      ]);
    } finally {
      await prisma
        .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quote(indexed)} CASCADE`)
        .catch(() => undefined);
    }
  });
});
