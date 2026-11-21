import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { ids, manifest, relations } from "../fixtures/task176-demo.mjs";
import { assertFixtureRows, seedRelations, verifyFixture } from "./fixture.mjs";
import { consumeSeedNonce, sweepMarkers } from "./identity.mjs";
import { demoTarget } from "./target.mjs";
import { root } from "./lifecycle.mjs";

const demoEnv = {
  DEMO_DATABASE_URL:
    "postgresql://sensitive-user:sensitive-password@localhost/janosik_task176_demo",
  DEMO_API_URL: "http://127.0.0.1:5311",
  DEMO_RESET_ALLOW: "1",
};
const makeRows = () =>
  Object.fromEntries(
    Object.entries(manifest.rows).map(([model, rows]) => [
      model,
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([field, value]) => [
            field,
            value === true && field.endsWith("At")
              ? new Date()
              : structuredClone(value),
          ]),
        ),
      ),
    ]),
  );

test("manifest pins the TASK-176 inventory and the overlay writes its relations in dependency order", async () => {
  const { user, board, boardMember, column, card, comment } = manifest.rows;
  assert.deepEqual(
    user.map((row) => row.id),
    [ids.userAdmin, ids.userMember],
  );
  assert.deepEqual(
    board.map((row) => row.id),
    [ids.boardOps, ids.boardSite],
  );
  assert.deepEqual(
    boardMember.map((row) => row.role),
    ["ADMIN", "MEMBER", "MEMBER", "ADMIN"],
  );
  assert.equal(column.length, 8);
  assert.equal(card.length, 13);
  assert.equal(
    card.filter((row) => row.deletedAt === null).length,
    manifest.liveCards,
  );
  assert.deepEqual(comment, []);
  const writes = [];
  const db = {
    $transaction: (work) =>
      work(
        Object.fromEntries(
          Object.keys(relations).map((model) => [
            model,
            { createMany: ({ data }) => writes.push([model, data]) },
          ]),
        ),
      ),
  };
  await seedRelations(db);
  assert.deepEqual(writes, Object.entries(relations));
  assert.deepEqual(
    writes.map(([table]) => table),
    ["label", "cardLabel", "checklist", "checklistItem", "cardLink"],
  );
  assert.ok(relations.checklistItem.every((item) => item.done));
});

test("manifest pins the card claim copy, pink label, checklist and link endpoints", () => {
  const { card, label, checklist, cardLink } = manifest.rows;
  const claim = card.find(({ id }) => id === "px-card-card-claim");
  assert.equal(claim.title, "Card claim visibility");
  assert.equal(
    claim.description,
    "API reference sweep — exact MCP transport contract.",
  );
  assert.deepEqual(
    label.map(({ id, name, color }) => [id, name, color]),
    [["px-label-task176-demo", "TASK-176 demo", "pink"]],
  );
  assert.deepEqual(
    checklist.map(({ id, title, cardId }) => [id, title, cardId]),
    [
      [
        "px-checklist-task176-demo",
        "TASK-176 acceptance",
        "px-card-card-claim",
      ],
    ],
  );
  assert.deepEqual(
    cardLink.map(({ id, type, fromCardId, toCardId }) => [
      id,
      type,
      fromCardId,
      toCardId,
    ]),
    [
      [
        "px-link-task176-demo",
        "relates_to",
        "px-card-card-claim",
        "px-card-mcp-write",
      ],
      [
        "px-link-task176-blocks",
        "blocks",
        "px-card-card-claim",
        "px-card-approval-inbox",
      ],
    ],
  );
});

test("verification detects observed drift across the entire fixture", () => {
  const actual = makeRows();
  for (const [model, rows] of Object.entries(actual))
    assertFixtureRows(model, rows);
  const canonical = actual.card.find((row) => row.id === ids.cardClaim);
  const changes = {
    title: "Card claim visibility 123",
    description: canonical.description + " фывфыв",
    columnId: ids.columnOpsDone,
    position: 2,
    assigneeId: ids.userAdmin,
    priority: "blocker",
    coverType: "color",
    coverValue: "yellow",
    dueDate: new Date(),
    acceptanceCriteria: ["unexpected"],
    definitionOfDone: ["unexpected"],
    claimedBy: ids.userAdmin,
    claimedByTokenId: "token",
    claimedBySessionId: "session",
    leaseUntil: new Date(),
    archivedAt: new Date(),
    archivedFromColumnId: ids.columnOpsBacklog,
    deletedAt: new Date(),
  };
  for (const [field, value] of Object.entries(changes)) {
    const changed = actual.card.map((row) =>
      row === canonical ? { ...row, [field]: value } : row,
    );
    assert.throws(() => assertFixtureRows("card", changed), new RegExp(field));
  }
  for (const [model, extra] of Object.entries({
    checklist: { id: "junk", title: "123" },
    checklistItem: { id: "junk", text: "1" },
    label: { id: "junk" },
    cardLink: { id: "e780ca71-aeeb-4c32-a6e1-c53389133cd0" },
    user: { id: "junk", email: "extra@t.com" },
    comment: { id: "t176-comment-042", deletedAt: new Date() },
  })) {
    assert.throws(
      () => assertFixtureRows(model, [...actual[model], extra]),
      /count/,
    );
  }
  assert.throws(() => assertFixtureRows("label", []), /count/);
  assert.throws(
    () =>
      assertFixtureRows(
        "cardLink",
        actual.cardLink.map((row) => ({ ...row, id: "junk" })),
      ),
    /Missing/,
  );
  assert.throws(
    () =>
      assertFixtureRows(
        "checklistItem",
        actual.checklistItem.map((row) => ({ ...row, done: false })),
      ),
    /done/,
  );
  assert.throws(
    () =>
      assertFixtureRows(
        "boardMember",
        actual.boardMember.map((row) => ({ ...row, acceptedAt: null })),
      ),
    /acceptedAt/,
  );
});

test("verify reads a consistent read-only snapshot without touching session or runtime rows", async () => {
  const actual = makeRows();
  const operations = [];
  const tx = {
    $executeRaw: ([sql]) => operations.push(sql),
    ...Object.fromEntries(
      Object.entries(actual).map(([model, rows]) => [
        model,
        {
          findMany: () => {
            operations.push(model);
            return rows;
          },
        },
      ]),
    ),
  };
  await verifyFixture({ $transaction: (work) => work(tx) });
  assert.match(operations[0], /REPEATABLE READ READ ONLY/);
  assert.deepEqual(operations.slice(1), Object.keys(actual).sort());
});

test("marker cleanup tolerates missing tables and columns from Prisma and PostgreSQL", async () => {
  const model = { deleteMany: () => undefined };
  for (const error of [
    { code: "P2021" },
    { code: "P2022" },
    { code: "42P01" },
    { code: "P2010", meta: { code: "42P01" } },
    { code: "P2010", meta: { code: "42703" } },
  ]) {
    await sweepMarkers({
      boardMember: model,
      refreshToken: model,
      board: model,
      user: model,
      $transaction: () => Promise.reject(error),
    });
  }
});

test("target guards fail closed, including unsafe URL options and direct overlay invocation", () => {
  const checked = demoTarget(demoEnv, { api: true, reset: true });
  assert.equal(checked.database, "janosik_task176_demo");
  assert.equal(checked.host, "localhost");
  for (const overrides of [
    { DEMO_DATABASE_URL: undefined },
    { DEMO_API_URL: undefined },
    { DEMO_RESET_ALLOW: undefined },
    { DEMO_DATABASE_URL: "postgresql://localhost/janosik" },
    { DEMO_DATABASE_URL: "postgresql://localhost/other_demo" },
    { DEMO_DATABASE_URL: demoEnv.DEMO_DATABASE_URL + "?host=example.com" },
    { DEMO_DATABASE_URL: demoEnv.DEMO_DATABASE_URL + "?schema=private" },
    {
      DEMO_DATABASE_URL:
        demoEnv.DEMO_DATABASE_URL + "?schema=public&schema=private",
    },
    { DEMO_API_URL: "http://example.com:5311" },
    { DEMO_API_URL: "http://user:password@127.0.0.1:5311" },
    { DEMO_API_URL: "http://127.0.0.1:5311/alternate" },
    { DATABASE_URL: "postgresql://localhost/janosik" },
    { API_URL: "http://127.0.0.1:5300" },
    { NODE_ENV: "production" },
  ]) {
    assert.throws(() =>
      demoTarget({ ...demoEnv, ...overrides }, { api: true, reset: true }),
    );
  }
  const other = demoTarget({
    ...demoEnv,
    DEMO_ALLOW_OTHER_DB: "1",
    DEMO_DATABASE_URL: "postgresql://localhost/other_demo",
  });
  assert.equal(other.database, "other_demo");
  assert.throws(
    () => consumeSeedNonce({ ticket: {}, nonce: "a".repeat(64) }, checked, {}),
    /reset-issued/,
  );

  const run = (args, env) =>
    spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8" });
  const direct = run(["scripts/task176-demo.mjs", "seed"], demoEnv);
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /only run inside an authorized reset/);
  const pixel = run(["scripts/seed-agent-pixel-demo.mjs"], {
    SEED_ALLOW: "1",
    DATABASE_URL: demoEnv.DEMO_DATABASE_URL,
  });
  assert.equal(pixel.status, 1);
  assert.match(pixel.stderr, /disposable database name/);
  const dryRun = run(
    ["scripts/task176-demo.mjs", "reset", "--dry-run"],
    demoEnv,
  );
  assert.equal(dryRun.status, 0);
  assert.match(dryRun.stdout, /localhost\/janosik_task176_demo/);
  assert.doesNotMatch(
    dryRun.stdout + dryRun.stderr,
    /sensitive-(user|password)|postgresql:/,
  );
});

const ambientKeys = [
  "DATABASE_URL",
  "DEMO_DATABASE_URL",
  "DEMO_API_URL",
  "DEMO_ALLOW_OTHER_DB",
  "DEMO_RESET_ALLOW",
  "SEED_ALLOW",
  "JWT_SECRET",
  "PUBLIC_ORIGIN",
  "SETTINGS_SECRET",
  "SEED_SECRETS_FILE",
];

const fakePrismaModule = [
  'const fs = require("node:fs");',
  'const path = require("node:path");',
  'const names = [".env", ".env." + process.env.NODE_ENV, ".env.local"];',
  "for (const name of names) {",
  '  const file = path.resolve(__dirname, "../../../backend", name);',
  "  if (!fs.existsSync(file)) continue;",
  '  for (const line of fs.readFileSync(file, "utf8").split(/\\r?\\n/)) {',
  "    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());",
  "    if (!match || process.env[match[1]] !== undefined) continue;",
  "    process.env[match[1]] = match[2];",
  "  }",
  "}",
  "exports.Prisma = {};",
  "exports.PrismaClient = class PrismaClient {};",
].join("\n");

// Reproduce Prisma's import-time dotenv load in a disposable copy. The fake
// client also reads .env.local deliberately: no ambient env file may select a
// target or authorize a reset, even one a future loader mistake might read.
function createEnvSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "task176-env-"));
  for (const file of [
    "scripts/task176-demo.mjs",
    "scripts/seed-agent-pixel-demo.mjs",
    "scripts/fixtures/task176-demo.mjs",
  ]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(root, file), join(dir, file));
  }
  cpSync(join(root, "scripts/task176"), join(dir, "scripts/task176"), {
    recursive: true,
    filter: (file) => !file.endsWith(".test.mjs"),
  });
  mkdirSync(join(dir, "backend"), { recursive: true });
  mkdirSync(join(dir, "node_modules/@prisma/client"), { recursive: true });
  // The static graph still imports argon2 (hashing the pixel scene's
  // passwords), so resolve the real package; only @prisma/client is faked.
  const argon2 = join(root, "node_modules/argon2");
  if (existsSync(argon2)) {
    symlinkSync(
      argon2,
      join(dir, "node_modules/argon2"),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  writeFileSync(
    join(dir, "node_modules/@prisma/client/package.json"),
    JSON.stringify({
      name: "@prisma/client",
      version: "0.0.0-test",
      main: "index.js",
    }),
  );
  writeFileSync(
    join(dir, "node_modules/@prisma/client/index.js"),
    fakePrismaModule,
  );
  return dir;
}

function writeAmbientEnv(dir, name, values) {
  writeFileSync(
    join(dir, "backend", name),
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
}

test("ambient backend env files cannot supply the demo target, reset authorization or secrets", () => {
  const dir = createEnvSandbox();
  const targetEnv = {
    DEMO_DATABASE_URL: "postgresql://localhost/janosik_task176_demo",
    DEMO_API_URL: "http://127.0.0.1:5311",
  };
  const run = (env) =>
    spawnSync(
      process.execPath,
      ["scripts/task176-demo.mjs", "reset", "--dry-run"],
      { cwd: dir, env, encoding: "utf8" },
    );
  try {
    writeAmbientEnv(dir, ".env", {
      DATABASE_URL: "postgresql://dev-user:dev-password@localhost/janosik",
      DEMO_DATABASE_URL: "postgresql://localhost/janosik_task176_demo",
      DEMO_API_URL: "http://127.0.0.1:5311",
      DEMO_ALLOW_OTHER_DB: "1",
      DEMO_RESET_ALLOW: "1",
      SEED_ALLOW: "1",
      JWT_SECRET: "ambient-jwt-secret-that-must-not-be-used",
      PUBLIC_ORIGIN: "http://127.0.0.1:9999",
      SETTINGS_SECRET: "ambient-settings-secret",
      SEED_SECRETS_FILE: join(dir, "ambient-secrets.json"),
    });

    const valid = run({ ...targetEnv, DEMO_RESET_ALLOW: "1" });
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /localhost\/janosik_task176_demo/);
    assert.doesNotMatch(
      valid.stdout + valid.stderr,
      /sensitive|dev-password|ambient-jwt|ambient-settings|postgresql:/,
    );

    const unauthorized = run(targetEnv);
    assert.equal(unauthorized.status, 1);
    assert.match(unauthorized.stderr, /DEMO_RESET_ALLOW=1/);

    const missingTarget = run({ DEMO_RESET_ALLOW: "1" });
    assert.equal(missingTarget.status, 1);
    assert.match(missingTarget.stderr, /Set DEMO_DATABASE_URL/);

    const otherDatabase = run({
      ...targetEnv,
      DEMO_DATABASE_URL: "postgresql://localhost/other_demo",
      DEMO_RESET_ALLOW: "1",
    });
    assert.equal(otherDatabase.status, 1);
    assert.match(
      otherDatabase.stderr,
      /explicitly allowed disposable database/,
    );

    rmSync(join(dir, "backend/.env"));
    writeAmbientEnv(dir, ".env.local", {
      DATABASE_URL: "postgresql://dev-user:dev-password@localhost/janosik",
      DEMO_DATABASE_URL: "postgresql://localhost/other_demo",
      DEMO_API_URL: "http://127.0.0.1:9998",
      DEMO_ALLOW_OTHER_DB: "1",
      DEMO_RESET_ALLOW: "1",
      SEED_ALLOW: "1",
      JWT_SECRET: "ambient-jwt-secret-that-must-not-be-used",
      PUBLIC_ORIGIN: "http://127.0.0.1:9999",
      SETTINGS_SECRET: "ambient-settings-secret",
      SEED_SECRETS_FILE: join(dir, "ambient-secrets.json"),
    });
    const localOnly = run({ ...targetEnv, DEMO_RESET_ALLOW: "1" });
    assert.equal(localOnly.status, 0, localOnly.stderr);
    const localUnauthorized = run(targetEnv);
    assert.equal(localUnauthorized.status, 1);
    assert.match(localUnauthorized.stderr, /DEMO_RESET_ALLOW=1/);

    writeAmbientEnv(dir, ".env", {
      DATABASE_URL: "postgresql://dev-user:dev-password@localhost/janosik",
      DEMO_DATABASE_URL: "postgresql://localhost/janosik_task176_demo",
      DEMO_API_URL: "http://127.0.0.1:5311",
      DEMO_ALLOW_OTHER_DB: "1",
      DEMO_RESET_ALLOW: "1",
      SEED_ALLOW: "1",
      JWT_SECRET: "ambient-jwt-secret-that-must-not-be-used",
      PUBLIC_ORIGIN: "http://127.0.0.1:9999",
      SETTINGS_SECRET: "ambient-settings-secret",
      SEED_SECRETS_FILE: join(dir, "ambient-secrets.json"),
    });
    const pixel = spawnSync(
      process.execPath,
      ["scripts/seed-agent-pixel-demo.mjs"],
      {
        cwd: dir,
        env: { DATABASE_URL: "postgresql://localhost/janosik_pixel" },
        encoding: "utf8",
      },
    );
    assert.equal(pixel.status, 1);
    assert.match(pixel.stderr, /SEED_ALLOW=1/);
    assert.doesNotMatch(pixel.stderr, /disposable database name/);
    const targetUrl = pathToFileURL(
      join(dir, "scripts/task176/target.mjs"),
    ).href;
    const databaseUrl = pathToFileURL(
      join(dir, "scripts/task176/database.mjs"),
    ).href;
    const code = [
      `const keys = ${JSON.stringify(ambientKeys)};`,
      `const { shellEnv, demoTarget, childEnv } = await import(${JSON.stringify(targetUrl)});`,
      `await import(${JSON.stringify(databaseUrl)});`,
      'if (process.env.DATABASE_URL !== "postgresql://dev-user:dev-password@localhost/janosik")',
      '  throw new Error("the fake Prisma loader did not run");',
      "const leaked = keys.filter((key) => shellEnv[key] !== undefined);",
      'if (leaked.length) { console.error("leaked:" + leaked.join(",")); process.exit(1); }',
      "try {",
      "  demoTarget(shellEnv);",
      '  console.error("ambient target accepted");',
      "  process.exit(1);",
      "} catch (error) {",
      "  if (!/Set DEMO_DATABASE_URL/.test(error.message)) throw error;",
      "}",
      'const child = childEnv({ databaseUrl: "postgresql://localhost/janosik_task176_demo" });',
      'const leakedChild = keys.filter((key) => key !== "DATABASE_URL" && child[key] !== undefined);',
      'if (leakedChild.length) { console.error("child:" + leakedChild.join(",")); process.exit(1); }',
      'console.log("pristine");',
    ].join("\n");
    const snapshot = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code],
      { cwd: dir, env: {}, encoding: "utf8" },
    );
    assert.equal(snapshot.status, 0, snapshot.stderr);
    assert.match(snapshot.stdout, /pristine/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
