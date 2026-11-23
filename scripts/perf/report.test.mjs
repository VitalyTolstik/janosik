import assert from "node:assert/strict";
import test from "node:test";
import { parseCli, resolveConfig, scenarioConfig } from "./lib/config.mjs";
import { RunMetrics } from "./lib/metrics.mjs";
import {
  buildReport,
  escapeCell,
  escapeText,
  formatBytes,
  formatInteger,
  formatMs,
  renderMarkdown,
  statusSplit,
} from "./lib/report.mjs";

function fixture({ extraConfig = [] } = {}) {
  const config = resolveConfig(parseCli(["--mock", ...extraConfig]), {});
  const metrics = new RunMetrics("S2");
  metrics.recordRequest("board.read", 12, 200, 2_000);
  metrics.recordRequest("command.claim", 25, 200, 100);
  metrics.recordRequest("comment.create", 30, 201, 100);
  metrics.recordRequest("command.move", 40, 409, 100);
  metrics.recordAction(3);
  metrics.recordCycle();
  metrics.recordActivity("write");
  metrics.recordActivity("comment");
  metrics.recordNoWork({ exhausted: true, stranded: false });
  metrics.recordSseOpen(1, 200);
  const summary = metrics.snapshot({ durationMs: 60_000, agents: 2 });
  const scenario = {
    id: "S2",
    title: "Claim → comment → move",
    status: "partial",
    statusReason: "board exhausted after 1 cycle",
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
    workWindow: {
      workStartedAt: 1_700_000_000_000,
      workEndedAt: 1_700_000_060_000,
      workDurationMs: 60_000,
    },
    mcp: {
      processes: 1,
      peakRssBytes: 50 * 1024 * 1024,
      totalPeakRssBytes: 50 * 1024 * 1024,
    },
    recycle: { requests: 2, writes: 2 },
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
    pgActivity: null,
    cpuProfile: { enabled: false },
    redis: { enabled: false },
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_060_000,
  };
}

test("buildReport keeps machine-readable metrics, statuses and redacts tokens", () => {
  const report = buildReport(fixture());
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.task, "TASK-200.1");
  assert.equal(report.git.commit, "abc1234");
  assert.equal(report.status, "partial");
  assert.equal(report.summary.partial, 1);
  assert.equal(report.scenarios[0].summary.actions, 3);
  assert.equal(report.scenarios[0].summary.errors.conflict409, 1);
  assert.equal(report.scenarios[0].summary.exhausted, 1);
  assert.equal(report.config.tokenCount, 2);
  assert.equal(JSON.stringify(report).includes("perf-smoke-token"), false);
  assert.equal(JSON.parse(JSON.stringify(report)).scenarios[0].id, "S2");
});

test("renderMarkdown includes status, commit, configuration and error columns", () => {
  const markdown = renderMarkdown(buildReport(fixture()));
  assert.match(markdown, /# Agent-scale baseline/);
  assert.match(markdown, /abc1234/);
  assert.match(markdown, /`partial`/);
  assert.match(markdown, /board exhausted after 1 cycle/);
  assert.match(markdown, /S2 Claim → comment → move/);
  assert.match(markdown, /\| 409 \| 429 \| 5xx \| Network \|/);
  assert.match(markdown, /command\.claim/);
  assert.match(markdown, /150\.0 MiB/);
  assert.match(markdown, /Mock \(`--mock`\) results .*prove/);
  assert.match(markdown, /Actual S3 action mix/);
  assert.match(markdown, /MCP: 1 process/);
});

test("renderMarkdown escapes table cells and headings", () => {
  const report = buildReport(fixture());
  report.label = "smoke | *bold*\nsecond line";
  report.scenarios[0].title = "Pipe | title\nnext";
  report.scenarios[0].errors = [{ message: "a | b\\c\nnext", orphan: true }];
  const markdown = renderMarkdown(report);
  assert.match(markdown, /smoke \\\| \\\*bold\\\* second line/);
  assert.match(markdown, /Pipe \\\| title next/);
  assert.match(markdown, /a \\\| b\\\\c next/);
  assert.match(markdown, /claim release failed/);
});

test("renderMarkdown reports an unavailable pg_stat_statements probe", () => {
  const report = buildReport({
    ...fixture(),
    pg: { enabled: true, available: false, reason: "psql: not found" },
    pgActivity: {
      enabled: true,
      available: true,
      samples: 2,
      peakConnections: 5,
      states: { active: 3 },
      waits: {},
    },
  });
  const markdown = renderMarkdown(report);
  assert.match(markdown, /PostgreSQL — pg_stat_statements deltas/);
  assert.match(markdown, /Unavailable: psql: not found/);
  assert.match(markdown, /peak connections 5/);
});

test("renderMarkdown renders both PG top lists and pg_stat_activity", () => {
  const report = buildReport({
    ...fixture(),
    pg: {
      enabled: true,
      available: true,
      url: "postgresql://db.perf/janosik",
      topByCalls: [
        {
          queryid: "1",
          calls: 4,
          totalMs: 20,
          meanMs: 5,
          rows: 2,
          query: "SELECT 1",
        },
      ],
      topByTotalTime: [
        {
          queryid: "2",
          calls: 1,
          totalMs: 90,
          meanMs: 90,
          rows: 0,
          query: "SELECT 2",
        },
      ],
    },
    pgActivity: {
      enabled: true,
      available: true,
      samples: 3,
      peakConnections: 8,
      states: { active: 4, idle: 4 },
      waits: { "Client:ClientRead": 2 },
    },
  });
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Top-20 by calls/);
  assert.match(markdown, /Top-20 by total_exec_time/);
  assert.match(markdown, /SELECT 2/);
  assert.match(markdown, /peak connections 8/);
  assert.match(markdown, /Client:ClientRead=2/);
});

test("renderMarkdown renders CPU, Redis and per-scenario PG sections", () => {
  const report = buildReport({
    ...fixture(),
    pg: {
      enabled: true,
      available: true,
      topByCalls: [],
      topByTotalTime: [],
    },
    cpuProfile: {
      enabled: true,
      available: true,
      files: ["api.cpuprofile"],
      totalMs: 1_000,
      samples: 100,
      top: [
        {
          function: "loadBoardAggregate",
          url: "file:///app/backend/board.js",
          line: 42,
          selfMs: 250,
          selfPct: 25,
        },
      ],
    },
    redis: {
      enabled: true,
      available: true,
      memory: { used: 1_024, peak: 2_048, max: 4_096 },
      clients: { connected: 3, blocked: 0 },
      opsPerSecond: 12,
      rejected: 1,
      keyspaceHits: 9,
      keyspaceMisses: 3,
      keyspaceHitRate: 0.75,
    },
  });
  report.scenarios[0].pg = {
    available: true,
    topByCalls: [{ query: "SELECT 1", calls: 2 }],
    topByTotalTime: [{ query: "SELECT 1", totalMs: 10 }],
  };
  const markdown = renderMarkdown(report);
  assert.match(markdown, /CPU profile — Top-10 self time/);
  assert.match(markdown, /loadBoardAggregate/);
  assert.match(markdown, /board\.js:42/);
  assert.match(markdown, /## Redis/);
  assert.match(markdown, /hit rate 75\.00%/);
  assert.match(markdown, /Per-scenario deltas/);
});

test("report output never contains URL userinfo or a password", () => {
  const config = resolveConfig(
    parseCli([
      "--mock",
      "--base-url",
      "http://alice:hunter2@example.test/api/v1",
      "--pg-url",
      "postgresql://perf:pgsecret@db.test:5432/janosik",
      "--redis-url",
      "redis://:redispass@redis.test:6379/0",
    ]),
    {},
  );
  const report = buildReport({
    ...fixture(),
    config,
    pg: {
      enabled: true,
      available: true,
      url: "postgresql://db.test:5432/janosik",
      topByCalls: [],
      topByTotalTime: [],
    },
  });
  const json = JSON.stringify(report);
  const markdown = renderMarkdown(report);
  for (const secret of ["hunter2", "pgsecret", "redispass", "alice:"]) {
    assert.equal(json.includes(secret), false, `JSON leaked ${secret}`);
    assert.equal(markdown.includes(secret), false, `Markdown leaked ${secret}`);
  }
  assert.match(json, /"baseUrl":"http:\/\/example\.test\/api\/v1"/);
  assert.equal(json.includes("perf@db.test"), false);
});

test("format helpers and statusSplit are stable", () => {
  assert.equal(formatMs(null), "—");
  assert.equal(formatMs(0.5), "0.50 ms");
  assert.equal(formatMs(1_500), "1.50 s");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MiB");
  assert.equal(formatInteger(1_234), "1,234");
  assert.deepEqual(statusSplit({ 200: 3, 409: 1, 500: 2, 0: 1, [-1]: 1 }), {
    client4xx: 1,
    server5xx: 2,
    network: 1,
    aborted: 1,
  });
  assert.equal(escapeCell("a|b\nc"), "a\\|b c");
  assert.equal(escapeText("a`b\nc"), "a\\`b c");
});
