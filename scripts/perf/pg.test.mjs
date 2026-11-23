import assert from "node:assert/strict";
import test from "node:test";
import {
  PG_SNAPSHOT_LIMIT,
  PgActivitySampler,
  collectPgActivity,
  collectPgStatements,
  diffPgStatements,
  parsePgActivityRows,
  parsePsqlRows,
  pgStatementsSql,
  psqlInvocation,
} from "./lib/pg.mjs";

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

test("parsePgActivityRows groups states and waits", () => {
  assert.deepEqual(
    parsePgActivityRows(
      [
        "active\t\t\t3",
        "idle\tClient\tClientRead\t2",
        "idle in transaction\tLock\trelation\t1",
      ].join("\n"),
    ),
    {
      total: 6,
      states: { active: 3, idle: 2, "idle in transaction": 1 },
      waits: { "Client:ClientRead": 2, "Lock:relation": 1 },
    },
  );
});

test("pgStatementsSql scopes to the current database and clamps the limit", () => {
  const sql = pgStatementsSql(20);
  assert.match(sql, /LIMIT 20/);
  assert.match(sql, /current_database\(\)/);
  assert.match(pgStatementsSql(-5), /LIMIT 1/);
  assert.match(pgStatementsSql(99_999), /LIMIT 1000/);
  assert.doesNotMatch(sql, /%LIMIT%/);
  assert.equal(PG_SNAPSHOT_LIMIT > 20, true);
});

test("psqlInvocation keeps the password and query secrets out of argv", () => {
  const invocation = psqlInvocation({
    databaseUrl:
      "postgresql://perf:s3cret@db.perf:5432/janosik?sslmode=require&sslpassword=sslsecret&client_secret=clientsecret",
    psql: "psql",
    sql: "SELECT 1",
  });
  assert.equal(
    invocation.args.some((arg) => arg.includes("s3cret")),
    false,
  );
  assert.equal(
    invocation.args.some((arg) => arg.includes("sslsecret")),
    false,
  );
  assert.equal(
    invocation.args.some((arg) => arg.includes("clientsecret")),
    false,
  );
  assert.equal(
    invocation.args.some((arg) => arg.includes("sslmode=require")),
    true,
  );
  assert.equal(
    invocation.args.some((arg) => arg.includes("@db.perf")),
    false,
  );
  assert.equal(invocation.args.includes("perf"), true);
  assert.equal(invocation.env.PGPASSWORD, "s3cret");
  assert.equal(invocation.connection.includes("s3cret"), false);
  assert.equal(invocation.connection.includes("perf@"), false);
  assert.equal(invocation.unsupportedSslPassword, true);
  assert.equal(invocation.secrets.includes("sslsecret"), true);
  assert.equal(invocation.secrets.includes("clientsecret"), true);
});

test("a query password is moved to PGPASSWORD and removed from argv", () => {
  const invocation = psqlInvocation({
    databaseUrl:
      "postgresql://perf@db.perf:5432/janosik?password=querysecret&sslmode=require",
    psql: "psql",
    sql: "SELECT 1",
  });
  assert.equal(invocation.env.PGPASSWORD, "querysecret");
  assert.equal(
    invocation.args.some((arg) => arg.includes("querysecret")),
    false,
  );
  assert.equal(invocation.connection.includes("querysecret"), false);
  assert.equal(invocation.connection.includes("sslmode=require"), true);
});

test("collectPgStatements is disabled without a URL", async () => {
  assert.deepEqual(await collectPgStatements({}), {
    enabled: false,
    reason: "no --pg-url",
  });
});

test("collectPgStatements reports psql failure without argv or the password", async () => {
  const result = await collectPgStatements({
    databaseUrl: "postgresql://perf:s3cret@localhost/perf",
    execFileImpl: (_bin, _args, _options, callback) => {
      const error = new Error(
        "Command failed: psql postgresql://perf:s3cret@localhost/perf",
      );
      error.stderr = "psql: error: connection refused";
      callback(error, "", error.stderr);
    },
  });
  assert.equal(result.enabled, true);
  assert.equal(result.available, false);
  assert.match(result.reason, /connection refused/);
  assert.equal(result.reason.includes("s3cret"), false);
  assert.equal(result.reason.includes("Command failed"), false);
});

test("collectPgStatements parses a successful psql run", async () => {
  let seenArgs;
  let seenOptions;
  const result = await collectPgStatements({
    databaseUrl: "postgresql://perf:s3cret@localhost/perf",
    limit: 5,
    execFileImpl: (_bin, args, options, callback) => {
      seenArgs = args;
      seenOptions = options;
      callback(null, "1\t3\t9.50\t3.17\t4\tSELECT 1\n", "");
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].query, "SELECT 1");
  assert.equal(
    seenArgs.some((arg) => arg.includes("s3cret")),
    false,
  );
  assert.equal(seenArgs.at(-1).includes("LIMIT 5"), true);
  assert.equal(seenOptions.env.PGPASSWORD, "s3cret");
});

test("diffPgStatements returns Top-20 by calls and by total time", () => {
  const before = {
    available: true,
    rows: [
      { queryid: "1", calls: 10, totalMs: 100, rows: 5, query: "SELECT a" },
      { queryid: "2", calls: 5, totalMs: 50, rows: 1, query: "SELECT b" },
      {
        queryid: "3",
        calls: 1,
        totalMs: 1,
        rows: 0,
        query: "SELECT 1 FROM pg_stat_statements",
      },
    ],
  };
  const after = {
    available: true,
    rows: [
      { queryid: "1", calls: 15, totalMs: 160, rows: 9, query: "SELECT a" },
      { queryid: "2", calls: 7, totalMs: 80, rows: 3, query: "SELECT b" },
      {
        queryid: "4",
        calls: 2,
        totalMs: 30,
        rows: 4,
        query: "SELECT new_after_only",
      },
      {
        queryid: "3",
        calls: 2,
        totalMs: 2,
        rows: 0,
        query: "SELECT 1 FROM pg_stat_statements",
      },
    ],
  };
  const delta = diffPgStatements(before, after);
  assert.equal(delta.available, true);
  assert.deepEqual(
    delta.topByCalls.map((row) => [row.queryid, row.calls]),
    [
      ["1", 5],
      ["2", 2],
      ["4", 2],
    ],
  );
  assert.deepEqual(
    delta.topByTotalTime.map((row) => [row.queryid, row.totalMs]),
    [
      ["1", 60],
      ["2", 30],
      ["4", 30],
    ],
  );
  assert.equal(
    delta.topByCalls.some((row) => row.queryid === "4"),
    true,
  );
});

test("diffPgStatements reports unavailability instead of throwing", () => {
  const delta = diffPgStatements(
    { available: false, reason: "psql missing" },
    { available: false, reason: "psql missing" },
  );
  assert.equal(delta.available, false);
  assert.match(delta.reason, /psql missing/);
});

test("collectPgActivity parses one sample without leaking credentials", async () => {
  const result = await collectPgActivity({
    databaseUrl: "postgresql://perf:s3cret@localhost/perf",
    execFileImpl: (_bin, _args, _options, callback) => {
      callback(null, "active\t\t\t4\nidle\tClient\tClientRead\t2\n", "");
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.total, 6);
  assert.equal(result.states.active, 4);
  assert.equal(result.waits["Client:ClientRead"], 2);
});

test("PgActivitySampler keeps the peak per state", async () => {
  let call = 0;
  const sampler = new PgActivitySampler({
    databaseUrl: "postgresql://localhost/perf",
    collect: async () => {
      call += 1;
      return call === 1
        ? {
            available: true,
            total: 3,
            states: { active: 2, idle: 1 },
            waits: {},
          }
        : {
            available: true,
            total: 5,
            states: { active: 4, idle: 1 },
            waits: { "Client:ClientRead": 2 },
          };
    },
  });
  await sampler.poll();
  await sampler.poll();
  const summary = await sampler.stop();
  assert.equal(summary.available, true);
  assert.equal(summary.samples, 2);
  assert.equal(summary.peakConnections, 5);
  assert.equal(summary.states.active, 4);
  assert.equal(summary.waits["Client:ClientRead"], 2);
});
