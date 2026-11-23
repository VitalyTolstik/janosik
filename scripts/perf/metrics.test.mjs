import assert from "node:assert/strict";
import test from "node:test";
import {
  RunMetrics,
  actionsPerSecond,
  percentile,
  requestsPerAgentPerMinute,
  statusCounts,
  summarizeNumbers,
} from "./lib/metrics.mjs";

test("percentile interpolates and handles empty sets", () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([42], 99), 42);
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 0), 1);
  assert.equal(percentile([1, 2, 3, 4], 100), 4);
  assert.equal(Math.round(percentile([1, 2, 3, 4], 95) * 100) / 100, 3.85);
});

test("summarizeNumbers reports p50/p95/p99 without mutating input", () => {
  const values = [4, 1, 3, 2];
  const stats = summarizeNumbers(values);
  assert.deepEqual(values, [4, 1, 3, 2]);
  assert.equal(stats.count, 4);
  assert.equal(stats.min, 1);
  assert.equal(stats.max, 4);
  assert.equal(stats.avg, 2.5);
  assert.equal(stats.p50, 2.5);
  assert.deepEqual(summarizeNumbers([]), {
    count: 0,
    min: null,
    avg: null,
    max: null,
    p50: null,
    p95: null,
    p99: null,
  });
});

test("rate helpers handle zero agents and zero duration", () => {
  assert.equal(actionsPerSecond(10, 2_000), 5);
  assert.equal(actionsPerSecond(10, 0), null);
  assert.equal(requestsPerAgentPerMinute(600, 10, 60_000), 60);
  assert.equal(requestsPerAgentPerMinute(600, 0, 60_000), null);
  assert.equal(requestsPerAgentPerMinute(600, 10, 0), null);
});

test("statusCounts separates 4xx, 5xx, network and aborts", () => {
  assert.deepEqual(
    statusCounts({
      200: 5,
      400: 1,
      401: 1,
      409: 2,
      429: 1,
      500: 3,
      0: 4,
      [-1]: 2,
    }),
    {
      success2xx: 5,
      client4xx: 5,
      server5xx: 3,
      network: 4,
      aborted: 2,
      auth401403: 1,
      badRequest400: 1,
    },
  );
});

test("RunMetrics snapshots requests, actions, errors, bytes and SSE", () => {
  const metrics = new RunMetrics("S2");
  metrics.recordRequest("board.read", 10, 200, 1_000);
  metrics.recordRequest("command.claim", 20, 409, 100);
  metrics.recordRequest("command.claim", 30, 200, 100);
  metrics.recordRequest("comment.create", 40, 201, 50);
  metrics.recordRequest("command.move", 50, 429, 80);
  metrics.recordRequest("board.read", 5, 0, 0);
  metrics.recordRequest("board.read", 6, -1, 0);
  metrics.recordAction(3);
  metrics.recordCycle();
  metrics.recordActivity("read");
  metrics.recordActivity("write");
  metrics.recordActivity("comment");
  metrics.recordNoWork({ exhausted: true, stranded: false });
  metrics.recordRecycled(2);
  metrics.recordOrphan(1);
  metrics.recordSseOpen(2, 200);
  metrics.recordSseOpen(3, 200);
  metrics.recordSseOpen(1, 503);
  metrics.recordSseBytes(1_024);
  metrics.recordSseFrame(0);
  metrics.recordSseClose();

  const snapshot = metrics.snapshot({ durationMs: 60_000, agents: 10 });
  assert.equal(snapshot.requests, 10);
  assert.equal(snapshot.success2xx, 5);
  assert.equal(snapshot.actions, 3);
  assert.equal(snapshot.cycles, 1);
  assert.equal(snapshot.noWork, 1);
  assert.equal(snapshot.exhausted, 1);
  assert.equal(snapshot.recycled, 2);
  assert.equal(snapshot.orphans, 1);
  assert.equal(snapshot.bytes, 1_330);
  assert.equal(snapshot.errors.total, 4);
  assert.equal(snapshot.errors.expected, 2);
  assert.equal(snapshot.errors.unexpected, 2);
  assert.equal(snapshot.errors.rate, 0.2);
  assert.equal(snapshot.errors.client4xx, 2);
  assert.equal(snapshot.errors.server5xx, 1);
  assert.equal(snapshot.errors.network, 1);
  assert.equal(snapshot.errors.aborted, 1);
  assert.equal(snapshot.errors.conflict409, 1);
  assert.equal(snapshot.errors.rateLimited429, 1);
  assert.equal(snapshot.errors.unexpected4xx, 0);
  assert.equal(snapshot.errors.rates.conflict409, 0.1);
  assert.equal(snapshot.errors.rates.rateLimited429, 0.1);
  assert.equal(snapshot.errors.rates.unexpected, 0.2);
  assert.equal(snapshot.requestsPerAgentPerMinute, 1);
  assert.equal(snapshot.actionsPerSecond, 0.05);
  assert.equal(snapshot.operations["command.claim"].requests, 2);
  assert.equal(snapshot.operations["command.claim"].statuses["409"], 1);
  assert.deepEqual(snapshot.activity, {
    reads: 1,
    writes: 1,
    comments: 1,
    total: 3,
    mix: {
      reads: 0.3333,
      writes: 0.3333,
      comments: 0.3333,
    },
  });
  assert.equal(snapshot.sse.opened, 2);
  assert.equal(snapshot.sse.failed, 1);
  assert.equal(snapshot.sse.current, 1);
  assert.equal(snapshot.sse.maxConcurrent, 2);
  assert.equal(snapshot.sse.frames, 1);
  assert.equal(snapshot.sse.bytes, 1_024);
});

test("expected claim-lease 400s are excluded from unexpected rates", () => {
  const metrics = new RunMetrics("S2");
  metrics.recordRequest("board.read", 1, 200);
  metrics.recordRequest("command.claim", 2, 400, 0, { expected: true });
  const snapshot = metrics.snapshot({ durationMs: 1_000, agents: 1 });
  assert.equal(snapshot.errors.badRequest400, 1);
  assert.equal(snapshot.errors.leaseConflict400, 1);
  assert.equal(snapshot.errors.unexpected400, 0);
  assert.equal(snapshot.errors.expected, 1);
  assert.equal(snapshot.errors.unexpected, 0);
  assert.equal(snapshot.errors.unexpected4xx, 0);
  assert.equal(snapshot.errors.rate, 0);
});

test("per-agent cadence is measured from observed action timestamps", () => {
  const metrics = new RunMetrics("S2");
  metrics.recordAgentAction(0, 1_000);
  metrics.recordAgentAction(0, 2_000);
  metrics.recordAgentAction(0, 3_000);
  metrics.recordAgentAction(1, 1_500);
  const snapshot = metrics.snapshot({ durationMs: 60_000, agents: 2 });
  assert.equal(snapshot.agentCadence.agentsMeasured, 1);
  assert.equal(snapshot.agentCadence.medianMs, 1_000);
  assert.equal(snapshot.agentCadence.minMs, 1_000);
  assert.equal(snapshot.agentCadence.maxMs, 1_000);
});

test("tool calls are measured separately from HTTP requests", () => {
  const metrics = new RunMetrics("S2");
  metrics.recordTool("janosik_claim_card", 5);
  metrics.recordTool("janosik_claim_card", 7);
  const snapshot = metrics.snapshot({ durationMs: 1_000, agents: 1 });
  assert.equal(snapshot.requests, 0);
  assert.equal(snapshot.toolCalls, 2);
  assert.equal(snapshot.tools.janosik_claim_card.calls, 2);
  assert.equal(snapshot.tools.janosik_claim_card.latency.max, 7);
});

test("empty RunMetrics snapshot is JSON-safe", () => {
  const snapshot = new RunMetrics("S1").snapshot({
    durationMs: 1_000,
    agents: 1,
  });
  assert.equal(snapshot.latency.p95, null);
  assert.equal(snapshot.bytesPerRequest, null);
  assert.equal(snapshot.errors.rate, 0);
  assert.equal(snapshot.errors.unexpected, 0);
  assert.equal(snapshot.errors.other4xx, 0);
  assert.equal(snapshot.success2xx, 0);
  assert.equal(snapshot.orphans, 0);
  assert.equal(snapshot.requestsPerAgentPerMinute, 0);
  assert.equal(snapshot.activity.mix, null);
});
