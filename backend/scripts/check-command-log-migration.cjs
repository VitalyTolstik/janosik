// TASK-200.11 migration check. Creates two throwaway databases on the existing
// test PostgreSQL server (no Docker/containers are started):
//
//   * empty    — every migration, including the partition swap, detail side
//                table, global CommandKey registry and safe-drop helper;
//   * existing — migrations up to the command-log work, then realistic
//                Command/CommandDetail/CommandPreimage rows, then all four
//                TASK-200.11 migrations.
//
// It asserts row counts, the details/key backfill, partition routing,
// PK/sequence, the global id guard, FK cascade, the drop helper and a pruned
// plan, then drops both databases.
//
// Usage: `npm run test:migration:command-log -w backend`
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { PrismaClient } = require("@prisma/client");

const BACKEND = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(BACKEND, "prisma", "migrations");
const SCHEMA = path.join(BACKEND, "prisma", "schema.prisma");
const MIGRATION_DIRS = [
  "20261123130000_task_200_11_command_log_partitioning",
  "20261123131000_task_200_11_command_details_side_table",
  "20261123132000_task_200_11_command_key_registry",
  "20261123133000_task_200_11_safe_partition_drop",
  "20261123134000_task_200_11_command_key_move",
  "20261123135000_task_200_11_command_key_board_index",
];

const baseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://janosik:janosik@localhost:5433/janosik_test";
const adminUrl = new URL(baseUrl);
adminUrl.pathname = "/postgres";

const suffix = `${process.pid}_${Date.now()}`;
const names = {
  empty: `janosik_task20011_empty_${suffix}`,
  existing: `janosik_task20011_existing_${suffix}`,
};
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "janosik-task20011-"));

function assert(condition, message) {
  if (!condition) throw new Error(`TASK-200.11 migration check: ${message}`);
}

async function admin(sql) {
  const prisma = new PrismaClient({
    datasources: { db: { url: adminUrl.toString() } },
  });
  try {
    await prisma.$executeRawUnsafe(sql);
  } finally {
    await prisma.$disconnect();
  }
}

function copyMigrations({ withTask }) {
  const target = path.join(scratch, withTask ? "full" : "before");
  fs.mkdirSync(path.join(target, "prisma"), { recursive: true });
  fs.copyFileSync(SCHEMA, path.join(target, "prisma", "schema.prisma"));
  fs.cpSync(MIGRATIONS, path.join(target, "prisma", "migrations"), {
    recursive: true,
  });
  if (!withTask) {
    for (const dir of MIGRATION_DIRS) {
      fs.rmSync(path.join(target, "prisma", "migrations", dir), {
        recursive: true,
        force: true,
      });
    }
  }
  return path.join(target, "prisma", "schema.prisma");
}

function migrate(database, { withTask }) {
  const schema = copyMigrations({ withTask });
  const prismaCli = require.resolve("prisma/build/index.js");
  const dbUrl = new URL(baseUrl);
  dbUrl.pathname = `/${database}`;
  try {
    execFileSync(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--schema", schema],
      {
        cwd: BACKEND,
        env: { ...process.env, DATABASE_URL: dbUrl.toString() },
        stdio: "pipe",
      },
    );
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    throw new Error(`prisma migrate deploy failed for ${database}:\n${out}`);
  }
}

function client(database) {
  const dbUrl = new URL(baseUrl);
  dbUrl.pathname = `/${database}`;
  return new PrismaClient({ datasources: { db: { url: dbUrl.toString() } } });
}

async function scalars(prisma, sql, ...params) {
  const rows = await prisma.$queryRawUnsafe(sql, ...params);
  return rows;
}

async function seedExisting(prisma) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "User" ("id", "email") VALUES ('mig-user', 'mig-user@example.com')`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Board" ("id", "title", "updatedAt") VALUES ('mig-board', 'Migration board', now())`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Board" ("id", "title", "updatedAt") VALUES ('mig-board-2', 'Migration board 2', now())`,
  );

  const months = ["2026-09-15", "2026-10-15", "2026-11-15"];
  for (let index = 0; index < 60; index += 1) {
    const when = `${months[index % months.length]} ${String(10 + (index % 10)).padStart(2, "0")}:00:00`;
    const id = `mig-cmd-${index}`;
    const details =
      index % 3 === 0
        ? JSON.stringify({
            changes: [
              {
                field: "description",
                from: "before ".repeat(400),
                to: "after ".repeat(400),
              },
            ],
          })
        : null;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Command"
         ("id", "boardId", "actorId", "type", "payload", "result", "touches",
          "createdAt", "details", "actorType", "runId")
       VALUES ($1, 'mig-board', 'mig-user', 'UPDATE_CARD', $2::jsonb, '{}'::jsonb,
               ARRAY['card:mig-card'], $3::timestamp, $4::jsonb, 'agent', 'mig-run')`,
      id,
      JSON.stringify({ type: "UPDATE_CARD", cardId: "mig-card", at: 1 }),
      when,
      details,
    );
    if (index % 4 === 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CommandPreimage" ("commandId", "boardId", "runId", "data", "createdAt")
         VALUES ($1, 'mig-board', 'mig-run', $2::jsonb, $3::timestamp)`,
        id,
        JSON.stringify({ schemaVersion: 1, boardVersion: index, entities: [] }),
        when,
      );
    }
  }

  const counts = await scalars(
    prisma,
    `SELECT
       (SELECT count(*)::int FROM "Command") AS commands,
       (SELECT count(*)::int FROM "Command" WHERE "details" IS NOT NULL) AS details,
       (SELECT count(*)::int FROM "CommandPreimage") AS preimages,
       (SELECT COALESCE(max("seq"), 0)::bigint FROM "Command") AS maxseq`,
  );
  return counts[0];
}

async function checkEmpty(prisma) {
  const counts = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM "Command"`,
  );
  assert(counts[0].n === 0, "a fresh database starts empty");

  const created = await scalars(
    prisma,
    `SELECT janosik_ensure_command_partition('2027-06-01'::date) AS created`,
  );
  assert(
    String(created[0].created).includes("Command_202706"),
    "ensure creates a future month for all three tables",
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "User" ("id", "email") VALUES ('empty-user', 'empty@example.com')`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Board" ("id", "title", "updatedAt") VALUES ('empty-board', 'Empty', now())`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Command" ("id", "boardId", "actorId", "type", "payload", "result", "createdAt")
     VALUES ('empty-cmd', 'empty-board', 'empty-user', 'ADD_COLUMN', '{}'::jsonb, '{}'::jsonb, '2027-06-15')`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CommandDetail" ("commandId", "boardId", "createdAt", "data")
     VALUES ('empty-cmd', 'empty-board', '2027-06-15', '{"changes":[]}'::jsonb)`,
  );
  const routed = await scalars(
    prisma,
    `SELECT c.tableoid::regclass::text AS command_part,
            d.tableoid::regclass::text AS detail_part,
            k."boardId" AS key_board
       FROM "Command" c
       JOIN "CommandDetail" d ON d."commandId" = c."id"
       JOIN "CommandKey" k ON k."id" = c."id"`,
  );
  assert(
    routed[0].command_part.includes("Command_202706"),
    "command routes to its month",
  );
  assert(
    routed[0].detail_part.includes("CommandDetail_202706"),
    "detail routes to its month",
  );
  assert(
    routed[0].key_board === "empty-board",
    "the global key carries the board",
  );

  await prisma.$executeRawUnsafe(
    `SELECT janosik_drop_command_partition('2027-06-01')`,
  );
  const gone = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM pg_class WHERE relname IN
       ('Command_202706', 'CommandDetail_202706', 'CommandPreimage_202706')`,
  );
  assert(gone[0].n === 0, "drop removes all three month partitions");
  const goneKey = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM "CommandKey" WHERE "id" = 'empty-cmd'`,
  );
  assert(
    goneKey[0].n === 1,
    "drop leaves the registry key for the bounded orphan sweep",
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM "CommandKey" k
      WHERE NOT EXISTS (
        SELECT 1 FROM "Command" c WHERE c."id" = k."id" AND c."boardId" = k."boardId"
      ) AND k."id" = 'empty-cmd'`,
  );

  // A row with no monthly partition lands in the default. `ensure` must skip
  // that month instead of failing 23514 and aborting the scheduler.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Command" ("id", "boardId", "actorId", "type", "payload", "result", "createdAt")
     VALUES ('default-cmd', 'empty-board', 'empty-user', 'ADD_COLUMN', '{}'::jsonb, '{}'::jsonb, '2019-05-15')`,
  );
  const blocked = await scalars(
    prisma,
    `SELECT janosik_ensure_command_partition('2019-05-01'::date) AS status`,
  );
  assert(
    String(blocked[0].status).startsWith("skipped:"),
    "ensure skips a month whose rows are in the default partition",
  );
  const noMay = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM pg_class WHERE relname = 'Command_201905'`,
  );
  assert(noMay[0].n === 0, "the wedged month was not partially attached");
  await prisma.$executeRawUnsafe(
    `DELETE FROM "Command" WHERE "id" = 'default-cmd'`,
  );
}

async function checkExisting(prisma, before) {
  const after = await scalars(
    prisma,
    `SELECT
       (SELECT count(*)::int FROM "Command") AS commands,
       (SELECT count(*)::int FROM "CommandDetail") AS details,
       (SELECT count(*)::int FROM "CommandPreimage") AS preimages,
       (SELECT COALESCE(max("seq"), 0)::bigint FROM "Command") AS maxseq`,
  );
  assert(
    after[0].commands === before.commands,
    "all commands survive the swap",
  );
  assert(
    after[0].details === before.details,
    "all details land in the side table",
  );
  assert(after[0].preimages === before.preimages, "all pre-images survive");
  assert(after[0].maxseq === before.maxseq, "the seq maximum is unchanged");

  const keys = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM "CommandKey"`,
  );
  assert(keys[0].n === after[0].commands, "every command has a global key");

  // The registry restores the old Command_pkey guarantee: a second row with
  // the same client id is rejected even on another month.
  let duplicateRejected = false;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Command" ("id", "boardId", "actorId", "type", "payload", "result", "createdAt")
       VALUES ('mig-cmd-1', 'mig-board-2', 'mig-user', 'RENAME_BOARD', '{}'::jsonb, '{}'::jsonb, '2026-10-20')`,
    );
  } catch {
    duplicateRejected = true;
  }
  assert(duplicateRejected, "a duplicate commandId is rejected globally");

  const fk = await scalars(
    prisma,
    `SELECT count(*)::int AS n
       FROM pg_constraint
      WHERE conname = 'CommandDetail_commandId_fkey'
        AND conrelid = '"CommandDetail"'::regclass`,
  );
  assert(fk[0].n === 0, "CommandDetail no longer references the key registry");

  const detailIndex = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM pg_class WHERE relname = 'CommandDetail_createdAt_idx'`,
  );
  assert(detailIndex[0].n === 0, "the unused detail createdAt index is gone");
  const boardIndex = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM pg_class WHERE relname = 'CommandDetail_boardId_commandId_idx'`,
  );
  assert(boardIndex[0].n === 1, "detail rows have a board-scoped index");
  const keyBoardIndex = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM pg_class WHERE relname = 'CommandKey_boardId_idx'`,
  );
  assert(keyBoardIndex[0].n === 1, "the registry has a board-scoped index");
  const boardColumn = await scalars(
    prisma,
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'CommandDetail' AND column_name = 'boardId'`,
  );
  assert(boardColumn[0]?.is_nullable === "NO", "detail boardId is required");

  const legacy = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM pg_class WHERE relname IN
       ('Command_legacy_task20011', 'CommandPreimage_legacy_task20011')`,
  );
  assert(legacy[0].n === 0, "legacy tables are removed after verification");

  const detailColumn = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'Command' AND column_name = 'details'`,
  );
  assert(
    detailColumn[0].n === 0,
    "Command no longer carries the heavy details column",
  );

  const partitions = await scalars(
    prisma,
    `SELECT child.relname::text AS name
       FROM pg_inherits
       JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
       JOIN pg_class child ON child.oid = pg_inherits.inhrelid
      WHERE parent.relname = 'Command'`,
  );
  for (const month of ["Command_202609", "Command_202610", "Command_202611"]) {
    assert(
      partitions.some((row) => row.name === month),
      `existing month ${month} has a partition`,
    );
  }

  const routing = await scalars(
    prisma,
    `SELECT c.tableoid::regclass::text AS command_part,
            d.tableoid::regclass::text AS detail_part,
            count(*)::int AS n
       FROM "Command" c JOIN "CommandDetail" d ON d."commandId" = c."id"
      WHERE c."id" = 'mig-cmd-0'
      GROUP BY 1, 2`,
  );
  assert(
    routing[0].command_part.includes("Command_202609"),
    "command row routes by month",
  );
  assert(
    routing[0].detail_part.includes("CommandDetail_202609"),
    "detail row routes by month",
  );

  const plan = await scalars(
    prisma,
    `EXPLAIN (FORMAT JSON)
     SELECT * FROM "Command"
      WHERE "createdAt" >= '2026-10-01' AND "createdAt" < '2026-11-01'`,
  );
  const serialized = JSON.stringify(plan);
  assert(
    serialized.includes("Command_202610"),
    "the plan reads the October partition",
  );
  assert(!serialized.includes("Command_202609"), "the plan prunes September");
  assert(
    !serialized.includes("Command_default"),
    "the plan never scans the default partition",
  );

  // A new command keeps the shared sequence and routes to the current month.
  const inserted = await scalars(
    prisma,
    `INSERT INTO "Command" ("id", "boardId", "actorId", "type", "payload", "result")
     VALUES ('mig-cmd-new', 'mig-board', 'mig-user', 'RENAME_BOARD', '{}'::jsonb, '{}'::jsonb)
     RETURNING "seq"::bigint AS seq, tableoid::regclass::text AS part`,
  );
  assert(
    Number(inserted[0].seq) > Number(before.maxseq),
    "the shared sequence continues",
  );
  assert(
    inserted[0].part.includes("Command_202611"),
    "the new row routes to the current month",
  );

  // ON DELETE CASCADE removes the side row with its command.
  await prisma.$executeRawUnsafe(
    `DELETE FROM "Command" WHERE "id" = 'mig-cmd-0'`,
  );
  const detailLeft = await scalars(
    prisma,
    `SELECT
       (SELECT count(*)::int FROM "CommandDetail" WHERE "commandId" = 'mig-cmd-0') AS detail,
       (SELECT count(*)::int FROM "CommandKey" WHERE "id" = 'mig-cmd-0') AS key`,
  );
  assert(
    detailLeft[0].detail === 0,
    "deleting a command removes its detail row",
  );
  assert(
    detailLeft[0].key === 1,
    "the registry key waits for the bounded orphan sweep",
  );

  // Whole-month retention: detail first, then command, then pre-images.
  const removed = await scalars(
    prisma,
    `SELECT janosik_drop_command_partition('2026-09-01'::date) AS removed`,
  );
  assert(
    Number(removed[0].removed) >= 0,
    "the drop helper returns a partition estimate",
  );
  const september = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM pg_class WHERE relname IN
       ('Command_202609', 'CommandDetail_202609', 'CommandPreimage_202609')`,
  );
  assert(september[0].n === 0, "whole-month retention removes September");
  const remaining = await scalars(
    prisma,
    `SELECT
       (SELECT count(*)::int FROM "Command" WHERE "createdAt" < '2026-10-01') AS commands,
       (SELECT count(*)::int FROM "CommandKey" WHERE "createdAt" < '2026-10-01') AS keys`,
  );
  assert(remaining[0].commands === 0, "no September command rows remain");
  assert(
    remaining[0].keys > 0,
    "month DDL leaves registry keys for the bounded orphan sweep",
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM "CommandKey" k
      WHERE NOT EXISTS (
        SELECT 1 FROM "Command" c WHERE c."id" = k."id" AND c."boardId" = k."boardId"
      ) AND k."createdAt" < '2026-10-01'`,
  );
  const sweptKeys = await scalars(
    prisma,
    `SELECT count(*)::int AS n FROM "CommandKey" WHERE "createdAt" < '2026-10-01'`,
  );
  assert(sweptKeys[0].n === 0, "the orphan sweep clears September keys");
}

async function main() {
  await admin(`CREATE DATABASE "${names.empty}"`);
  await admin(`CREATE DATABASE "${names.existing}"`);

  try {
    migrate(names.empty, { withTask: true });
    const empty = client(names.empty);
    try {
      await checkEmpty(empty);
    } finally {
      await empty.$disconnect();
    }

    // Existing install: stop before TASK-200.11, seed the old schema, then run
    // only the pending command-log migration.
    migrate(names.existing, { withTask: false });
    const existing = client(names.existing);
    try {
      const before = await seedExisting(existing);
      await existing.$disconnect();
      migrate(names.existing, { withTask: true });
      try {
        await checkExisting(existing, before);
      } finally {
        await existing.$disconnect();
      }
    } finally {
      await existing.$disconnect().catch(() => undefined);
    }
  } finally {
    await admin(`DROP DATABASE IF EXISTS "${names.empty}" WITH (FORCE)`).catch(
      () => undefined,
    );
    await admin(
      `DROP DATABASE IF EXISTS "${names.existing}" WITH (FORCE)`,
    ).catch(() => undefined);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log("TASK-200.11 command-log migration: empty + existing data OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
