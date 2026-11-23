import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_SCENARIOS,
  SMOKE_SCENARIOS,
  parseCli,
  parseDurationMs,
  parseScenarioList,
  publicConfig,
  resolveConfig,
  scenarioConfig,
  splitList,
  usage,
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

test("parseScenarioList expands all and smoke and rejects unknown ids", () => {
  assert.deepEqual(parseScenarioList("all").ids, ALL_SCENARIOS);
  assert.deepEqual(parseScenarioList("smoke"), {
    ids: SMOKE_SCENARIOS,
    mode: "smoke",
  });
  assert.deepEqual(parseScenarioList("S2,s1").ids, ["S2", "S1"]);
  assert.throws(() => parseScenarioList("S9"), /unknown scenario/);
});

test("resolveConfig requires a scenario unless --mock requests smoke", () => {
  const bare = resolveConfig(parseCli([]), {});
  assert.equal(bare.help, true);

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
      resolveConfig(parseCli(["--scenario", "S1", "--base-url", "ftp://x"]), {
        PERF_TOKEN: "jnk_x",
      }),
    /must start with http/,
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
});

test("all scenarios under --mock stay small", () => {
  const config = resolveConfig(parseCli(["--scenario", "all", "--mock"]), {});
  assert.deepEqual(config.scenarioIds, ["S1", "S2", "S3", "S4", "S5", "S6"]);
  assert.equal(scenarioConfig(config, "S4").agents, 3);
  assert.equal(scenarioConfig(config, "S5").sse, 5);
  assert.equal(scenarioConfig(config, "S5").rampMs, 1_000);
});

test("publicConfig contains no token material", () => {
  const config = resolveConfig(parseCli(["--mock"]), {});
  const sanitized = JSON.stringify(publicConfig(config));
  assert.equal(sanitized.includes("perf-smoke-token"), false);
  assert.match(sanitized, /"tokenCount":2/);
  assert.equal(sanitized.includes("jnk_"), false);
});

test("usage documents every scenario and the mock smoke path", () => {
  const text = usage();
  for (const id of ALL_SCENARIOS) assert.match(text, new RegExp(`\\b${id}\\b`));
  assert.match(text, /perf:smoke/);
  assert.match(text, /--api-probe/);
});
