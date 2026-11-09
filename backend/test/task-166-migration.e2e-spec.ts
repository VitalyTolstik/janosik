import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import "@/config/env";

/**
 * TASK-166.1 migration regression: the ApiToken block from the real migration
 * file must grandfather existing tokens without touching new-token defaults.
 *
 * A dedicated throwaway schema keeps the test off every application table:
 * the pre-migration `ApiToken` shape is created there, then the exact
 * statements read from `migration.sql` run under `SET LOCAL search_path`.
 */
describe("TASK-166 ApiToken migration backfill (e2e)", () => {
  const prisma = new PrismaClient();
  const schema = `task166_mig_${Date.now()}_${process.pid}`;
  const quote = (name: string): string => `"${name}"`;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${quote(schema)}`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${quote(schema)}."ApiToken" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "tokenHash" TEXT NOT NULL,
        "boardId" TEXT,
        "readOnly" BOOLEAN NOT NULL DEFAULT false,
        "rateLimitPerMinute" INTEGER,
        "lastUsedAt" TIMESTAMP(3),
        "expiresAt" TIMESTAMP(3),
        "revokedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO ${quote(schema)}."ApiToken"
        ("id", "userId", "name", "tokenHash", "readOnly")
      VALUES
        ('legacy-rw', 'user-1', 'legacy read/write', 'hash-rw', false),
        ('legacy-ro', 'user-1', 'legacy read-only', 'hash-ro', true)
    `);
  });

  afterAll(async () => {
    await prisma
      .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`)
      .catch(() => undefined);
    await prisma.$disconnect();
  });

  it("backfills admin/trustedCi and keeps the worker default for new tokens", async () => {
    const migration = readFileSync(
      join(
        __dirname,
        "../prisma/migrations/20261109200000_task_166_agent_control/migration.sql",
      ),
      "utf8",
    );
    const start = migration.indexOf(
      'ALTER TABLE "ApiToken" ADD COLUMN     "scopePreset"',
    );
    const end = migration.indexOf('-- AlterTable\nALTER TABLE "Activity"');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const statements = migration
      .slice(start, end)
      .split(";")
      .map((statement) =>
        statement
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((statement) => statement.length > 0);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quote(schema)}`);
      for (const statement of statements) {
        await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRawUnsafe(`
        INSERT INTO "ApiToken" ("id", "userId", "name", "tokenHash")
        VALUES ('new-default', 'user-1', 'new token', 'hash-new')
      `);
    });

    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; scopePreset: string; trustedCi: boolean }>
    >(
      `SELECT "id", "scopePreset", "trustedCi"
         FROM ${quote(schema)}."ApiToken"
        ORDER BY "id"`,
    );
    expect(rows).toEqual([
      {
        id: "legacy-ro",
        scopePreset: "admin",
        trustedCi: false,
      },
      {
        id: "legacy-rw",
        scopePreset: "admin",
        trustedCi: true,
      },
      {
        id: "new-default",
        scopePreset: "worker",
        trustedCi: false,
      },
    ]);
  });
});
