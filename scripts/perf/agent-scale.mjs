#!/usr/bin/env node

// TASK-200.1 — agent-scale performance harness.
//
// This is a reproducible driver, not a capacity certificate. It runs S1–S6
// from docs/PERF-AGENT-SCALE.md §7.1 with a PAT-backed HTTP agent loop and
// writes a JSON + Markdown report containing the commit and effective config.

import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseCli,
  resolveConfig,
  scenarioConfig,
  usage,
} from "./lib/config.mjs";
import { HttpClient } from "./lib/http.mjs";
import { RunMetrics } from "./lib/metrics.mjs";
import { RuntimeSampler } from "./lib/probes.mjs";
import { runScenario } from "./lib/scenarios.mjs";
import { buildReport, renderMarkdown } from "./lib/report.mjs";
import { environmentInfo, gitInfo } from "./lib/git.mjs";
import { collectPgStats } from "./lib/pg.mjs";
import { startMockServer } from "./lib/mock-server.mjs";

const startedAt = Date.now();
let mock = null;
let sampler = null;
let interrupted = false;

function log(message) {
  console.log(message);
}

async function main() {
  let config;
  try {
    config = resolveConfig(parseCli(process.argv.slice(2)), process.env);
  } catch (error) {
    console.error(`perf: ${error instanceof Error ? error.message : error}`);
    console.error("");
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (config.help) {
    console.log(usage());
    return;
  }

  if (config.mock) {
    mock = await startMockServer({
      port: config.mockPort,
      boardCount: config.mockBoards,
      cardsPerBoard: config.mockCards,
    });
    config.baseUrl = mock.baseUrl;
    log(`mock API: ${config.baseUrl}`);
  }

  const controller = new AbortController();
  const stop = () => {
    if (interrupted) return;
    interrupted = true;
    console.error(
      "\ninterrupted — closing workers and writing a partial report",
    );
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await waitForHealth(config);
    const users = await resolveUsers(config);
    const boards = await resolveBoards(config, users);
    log(
      `target: ${config.baseUrl} · boards ${boards.length} · tokens ${users.length} · mode ${config.mode}`,
    );

    sampler = new RuntimeSampler({
      apiPid: config.apiPid,
      apiProbeFile: config.apiProbe,
    }).start();

    const scenarios = [];
    for (const id of config.scenarioIds) {
      if (controller.signal.aborted) break;
      scenarios.push(
        await runOne({ id, config, users, boards, signal: controller.signal }),
      );
    }

    sampler.poll();
    const pg = await collectPgStats({
      databaseUrl: config.pgUrl,
      psql: config.psql,
      limit: 20,
    });

    const report = buildReport({
      config,
      scenarios,
      git: gitInfo(),
      environment: environmentInfo(),
      pg,
      startedAt,
      endedAt: Date.now(),
    });
    const { jsonPath, markdownPath } = await writeReport(config, report);
    printSummary(report, jsonPath, markdownPath);

    if (interrupted) process.exitCode = 130;
    else if (config.mode === "smoke" && smokeFailed(report)) {
      process.exitCode = 1;
    }
  } finally {
    sampler?.stop();
    if (mock !== null) await mock.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

async function waitForHealth(config) {
  const client = new HttpClient({
    baseUrl: config.baseUrl,
    token: "",
    metrics: new RunMetrics("bootstrap"),
  });
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await client.health();
      if (response.ok) return;
      lastError = new Error(`GET /health -> ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `API is not reachable at ${config.baseUrl}/health: ${lastError instanceof Error ? lastError.message : lastError}`,
  );
}

async function resolveUsers(config) {
  const tokens = [...new Set(config.tokens)];
  const metrics = new RunMetrics("bootstrap");
  const users = [];
  for (const token of tokens) {
    const client = new HttpClient({
      baseUrl: config.baseUrl,
      token,
      metrics,
    });
    const me = await client.me();
    if (me === null || typeof me.id !== "string") {
      throw new Error("GET /auth/me returned no user id");
    }
    users.push({ token, id: me.id, email: me.email ?? null });
  }
  if (users.length === 0) throw new Error("no usable PAT");
  return users;
}

async function resolveBoards(config, users) {
  if (config.explicitBoards.length > 0) return config.explicitBoards;
  const client = new HttpClient({
    baseUrl: config.baseUrl,
    token: users[0].token,
    metrics: new RunMetrics("bootstrap"),
  });
  const boards = await client.listBoards();
  const ids = boards
    .filter((board) => typeof board?.id === "string")
    .map((board) => board.id)
    .slice(0, config.boardsCount);
  if (ids.length === 0) {
    throw new Error(
      "no boards visible to the PAT; pass --board <id> or create one",
    );
  }
  if (ids.length < config.boardsCount) {
    log(
      `warning: --boards ${config.boardsCount} requested, only ${ids.length} accessible`,
    );
  }
  return ids;
}

async function runOne({ id, config, users, boards, signal }) {
  const effective = scenarioConfig(config, id);
  const metrics = new RunMetrics(id);
  log(
    `\n▶ ${id} ${effective.title} · agents ${effective.agents ?? 0} · humans ${effective.humans ?? 0} · sse ${effective.sse ?? 0}`,
  );
  let result;
  let failure = null;
  try {
    result = await runScenario({
      id,
      config,
      users,
      boards,
      metrics,
      signal,
      log,
    });
  } catch (error) {
    failure = error;
    result = {
      scenario: effective,
      durationMs: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
      errors: [
        { message: error instanceof Error ? error.message : String(error) },
      ],
    };
  }
  sampler.poll();
  const windowEnd = Date.now();
  const snapshot = metrics.snapshot({
    durationMs: Math.max(1, result.durationMs),
    agents: effective.agents ?? 0,
  });
  const resources = sampler.summarize(result.startedAt, windowEnd);
  log(
    `${failure === null ? "✓" : "✗"} ${id}: ${snapshot.requests} req · ${snapshot.cycles} cycles · ${snapshot.actionsPerSecond ?? "—"} actions/s · p95 ${snapshot.latency.p95 ?? "—"} ms · 409 ${snapshot.errors.conflict409} · 429 ${snapshot.errors.rateLimited429} · 5xx ${snapshot.errors.server5xx}`,
  );
  if (failure !== null) {
    log(
      `  scenario failed: ${failure instanceof Error ? failure.message : failure}`,
    );
  }
  return {
    id,
    title: effective.title,
    config: { ...effective },
    summary: snapshot,
    api: resources,
    errors: [
      ...(failure === null
        ? []
        : [
            {
              message:
                failure instanceof Error ? failure.message : String(failure),
            },
          ]),
      ...(result.errors ?? []),
    ],
  };
}

function smokeFailed(report) {
  if (report.scenarios.length === 0) return true;
  for (const scenario of report.scenarios) {
    const summary = scenario.summary;
    if (summary.requests === 0) return true;
    if (summary.errors.server5xx > 0 || summary.errors.network > 0) return true;
    if (scenario.id === "S2" && summary.cycles === 0) return true;
  }
  return false;
}

async function writeReport(config, report) {
  const stamp = timestampSlug(new Date(report.endedAt));
  const defaultPath =
    config.mode === "smoke"
      ? path.join(
          os.tmpdir(),
          "janosik-perf",
          `agent-scale-smoke-${stamp}.json`,
        )
      : path.join("scripts", "perf", "results", `agent-scale-${stamp}.json`);
  const jsonPath = path.resolve(config.output ?? defaultPath);
  const markdownPath = jsonPath.replace(/\.json$/i, "") + ".md";
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderMarkdown(report)}\n`, "utf8");
  return { jsonPath, markdownPath };
}

function timestampSlug(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function printSummary(report, jsonPath, markdownPath) {
  console.log("");
  console.log(`commit ${report.git.commit} · ${report.git.branch}`);
  for (const scenario of report.scenarios) {
    const s = scenario.summary;
    console.log(
      `${scenario.id.padEnd(3)} req=${s.requests} cycles=${s.cycles} p95=${s.latency.p95 ?? "—"}ms 409=${s.errors.conflict409} 429=${s.errors.rateLimited429} 5xx=${s.errors.server5xx}`,
    );
  }
  console.log(`JSON: ${jsonPath}`);
  console.log(`MD:   ${markdownPath}`);
  if (report.pg?.enabled === true && report.pg.available === false) {
    console.log(`pg_stat_statements: ${report.pg.reason}`);
  }
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack : error);
  sampler?.stop();
  if (mock !== null) await mock.close().catch(() => {});
  process.exitCode = 1;
});
