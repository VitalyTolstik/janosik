import assert from "node:assert/strict";
import test from "node:test";
import { collectPgStats, parsePsqlRows, pgStatementsSql } from "./lib/pg.mjs";

test("parsePsqlRows maps psql tab output", () => {
  const rows = parsePsqlRows(
    [
      '123\t42\t1234.50\t29.39\t900\tSELECT * FROM "Board" WHERE id = $1',
      '456\t7\t10.00\t1.43\t0\tUPDATE "Card" SET title = $1',
      "broken line",
      "",
    ].join("\n"),
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    queryid: "123",
    calls: 42,
    totalMs: 1234.5,
    meanMs: 29.39,
    rows: 900,
    query: 'SELECT * FROM "Board" WHERE id = $1',
  });
  assert.equal(rows[1].calls, 7);
});

test("pgStatementsSql clamps the limit", () => {
  assert.match(pgStatementsSql(20), /LIMIT 20/);
  assert.match(pgStatementsSql(-5), /LIMIT 1/);
  assert.match(pgStatementsSql(99_999), /LIMIT 1000/);
  assert.doesNotMatch(pgStatementsSql(20), /%LIMIT%/);
});

test("collectPgStats is disabled without a URL", async () => {
  assert.deepEqual(await collectPgStats({}), {
    enabled: false,
    reason: "no --pg-url",
  });
});

test("collectPgStats reports psql failure without throwing", async () => {
  const result = await collectPgStats({
    databaseUrl: "postgresql://localhost/perf",
    execFileImpl: (_bin, _args, _options, callback) => {
      callback(new Error("psql: command not found"));
    },
  });
  assert.equal(result.enabled, true);
  assert.equal(result.available, false);
  assert.match(result.reason, /command not found/);
});

test("collectPgStats parses a successful psql run", async () => {
  let seenArgs;
  const result = await collectPgStats({
    databaseUrl: "postgresql://localhost/perf",
    limit: 5,
    execFileImpl: (_bin, args, _options, callback) => {
      seenArgs = args;
      callback(null, "1\t3\t9.50\t3.17\t4\tSELECT 1\n", "");
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.queries.length, 1);
  assert.equal(result.queries[0].query, "SELECT 1");
  assert.equal(seenArgs.includes("postgresql://localhost/perf"), true);
  assert.equal(seenArgs.at(-1).includes("LIMIT 5"), true);
});
