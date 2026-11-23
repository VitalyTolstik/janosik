// TASK-200.1 — JSON + Markdown report rendering.
//
// `buildReport` is pure: the CLI hands it already-measured snapshots, git
// metadata and environment facts. That keeps the report reproducible in a
// test and guarantees tokens never leak into the output. URLs are redacted
// before this module sees them, and `escapeCell`/`escapeText` keep labels and
// error text from breaking the Markdown tables.

import { publicConfig } from "./config.mjs";
import { redactUrl } from "./redact.mjs";

const SCHEMA_VERSION = 2;

export function buildReport({
  config,
  scenarios,
  git,
  environment,
  pg = { enabled: false },
  pgActivity = null,
  cpuProfile = { enabled: false },
  redis = { enabled: false },
  startedAt,
  endedAt,
  interrupted = false,
  preflightError = null,
}) {
  const statuses = scenarios.map((scenario) => scenario.status ?? "ok");
  const overall = interrupted
    ? "interrupted"
    : statuses.includes("failed")
      ? "failed"
      : statuses.includes("interrupted")
        ? "interrupted"
        : statuses.includes("partial")
          ? "partial"
          : scenarios.length === 0
            ? "failed"
            : "ok";
  return {
    schemaVersion: SCHEMA_VERSION,
    task: "TASK-200.1",
    label: config.label,
    mode: config.mode,
    driver: config.driver,
    status: overall,
    generatedAt: new Date(endedAt).toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    wallMs: endedAt - startedAt,
    git,
    environment,
    config: publicConfig(config),
    scenarios,
    summary: {
      status: overall,
      scenarios: scenarios.length,
      ok: statuses.filter((status) => status === "ok").length,
      partial: statuses.filter((status) => status === "partial").length,
      failed: statuses.filter((status) => status === "failed").length,
      interrupted:
        statuses.filter((status) => status === "interrupted").length ||
        (interrupted ? 1 : 0),
    },
    preflightError,
    cpuProfile,
    pg,
    pgActivity,
    redis,
  };
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Agent-scale baseline — ${escapeText(report.label)}`);
  lines.push("");
  lines.push(
    `**Status** \`${report.status}\` · **Commit** \`${escapeInline(report.git.commit)}\` on \`${escapeInline(report.git.branch)}\`${report.git.dirty ? " (dirty tree)" : ""}  `,
  );
  lines.push(
    `**Mode** ${report.mode} · **Driver** ${report.driver ?? "http"} · **Generated** ${report.generatedAt} · **Wall** ${formatDuration(report.wallMs)}  `,
  );
  lines.push(
    `**API** ${escapeInline(report.config.baseUrl)} · **Generator** node ${escapeInline(report.environment.node)} on ${escapeInline(`${report.environment.platform}/${report.environment.arch}`)}  `,
  );
  lines.push(
    `**Scenarios** ${report.scenarios.map((scenario) => scenario.id).join(", ")} · **Tokens** ${report.config.tokenCount} · **Labels** S1–S6 from docs/PERF-AGENT-SCALE.md §7.1`,
  );
  lines.push("");
  lines.push("## Status");
  lines.push("");
  lines.push(
    `ok ${report.summary?.ok ?? 0} · partial ${report.summary?.partial ?? 0} · failed ${report.summary?.failed ?? 0} · interrupted ${report.summary?.interrupted ?? 0}`,
  );
  if (report.preflightError !== null && report.preflightError !== undefined) {
    lines.push("");
    lines.push(`Preflight: ${escapeText(report.preflightError)}`);
  }
  for (const scenario of report.scenarios) {
    lines.push(
      `- **${scenario.id}** \`${scenario.status ?? "ok"}\`${scenario.statusReason ? ` — ${escapeText(scenario.statusReason)}` : ""}`,
    );
  }
  lines.push("");
  lines.push("## Throughput and errors");
  lines.push("");
  lines.push(
    "| Scenario | Status | Agents | Work | Requests | Tool calls | Actions/s | Cycles | No work | p50 | p95 | p99 | 400 lease | 400 other | 409 | 409 % | 429 | 429 % | 5xx | Net | Unexp % |",
  );
  lines.push(
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const scenario of report.scenarios) {
    const s = scenario.summary;
    lines.push(
      `| ${scenario.id} ${escapeCell(scenario.title)} | ${scenario.status ?? "ok"} | ${s.agents || "—"} | ${formatDuration(s.durationMs)} | ${formatInteger(s.requests)} | ${formatInteger(s.toolCalls)} | ${formatDecimal(s.actionsPerSecond)} | ${formatInteger(s.cycles)} | ${formatInteger(s.noWork)} | ${formatMs(s.latency.p50)} | ${formatMs(s.latency.p95)} | ${formatMs(s.latency.p99)} | ${formatInteger(s.errors.leaseConflict400)} | ${formatInteger(s.errors.unexpected400)} | ${s.errors.conflict409} | ${formatPercent(s.errors.rates?.conflict409)} | ${s.errors.rateLimited429} | ${formatPercent(s.errors.rates?.rateLimited429)} | ${s.errors.server5xx} | ${s.errors.network} | ${formatPercent(s.errors.rates?.unexpected)} |`,
    );
  }
  lines.push("");
  lines.push("## Resources");
  lines.push("");
  lines.push(
    "| Scenario | Probe | API RSS p50 | API RSS p95 | API peak RSS* | API heap p95 | API loop p95 | Gen RSS max | Gen loop p95 | SSE max | SSE ramp | SSE hold | SSE bytes |",
  );
  lines.push(
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const scenario of report.scenarios) {
    const s = scenario.summary;
    const api = scenario.api?.api ?? {};
    const generator = scenario.api?.generator ?? {};
    const apiPeakRss =
      scenario.api?.source === "api-proc"
        ? (api.peakRss?.max ?? api.rss?.max)
        : api.rss?.max;
    lines.push(
      `| ${scenario.id} | ${scenario.api?.source ?? "none"} | ${formatBytes(api.rss?.p50)} | ${formatBytes(api.rss?.p95)} | ${formatBytes(apiPeakRss)} | ${formatBytes(api.heapUsed?.p95)} | ${formatMs(api.eventLoopLag?.p95)} | ${formatBytes(generator.rss?.max)} | ${formatMs(generator.eventLoopLag?.p95)} | ${s.sse.maxConcurrent} | ${formatDuration(s.sse.rampObservedMs)} | ${formatDuration(s.sse.holdObservedMs)} | ${formatBytes(s.sse.bytes)} |`,
    );
  }
  lines.push("");
  lines.push("## Scenario detail");
  for (const scenario of report.scenarios) {
    lines.push("");
    lines.push(`### ${scenario.id} — ${escapeText(scenario.title)}`);
    lines.push("");
    lines.push(
      `Status: \`${scenario.status ?? "ok"}\`${scenario.statusReason ? ` — ${escapeText(scenario.statusReason)}` : ""}`,
    );
    lines.push("");
    lines.push(
      `Config: ${scenarioConfigLine(scenario.config)} · requests ${formatInteger(scenario.summary.requests)} · tool calls ${formatInteger(scenario.summary.toolCalls)} · bytes/request ${formatBytes(scenario.summary.bytesPerRequest)}`,
    );
    if (scenario.workWindow !== undefined) {
      lines.push(
        `Work window: ${formatDuration(scenario.workWindow.workDurationMs)} (started ${new Date(scenario.workWindow.workStartedAt).toISOString()}, measured to ${new Date(scenario.workWindow.workEndedAt).toISOString()})`,
      );
    }
    if (scenario.recycle?.requests > 0) {
      lines.push(
        `Recycle (excluded from agent metrics): ${formatInteger(scenario.recycle.writes)} writes in ${formatInteger(scenario.recycle.requests)} requests; ${formatInteger(scenario.summary.recycled)} cards recycled${scenario.recycle.orphans > 0 ? `; ${formatInteger(scenario.recycle.orphans)} orphan release(s)` : ""}.`,
      );
    }
    if (scenario.id === "S5") {
      const sse = scenario.summary.sse;
      lines.push(
        `SSE opened ${formatInteger(sse.opened)}, failed ${formatInteger(sse.failed)}, max concurrent ${formatInteger(sse.maxConcurrent)}, observed ramp ${formatDuration(sse.rampObservedMs)}, observed hold ${formatDuration(sse.holdObservedMs)}.`,
      );
    }
    const probeErrors = scenario.api?.errors ?? [];
    if (probeErrors.length > 0) {
      lines.push("");
      lines.push(
        `Probe errors: ${probeErrors
          .map(
            (error) =>
              `${escapeCell(error.source)}: ${escapeCell(error.message)}`,
          )
          .join("; ")}`,
      );
    }
    const mix = scenario.summary.activity;
    if (mix !== undefined && mix.total > 0) {
      lines.push(
        `Actual S3 action-intent mix: reads ${formatPercent(mix.mix?.reads)} (${mix.reads}), write beats ${formatPercent(mix.mix?.writes)} (${mix.writes}), comment beats ${formatPercent(mix.mix?.comments)} (${mix.comments}).`,
      );
    }
    if (scenario.mcp !== undefined && scenario.mcp !== null) {
      lines.push(
        `MCP: ${scenario.mcp.processes} process(es), sampled RSS peak ${formatBytes(scenario.mcp.peakRssBytes)}, lifetime peak ${formatBytes(scenario.mcp.peakVmHwmBytes)}, total sampled peak ${formatBytes(scenario.mcp.totalPeakRssBytes)}.`,
      );
    }
    const tools = Object.entries(scenario.summary.tools ?? {});
    if (tools.length > 0) {
      lines.push("");
      lines.push("| MCP tool | Calls | p50 | p95 | p99 |");
      lines.push("| --- | ---: | ---: | ---: | ---: |");
      for (const [name, tool] of tools) {
        lines.push(
          `| ${escapeCell(name)} | ${formatInteger(tool.calls)} | ${formatMs(tool.latency?.p50)} | ${formatMs(tool.latency?.p95)} | ${formatMs(tool.latency?.p99)} |`,
        );
      }
    }
    const operations = Object.entries(scenario.summary.operations);
    if (operations.length > 0) {
      lines.push("");
      lines.push(
        "| Operation | Requests | p50 | p95 | p99 | 4xx | 5xx | Network | Aborted | Bytes |",
      );
      lines.push(
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      );
      for (const [name, op] of operations) {
        const counts = statusSplit(op.statuses);
        lines.push(
          `| ${escapeCell(name)} | ${formatInteger(op.requests)} | ${formatMs(op.latency.p50)} | ${formatMs(op.latency.p95)} | ${formatMs(op.latency.p99)} | ${counts.client4xx} | ${counts.server5xx} | ${counts.network} | ${counts.aborted} | ${formatBytes(op.bytes)} |`,
        );
      }
    }
    if (scenario.errors.length > 0) {
      lines.push("");
      lines.push("Errors (samples):");
      lines.push("");
      for (const error of scenario.errors) {
        lines.push(
          `- ${escapeText(error.message)}${error.orphan ? " _(claim release failed)_" : ""}`,
        );
      }
    }
  }
  if (report.cpuProfile?.enabled === true) {
    lines.push("");
    lines.push("## CPU profile — Top-10 self time");
    lines.push("");
    if (report.cpuProfile.available === false) {
      lines.push(`Unavailable: ${escapeText(report.cpuProfile.reason)}`);
    } else {
      lines.push(
        `Files: ${(report.cpuProfile.files ?? []).map((file) => `\`${escapeInline(file)}\``).join(", ")} · samples ${formatInteger(report.cpuProfile.samples)} · ${formatDuration(report.cpuProfile.totalMs)} profiled`,
      );
      lines.push("");
      lines.push("| # | Function | Self time | Self % | Location |");
      lines.push("| ---: | --- | ---: | ---: | --- |");
      for (const [index, entry] of (report.cpuProfile.top ?? []).entries()) {
        lines.push(
          `| ${index + 1} | ${escapeCell(entry.function)} | ${formatMs(entry.selfMs)} | ${formatPercent(entry.selfPct === null ? null : entry.selfPct / 100)} | ${escapeCell(location(entry))} |`,
        );
      }
    }
  }
  renderPg(lines, report);
  if (report.redis?.enabled === true) {
    lines.push("");
    lines.push("## Redis");
    lines.push("");
    if (report.redis.available === false) {
      lines.push(`Unavailable: ${escapeText(report.redis.reason)}`);
    } else {
      lines.push(
        `Memory ${formatBytes(report.redis.memory?.used)} (peak ${formatBytes(report.redis.memory?.peak)}, max ${formatBytes(report.redis.memory?.max)}) · clients ${formatInteger(report.redis.clients?.connected)} connected / ${formatInteger(report.redis.clients?.blocked)} blocked · ops/s ${formatInteger(report.redis.opsPerSecond)} · rejected ${formatInteger(report.redis.rejected)} · hits/misses ${formatInteger(report.redis.keyspaceHits)}/${formatInteger(report.redis.keyspaceMisses)} · hit rate ${formatPercent(report.redis.keyspaceHitRate)}`,
      );
    }
  }
  lines.push("");
  lines.push("## Reading the numbers");
  lines.push("");
  lines.push(
    "- This is a harness baseline, not a capacity certificate: run the generator on a separate host from the API (docs/PERF-AGENT-SCALE.md §7.1).",
  );
  lines.push(
    "- `409` is an expected CAS conflict, `429` an expected rate limit, and a `400` claim-lease conflict is expected contention too; they have separate counts/rates and are excluded from the main `Unexp %` rate. `5xx`, network failures and other unexpected 4xx degrade a measured run to `partial` above the documented small thresholds; zero successful 2xx responses is `failed`.",
  );
  lines.push(
    "- `ok` means successful work was measured; `partial` means the board drained, a claim/stream degraded, or unexpected 4xx/5xx crossed the threshold; `failed` means zero successful 2xx work, zero requests or fatal auth; `interrupted` means SIGINT/SIGTERM.",
  );
  lines.push(
    "- S1 currently polls the full board (`GET /boards/:id`); `--idle-endpoint ready` measures the 200.2 endpoint once it exists and falls back to the board on 404.",
  );
  lines.push(
    "- API RSS comes from `--api-probe` (heap + event-loop lag) or `--api-pid` (/proc VmRSS); generator RSS/lag is sampled in-process and is not an API measurement. `API peak RSS*` for `api-proc` is `/proc` VmHWM, the process **lifetime** peak; for `api-preload` it is the scenario-window peak.",
  );
  lines.push(
    "- `--api-preload` timestamps come from the API host clock; window filtering assumes NTP-synced clocks, so use `--api-pid` if clocks differ.",
  );
  lines.push(
    "- Mock (`--mock`) results only prove the harness works; they are never a product baseline.",
  );
  lines.push("");
  return lines.join("\n");
}

function renderPg(lines, report) {
  const pg = report.pg ?? {};
  if (
    pg?.enabled !== true &&
    pg?.available !== true &&
    report.pgActivity?.available !== true
  ) {
    return;
  }
  lines.push("");
  lines.push("## PostgreSQL — pg_stat_statements deltas");
  lines.push("");
  if (pg?.available === false) {
    lines.push(`Unavailable: ${escapeText(pg.reason)}`);
    renderPgActivity(lines, report.pgActivity);
    return;
  }
  lines.push(
    `Database URL: ${escapeInline(redactUrl(pg.url ?? "")) || "(not reported)"}`,
  );
  for (const [title, rows] of [
    ["Top-20 by calls", pg.topByCalls ?? []],
    ["Top-20 by total_exec_time", pg.topByTotalTime ?? []],
  ]) {
    lines.push("");
    lines.push(`### ${title}`);
    lines.push("");
    if (rows.length === 0) {
      lines.push("No statement deltas were observed.");
      continue;
    }
    lines.push("| # | Calls | Total ms | Mean ms | Rows | Query |");
    lines.push("| ---: | ---: | ---: | ---: | ---: | --- |");
    for (const [index, query] of rows.entries()) {
      lines.push(
        `| ${index + 1} | ${formatInteger(query.calls)} | ${formatDecimal(query.totalMs)} | ${formatDecimal(query.meanMs)} | ${formatInteger(query.rows)} | ${escapeCell(query.query)} |`,
      );
    }
  }
  const perScenario = report.scenarios.filter(
    (scenario) => scenario.pg !== undefined && scenario.pg !== null,
  );
  if (perScenario.length > 0) {
    lines.push("");
    lines.push("### Per-scenario deltas");
    lines.push("");
    lines.push(
      "| Scenario | Top query by calls | Calls | Top query by time | Total ms |",
    );
    lines.push("| --- | --- | ---: | --- | ---: |");
    for (const scenario of perScenario) {
      const byCalls = scenario.pg.topByCalls?.[0];
      const byTime = scenario.pg.topByTotalTime?.[0];
      lines.push(
        `| ${scenario.id} | ${escapeCell(byCalls?.query ?? "—")} | ${formatInteger(byCalls?.calls)} | ${escapeCell(byTime?.query ?? "—")} | ${formatDecimal(byTime?.totalMs)} |`,
      );
    }
  }
  renderPgActivity(lines, report.pgActivity);
}

function renderPgActivity(lines, activity) {
  if (activity?.available !== true) return;
  lines.push("");
  lines.push("### pg_stat_activity (peak per state/wait)");
  lines.push("");
  lines.push(
    `Samples ${formatInteger(activity.samples)} · peak connections ${formatInteger(activity.peakConnections)}`,
  );
  lines.push("");
  lines.push(
    `States: ${
      Object.entries(activity.states ?? {})
        .map(([state, count]) => `${escapeCell(state)}=${count}`)
        .join(", ") || "—"
    }`,
  );
  lines.push("");
  lines.push(
    `Waits: ${
      Object.entries(activity.waits ?? {})
        .map(([wait, count]) => `${escapeCell(wait)}=${count}`)
        .join(", ") || "—"
    }`,
  );
}

function scenarioConfigLine(config) {
  const parts = [];
  for (const key of [
    "agents",
    "humans",
    "sse",
    "cadenceMs",
    "watchCadenceMs",
    "durationMs",
    "rampMs",
    "holdMs",
    "concurrency",
    "repeats",
    "leaseMs",
    "jitter",
    "idleEndpoint",
    "burst",
  ]) {
    if (config[key] !== undefined) {
      parts.push(
        `${key}=${key.endsWith("Ms") ? formatDuration(config[key]) : config[key]}`,
      );
    }
  }
  if (config.mix !== undefined) {
    const { reads, writes, comments } = config.mix;
    parts.push(
      `mix=${Math.round(reads * 100)}/${Math.round(writes * 100)}/${Math.round(comments * 100)}`,
    );
  }
  return parts.join(", ");
}

export function statusSplit(statuses) {
  let client4xx = 0;
  let server5xx = 0;
  let network = 0;
  let aborted = 0;
  for (const [status, count] of Object.entries(statuses ?? {})) {
    const value = Number(status);
    if (value === 0) network += count;
    else if (value === -1) aborted += count;
    else if (value >= 500) server5xx += count;
    else if (value >= 400) client4xx += count;
  }
  return { client4xx, server5xx, network, aborted };
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

export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.length > 0 ? parts.join(" ") : "0 ms";
}

function location(entry) {
  if (entry.url === "(native)") return "(native)";
  const file = String(entry.url).replace(/^file:\/\//, "");
  const line = entry.line === null ? "" : `:${entry.line}`;
  return `${file}${line}`;
}

/** Markdown table cell: escape pipes, backslashes and newlines. */
export function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, " ");
}

/** Inline code/text outside a table. */
export function escapeInline(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`");
}

/** Bare text in headings/list items. */
export function escapeText(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replace(/([`*_[\]<>#|])/g, "\\$1")
    .replace(/\r?\n/g, " ");
}
