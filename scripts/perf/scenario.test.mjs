import assert from "node:assert/strict";
import test from "node:test";
import { parseCli, resolveConfig, scenarioConfig } from "./lib/config.mjs";
import { HttpClient } from "./lib/http.mjs";
import { RunMetrics } from "./lib/metrics.mjs";
import { startMockServer } from "./lib/mock-server.mjs";
import { runScenario } from "./lib/scenarios.mjs";
import { evaluateScenarioStatus } from "./lib/status.mjs";

async function usersFor(mock, tokens) {
  return Promise.all(
    tokens.map(async (token) => {
      const client = new HttpClient({
        baseUrl: mock.baseUrl,
        token,
        metrics: new RunMetrics("bootstrap"),
      });
      const me = await client.me();
      return { token, id: me.id, email: me.email };
    }),
  );
}

function statusOf(result, config, metrics) {
  const summary = metrics.snapshot({
    durationMs: Math.max(1, result.durationMs),
    agents: result.scenario.agents ?? 0,
  });
  summary.timedOut = result.timedOut === true;
  return {
    summary,
    ...evaluateScenarioStatus({
      id: result.scenario.id,
      scenario: result.scenario,
      summary,
      errors: result.errors,
      fatal: result.fatalAuth,
      interrupted: result.interrupted,
      driver: "http",
      workDurationMs: result.workDurationMs,
    }),
  };
}

test("S4 synchronises a burst after the ramp and reports the work window", async (t) => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 40 });
  t.after(() => mock.close());
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--scenario",
      "S4",
      "--agents",
      "2",
      "--ramp",
      "250ms",
      "--duration",
      "400ms",
      "--cadence",
      "100ms",
    ]),
    {},
  );
  const users = await usersFor(mock, config.tokens);
  const metrics = new RunMetrics("S4");
  const started = Date.now();
  const result = await runScenario({
    id: "S4",
    config: { ...config, baseUrl: mock.baseUrl },
    users,
    boards: ["board-1"],
    metrics,
    signal: new AbortController().signal,
  });
  assert.equal(result.scenario.burst, true);
  assert.equal(result.workStartedAt >= started + 250, true);
  assert.equal(result.plannedWorkStartedAt, result.startedAt + 250);
  assert.equal(result.actualWorkStartedAt >= result.plannedWorkStartedAt, true);
  assert.equal(result.workDurationMs >= 300, true);
  assert.equal(result.workDurationMs <= 1_500, true);
  assert.equal(statusOf(result, config, metrics).status, "ok");
});

test("S5 hold starts after the observed ramp and is reported", async (t) => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 4 });
  t.after(() => mock.close());
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--scenario",
      "S5",
      "--sse",
      "3",
      "--ramp",
      "200ms",
      "--hold",
      "300ms",
    ]),
    {},
  );
  const users = await usersFor(mock, config.tokens);
  const metrics = new RunMetrics("S5");
  const result = await runScenario({
    id: "S5",
    config: { ...config, baseUrl: mock.baseUrl },
    users,
    boards: ["board-1"],
    metrics,
    signal: new AbortController().signal,
  });
  assert.equal(result.scenario.sse, 3);
  assert.equal(metrics.sse.opened, 3);
  assert.equal(metrics.sse.holdObservedMs >= 250, true);
  assert.equal(metrics.sse.rampObservedMs >= 150, true);
  assert.equal(result.timedOut, false);
  assert.equal(statusOf(result, config, metrics).status, "ok");
});

test("S5 overall deadline cuts the hold and reports partial", async (t) => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 4 });
  t.after(() => mock.close());
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--scenario",
      "S5",
      "--sse",
      "3",
      "--ramp",
      "10ms",
      "--hold",
      "500ms",
    ]),
    {},
  );
  const users = await usersFor(mock, config.tokens);
  const metrics = new RunMetrics("S5");
  const result = await runScenario({
    id: "S5",
    config: { ...config, baseUrl: mock.baseUrl },
    users,
    boards: ["board-1"],
    metrics,
    signal: new AbortController().signal,
    sseOverallGraceMs: -400,
  });
  const status = statusOf(result, config, metrics);
  assert.equal(result.timedOut, true);
  assert.equal(metrics.sse.liveAtHoldStart, 3);
  assert.equal(status.status, "partial");
  assert.match(status.reason, /scenario deadline truncated/);
});

test("S3 deadline cut after a live hold is partial, not ok", async (t) => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 4 });
  t.after(() => mock.close());
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--scenario",
      "S3",
      "--agents",
      "1",
      "--humans",
      "0",
      "--sse",
      "2",
      "--mix",
      "100/0/0",
      "--duration",
      "300ms",
      "--cadence",
      "50ms",
    ]),
    {},
  );
  const users = await usersFor(mock, config.tokens);
  const metrics = new RunMetrics("S3");
  const result = await runScenario({
    id: "S3",
    config: { ...config, baseUrl: mock.baseUrl },
    users,
    boards: ["board-1"],
    metrics,
    signal: new AbortController().signal,
    sseCloseGraceMs: -1,
  });
  const status = statusOf(result, config, metrics);
  assert.equal(result.timedOut, true);
  assert.equal(metrics.sse.liveAtHoldStart, 2);
  assert.equal(status.status, "partial");
  assert.match(status.reason, /scenario deadline truncated/);
});

test("S2 reports a drained board as partial, not as a green baseline", async (t) => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 2 });
  t.after(() => mock.close());
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--scenario",
      "S2",
      "--agents",
      "1",
      "--duration",
      "500ms",
      "--cadence",
      "50ms",
    ]),
    {},
  );
  const users = await usersFor(mock, config.tokens);
  const metrics = new RunMetrics("S2");
  const result = await runScenario({
    id: "S2",
    config: { ...config, baseUrl: mock.baseUrl },
    users,
    boards: ["board-1"],
    metrics,
    signal: new AbortController().signal,
  });
  const status = statusOf(result, config, metrics);
  assert.equal(status.summary.cycles > 0, true);
  assert.equal(status.summary.exhausted > 0, true);
  assert.equal(status.status, "partial");
  assert.match(status.reason, /board exhausted/);
});

test("--recycle keeps a small board working without inflating agent actions", async (t) => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 3 });
  t.after(() => mock.close());
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--scenario",
      "S2",
      "--agents",
      "1",
      "--duration",
      "900ms",
      "--cadence",
      "50ms",
      "--recycle",
    ]),
    {},
  );
  assert.equal(config.recycle, true);
  const users = await usersFor(mock, config.tokens);
  const metrics = new RunMetrics("S2");
  const result = await runScenario({
    id: "S2",
    config: { ...config, baseUrl: mock.baseUrl },
    users,
    boards: ["board-1"],
    metrics,
    signal: new AbortController().signal,
  });
  const status = statusOf(result, config, metrics);
  assert.equal(status.summary.cycles > 3, true);
  assert.equal(status.summary.recycled > 0, true);
  assert.equal(result.recycle.requests > 0, true);
  assert.equal(["ok", "partial"].includes(status.status), true);
  // Recycle writes live in their own collector, not in the agent snapshot.
  assert.equal(status.summary.actions, status.summary.cycles * 3);
});

test("S5 with streams that close immediately is not ok", async (t) => {
  const mock = await startMockServer({
    boardCount: 1,
    cardsPerBoard: 2,
    sseCloseImmediately: true,
  });
  t.after(() => mock.close());
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--scenario",
      "S5",
      "--sse",
      "2",
      "--ramp",
      "10ms",
      "--hold",
      "100ms",
    ]),
    {},
  );
  const users = await usersFor(mock, config.tokens);
  const metrics = new RunMetrics("S5");
  const result = await runScenario({
    id: "S5",
    config: { ...config, baseUrl: mock.baseUrl },
    users,
    boards: ["board-1"],
    metrics,
    signal: new AbortController().signal,
  });
  const status = statusOf(result, config, metrics);
  assert.equal(metrics.sse.opened, 2);
  assert.equal(metrics.sse.closedEarly, 2);
  assert.equal(metrics.sse.liveAtHoldEnd, 0);
  assert.equal(status.status, "failed");
});

test("S5 with no live stream is failed, not an empty success", async (t) => {
  const mock = await startMockServer({
    boardCount: 1,
    cardsPerBoard: 2,
    sseStatus: 503,
  });
  t.after(() => mock.close());
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--scenario",
      "S5",
      "--sse",
      "2",
      "--ramp",
      "10ms",
      "--hold",
      "100ms",
    ]),
    {},
  );
  const users = await usersFor(mock, config.tokens);
  const metrics = new RunMetrics("S5");
  const result = await runScenario({
    id: "S5",
    config: { ...config, baseUrl: mock.baseUrl },
    users,
    boards: ["board-1"],
    metrics,
    signal: new AbortController().signal,
  });
  const status = statusOf(result, config, metrics);
  assert.equal(metrics.sse.opened, 0);
  assert.equal(metrics.sse.failed, 2);
  assert.equal(status.status, "failed");
});

test("S3 measures live streams at the end of its hold", async (t) => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 4 });
  t.after(() => mock.close());
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--scenario",
      "S3",
      "--agents",
      "1",
      "--humans",
      "0",
      "--sse",
      "2",
      "--mix",
      "100/0/0",
      "--duration",
      "300ms",
      "--cadence",
      "50ms",
    ]),
    {},
  );
  const users = await usersFor(mock, config.tokens);
  const metrics = new RunMetrics("S3");
  const result = await runScenario({
    id: "S3",
    config: { ...config, baseUrl: mock.baseUrl },
    users,
    boards: ["board-1"],
    metrics,
    signal: new AbortController().signal,
  });
  const status = statusOf(result, config, metrics);
  assert.equal(metrics.sse.opened, 2);
  assert.equal(metrics.sse.liveAtHoldStart, 2);
  assert.equal(metrics.sse.liveAtHoldEnd, 2);
  assert.equal(status.status, "ok");
});

test("read-only S3 --mix 100/0/0 is not failed for zero cycles", async (t) => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 4 });
  t.after(() => mock.close());
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--scenario",
      "S3",
      "--agents",
      "1",
      "--humans",
      "0",
      "--sse",
      "0",
      "--mix",
      "100/0/0",
      "--duration",
      "300ms",
      "--cadence",
      "50ms",
    ]),
    {},
  );
  const users = await usersFor(mock, config.tokens);
  const metrics = new RunMetrics("S3");
  const result = await runScenario({
    id: "S3",
    config: { ...config, baseUrl: mock.baseUrl },
    users,
    boards: ["board-1"],
    metrics,
    signal: new AbortController().signal,
  });
  const status = statusOf(result, config, metrics);
  assert.equal(status.summary.cycles, 0);
  assert.equal(status.summary.success2xx > 0, true);
  assert.equal(status.status, "ok");
});

test("scenarioConfig still exposes the requested S4 work window", () => {
  const config = resolveConfig(
    parseCli(["--scenario", "S4", "--duration", "5s"]),
    { JANOSIK_PERF_TOKEN: "jnk_x" },
  );
  const scenario = scenarioConfig(config, "S4");
  assert.equal(scenario.durationMs, 5_000);
  assert.equal(scenario.rampMs, 30_000);
  assert.equal(scenario.burst, true);
});
