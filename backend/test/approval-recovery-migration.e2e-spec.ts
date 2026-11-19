import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import "@/config/env";

describe("Approval recovery migration (e2e)", () => {
  const prisma = new PrismaClient();

  afterAll(() => prisma.$disconnect());

  it("indexes session approvals and cancels only actionable approvals on ended sessions", async () => {
    const migrations = [
      "20261119125900_approval_request_session_index",
      "20261119130000_approval_recovery_and_heartbeat",
    ].map((name) =>
      readFileSync(
        join(__dirname, "../prisma/migrations", name, "migration.sql"),
        "utf8",
      ),
    );

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL search_path TO pg_temp`;
      await tx.$executeRaw`
        CREATE TEMP TABLE "AgentSession" (
          id text PRIMARY KEY, "boardId" text, "endedAt" timestamp(3)
        ) ON COMMIT DROP
      `;
      await tx.$executeRaw`
        CREATE TEMP TABLE "ApprovalRequest" (
          id text PRIMARY KEY, "boardId" text, "agentSessionId" text,
          status text, "decidedAt" timestamp(3), "expiresAt" timestamp(3)
        ) ON COMMIT DROP
      `;
      await tx.$executeRaw`
        INSERT INTO "AgentSession" VALUES
          ('ended', 'board', CURRENT_TIMESTAMP - interval '1 hour'),
          ('open', 'board', NULL)
      `;
      await tx.$executeRaw`
        INSERT INTO "ApprovalRequest" (id, "boardId", "agentSessionId", status, "expiresAt")
        VALUES
          ('pending', 'board', 'ended', 'pending', CURRENT_TIMESTAMP + interval '1 hour'),
          ('approved', 'board', 'ended', 'approved', CURRENT_TIMESTAMP + interval '1 hour'),
          ('expired', 'board', 'ended', 'approved', CURRENT_TIMESTAMP - interval '1 minute'),
          ('consumed', 'board', 'ended', 'consumed', CURRENT_TIMESTAMP + interval '1 hour'),
          ('open', 'board', 'open', 'pending', CURRENT_TIMESTAMP + interval '1 hour'),
          ('other-board', 'other', 'ended', 'pending', CURRENT_TIMESTAMP + interval '1 hour'),
          ('no-session', 'board', NULL, 'pending', CURRENT_TIMESTAMP + interval '1 hour')
      `;

      for (const statement of migrations
        .join("\n")
        .split(";")
        .map((sql) => sql.trim())
        .filter(Boolean)) {
        await tx.$executeRawUnsafe(statement);
      }

      const rows = await tx.$queryRaw<
        Array<{ id: string; status: string; stamped: boolean }>
      >`
        SELECT approval.id, approval.status,
          COALESCE(approval."decidedAt" = session."endedAt", false) AS stamped
        FROM "ApprovalRequest" AS approval
        LEFT JOIN "AgentSession" AS session ON session.id = approval."agentSessionId"
        ORDER BY approval.id
      `;
      expect(rows).toEqual([
        { id: "approved", status: "cancelled", stamped: true },
        { id: "consumed", status: "consumed", stamped: false },
        { id: "expired", status: "approved", stamped: false },
        { id: "no-session", status: "pending", stamped: false },
        { id: "open", status: "pending", stamped: false },
        { id: "other-board", status: "pending", stamped: false },
        { id: "pending", status: "cancelled", stamped: true },
      ]);

      const indexes = await tx.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = pg_my_temp_schema()::regnamespace::text
          AND indexname = 'ApprovalRequest_boardId_agentSessionId_status_idx'
      `;
      expect(indexes[0]?.indexdef).toContain(
        '("boardId", "agentSessionId", status)',
      );
    });
  });
});
