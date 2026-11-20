import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { ids, manifest, relations } from "../fixtures/task176-demo.mjs";
import { assertFixtureRows, seedRelations, verifyFixture } from "./fixture.mjs";
import { consumeSeedNonce } from "./identity.mjs";
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
  assert.deepEqual(operations.slice(1), Object.keys(actual));
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
