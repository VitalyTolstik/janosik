// TASK-200.1 — JSON + Markdown report rendering.
//
// `buildReport` is pure: the CLI hands it already-measured snapshots, git
// metadata and environment facts. That keeps the report reproducible in a
// test and guarantees tokens never leak into the output.

import { publicConfig } from "./config.mjs";

const SCHEMA_VERSION = 1;

export function buildReport({
  config,
  scenarios,
  git,
  environment,
  pg = { enabled: false },
  startedAt,
  endedAt,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    task: "TASK-200.1",
    label: config.label,
    mode: config.mode,
    generatedAt: new Date(endedAt).toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    wallMs: endedAt - startedAt,
    git,
    environment,
    config: publicConfig(config),
    scenarios,
    pg,
  };
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Agent-scale baseline — ${report.label}`);
  lines.push("");
  lines.push(
    `**Commit** \`${report.git.commit}\` on \`${report.git.branch}\`${report.git.dirty ? " (dirty tree)" : ""}  `,
  );
  lines.push(
    `**Mode** ${report.mode} · **Generated** ${report.generatedAt} · **Wall** ${formatDuration(report.wallMs)}  `,
  );
  lines.push(
    `**API** ${report.config.baseUrl} · **Generator** node ${report.environment.node} on ${report.environment.platform}/${report.environment.arch}  `,
  );
  lines.push(
    `**Scenarios** ${report.scenarios.map((scenario) => scenario.id).join(", ")} · **Tokens** ${report.config.tokenCount} · **Labels** S1–S6 from docs/PERF-AGENT-SCALE.md §7.1`,
  );
  lines.push("");
  lines.push("## Throughput and errors");
  lines.push("");
  lines.push(
    "| Scenario | Agents | Duration | Requests | Actions/s | Cycles | p50 | p95 | p99 | 409 | 429 | 5xx | Err % | req/agent/min |",
  );
  lines.push(
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const scenario of report.scenarios) {
    const s = scenario.summary;
    lines.push(
      `| ${scenario.id} ${scenario.title} | ${s.agents || "—"} | ${formatDuration(s.durationMs)} | ${formatInteger(s.requests)} | ${formatDecimal(s.actionsPerSecond)} | ${formatInteger(s.cycles)} | ${formatMs(s.latency.p50)} | ${formatMs(s.latency.p95)} | ${formatMs(s.latency.p99)} | ${s.errors.conflict409} | ${s.errors.rateLimited429} | ${s.errors.server5xx} | ${formatPercent(s.errors.rate)} | ${formatDecimal(s.requestsPerAgentPerMinute)} |`,
    );
  }
  lines.push("");
  lines.push("## Resources");
  lines.push("");
  lines.push(
    "| Scenario | Probe | API RSS p50 | API RSS p95 | API RSS max | API heap p95 | API loop p95 | Gen RSS max | Gen loop p95 | SSE max | SSE bytes |",
  );
  lines.push(
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const scenario of report.scenarios) {
    const s = scenario.summary;
    const api = scenario.api?.api ?? {};
    const generator = scenario.api?.generator ?? {};
    lines.push(
      `| ${scenario.id} | ${scenario.api?.source ?? "none"} | ${formatBytes(api.rss?.p50)} | ${formatBytes(api.rss?.p95)} | ${formatBytes(api.rss?.max)} | ${formatBytes(api.heapUsed?.p95)} | ${formatMs(api.eventLoopLag?.p95)} | ${formatBytes(generator.rss?.max)} | ${formatMs(generator.eventLoopLag?.p95)} | ${s.sse.maxConcurrent} | ${formatBytes(s.sse.bytes)} |`,
    );
  }
  lines.push("");
  lines.push("## Scenario detail");
  for (const scenario of report.scenarios) {
    lines.push("");
    lines.push(`### ${scenario.id} — ${scenario.title}`);
    lines.push("");
    lines.push(
      `Config: ${scenarioConfigLine(scenario.config)} · requests ${formatInteger(scenario.summary.requests)} · bytes/request ${formatBytes(scenario.summary.bytesPerRequest)}`,
    );
    const operations = Object.entries(scenario.summary.operations);
    if (operations.length > 0) {
      lines.push("");
      lines.push(
        "| Operation | Requests | p50 | p95 | p99 | 4xx | 5xx | Bytes |",
      );
      lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
      for (const [name, op] of operations) {
        const counts = statusSplit(op.statuses);
        lines.push(
          `| ${name} | ${formatInteger(op.requests)} | ${formatMs(op.latency.p50)} | ${formatMs(op.latency.p95)} | ${formatMs(op.latency.p99)} | ${counts.client4xx} | ${counts.server5xx} | ${formatBytes(op.bytes)} |`,
        );
      }
    }
    if (scenario.errors.length > 0) {
      lines.push("");
      lines.push("Errors (samples):");
      lines.push("");
      for (const error of scenario.errors) {
        lines.push(`- ${error.message}`);
      }
    }
  }
  if (report.pg?.enabled === true) {
    lines.push("");
    lines.push("## PostgreSQL — top statements");
    lines.push("");
    if (report.pg.available === false) {
      lines.push(`Unavailable: ${report.pg.reason}`);
    } else {
      lines.push("| # | Calls | Total ms | Mean ms | Rows | Query |");
      lines.push("| ---: | ---: | ---: | ---: | ---: | --- |");
      for (const [index, query] of report.pg.queries.entries()) {
        lines.push(
          `| ${index + 1} | ${formatInteger(query.calls)} | ${formatDecimal(query.totalMs)} | ${formatDecimal(query.meanMs)} | ${formatInteger(query.rows)} | ${escapeCell(query.query)} |`,
        );
      }
    }
  }
  lines.push("");
  lines.push("## Reading the numbers");
  lines.push("");
  lines.push(
    "- This is a harness baseline, not a capacity certificate: run the generator on a separate host from the API (docs/PERF-AGENT-SCALE.md §7.1).",
  );
  lines.push(
    "- `409` is a measured CAS conflict on the real agent path; `429` is the board/global rate limit. Both are counted before any retry decision.",
  );
  lines.push(
    "- S1 currently polls the full board (`GET /boards/:id`); `--idle-endpoint ready` measures the 200.2 endpoint once it exists and falls back to the board on 404.",
  );
  lines.push(
    "- API RSS comes from `--api-probe` (heap + event-loop lag) or `--api-pid` (/proc VmRSS); generator RSS/lag is sampled in-process and is not an API measurement.",
  );
  lines.push(
    "- Mock (`--mock`) results only prove the harness works; they are never a product baseline.",
  );
  lines.push("");
  return lines.join("\n");
}

function scenarioConfigLine(config) {
  const parts = [];
  for (const key of [
    "agents",
    "humans",
    "sse",
    "cadenceMs",
    "durationMs",
    "rampMs",
    "holdMs",
    "concurrency",
    "repeats",
    "leaseMs",
    "jitter",
    "idleEndpoint",
  ]) {
    if (config[key] !== undefined) {
      parts.push(
        `${key}=${key.endsWith("Ms") ? formatDuration(config[key]) : config[key]}`,
      );
    }
  }
  return parts.join(", ");
}

export function statusSplit(statuses) {
  let client4xx = 0;
  let server5xx = 0;
  for (const [status, count] of Object.entries(statuses ?? {})) {
    const value = Number(status);
    if (value >= 500 || value === 0) server5xx += count;
    else if (value >= 400) client4xx += count;
  }
  return { client4xx, server5xx };
}

export function formatMs(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 1) return `${value.toFixed(2)} ms`;
  if (value < 1_000) return `${value.toFixed(1)} ms`;
  return `${(value / 1_000).toFixed(2)} s`;
}

export function formatBytes(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 1_024) return `${Math.round(value)} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KiB`;
  if (value < 1_024 ** 3) return `${(value / 1_024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1_024 ** 3).toFixed(2)} GiB`;
}

export function formatInteger(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return Math.round(value).toLocaleString("en-US");
}

function formatDecimal(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}
