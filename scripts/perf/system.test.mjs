import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
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

test("collectCpuProfile aggregates all nodes from the newest profile set", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-cpu-set-"));
  const makeProfile = (prefix) => {
    const nodes = [];
    const samples = [];
    for (let index = 0; index < 10; index += 1) {
      const id = index + 1;
      nodes.push({
        id,
        callFrame: {
          functionName: `${prefix}${index}`,
          url: `file:///app/${prefix}.js`,
          lineNumber: index,
        },
      });
      for (let hit = 0; hit < 6; hit += 1) samples.push(id);
    }
    nodes.push({
      id: 11,
      callFrame: {
        functionName: "lowInEveryFile",
        url: "file:///app/shared.js",
        lineNumber: 4,
      },
    });
    for (let hit = 0; hit < 5; hit += 1) samples.push(11);
    return { startTime: 0, endTime: 1_000_000, samples, nodes };
  };
  try {
    await writeFile(
      path.join(directory, "run-a.cpuprofile"),
      JSON.stringify(makeProfile("a")),
      "utf8",
    );
    await writeFile(
      path.join(directory, "run-b.cpuprofile"),
      JSON.stringify(makeProfile("b")),
      "utf8",
    );
    const old = path.join(directory, "old.cpuprofile");
    await writeFile(
      old,
      JSON.stringify({
        startTime: 0,
        endTime: 1_000_000,
        samples: [1, 1, 1],
        nodes: [
          {
            id: 1,
            callFrame: { functionName: "oldRun", url: "file:///old.js" },
          },
        ],
      }),
      "utf8",
    );
    await utimes(old, new Date(0), new Date(0));
    const collected = await collectCpuProfile(directory);
    assert.equal(collected.available, true);
    assert.deepEqual([...collected.files].sort(), [
      "run-a.cpuprofile",
      "run-b.cpuprofile",
    ]);
    assert.equal(collected.top[0].function, "lowInEveryFile");
    assert.equal(
      collected.top.some((entry) => entry.function === "oldRun"),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
    redisUrl:
      "redis://default:redis%40secret@redis.test:6380/2?auth_token=querysecret",
    redisCli: "redis-cli",
  });
  assert.equal(
    invocation.args.some((arg) => arg.includes("redis%40secret")),
    false,
  );
  assert.equal(
    invocation.args.some((arg) => arg.includes("redis@secret")),
    false,
  );
  assert.equal(
    invocation.args.some((arg) => arg.includes("querysecret")),
    false,
  );
  assert.equal(invocation.env.REDISCLI_AUTH, "redis@secret");
  assert.equal(invocation.url.includes("redis@secret"), false);
  assert.equal(invocation.url.includes("querysecret"), false);
});

test("redaction helpers remove URL userinfo, bearer tokens and child argv", () => {
  assert.equal(
    stripUserInfo("postgresql://perf:s3cret@db.test:5432/janosik"),
    "postgresql://db.test:5432/janosik",
  );
  assert.equal(
    redactUrl(
      "https://user:pass@example.test/api?sslpassword=ssl&client_secret=cs&x-api-key=k&x=1",
    ),
    "https://example.test/api?sslpassword=%5Bredacted%5D&client_secret=%5Bredacted%5D&x-api-key=%5Bredacted%5D&x=1",
  );
  assert.equal(
    sanitizeText("sslpassword=ssl client_secret=cs"),
    "sslpassword=[redacted] client_secret=[redacted]",
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
      success2xx: 10,
      toolCalls: 0,
      cycles: 1,
      exhausted: 0,
      stranded: 0,
      recycled: 0,
      orphans: 0,
      errors: {
        auth401403: 0,
        network: 0,
        server5xx: 0,
        unexpected4xx: 0,
        conflict409: 0,
        rateLimited429: 0,
        rates: { server5xx: 0, unexpected4xx: 0 },
      },
      sse: {},
    },
    errors: [],
    fatal: false,
    interrupted: false,
    driver: "http",
    workDurationMs: 1_000,
  };
  const evaluate = (overrides = {}) =>
    evaluateScenarioStatus({
      ...base,
      ...overrides,
      summary: { ...base.summary, ...(overrides.summary ?? {}) },
    });

  assert.equal(evaluate().status, "ok");
  assert.equal(
    evaluate({
      summary: {
        success2xx: 0,
        errors: {
          ...base.summary.errors,
          server5xx: 10,
          rates: { ...base.summary.errors.rates, server5xx: 1 },
        },
      },
    }).status,
    "failed",
  );
  assert.equal(
    evaluate({ id: "S1", summary: { success2xx: 0 } }).status,
    "failed",
  );
  assert.equal(
    evaluate({
      id: "S6",
      summary: {
        success2xx: 0,
        errors: {
          ...base.summary.errors,
          server5xx: 10,
          rates: { ...base.summary.errors.rates, server5xx: 1 },
        },
      },
    }).status,
    "failed",
  );
  assert.equal(
    evaluate({
      id: "S5",
      scenario: { sse: 5000 },
      summary: { sse: { opened: 0, failed: 5000, maxConcurrent: 0 } },
    }).status,
    "failed",
  );
  assert.equal(
    evaluate({
      id: "S5",
      scenario: { sse: 5000 },
      summary: {
        sse: {
          opened: 1,
          failed: 4_999,
          liveAtHoldStart: 1,
          liveAtHoldEnd: 1,
          maxConcurrent: 1,
        },
      },
    }).status,
    "partial",
  );
  assert.equal(
    evaluate({
      id: "S5",
      scenario: { sse: 5000 },
      summary: {
        sse: {
          opened: 1,
          failed: 0,
          liveAtHoldStart: 1,
          liveAtHoldEnd: 0,
          maxConcurrent: 1,
        },
      },
    }).status,
    "failed",
  );
  assert.equal(
    evaluate({
      id: "S3",
      scenario: { agents: 2, sse: 2 },
      summary: {
        cycles: 1,
        sse: {
          opened: 1,
          failed: 0,
          liveAtHoldStart: 0,
          liveAtHoldEnd: 0,
          maxConcurrent: 1,
        },
      },
    }).status,
    "failed",
  );
  assert.equal(
    evaluate({
      summary: {
        sse: {
          opened: 2,
          failed: 0,
          liveAtHoldStart: 2,
          liveAtHoldEnd: 2,
          maxConcurrent: 2,
          closedEarly: 1,
        },
      },
    }).status,
    "partial",
  );
  assert.equal(evaluate({ summary: { orphans: 1 } }).status, "partial");
  assert.equal(
    evaluate({
      summary: {
        errors: {
          ...base.summary.errors,
          server5xx: 2,
          rates: { ...base.summary.errors.rates, server5xx: 0.2 },
        },
      },
    }).status,
    "partial",
  );
  assert.equal(
    evaluate({
      summary: {
        errors: {
          ...base.summary.errors,
          unexpected4xx: 1,
          rates: { ...base.summary.errors.rates, unexpected4xx: 0.1 },
        },
      },
    }).status,
    "partial",
  );
  assert.equal(
    evaluate({
      summary: {
        errors: {
          ...base.summary.errors,
          conflict409: 9,
          rateLimited429: 9,
          rates: {
            ...base.summary.errors.rates,
            conflict409: 0.9,
            rateLimited429: 0.9,
          },
        },
      },
    }).status,
    "ok",
  );
  assert.equal(
    evaluate({
      id: "S3",
      scenario: { agents: 2, mix: { reads: 1, writes: 0, comments: 0 } },
      summary: { cycles: 0 },
    }).status,
    "ok",
  );
  assert.equal(
    evaluate({
      summary: { requests: 0, success2xx: 0 },
    }).status,
    "failed",
  );
  assert.equal(evaluate({ summary: { exhausted: 1 } }).status, "partial");
  assert.equal(
    evaluate({ summary: { exhausted: 1, recycled: 5 } }).status,
    "partial",
  );
  assert.equal(evaluate({ summary: { cycles: 0 } }).status, "failed");
  assert.equal(evaluate({ interrupted: true }).status, "interrupted");
  assert.equal(
    evaluate({ errors: [{ fatal: true, message: "auth" }] }).status,
    "failed",
  );
  assert.equal(
    evaluate({
      driver: "mcp",
      summary: { requests: 4, success2xx: 4, toolCalls: 4 },
    }).status,
    "ok",
  );
});
