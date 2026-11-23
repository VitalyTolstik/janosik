import assert from "node:assert/strict";
import test from "node:test";
import { parseCli, resolveConfig, scenarioConfig } from "./lib/config.mjs";
import { RunMetrics } from "./lib/metrics.mjs";
import {
  buildReport,
  formatBytes,
  formatInteger,
  formatMs,
  renderMarkdown,
  statusSplit,
} from "./lib/report.mjs";

function fixture() {
  const config = resolveConfig(parseCli(["--mock"]), {});
  const metrics = new RunMetrics("S2");
  metrics.recordRequest("board.read", 12, 200, 2_000);
  metrics.recordRequest("command.claim", 25, 200, 100);
  metrics.recordRequest("comment.create", 30, 201, 100);
  metrics.recordRequest("command.move", 40, 409, 100);
  metrics.recordAction(3);
  metrics.recordCycle();
  metrics.recordSseOpen(1, 200);
  const summary = metrics.snapshot({ durationMs: 60_000, agents: 2 });
  const scenario = {
    id: "S2",
    title: "Claim → comment → move",
    config: scenarioConfig(config, "S2"),
    summary,
    api: {
      source: "api-preload",
      api: {
        rss: {
          p50: 120 * 1024 * 1024,
          p95: 150 * 1024 * 1024,
          max: 160 * 1024 * 1024,
        },
        heapUsed: { p95: 60 * 1024 * 1024 },
        eventLoopLag: { p95: 12 },
      },
      generator: {
        rss: { max: 80 * 1024 * 1024 },
        eventLoopLag: { p95: 4 },
      },
    },
    errors: [],
  };
  return {
    config,
    scenarios: [scenario],
    git: { commit: "abc1234", branch: "feat/x", dirty: false },
    environment: {
      node: "v24.0.0",
      platform: "linux",
      arch: "x64",
      cpus: 8,
      totalMemBytes: 16 * 1024 ** 3,
      hostname: "perf-host",
    },
    pg: { enabled: false },
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_060_000,
  };
}

test("buildReport keeps machine-readable metrics and redacts tokens", () => {
  const report = buildReport(fixture());
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.task, "TASK-200.1");
  assert.equal(report.git.commit, "abc1234");
  assert.equal(report.scenarios[0].summary.actions, 3);
  assert.equal(report.scenarios[0].summary.errors.conflict409, 1);
  assert.equal(report.config.tokenCount, 2);
  assert.equal(JSON.stringify(report).includes("perf-smoke-token"), false);
  assert.equal(JSON.parse(JSON.stringify(report)).scenarios[0].id, "S2");
});

test("renderMarkdown includes commit, configuration and error columns", () => {
  const markdown = renderMarkdown(buildReport(fixture()));
  assert.match(markdown, /# Agent-scale baseline/);
  assert.match(markdown, /abc1234/);
  assert.match(markdown, /S2 Claim → comment → move/);
  assert.match(markdown, /\| 409 \| 429 \| 5xx \|/);
  assert.match(markdown, /command\.claim/);
  assert.match(markdown, /150\.0 MiB/);
  assert.match(markdown, /Mock \(`--mock`\) results .*prove/);
  assert.match(markdown, /req\/agent\/min/);
});

test("renderMarkdown reports an unavailable pg_stat_statements probe", () => {
  const report = buildReport({
    ...fixture(),
    pg: { enabled: true, available: false, reason: "psql: not found" },
  });
  const markdown = renderMarkdown(report);
  assert.match(markdown, /PostgreSQL — top statements/);
  assert.match(markdown, /Unavailable: psql: not found/);
});

test("format helpers are stable", () => {
  assert.equal(formatMs(null), "—");
  assert.equal(formatMs(0.5), "0.50 ms");
  assert.equal(formatMs(1_500), "1.50 s");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MiB");
  assert.equal(formatInteger(1_234), "1,234");
  assert.deepEqual(statusSplit({ 200: 3, 409: 1, 500: 2, 0: 1 }), {
    client4xx: 1,
    server5xx: 3,
  });
});
