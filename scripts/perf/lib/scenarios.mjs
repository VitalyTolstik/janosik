// TASK-200.1 — scenario runners S1–S6.
//
// The harness deliberately keeps the drivers simple: a scenario is a set of
// async workers bounded by a deadline. Heavy profiles are configuration, not
// separate code paths, so a smoke run exercises the same loop as a 500-agent
// baseline. Deadlines are measured independently of worker drain time, and
// per-scenario status is derived from what was actually measured.

import {
  isAuthError,
  mulberry32,
  recycleDoneCards,
  runAgentLoop,
  runHumanLoop,
  runMixedAgentLoop,
} from "./agent.mjs";
import { HttpClient, sleep } from "./http.mjs";
import { RunMetrics } from "./metrics.mjs";
import { validateScenarioConfig } from "./config.mjs";
import { sanitizeText } from "./redact.mjs";
import { formatDuration } from "./report.mjs";

const S5_OVERALL_GRACE_MS = 30_000;
import {
  createMcpWorker,
  runMcpAgentLoop,
  summarizeMcpWorkers,
} from "./mcp.mjs";

function clientsFor(config, users, metrics, signal) {
  return users.map(
    (user) =>
      new HttpClient({
        baseUrl: config.baseUrl,
        token: user.token,
        metrics,
        signal,
      }),
  );
}

function errorRecorder(config) {
  const errors = [];
  return {
    push(entry) {
      if (errors.length >= 10) return;
      errors.push({
        agent: entry.agentIndex ?? entry.workerIndex ?? null,
        boardId: entry.boardId ?? null,
        fatal: entry.fatal === true,
        orphan: entry.orphan === true,
        cleanupAborted: entry.cleanupAborted === true,
        cleanupFailed: entry.cleanupFailed === true,
        status: Number.isInteger(entry.error?.status)
          ? entry.error.status
          : null,
        message: sanitizeText(
          entry.error instanceof Error
            ? entry.error.message
            : String(entry.error),
          config.tokens,
        ),
      });
    },
    list() {
      return errors;
    },
  };
}

function joinSignal(parent, onAbort) {
  if (parent === undefined) return () => {};
  if (parent.aborted) {
    onAbort();
    return () => {};
  }
  parent.addEventListener("abort", onAbort, { once: true });
  return () => parent.removeEventListener("abort", onAbort);
}

async function delayUntil(target, signal) {
  const wait = target - Date.now();
  if (wait > 0) await sleep(wait, signal);
}

function startAtFor({ id, scenario, index, agents, startedAt }) {
  if (id !== "S4" || (scenario.rampMs ?? 0) <= 0) return startedAt;
  if (scenario.burst === true) return startedAt + scenario.rampMs;
  if (agents <= 1) return startedAt;
  return startedAt + Math.round((index / (agents - 1)) * scenario.rampMs);
}

function createRecycler({ config, signal, metrics, boards }) {
  if (config.recycle !== true || config.recycleToken === undefined) {
    return { recycle: null, metrics: null, state: null };
  }
  const recycleMetrics = new RunMetrics("recycle");
  const perBoard = new Map();
  for (const boardId of boards) {
    perBoard.set(boardId, {
      client: new HttpClient({
        baseUrl: config.baseUrl,
        token: config.recycleToken,
        metrics: recycleMetrics,
        signal,
      }),
      lastAttempt: 0,
      inFlight: null,
    });
  }
  const state = { orphans: 0 };
  const recycle = async (boardId) => {
    const entry = perBoard.get(boardId);
    if (entry === undefined) return false;
    if (entry.inFlight !== null) return entry.inFlight;
    if (Date.now() - entry.lastAttempt < 500) return false;
    entry.lastAttempt = Date.now();
    entry.inFlight = (async () => {
      try {
        const result = await recycleDoneCards({
          client: entry.client,
          boardId,
        });
        if (result.moved > 0) {
          recycleMetrics.recordAction(result.moved, "write");
          metrics.recordRecycled(result.moved);
        }
        if (result.orphans > 0) {
          state.orphans += result.orphans;
          recycleMetrics.recordOrphan(result.orphans);
          metrics.recordOrphan(result.orphans);
        }
        return result.moved > 0;
      } catch {
        return false;
      } finally {
        entry.inFlight = null;
      }
    })();
    return entry.inFlight;
  };
  return { recycle, metrics: recycleMetrics, state };
}

export async function runScenario({
  id,
  config,
  users,
  boards,
  metrics,
  signal,
  log = () => {},
  sseOverallGraceMs = S5_OVERALL_GRACE_MS,
  sseCloseGraceMs: s3CloseGraceMs = 250,
}) {
  const scenario = validateScenarioConfig(config, id);
  const errors = errorRecorder(config);
  const controller = new AbortController();
  const startedAt = Date.now();
  let measurementEndedAt = null;
  let fatal = false;
  let interrupted = signal?.aborted === true;
  let timedOut = false;
  let timer = null;
  let mcpWorkers = [];

  const captureMeasurement = () => {
    if (measurementEndedAt === null) measurementEndedAt = Date.now();
  };
  const unlink = joinSignal(signal, () => {
    interrupted = true;
    captureMeasurement();
    controller.abort();
  });
  const onError = (entry) => {
    errors.push(entry);
    if (entry.orphan === true) metrics.recordOrphan();
    if (entry.cleanupAborted === true) metrics.recordCleanupAborted();
    if (entry.cleanupFailed === true) metrics.recordCleanupFailed();
    if (entry.fatal === true) {
      fatal = true;
      captureMeasurement();
      controller.abort();
    }
  };

  const clients = clientsFor(config, users, metrics, controller.signal);
  const cleanupMetrics = new RunMetrics(`cleanup-${id}`);
  const cleanupClients = users.map(
    (user) =>
      new HttpClient({
        baseUrl: config.baseUrl,
        token: user.token,
        metrics: cleanupMetrics,
        timeoutMs: 5_000,
      }),
  );
  const recycler = createRecycler({
    config,
    signal: controller.signal,
    metrics,
    boards,
  });
  const onNoWork =
    recycler.recycle === null
      ? undefined
      : async (_state, boardId) => recycler.recycle(boardId);

  const agents = Math.max(0, scenario.agents ?? 0);
  const humans = Math.max(0, scenario.humans ?? 0);
  const mcpProcesses =
    config.driver === "mcp"
      ? config.mode === "smoke"
        ? Math.min(config.mcpProcesses ?? agents, 2)
        : (config.mcpProcesses ?? agents)
      : 0;

  const workStartedAt =
    id === "S4" ? startedAt + (scenario.rampMs ?? 0) : startedAt;
  let actualWorkStartedAt = workStartedAt;
  const workerFirstRequests = [];
  const onFirstRequest = (ts) => workerFirstRequests.push(ts);

  const durationLabel =
    id === "S6"
      ? "burst"
      : id === "S5"
        ? `${formatDuration((scenario.rampMs ?? 0) + (scenario.holdMs ?? 0))} ramp+hold`
        : formatDuration(scenario.durationMs ?? 0);
  log(
    `${id} ${scenario.title}: agents=${agents} humans=${humans} sse=${scenario.sse ?? 0} duration=${durationLabel}${id === "S4" ? ` (after ${formatDuration(scenario.rampMs ?? 0)} ramp)` : ""}`,
  );

  try {
    if (id === "S5") {
      timer = setTimeout(
        () => {
          timedOut = true;
          captureMeasurement();
          controller.abort();
        },
        Math.max(
          1,
          startedAt +
            (scenario.rampMs ?? 0) +
            (scenario.holdMs ?? 0) +
            sseOverallGraceMs -
            Date.now(),
        ),
      );
      const result = await runSseRamp({
        scenario,
        clients,
        boards,
        metrics,
        signal: controller.signal,
        log,
      });
      captureMeasurement();
      return finish({
        scenario,
        startedAt,
        workStartedAt,
        measurementEndedAt:
          interrupted || fatal || timedOut
            ? measurementEndedAt
            : (result.holdEndedAt ?? measurementEndedAt),
        fatal,
        interrupted,
        errors,
        metrics,
        recycler,
        mcp: null,
        timedOut,
      });
    }

    if (id === "S6") {
      await runReadBurst({
        scenario,
        clients,
        boards,
        signal: controller.signal,
      });
      captureMeasurement();
      return finish({
        scenario,
        startedAt,
        workStartedAt,
        measurementEndedAt,
        fatal,
        interrupted,
        errors,
        metrics,
        recycler,
        mcp: null,
        timedOut,
      });
    }

    const workEnd =
      id === "S4"
        ? startedAt + (scenario.rampMs ?? 0) + scenario.durationMs
        : startedAt + scenario.durationMs;
    // S3's SSE hold ends at workEnd. Give the hold a moment to record the
    // still-open stream count and close cleanly before the scenario timer
    // aborts every client at the same instant.
    const sseCloseGraceMs =
      id === "S3" && (scenario.sse ?? 0) > 0 ? s3CloseGraceMs : 0;
    timer = setTimeout(
      () => {
        timedOut = true;
        captureMeasurement();
        controller.abort();
      },
      Math.max(1, workEnd + sseCloseGraceMs - Date.now()),
    );

    const tasks = [];
    if (config.driver === "mcp" && mcpProcesses > 0) {
      const tokens = users.map((user) => user.token);
      const settled = await Promise.allSettled(
        Array.from({ length: mcpProcesses }, (_, index) =>
          createMcpWorker({
            baseUrl: config.baseUrl,
            token: tokens[index % tokens.length],
            boardId: boards[index % boards.length],
            metrics,
            log,
            signal: controller.signal,
          }),
        ),
      );
      mcpWorkers = settled
        .filter((entry) => entry.status === "fulfilled")
        .map((entry) => entry.value);
      const failed = settled.find((entry) => entry.status === "rejected");
      if (failed !== undefined) onError({ error: failed.reason, fatal: true });
      for (let index = 0; index < mcpWorkers.length; index += 1) {
        tasks.push(
          runMcpAgentLoop({
            worker: mcpWorkers[index],
            boardId: boards[index % boards.length],
            agentIndex: index,
            mode: id === "S1" ? "idle" : "work",
            config: scenario,
            deadline: workEnd,
            signal: controller.signal,
            metrics,
            random: mulberry32(config.seed + index + id.charCodeAt(1) * 1_000),
            startAt: startAtFor({
              id,
              scenario,
              index,
              agents: mcpWorkers.length,
              startedAt,
            }),
            onFirstRequest,
            onError,
            onNoWork,
          }),
        );
      }
    } else {
      for (let index = 0; index < agents; index += 1) {
        tasks.push(
          (id === "S3" ? runMixedAgentLoop : runAgentLoop)({
            client: clients[index % clients.length],
            userId: users[index % users.length].id,
            boardId: boards[index % boards.length],
            agentIndex: index,
            mode: id === "S1" ? "idle" : "work",
            config: scenario,
            deadline: workEnd,
            signal: controller.signal,
            metrics,
            cleanupClient: cleanupClients[index % cleanupClients.length],
            random: mulberry32(config.seed + index + id.charCodeAt(1) * 1_000),
            startAt: startAtFor({ id, scenario, index, agents, startedAt }),
            onFirstRequest,
            onError,
            onNoWork,
          }),
        );
      }
    }

    for (let index = 0; index < humans; index += 1) {
      tasks.push(
        runHumanLoop({
          client: clients[(agents + index) % clients.length],
          boardId: boards[index % boards.length],
          workerIndex: index,
          config: scenario,
          deadline: workEnd,
          signal: controller.signal,
          random: mulberry32(config.seed + 50_000 + index),
          onError,
        }),
      );
    }
    if (id === "S3" && (scenario.sse ?? 0) > 0) {
      tasks.push(
        holdSseStreams({
          count: scenario.sse,
          rampMs: 0,
          deadline: workEnd,
          clients,
          boards,
          metrics,
          signal: controller.signal,
          log,
        }),
      );
    }
    await Promise.allSettled(tasks);
    // First requests arrive while the tasks run; read them only after every
    // worker has settled so a staggered (no-burst) S4 reports the earliest
    // observed request, not the planned ramp end.
    let observedWorkStartedAt = null;
    if (id === "S4") {
      observedWorkStartedAt =
        workerFirstRequests.length > 0
          ? Math.min(...workerFirstRequests)
          : null;
      actualWorkStartedAt = observedWorkStartedAt ?? workStartedAt;
    }
    captureMeasurement();
    const mcp = mcpWorkers.length > 0 ? summarizeMcpWorkers(mcpWorkers) : null;
    return finish({
      scenario,
      startedAt,
      workStartedAt: actualWorkStartedAt,
      plannedWorkStartedAt: workStartedAt,
      actualWorkStartedAt: observedWorkStartedAt,
      measurementEndedAt,
      fatal,
      interrupted,
      errors,
      metrics,
      recycler,
      mcp,
      timedOut,
    });
  } catch (error) {
    onError({ error, fatal: isAuthError(error) });
    captureMeasurement();
    return {
      scenario,
      startedAt,
      measurementEndedAt,
      endedAt: Date.now(),
      workStartedAt,
      workEndedAt: measurementEndedAt,
      workDurationMs: Math.max(0, measurementEndedAt - workStartedAt),
      durationMs: Math.max(0, measurementEndedAt - startedAt),
      drainEndedAt: Date.now(),
      errors: errors.list(),
      fatalAuth: fatal,
      interrupted,
      timedOut,
      recycled: metrics.recycled,
      recycle: recycler.metrics
        ? {
            requests: recycler.metrics.requests,
            writes: recycler.metrics.actions,
            orphans: recycler.state?.orphans ?? 0,
            errors: recycler.metrics.snapshot({ durationMs: 1 }).errors,
          }
        : null,
      mcp: null,
    };
  } finally {
    if (timer !== null) clearTimeout(timer);
    controller.abort();
    unlink();
    await Promise.allSettled(mcpWorkers.map((worker) => worker.close()));
  }
}

function finish({
  scenario,
  startedAt,
  workStartedAt,
  plannedWorkStartedAt = workStartedAt,
  actualWorkStartedAt = null,
  measurementEndedAt,
  fatal,
  interrupted,
  errors,
  metrics,
  recycler,
  mcp,
  timedOut = false,
}) {
  const endedAt = Date.now();
  const measuredEnd = measurementEndedAt ?? endedAt;
  return {
    scenario,
    startedAt,
    measurementEndedAt: measuredEnd,
    endedAt,
    workStartedAt,
    plannedWorkStartedAt,
    actualWorkStartedAt,
    workEndedAt: measuredEnd,
    workDurationMs: Math.max(0, measuredEnd - workStartedAt),
    durationMs: Math.max(0, measuredEnd - startedAt),
    drainEndedAt: endedAt,
    errors: errors.list(),
    fatalAuth: fatal,
    interrupted,
    // For S1/S2/S4/S6 the timer is the planned stop, not a truncation. Only
    // the S5 overall timer and the S3 SSE-hold grace indicate a cut run.
    timedOut:
      timedOut === true &&
      (scenario.id === "S5" ||
        (scenario.id === "S3" && (scenario.sse ?? 0) > 0)),
    recycled: metrics.recycled,
    recycle: recycler.metrics
      ? {
          requests: recycler.metrics.requests,
          writes: recycler.metrics.actions,
          orphans: recycler.state?.orphans ?? 0,
          errors: recycler.metrics.snapshot({ durationMs: 1 }).errors,
        }
      : null,
    mcp,
  };
}

async function runReadBurst({ scenario, clients, boards, signal }) {
  const concurrency = Math.max(1, scenario.concurrency ?? 1);
  for (let round = 0; round < Math.max(1, scenario.repeats ?? 1); round += 1) {
    if (signal.aborted) return;
    const tasks = [];
    for (let index = 0; index < concurrency; index += 1) {
      tasks.push(
        clients[index % clients.length]
          .readBoard(boards[index % boards.length])
          .catch(() => undefined),
      );
    }
    await Promise.all(tasks);
  }
}

async function openSseRamp({
  count,
  rampMs,
  clients,
  boards,
  metrics,
  signal,
  log,
}) {
  const handles = [];
  const rampStartedAt = Date.now();
  const total = Math.max(0, count);
  for (let index = 0; index < total; index += 1) {
    if (signal.aborted) break;
    const target =
      rampStartedAt +
      (total <= 1 || rampMs <= 0 ? 0 : (index / (total - 1)) * rampMs);
    await delayUntil(target, signal);
    try {
      const handle = await clients[index % clients.length].openSse({
        boardId: boards[index % boards.length],
        signal,
      });
      handles.push(handle);
    } catch {
      // The client counted the failed open; a refused stream (e.g. 503 at the
      // admission ceiling) is data, not a reason to abort the ramp.
    }
    if (index > 0 && index % 500 === 0) {
      log(`  SSE ${index}/${total} (${metrics.sse.current} live)`);
    }
  }
  const rampEndedAt = Date.now();
  metrics.sse.rampObservedMs = rampEndedAt - rampStartedAt;
  log(`  SSE ramp done: ${handles.length}/${total} live`);
  return { handles, rampStartedAt, rampEndedAt };
}

async function closeSseHandles(handles, metrics, rampEndedAt) {
  const closedAt = Date.now();
  await Promise.allSettled(handles.map((handle) => handle.close()));
  metrics.sse.holdObservedMs = Math.max(0, closedAt - rampEndedAt);
  return closedAt;
}

async function holdSseStreams({
  count,
  rampMs,
  deadline,
  clients,
  boards,
  metrics,
  signal,
  log,
}) {
  const { handles, rampEndedAt } = await openSseRamp({
    count,
    rampMs,
    clients,
    boards,
    metrics,
    signal,
    log,
  });
  metrics.recordSseHoldStart();
  try {
    await delayUntil(deadline, signal);
  } catch (error) {
    // S3's hold deadline coincides with the scenario timer. An abort at that
    // boundary is expected, but the live count at the end of the hold still
    // has to be measured before the streams close.
    if (!signal.aborted) throw error;
  } finally {
    metrics.recordSseHoldEnd();
  }
  return closeSseHandles(handles, metrics, rampEndedAt);
}

async function runSseRamp({ scenario, clients, boards, metrics, signal, log }) {
  const { handles, rampEndedAt } = await openSseRamp({
    count: scenario.sse ?? 0,
    rampMs: scenario.rampMs ?? 0,
    clients,
    boards,
    metrics,
    signal,
    log,
  });
  if (handles.length === 0) {
    return { rampEndedAt, holdEndedAt: Date.now(), opened: 0 };
  }
  metrics.recordSseHoldStart();
  // The hold starts when the ramp *actually* finishes, not at the planned
  // ramp boundary: a slow admission path must not steal hold time.
  const holdDeadline = rampEndedAt + (scenario.holdMs ?? 0);
  log(
    `  SSE ramp observed ${formatDuration(metrics.sse.rampObservedMs)}; holding ${formatDuration(scenario.holdMs ?? 0)} from now`,
  );
  try {
    await delayUntil(holdDeadline, signal);
  } catch (error) {
    // The overall deadline can cut the hold. Record what was still live and
    // let the caller mark the scenario partial with an explicit reason.
    if (!signal.aborted) throw error;
  } finally {
    metrics.recordSseHoldEnd();
  }
  const holdEndedAt = await closeSseHandles(handles, metrics, rampEndedAt);
  return { rampEndedAt, holdEndedAt, opened: handles.length };
}
