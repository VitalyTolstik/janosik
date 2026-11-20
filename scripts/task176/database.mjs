import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { backend } from "./lifecycle.mjs";
import { childEnv, DemoError } from "./target.mjs";

const requireBackend = createRequire(`${backend}/package.json`);

export async function withDatabase(target, work) {
  const prisma = new PrismaClient({ datasourceUrl: target.databaseUrl });
  try {
    const [identity] =
      await prisma.$queryRaw`SELECT current_database() AS db, current_schema() AS schema`;
    if (identity.db !== target.database || identity.schema !== "public") {
      throw new DemoError(
        "The connected PostgreSQL database or schema did not match the guarded target.",
      );
    }
    return await work(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

export async function withResetLease(target, work) {
  // Take a database-scoped lock as well as flock. The dedicated connection
  // never touches fixture relations, so it can remain open across DROP SCHEMA.
  return withDatabase(target, (prisma) =>
    prisma.$transaction(
      async (tx) => {
        const [{ pid, locked }] = await tx.$queryRaw`
      SELECT pg_backend_pid() AS pid, pg_try_advisory_xact_lock(176, 183) AS locked
    `;
        if (!locked)
          throw new DemoError(
            "Another TASK-176 reset holds the database lease.",
          );
        return work(pid);
      },
      { timeout: 10 * 60_000 },
    ),
  );
}

export async function terminateOtherConnections(prisma, database, leasePid) {
  const results = await prisma.$queryRaw`
    SELECT pid, pg_terminate_backend(pid, 5000) AS terminated
    FROM pg_stat_activity
    WHERE datname = ${database}
      AND pid <> pg_backend_pid()
      AND pid <> ${leasePid}
      AND backend_type = 'client backend'
    ORDER BY pid
  `;
  const terminated = results
    .filter((row) => row.terminated)
    .map((row) => row.pid);
  console.log(
    `Terminated PostgreSQL connections for ${database}: ${terminated.join(", ") || "none"}.`,
  );
  if (terminated.length !== results.length) {
    throw new DemoError("A demo database connection could not be terminated.");
  }
}

export async function migrateReset(target, lock) {
  const cli = requireBackend.resolve("prisma/build/index.js");
  const child = spawn(
    process.execPath,
    [
      cli,
      "migrate",
      "reset",
      "--force",
      "--skip-seed",
      "--schema",
      join(backend, "prisma/schema.prisma"),
    ],
    {
      cwd: lock.stateDir,
      env: childEnv(target),
      // If the wrapper is SIGKILLed during migration, Prisma keeps the lock
      // until it exits. A second reset must not race a running schema engine.
      stdio: ["ignore", "ignore", "ignore", lock.fd],
    },
  );
  const status = await new Promise((resolve) => {
    child.once("error", () => resolve(null));
    child.once("close", resolve);
  });
  if (status !== 0)
    throw new DemoError(
      "Prisma migrate reset failed. Check demo schema privileges and migration status.",
    );
}

const fallbackOrder = [
  "checklistItem",
  "checklist",
  "cardLink",
  "cardLabel",
  "comment",
  "attachment",
  "activity",
  "commandPreimage",
  "command",
  "agentRun",
  "approvalRequest",
  "agentSession",
  "apiToken",
  "attentionNotification",
  "notificationMail",
  "boardShareAuditLog",
  "boardShare",
  "card",
  "label",
  "column",
  "boardMember",
  "board",
  "demoRun",
  "dataExport",
  "reminderSent",
  "idempotencyRecord",
  "securityAuditLog",
  "refreshToken",
  "user",
  "adminAuditLog",
  "adminRefreshToken",
  "adminUser",
];

export async function resetFixtureAndAccounts(prisma) {
  await prisma.$transaction(
    async (tx) => {
      for (const model of fallbackOrder) await tx[model].deleteMany();
    },
    { timeout: 60_000 },
  );
}
