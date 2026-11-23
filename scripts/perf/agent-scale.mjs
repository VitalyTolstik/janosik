#!/usr/bin/env node

// TASK-200.1 — agent-scale performance harness.
//
// This is a reproducible driver, not a capacity certificate. It runs S1–S6
// from docs/PERF-AGENT-SCALE.md §7.1 with a PAT-backed HTTP agent loop or real
// MCP stdio processes, and writes a JSON + Markdown report containing the
// commit, effective config, per-scenario status and the measurement windows.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseCli,
  resolveConfig,
  scenarioConfig,
  usage,
  validateScenarioConfig,
} from "./lib/config.mjs";
import { HttpClient } from "./lib/http.mjs";
import { RunMetrics } from "./lib/metrics.mjs";
import { RuntimeSampler } from "./lib/probes.mjs";
import { runScenario } from "./lib/scenarios.mjs";
import { buildReport, renderMarkdown } from "./lib/report.mjs";
import { environmentInfo, gitInfo } from "./lib/git.mjs";
import {
  PG_SNAPSHOT_LIMIT,
  PgActivitySampler,
  collectPgStatements,
  diffPgStatements,
} from "./lib/pg.mjs";
import { collectCpuProfile } from "./lib/cpuprofile.mjs";
import { LiveProfiler } from "./lib/inspector-profile.mjs";
import { collectRedisInfo, diffRedisInfo } from "./lib/redis.mjs";
import { startMockServer } from "./lib/mock-server.mjs";
import { evaluateScenarioStatus } from "./lib/status.mjs";
import {
  PreflightError,
  requiredIdentities,
  selectBoards,
  validateBoardAccess,
  validateTokenIdentity,
} from "./lib/preflight.mjs";
import { redactUrl, sanitizeText } from "./lib/redact.mjs";

const startedAt = Date.now();
let mock = null;
let sampler = null;
let pgSampler = null;
let activeConfig = null;
let interrupted = false;

function log(message) {
  console.log(message);
}

function redactedBaseUrl(config) {
  return redactUrl(config.baseUrl);
}

async function main() {
  let config;
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    try {
      config = resolveConfig(parseCli(process.argv.slice(2)), process.env);
    } catch (error) {
      console.error(
        `perf: ${sanitizeText(error instanceof Error ? error.message : error)}`,
      );
      console.error("perf: run with --help for the CLI surface");
      process.exitCode = 2;
      return;
    }
    activeConfig = config;
    if (config.help) {
      console.log(usage());
      return;
    }

    // Fail on an invalid profile before spawning a mock or touching the API.
    try {
      for (const id of config.scenarioIds) validateScenarioConfig(config, id);
    } catch (error) {
      console.error(
        `perf: ${sanitizeText(error instanceof Error ? error.message : error)}`,
      );
      process.exitCode = 2;
      return;
    }

    if (config.mock) {
      mock = await startMockServer({
        port: config.mockPort,
        boardCount: config.mockBoards,
        cardsPerBoard: config.mockCards,
      });
      config.baseUrl = mock.baseUrl;
      log(`mock API: ${redactedBaseUrl(config)}`);
    }

    const controller = new AbortController();
    let liveProfiler = null;
    let liveProfileStartedAt = null;
    let instrumentationFailed = false;
    let instrumentationError = null;
    const stop = (signal) => {
      if (interrupted) {
        console.error(`perf: second ${signal} — exiting 130 without waiting`);
        process.exit(130);
      }
      interrupted = true;
      console.error(
        "\nperf: interrupted — cancelling in-flight requests and writing a partial report",
      );
      controller.abort();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    try {
      await waitForHealth(config, controller.signal);
      const users = await resolveUsers(config, controller.signal);
      assertTokenPool(config, users);
      const boards = await resolveBoards(config, users, controller.signal);
      config.resolvedBoards = boards;
      log(
        `target: ${redactedBaseUrl(config)} · boards ${boards.length} · tokens ${users.length} · mode ${config.mode} · driver ${config.driver}`,
      );
      if (config.pgActivity && !config.pgUrl) {
        log(
          "warning: --pg-activity needs --pg-url; skipping activity sampling",
        );
      }

      sampler = new RuntimeSampler({
        apiPid: config.apiPid,
        apiProbeFile: config.apiProbe,
      }).start();
      if (config.apiInspect !== undefined) {
        liveProfiler = new LiveProfiler({
          wsUrl: config.apiInspect,
          profilePath: config.cpuProfile,
          signal: controller.signal,
        });
        try {
          await liveProfiler.start();
          liveProfileStartedAt = Date.now();
        } catch (error) {
          instrumentationFailed = true;
          instrumentationError = sanitizeText(
            `--api-inspect failed: ${error instanceof Error ? error.message : String(error)}`,
            config.tokens,
          );
          log(`warning: ${instrumentationError}; continuing without a profile`);
          liveProfiler.close();
          liveProfiler = null;
        }
      }
      if (config.pgActivity && config.pgUrl) {
        pgSampler = new PgActivitySampler({
          databaseUrl: config.pgUrl,
          psql: config.psql,
          intervalMs: config.pgActivityIntervalMs,
        }).start(controller.signal);
      }

      const redisBefore = await collectRedisInfo({
        redisUrl: config.redisUrl,
        redisCli: config.redisCli,
        signal: controller.signal,
      });
      const redisStartedAt = Date.now();
      const pgSuiteBefore = config.pgUrl
        ? await collectPgStatements({
            databaseUrl: config.pgUrl,
            psql: config.psql,
            limit: PG_SNAPSHOT_LIMIT,
            signal: controller.signal,
          })
        : null;

      const scenarios = [];
      let fatal = false;
      for (const id of config.scenarioIds) {
        if (controller.signal.aborted || fatal) break;
        if (config.mock && config.mode === "smoke") mock.resetBoards();
        const pgBefore = config.pgUrl
          ? await collectPgStatements({
              databaseUrl: config.pgUrl,
              psql: config.psql,
              limit: PG_SNAPSHOT_LIMIT,
              signal: controller.signal,
            })
          : null;
        const scenario = await runOne({
          id,
          config,
          users,
          boards,
          signal: controller.signal,
        });
        if (config.pgUrl && pgBefore !== null) {
          const pgAfter = await collectPgStatements({
            databaseUrl: config.pgUrl,
            psql: config.psql,
            limit: PG_SNAPSHOT_LIMIT,
            signal: controller.signal,
          });
          scenario.pg = diffPgStatements(pgBefore, pgAfter, 20);
          scenario.pg.commands = scenario.summary.actions;
          scenario.pg.queriesPerCommand =
            scenario.pg.available === true && scenario.summary.actions > 0
              ? Math.round(
                  (scenario.pg.totalCalls / scenario.summary.actions) * 1_000,
                ) / 1_000
              : null;
        }
        scenarios.push(scenario);
        if (scenario.status === "failed" && scenario.fatalAuth === true) {
          fatal = true;
          log("perf: fatal auth — stopping the suite");
        }
      }

      sampler.poll();
      sampler.flush();
      const pgActivity = pgSampler !== null ? await pgSampler.stop() : null;
      const redisAfter = await collectRedisInfo({
        redisUrl: config.redisUrl,
        redisCli: config.redisCli,
        signal: controller.signal,
      });
      const redis = diffRedisInfo(
        redisBefore,
        redisAfter,
        Date.now() - redisStartedAt,
      );
      const pgSuiteAfter = config.pgUrl
        ? await collectPgStatements({
            databaseUrl: config.pgUrl,
            psql: config.psql,
            limit: PG_SNAPSHOT_LIMIT,
            signal: controller.signal,
          })
        : null;
      const pg = config.pgUrl
        ? {
            ...diffPgStatements(pgSuiteBefore, pgSuiteAfter, 20),
            enabled: true,
            url: redactUrl(config.pgUrl),
          }
        : { enabled: false };
      if (pg.enabled === true) {
        pg.commands = scenarios.reduce(
          (sum, scenario) => sum + (scenario.summary.actions ?? 0),
          0,
        );
        pg.queriesPerCommand =
          pg.available === true && pg.commands > 0
            ? Math.round((pg.totalCalls / pg.commands) * 1_000) / 1_000
            : null;
      }
      let liveProfile = null;
      if (liveProfiler !== null) {
        try {
          liveProfile = await liveProfiler.stop();
        } catch (error) {
          instrumentationFailed = true;
          instrumentationError = sanitizeText(
            error instanceof Error ? error.message : error,
            config.tokens,
          );
        }
      }
      // Static `node --cpu-prof` writes only after the API exits, so the file
      // is legitimately older than this harness process. Freshness is checked
      // for the live inspector flow only.
      const cpuProfile =
        config.apiInspect !== undefined
          ? liveProfiler !== null && liveProfile !== null
            ? await collectCpuProfile(liveProfile.path, {
                freshSince: liveProfileStartedAt,
              })
            : {
                enabled: true,
                available: false,
                reason:
                  instrumentationError ?? "live CPU profile was not produced",
              }
          : await collectCpuProfile(config.cpuProfile);
      if (
        config.apiInspect !== undefined &&
        liveProfiler !== null &&
        cpuProfile.available !== true
      ) {
        instrumentationFailed = true;
        instrumentationError =
          cpuProfile.reason ?? "live CPU profile was not produced";
      }

      const report = buildReport({
        config,
        scenarios,
        git: gitInfo(),
        environment: environmentInfo(),
        pg,
        pgActivity,
        cpuProfile,
        redis,
        startedAt,
        endedAt: Date.now(),
        interrupted: interrupted || controller.signal.aborted,
        instrumentationFailed,
        instrumentationError,
      });
      const { jsonPath, markdownPath } = await writeReport(config, report);
      printSummary(report, jsonPath, markdownPath);
      if (interrupted || report.status === "interrupted") {
        process.exitCode = 130;
      } else if (fatal || report.status === "failed") {
        process.exitCode = 1;
      } else if (config.requireOk && report.status !== "ok") {
        process.exitCode = 1;
      } else {
        process.exitCode = 0;
      }
    } finally {
      liveProfiler?.close();
      sampler?.stop();
      if (pgSampler !== null) await pgSampler.stop();
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  } finally {
    clearInterval(keepAlive);
    if (mock !== null) await mock.close().catch(() => {});
  }
}

async function waitForHealth(config, signal) {
  const client = new HttpClient({
    baseUrl: config.baseUrl,
    token: "",
    metrics: new RunMetrics("bootstrap"),
    signal,
  });
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (signal.aborted)
      throw new PreflightError("interrupted during health check");
    try {
      const response = await client.health();
      if (response.ok) return;
      lastError = new Error(`GET /health -> ${response.status}`);
    } catch (error) {
      if (signal.aborted) {
        throw new PreflightError("interrupted during health check");
      }
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new PreflightError(
    `API is not reachable at ${redactedBaseUrl(config)}/health: ${sanitizeText(
      lastError instanceof Error ? lastError.message : lastError,
      config.tokens,
    )}`,
  );
}

async function resolveUsers(config, signal) {
  const metrics = new RunMetrics("bootstrap");
  const users = [];
  for (const token of config.tokens) {
    const client = new HttpClient({
      baseUrl: config.baseUrl,
      token,
      metrics,
      signal,
    });
    let me;
    try {
      me = await client.me();
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        throw new PreflightError(
          "token preflight failed with 401/403: use a valid board-domain PAT with the write preset",
        );
      }
      throw error;
    }
    if (me === null || typeof me.id !== "string") {
      throw new PreflightError("GET /auth/me returned no user id");
    }
    const user = validateTokenIdentity(
      {
        token,
        id: me.id,
        email: me.email ?? null,
        tokenIdentity: me.token ?? null,
      },
      users.length,
    );
    users.push(user);
  }
  if (users.length === 0) throw new PreflightError("no usable PAT");
  return users;
}

/** The real agent path needs one identity per agent unless explicitly shared. */
function assertTokenPool(config, users) {
  const required = requiredIdentities(config);
  if (required > users.length && config.allowSharedIdentity !== true) {
    if (config.mock) {
      log(
        `warning: ${required} mock agents share ${users.length} identity(ies)`,
      );
      return;
    }
    throw new PreflightError(
      `token pool has ${users.length} identity(ies) for ${required} agent(s) in S2/S3/S4; ` +
        "pass more token identities (env/token-file) or --shared-identity to model several agents per identity",
    );
  }
  if (required > users.length) {
    log(
      `warning: ${required} agents share ${users.length} identity(ies) (--shared-identity)`,
    );
  }
}

function isArchivedBoard(board) {
  return (
    board?.archived === true ||
    (board?.archivedAt !== null && board?.archivedAt !== undefined)
  );
}

async function resolveBoards(config, users, signal) {
  const clients = users.map(
    (user) =>
      new HttpClient({
        baseUrl: config.baseUrl,
        token: user.token,
        metrics: new RunMetrics("bootstrap"),
        signal,
      }),
  );

  if (config.explicitBoards.length > 0) {
    for (const [boardIndex, id] of config.explicitBoards.entries()) {
      let response;
      try {
        response = await clients[0].readBoard(id);
      } catch (error) {
        const label = `token 1, board ${boardIndex + 1} (${id})`;
        if (error?.status === 401 || error?.status === 403) {
          throw new PreflightError(
            `${label}: not accessible (${error.status})`,
          );
        }
        if (error?.status === 404) {
          throw new PreflightError(`${label}: does not exist`);
        }
        throw error;
      }
      if (isArchivedBoard(response.board)) {
        throw new PreflightError(
          `token 1, board ${boardIndex + 1} (${id}): board is archived`,
        );
      }
    }
  }

  const lists = [];
  for (const [index, client] of clients.entries()) {
    try {
      lists.push(await client.listBoards());
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        throw new PreflightError(
          `token ${index + 1}: GET /boards failed with ${error.status}`,
        );
      }
      throw error;
    }
  }

  const ids = selectBoards({
    users,
    lists,
    explicitBoards: config.explicitBoards,
    boardsCount: config.boardsCount,
  });
  if (config.recycle && config.recycleToken !== undefined) {
    const recycleClient = new HttpClient({
      baseUrl: config.baseUrl,
      token: config.recycleToken,
      metrics: new RunMetrics("bootstrap-recycle"),
      signal,
    });
    let me;
    let recycleLists;
    try {
      me = await recycleClient.me();
      recycleLists = await recycleClient.listBoards();
    } catch (error) {
      throw new PreflightError(
        `recycle token preflight failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    validateTokenIdentity(
      { tokenIdentity: me?.token ?? null },
      0,
      "recycle token",
    );
    validateBoardAccess({
      label: "recycle token",
      summaries: recycleLists,
      ids,
      roles: new Set(["ADMIN"]),
    });
  }
  if (config.explicitBoards.length === 0 && ids.length < config.boardsCount) {
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
    `\n▶ ${id} ${effective.title} · agents ${effective.agents ?? 0} · humans ${effective.humans ?? 0} · sse ${effective.sse ?? 0} · driver ${config.driver}`,
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
    const now = Date.now();
    result = {
      scenario: effective,
      startedAt: now,
      measurementEndedAt: now,
      endedAt: now,
      workStartedAt: now,
      workEndedAt: now,
      workDurationMs: 0,
      durationMs: 1,
      drainEndedAt: now,
      errors: [
        {
          message: sanitizeText(
            error instanceof Error ? error.message : error,
            config.tokens,
          ),
          fatal: error?.status === 401 || error?.status === 403,
        },
      ],
      fatalAuth: error?.status === 401 || error?.status === 403,
      interrupted: signal.aborted,
      recycled: 0,
      mcp: null,
    };
  }
  sampler.poll();
  const measuredEnd = result.measurementEndedAt ?? Date.now();
  const actualAgents = result.mcp?.processes ?? effective.agents ?? 0;
  const statusScenario = { ...effective, agents: actualAgents };
  const metricDuration = Math.max(
    1,
    result.workDurationMs ?? result.durationMs,
  );
  const snapshot = metrics.snapshot({
    durationMs: metricDuration,
    agents: actualAgents,
  });
  snapshot.timedOut = result.timedOut === true;
  const usesMcp =
    config.driver === "mcp" && ["S1", "S2", "S3", "S4"].includes(id);
  const { status, reason } = evaluateScenarioStatus({
    id,
    scenario: statusScenario,
    summary: snapshot,
    errors: result.errors ?? [],
    fatal: result.fatalAuth === true || failure !== null,
    interrupted: result.interrupted === true || interrupted,
    driver: usesMcp ? "mcp" : "http",
    workDurationMs: result.workDurationMs,
  });
  const resources = sampler.summarize(
    result.workStartedAt ?? result.startedAt,
    measuredEnd,
  );
  log(
    `${status === "ok" ? "✓" : status === "partial" ? "◐" : status === "interrupted" ? "■" : "✗"} ${id} [${status}]: ${snapshot.requests} req · ${snapshot.agents} agents · ${snapshot.cycles} cycles · ${snapshot.actionsPerSecond ?? "—"} actions/s · p95 ${snapshot.latency.p95 ?? "—"} ms · 400 ${snapshot.errors.badRequest400} · 409 ${snapshot.errors.conflict409} · 429 ${snapshot.errors.rateLimited429} · 5xx ${snapshot.errors.server5xx} · net ${snapshot.errors.network} · unexp ${((snapshot.errors.rates?.unexpected ?? 0) * 100).toFixed(2)}%`,
  );
  if (reason !== null) log(`  ${reason}`);
  return {
    id,
    title: effective.title,
    status,
    statusReason: reason,
    timedOut: result.timedOut === true,
    config: { ...effective, agents: actualAgents },
    summary: snapshot,
    api: resources,
    workWindow: {
      workStartedAt: result.workStartedAt ?? result.startedAt,
      plannedWorkStartedAt:
        result.plannedWorkStartedAt ?? result.workStartedAt ?? result.startedAt,
      actualWorkStartedAt:
        result.actualWorkStartedAt ?? result.workStartedAt ?? result.startedAt,
      workEndedAt: measuredEnd,
      workDurationMs:
        result.workDurationMs ?? Math.max(0, measuredEnd - result.startedAt),
    },
    mcp: result.mcp ?? null,
    recycle: result.recycle ?? null,
    errors: result.errors ?? [],
    fatalAuth: result.fatalAuth === true,
  };
}

async function writeReport(config, report) {
  const date = report.generatedAt.slice(0, 10);
  const time = report.generatedAt.slice(11, 19).replaceAll(":", "");
  const sha = String(report.git.commit ?? "unknown").slice(0, 8);
  const scenarioSlug =
    config.scenarioIds.length === 0 ? "none" : config.scenarioIds.join("-");
  const defaultPath = path.join(
    "scripts",
    "perf",
    "results",
    `${date}-${sha}`,
    `${config.mode}-${scenarioSlug}-${config.driver}-${time}.json`,
  );
  const jsonPath = path.resolve(config.output ?? defaultPath);
  const markdownPath = jsonPath.replace(/\.json$/i, "") + ".md";
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderMarkdown(report)}\n`, "utf8");
  return { jsonPath, markdownPath };
}

function printSummary(report, jsonPath, markdownPath) {
  console.log("");
  console.log(
    `commit ${report.git.commit} · ${report.git.branch} · status ${report.status}`,
  );
  for (const scenario of report.scenarios) {
    const s = scenario.summary;
    console.log(
      `${scenario.id.padEnd(3)} ${String(scenario.status).padEnd(11)} req=${s.requests} tools=${s.toolCalls} req/agent/min=${s.requestsPerAgentPerMinute ?? "—"} cycles=${s.cycles} p95=${s.latency.p95 ?? "—"}ms 400=${s.errors.badRequest400} 409=${s.errors.conflict409} 429=${s.errors.rateLimited429} 5xx=${s.errors.server5xx} net=${s.errors.network} unexp=${((s.errors.rates?.unexpected ?? 0) * 100).toFixed(2)}%`,
    );
  }
  console.log(`JSON: ${jsonPath}`);
  console.log(`MD:   ${markdownPath}`);
  if (report.pg?.enabled === true && report.pg.available === false) {
    console.log(`pg_stat_statements: ${report.pg.reason}`);
  }
}

void main().catch(async (error) => {
  const message = sanitizeText(
    error instanceof Error ? error.message : error,
    activeConfig?.tokens ?? [],
  );
  console.error(`perf: ${message}`);
  if (interrupted && activeConfig !== null && activeConfig.help !== true) {
    try {
      const report = buildReport({
        config: activeConfig,
        scenarios: [],
        git: gitInfo(),
        environment: environmentInfo(),
        pg: { enabled: false },
        pgActivity: null,
        cpuProfile: { enabled: false },
        redis: { enabled: false },
        startedAt,
        endedAt: Date.now(),
        interrupted: true,
        preflightError: message,
      });
      const { jsonPath, markdownPath } = await writeReport(
        activeConfig,
        report,
      );
      console.error(
        `perf: partial preflight report: ${jsonPath} · ${markdownPath}`,
      );
    } catch (reportError) {
      console.error(
        `perf: could not write the partial preflight report: ${sanitizeText(
          reportError instanceof Error ? reportError.message : reportError,
          activeConfig.tokens,
        )}`,
      );
    }
  }
  process.exitCode = interrupted
    ? 130
    : error instanceof PreflightError
      ? 2
      : 1;
});
