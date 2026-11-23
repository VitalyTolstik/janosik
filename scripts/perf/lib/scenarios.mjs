// TASK-200.1 — scenario runners S1–S6.
//
// The harness deliberately keeps the drivers simple: a scenario is a set of
// async workers bounded by a deadline. Heavy profiles are configuration, not
// separate code paths, so a smoke run exercises the same loop as a 500-agent
// baseline.

import { mulberry32, runAgentLoop, runHumanLoop } from "./agent.mjs";
import { HttpClient, sleep } from "./http.mjs";
import { scenarioConfig } from "./config.mjs";

function linkSignal(parent, child) {
  if (parent === undefined) return () => {};
  const abort = () => child.abort();
  if (parent.aborted) child.abort();
  else parent.addEventListener("abort", abort, { once: true });
  return () => parent.removeEventListener("abort", abort);
}

function clientsFor(config, users, metrics) {
  return users.map(
    (user) =>
      new HttpClient({
        baseUrl: config.baseUrl,
        token: user.token,
        metrics,
      }),
  );
}

function errorRecorder() {
  const errors = [];
  return {
    push(entry) {
      if (errors.length >= 10) return;
      errors.push({
        agent: entry.agentIndex ?? entry.workerIndex ?? null,
        boardId: entry.boardId ?? null,
        fatal: entry.fatal === true,
        message:
          entry.error instanceof Error
            ? entry.error.message
            : String(entry.error),
      });
    },
    list() {
      return errors;
    },
  };
}

function scenarioDuration(scenario) {
  if (scenario.id === "S6") return 0;
  if (scenario.id === "S5") {
    return (scenario.rampMs ?? 0) + (scenario.holdMs ?? 0);
  }
  return scenario.durationMs ?? 60_000;
}

export async function runScenario({
  id,
  config,
  users,
  boards,
  metrics,
  signal,
  log = () => {},
}) {
  const scenario = scenarioConfig(config, id);
  const clients = clientsFor(config, users, metrics);
  const errors = errorRecorder();
  const controller = new AbortController();
  const unlink = linkSignal(signal, controller);
  const startedAt = Date.now();
  const durationMs = scenarioDuration(scenario);
  const deadline = startedAt + durationMs;
  let timer = null;

  const onError = (entry) => {
    errors.push(entry);
    if (entry.fatal) controller.abort();
  };

  log(
    `${id} ${scenario.title}: agents=${scenario.agents ?? 0} humans=${scenario.humans ?? 0} sse=${scenario.sse ?? 0} duration=${id === "S6" ? "burst" : `${Math.round(durationMs / 1000)}s`}`,
  );

  try {
    if (id === "S6") {
      await runReadBurst({
        scenario,
        clients,
        boards,
        signal: controller.signal,
      });
    } else if (id === "S5") {
      await runSseRamp({
        scenario,
        clients,
        boards,
        metrics,
        signal: controller.signal,
        startedAt,
        log,
      });
    } else {
      timer = setTimeout(() => controller.abort(), durationMs);
      timer.unref?.();
      const tasks = [];
      const agents = Math.max(0, scenario.agents ?? 0);
      for (let index = 0; index < agents; index += 1) {
        const startDelayMs =
          id === "S4" && (scenario.rampMs ?? 0) > 0 && agents > 1
            ? Math.round((index / (agents - 1)) * scenario.rampMs)
            : 0;
        tasks.push(
          runAgentLoop({
            client: clients[index % clients.length],
            userId: users[index % users.length].id,
            boardId: boards[index % boards.length],
            agentIndex: index,
            mode: id === "S1" ? "idle" : "work",
            config: scenario,
            deadline,
            signal: controller.signal,
            metrics,
            random: mulberry32(config.seed + index + id.charCodeAt(1) * 1_000),
            startDelayMs,
            onError,
          }),
        );
      }
      const humans = Math.max(0, scenario.humans ?? 0);
      for (let index = 0; index < humans; index += 1) {
        tasks.push(
          runHumanLoop({
            client: clients[(agents + index) % clients.length],
            boardId: boards[index % boards.length],
            workerIndex: index,
            config: scenario,
            deadline,
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
            deadline,
            clients,
            boards,
            metrics,
            signal: controller.signal,
            log,
          }),
        );
      }
      await Promise.allSettled(tasks);
    }
  } finally {
    if (timer !== null) clearTimeout(timer);
    controller.abort();
    unlink();
  }

  const endedAt = Date.now();
  return {
    scenario,
    durationMs: endedAt - startedAt,
    startedAt,
    endedAt,
    errors: errors.list(),
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
  const handles = [];
  const startedAt = Date.now();
  const total = Math.max(0, count);
  for (let index = 0; index < total; index += 1) {
    if (signal.aborted) break;
    const target =
      startedAt +
      (total <= 1 || rampMs <= 0 ? 0 : (index / (total - 1)) * rampMs);
    const wait = target - Date.now();
    if (wait > 0) await sleep(wait, signal);
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
  log(`  SSE ramp done: ${handles.length}/${total} live`);
  const wait = deadline - Date.now();
  if (wait > 0) await sleep(wait, signal);
  await Promise.allSettled(handles.map((handle) => handle.close()));
}

async function runSseRamp({
  scenario,
  clients,
  boards,
  metrics,
  signal,
  startedAt,
  log,
}) {
  const rampMs = scenario.rampMs ?? 0;
  const holdMs = scenario.holdMs ?? 0;
  await holdSseStreams({
    count: scenario.sse ?? 0,
    rampMs,
    deadline: startedAt + rampMs + holdMs,
    clients,
    boards,
    metrics,
    signal,
    log,
  });
}
