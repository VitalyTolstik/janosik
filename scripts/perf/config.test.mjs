import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_SCENARIOS,
  SMOKE_SCENARIOS,
  parseCli,
  parseDurationMs,
  parseMix,
  parseScenarioList,
  publicConfig,
  resolveConfig,
  scenarioConfig,
  splitList,
  usage,
  validateScenarioConfig,
} from "./lib/config.mjs";

test("parseDurationMs accepts suffixes and bare seconds", () => {
  assert.equal(parseDurationMs("duration", "10s"), 10_000);
  assert.equal(parseDurationMs("duration", "500ms"), 500);
  assert.equal(parseDurationMs("duration", "2m"), 120_000);
  assert.equal(parseDurationMs("duration", "1h"), 3_600_000);
  assert.equal(parseDurationMs("duration", "90"), 90_000);
  assert.equal(parseDurationMs("duration", undefined), undefined);
  assert.throws(() => parseDurationMs("duration", "soon"), /must look like/);
});

test("splitList handles repeats and commas", () => {
  assert.deepEqual(splitList(["a,b", " c "]), ["a", "b", "c"]);
  assert.deepEqual(splitList(undefined), []);
});

test("parseMix accepts percentages and fractions and rejects bad sums", () => {
  assert.deepEqual(parseMix("60/30/10"), {
    reads: 0.6,
    writes: 0.3,
    comments: 0.1,
  });
  assert.deepEqual(parseMix("0.6/0.3/0.1"), {
    reads: 0.6,
    writes: 0.3,
    comments: 0.1,
  });
  assert.throws(() => parseMix("60/30"), /reads\/writes\/comments/);
  assert.throws(() => parseMix("60/30/30"), /sum to 100/);
});

test("parseScenarioList expands all and smoke and rejects unknown ids", () => {
  assert.deepEqual(parseScenarioList("all").ids, ALL_SCENARIOS);
  assert.deepEqual(parseScenarioList("smoke"), {
    ids: SMOKE_SCENARIOS,
    mode: "smoke",
  });
  assert.deepEqual(parseScenarioList("S2,s1").ids, ["S2", "S1"]);
  assert.throws(() => parseScenarioList("S9"), /unknown scenario/);
});

test("bare and smoke-without-mock invocations fail instead of exiting 0", () => {
  assert.throws(
    () => resolveConfig(parseCli([]), {}),
    /--scenario is required/,
  );
  assert.throws(
    () => resolveConfig(parseCli(["--scenario", "smoke"]), {}),
    /needs --mock/,
  );
  assert.equal(resolveConfig(parseCli(["--help"]), {}).help, true);

  const mock = resolveConfig(parseCli(["--mock"]), {});
  assert.equal(mock.help, false);
  assert.equal(mock.mode, "smoke");
  assert.deepEqual(mock.scenarioIds, SMOKE_SCENARIOS);
  assert.equal(mock.tokens.length, 2);
  assert.equal(mock.mock, true);
});

test("resolveConfig builds a real run from env token and board overrides", () => {
  const config = resolveConfig(
    parseCli([
      "--scenario",
      "S2",
      "--agents",
      "7",
      "--cadence",
      "2s",
      "--duration",
      "1m",
      "--boards",
      "3",
      "--jitter",
      "0",
      "--lease-ms",
      "60000",
    ]),
    { JANOSIK_PERF_TOKEN: "jnk_a,jnk_b" },
  );
  assert.equal(config.mode, "real");
  assert.deepEqual(config.scenarioIds, ["S2"]);
  assert.deepEqual(config.tokens, ["jnk_a", "jnk_b"]);
  assert.equal(config.boardsCount, 3);
  assert.equal(config.overrides.agents, 7);
  assert.equal(config.overrides.cadenceMs, 2_000);
  assert.equal(config.overrides.durationMs, 60_000);
  assert.equal(config.overrides.leaseMs, 60_000);
  assert.equal(config.jitter, 0);
});

test("token precedence is CLI > JANOSIK_PERF_TOKEN > PERF_TOKEN and dedupes", () => {
  const cli = resolveConfig(
    parseCli(["--scenario", "S1", "--token", "jnk_cli,jnk_cli"]),
    { JANOSIK_PERF_TOKEN: "jnk_env", PERF_TOKEN: "jnk_fallback" },
  );
  assert.deepEqual(cli.tokens, ["jnk_cli"]);
  assert.equal(publicConfig(cli).tokenCount, 1);

  const env = resolveConfig(parseCli(["--scenario", "S1"]), {
    JANOSIK_PERF_TOKEN: "jnk_env,jnk_env",
    PERF_TOKEN: "jnk_fallback",
  });
  assert.deepEqual(env.tokens, ["jnk_env"]);

  const fallback = resolveConfig(parseCli(["--scenario", "S1"]), {
    PERF_TOKEN: "jnk_fallback",
  });
  assert.deepEqual(fallback.tokens, ["jnk_fallback"]);
});

test("resolveConfig rejects missing PAT, bad numbers and bad URLs", () => {
  assert.throws(
    () => resolveConfig(parseCli(["--scenario", "S1"]), {}),
    /no PAT/,
  );
  assert.throws(
    () =>
      resolveConfig(parseCli(["--scenario", "S1", "--agents", "3.5"]), {
        PERF_TOKEN: "jnk_x",
      }),
    /--agents must be an integer/,
  );
  assert.throws(
    () =>
      resolveConfig(parseCli(["--scenario", "S1", "--agents", "0"]), {
        PERF_TOKEN: "jnk_x",
      }),
    /--agents must be an integer/,
  );
  assert.throws(
    () =>
      resolveConfig(parseCli(["--scenario", "S1", "--base-url", "ftp://x"]), {
        PERF_TOKEN: "jnk_x",
      }),
    /must start with http/,
  );
  assert.throws(
    () =>
      resolveConfig(parseCli(["--scenario", "S2", "--recycle"]), {
        PERF_TOKEN: "jnk_x",
      }),
    /--recycle needs --recycle-token/,
  );
});

test("scenarioConfig applies documented defaults and smoke overrides", () => {
  const real = resolveConfig(
    parseCli(["--scenario", "S2", "--base-url", "http://example.test"]),
    { PERF_TOKEN: "jnk_x" },
  );
  const s2 = scenarioConfig(real, "S2");
  assert.equal(s2.agents, 100);
  assert.equal(s2.cadenceMs, 10_000);
  assert.equal(s2.durationMs, 120_000);
  assert.equal(s2.title, "Claim → comment → move");

  const smoke = resolveConfig(parseCli(["--mock"]), {});
  const smokeS2 = scenarioConfig(smoke, "S2");
  assert.equal(smokeS2.agents, 2);
  assert.equal(smokeS2.durationMs, 4_000);

  const override = resolveConfig(
    parseCli([
      "--scenario",
      "S2",
      "--token",
      "jnk_x",
      "--agents",
      "3",
      "--duration",
      "9s",
    ]),
    {},
  );
  assert.equal(scenarioConfig(override, "S2").agents, 3);
  assert.equal(scenarioConfig(override, "S2").durationMs, 9_000);

  const s5 = scenarioConfig(
    resolveConfig(parseCli(["--scenario", "S5", "--token", "jnk_x"]), {}),
    "S5",
  );
  assert.equal(s5.sse, 5_000);
  assert.equal(s5.holdMs, 600_000);
  const s3 = scenarioConfig(real, "S3");
  assert.deepEqual(s3.mix, { reads: 0.6, writes: 0.3, comments: 0.1 });
  assert.equal(s3.watchCadenceMs, 3_000);
});

test("all scenarios under --mock stay small", () => {
  const config = resolveConfig(parseCli(["--scenario", "all", "--mock"]), {});
  assert.deepEqual(config.scenarioIds, ["S1", "S2", "S3", "S4", "S5", "S6"]);
  assert.equal(scenarioConfig(config, "S4").agents, 3);
  assert.equal(scenarioConfig(config, "S4").burst, true);
  assert.equal(scenarioConfig(config, "S5").sse, 5);
  assert.equal(scenarioConfig(config, "S5").rampMs, 1_000);
});

test("validateScenarioConfig rejects zero loops and bad S4/S5 windows", () => {
  const base = resolveConfig(
    parseCli(["--scenario", "S2", "--token", "jnk_x"]),
    {},
  );
  assert.throws(
    () =>
      validateScenarioConfig(
        { ...base, overrides: { ...base.overrides, cadenceMs: 0 } },
        "S2",
      ),
    /cadence must be greater than zero/,
  );
  assert.throws(
    () =>
      validateScenarioConfig(
        { ...base, overrides: { ...base.overrides, durationMs: 0 } },
        "S2",
      ),
    /duration must be greater than zero/,
  );
  const s4 = resolveConfig(
    parseCli(["--scenario", "S4", "--token", "jnk_x", "--duration", "2s"]),
    {},
  );
  assert.equal(validateScenarioConfig(s4, "S4").durationMs, 2_000);
  const s5 = resolveConfig(
    parseCli(["--scenario", "S5", "--token", "jnk_x", "--hold", "0"]),
    {},
  );
  assert.throws(() => validateScenarioConfig(s5, "S5"), /hold must be greater/);
});

test("publicConfig redacts URL userinfo and contains no token material", () => {
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--base-url",
      "http://user:pass@example.test/api/v1",
      "--pg-url",
      "postgresql://perf:s3cret@db.test:5432/janosik",
      "--redis-url",
      "redis://:redispass@redis.test:6379/0",
    ]),
    {},
  );
  const sanitized = JSON.stringify(publicConfig(config));
  assert.equal(sanitized.includes("perf-smoke-token"), false);
  assert.equal(sanitized.includes("s3cret"), false);
  assert.equal(sanitized.includes("redispass"), false);
  assert.equal(sanitized.includes("user:pass@"), false);
  assert.match(sanitized, /"tokenCount":2/);
  assert.equal(sanitized.includes("jnk_"), false);
});

test("smoke ignores real PG/board env and caps overrides", () => {
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--agents",
      "1000",
      "--humans",
      "1000",
      "--sse",
      "1000",
      "--duration",
      "1h",
      "--hold",
      "1h",
      "--concurrency",
      "1000",
    ]),
    {
      JANOSIK_PERF_BOARDS: "real-board-1,real-board-2",
      JANOSIK_PERF_PG_URL: "postgresql://perf:secret@db/perf",
      JANOSIK_PERF_REDIS_URL: "redis://:secret@redis/0",
    },
  );
  assert.deepEqual(config.explicitBoards, []);
  assert.equal(config.pgUrl, undefined);
  assert.equal(config.redisUrl, undefined);
  assert.equal(config.boardsCount, 1);
  assert.equal(scenarioConfig(config, "S2").agents, 8);
  assert.equal(scenarioConfig(config, "S2").durationMs, 30_000);
  assert.equal(scenarioConfig(config, "S3").sse, 20);
  assert.equal(scenarioConfig(config, "S6").concurrency, 50);
  assert.equal(scenarioConfig(config, "S5").holdMs, 10_000);
  assert.equal(publicConfig(config).pg.enabled, false);
  assert.equal(publicConfig(config).redis.enabled, false);
});

test("burst can be disabled and mock board/card overrides are capped", () => {
  const noBurst = resolveConfig(
    parseCli(["--scenario", "S4", "--token", "jnk_x", "--no-burst"]),
    {},
  );
  assert.equal(scenarioConfig(noBurst, "S4").burst, false);
  const burst = resolveConfig(
    parseCli(["--scenario", "S4", "--token", "jnk_x", "--burst"]),
    {},
  );
  assert.equal(scenarioConfig(burst, "S4").burst, true);

  const mock = resolveConfig(
    parseCli(["--mock", "--mock-boards", "1000", "--mock-cards", "100000"]),
    {},
  );
  assert.equal(mock.mockBoards, 16);
  assert.equal(mock.mockCards, 2_000);
});

test("--driver mcp rejects the unimplemented S3 mixed loop", () => {
  assert.throws(
    () =>
      resolveConfig(
        parseCli(["--scenario", "S3", "--driver", "mcp", "--token", "jnk_x"]),
        {},
      ),
    /does not implement the S3/,
  );
  assert.equal(
    resolveConfig(
      parseCli(["--scenario", "S2", "--driver", "mcp", "--token", "jnk_x"]),
      {},
    ).driver,
    "mcp",
  );
});

test("usage documents scenarios, probes, drivers and exit semantics", () => {
  const text = usage();
  for (const id of ALL_SCENARIOS) assert.match(text, new RegExp(`\\b${id}\\b`));
  assert.match(text, /perf:smoke/);
  assert.match(text, /--api-probe/);
  assert.match(text, /--cpu-profile/);
  assert.match(text, /--pg-activity/);
  assert.match(text, /--redis-url/);
  assert.match(text, /--driver/);
  assert.match(text, /--recycle/);
  assert.match(text, /130/);
});
