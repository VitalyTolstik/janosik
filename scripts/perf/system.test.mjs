import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectCpuProfile, parseCpuProfile } from "./lib/cpuprofile.mjs";
import {
  diffRedisInfo,
  parseRedisInfo,
  redisInvocation,
} from "./lib/redis.mjs";
import {
  redactSecrets,
  redactUrl,
  safeChildError,
  sanitizeText,
  stripUserInfo,
} from "./lib/redact.mjs";
import { evaluateScenarioStatus } from "./lib/status.mjs";

function profile() {
  return {
    startTime: 0,
    endTime: 1_000_000,
    samples: [1, 1, 2],
    timeDeltas: [100, 100, 100],
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: "hot",
          url: "file:///app/a.js",
          lineNumber: 9,
        },
      },
      {
        id: 2,
        callFrame: {
          functionName: "cold",
          url: "file:///app/b.js",
          lineNumber: 0,
        },
      },
    ],
  };
}

test("parseCpuProfile builds a Top-10 self-time table", () => {
  const parsed = parseCpuProfile(profile(), { file: "a.cpuprofile" });
  assert.equal(parsed.totalMs, 1_000);
  assert.equal(parsed.samples, 3);
  assert.equal(parsed.top[0].function, "hot");
  assert.equal(parsed.top[0].selfPct, 66.67);
  assert.equal(parsed.top[0].line, 10);
  assert.equal(parsed.top[1].function, "cold");
});

test("collectCpuProfile aggregates a directory and reports errors", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-cpu-"));
  try {
    await writeFile(
      path.join(directory, "api.cpuprofile"),
      JSON.stringify(profile()),
      "utf8",
    );
    const collected = await collectCpuProfile(directory);
    assert.equal(collected.enabled, true);
    assert.equal(collected.available, true);
    assert.deepEqual(collected.files, ["api.cpuprofile"]);
    assert.equal(collected.top[0].function, "hot");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const missing = await collectCpuProfile("/definitely/not/here");
  assert.equal(missing.enabled, true);
  assert.equal(missing.available, false);
});

test("parseRedisInfo extracts memory, clients, stats and keyspace", () => {
  const info = parseRedisInfo(
    [
      "# Memory",
      "used_memory:1048576",
      "used_memory_human:1.00M",
      "used_memory_peak:2097152",
      "maxmemory:0",
      "# Clients",
      "connected_clients:7",
      "blocked_clients:1",
      "# Stats",
      "instantaneous_ops_per_sec:42",
      "rejected_connections:2",
      "keyspace_hits:90",
      "keyspace_misses:10",
      "# Keyspace",
      "db0:keys=5,expires=1,avg_ttl=0",
    ].join("\n"),
  );
  assert.equal(info.memory.used, 1_048_576);
  assert.equal(info.clients.connected, 7);
  assert.equal(info.stats.opsPerSecond, 42);
  assert.equal(info.stats.rejectedConnections, 2);
  assert.deepEqual(info.keyspace.db0, { keys: 5, expires: 1, avg_ttl: 0 });
});

test("diffRedisInfo reports maxima and counter deltas", () => {
  const before = {
    available: true,
    url: "redis://redis.test:6379/0",
    info: parseRedisInfo(
      [
        "# Memory",
        "used_memory:100",
        "# Clients",
        "connected_clients:2",
        "blocked_clients:0",
        "# Stats",
        "instantaneous_ops_per_sec:5",
        "rejected_connections:0",
        "keyspace_hits:10",
        "keyspace_misses:5",
      ].join("\n"),
    ),
  };
  const after = {
    available: true,
    url: "redis://redis.test:6379/0",
    info: parseRedisInfo(
      [
        "# Memory",
        "used_memory:200",
        "# Clients",
        "connected_clients:9",
        "blocked_clients:1",
        "# Stats",
        "instantaneous_ops_per_sec:12",
        "rejected_connections:3",
        "keyspace_hits:30",
        "keyspace_misses:10",
      ].join("\n"),
    ),
  };
  const delta = diffRedisInfo(before, after, 60_000);
  assert.equal(delta.available, true);
  assert.equal(delta.memory.used, 200);
  assert.equal(delta.clients.connected, 9);
  assert.equal(delta.clients.blocked, 1);
  assert.equal(delta.rejected, 3);
  assert.equal(delta.keyspaceHits, 20);
  assert.equal(delta.keyspaceMisses, 5);
  assert.equal(delta.keyspaceHitRate, 0.8);
});

test("redisInvocation keeps the password in the environment, not argv", () => {
  const invocation = redisInvocation({
    redisUrl: "redis://default:redissecret@redis.test:6380/2",
    redisCli: "redis-cli",
  });
  assert.equal(
    invocation.args.some((arg) => arg.includes("redissecret")),
    false,
  );
  assert.equal(invocation.env.REDISCLI_AUTH, "redissecret");
  assert.equal(invocation.url.includes("redissecret"), false);
});

test("redaction helpers remove URL userinfo, bearer tokens and child argv", () => {
  assert.equal(
    stripUserInfo("postgresql://perf:s3cret@db.test:5432/janosik"),
    "postgresql://db.test:5432/janosik",
  );
  assert.equal(
    redactUrl("https://user:pass@example.test/api?token=abc&x=1"),
    "https://example.test/api?token=%5Bredacted%5D&x=1",
  );
  assert.equal(
    sanitizeText("Authorization: Bearer jnk_secret and jnk_other", [
      "jnk_secret",
    ]),
    "Authorization: Bearer [redacted] and [redacted]",
  );
  assert.equal(redactSecrets("a-b-c", ["b"]), "a-[redacted]-c");
  const safe = safeChildError({
    message: "Command failed: psql postgresql://perf:s3cret@db/perf",
    stderr: "psql: error: password authentication failed for user perf",
    code: 2,
  });
  assert.match(safe, /authentication failed/);
  assert.equal(safe.includes("Command failed"), false);
  assert.equal(safe.includes("s3cret"), false);
});

test("evaluateScenarioStatus distinguishes ok/partial/failed/interrupted", () => {
  const base = {
    id: "S2",
    scenario: { agents: 2 },
    summary: {
      requests: 10,
      toolCalls: 0,
      cycles: 1,
      exhausted: 0,
      stranded: 0,
      errors: { auth401403: 0, network: 0 },
      sse: {},
    },
    errors: [],
    fatal: false,
    interrupted: false,
    driver: "http",
    workDurationMs: 1_000,
  };
  assert.equal(evaluateScenarioStatus(base).status, "ok");
  assert.equal(
    evaluateScenarioStatus({
      ...base,
      summary: { ...base.summary, exhausted: 1 },
    }).status,
    "partial",
  );
  assert.equal(
    evaluateScenarioStatus({
      ...base,
      summary: { ...base.summary, cycles: 0 },
    }).status,
    "failed",
  );
  assert.equal(
    evaluateScenarioStatus({ ...base, interrupted: true }).status,
    "interrupted",
  );
  assert.equal(
    evaluateScenarioStatus({
      ...base,
      errors: [{ fatal: true, message: "auth" }],
    }).status,
    "failed",
  );
  assert.equal(
    evaluateScenarioStatus({
      ...base,
      driver: "mcp",
      summary: { ...base.summary, requests: 0, toolCalls: 4 },
    }).status,
    "ok",
  );
});
