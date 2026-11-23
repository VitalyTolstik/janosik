// TASK-200.1 — agent-scale harness configuration.
//
// Pure helpers: no filesystem, network or clock access, so the CLI surface and
// every derived default can be unit-tested with `node --test`.

import { parseArgs } from "node:util";

export const TASK = "TASK-200.1";
export const DEFAULT_BASE_URL = "http://localhost:3000/api/v1";
export const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

/**
 * Scenario defaults from `docs/PERF-AGENT-SCALE.md` §7.1. These are the
 * *documented* profiles; the CLI intentionally requires `--scenario` so a
 * bare command can never start a 1,000-agent run by accident.
 */
export const SCENARIO_DEFS = {
  S1: {
    id: "S1",
    title: "Idle swarm",
    defaults: {
      agents: 100,
      cadenceMs: 30_000,
      durationMs: 60_000,
      idleEndpoint: "board",
    },
  },
  S2: {
    id: "S2",
    title: "Claim → comment → move",
    defaults: { agents: 100, cadenceMs: 10_000, durationMs: 120_000 },
  },
  S3: {
    id: "S3",
    title: "Mixed humans + SSE",
    defaults: {
      agents: 500,
      humans: 50,
      sse: 100,
      cadenceMs: 10_000,
      durationMs: 120_000,
    },
  },
  S4: {
    id: "S4",
    title: "Burst start",
    defaults: {
      agents: 1_000,
      cadenceMs: 10_000,
      durationMs: 30_000,
      rampMs: 30_000,
      burst: true,
    },
  },
  S5: {
    id: "S5",
    title: "SSE ramp",
    defaults: { sse: 3_000, rampMs: 300_000, holdMs: 600_000 },
  },
  S6: {
    id: "S6",
    title: "Read burst",
    defaults: { concurrency: 500, repeats: 1 },
  },
};

export const ALL_SCENARIOS = Object.keys(SCENARIO_DEFS);
export const SMOKE_SCENARIOS = ["S1", "S2", "S3", "S6"];

/** Tiny mock-friendly profile used by `npm run perf:smoke`. */
export const SMOKE_DEFAULTS = {
  S1: { agents: 2, cadenceMs: 250, durationMs: 1_500 },
  S2: { agents: 2, cadenceMs: 200, durationMs: 4_000 },
  S3: {
    agents: 2,
    humans: 2,
    sse: 2,
    cadenceMs: 250,
    durationMs: 3_000,
  },
  S4: { agents: 3, cadenceMs: 250, durationMs: 2_000, rampMs: 1_000 },
  S5: { sse: 5, rampMs: 1_000, holdMs: 1_000 },
  S6: { concurrency: 4, repeats: 1 },
};

const SCENARIO_LIST = /^[A-Za-z0-9]+$/;

export const CLI_OPTIONS = {
  scenario: { type: "string", multiple: true, short: "s" },
  "base-url": { type: "string" },
  token: { type: "string", multiple: true },
  board: { type: "string", multiple: true },
  boards: { type: "string" },
  agents: { type: "string" },
  humans: { type: "string" },
  sse: { type: "string" },
  cadence: { type: "string" },
  duration: { type: "string" },
  ramp: { type: "string" },
  hold: { type: "string" },
  concurrency: { type: "string" },
  repeats: { type: "string" },
  "lease-ms": { type: "string" },
  jitter: { type: "string" },
  seed: { type: "string" },
  "idle-endpoint": { type: "string" },
  output: { type: "string" },
  label: { type: "string" },
  "api-pid": { type: "string" },
  "api-probe": { type: "string" },
  "pg-url": { type: "string" },
  psql: { type: "string" },
  mock: { type: "boolean" },
  "mock-port": { type: "string" },
  "mock-boards": { type: "string" },
  "mock-cards": { type: "string" },
  help: { type: "boolean", short: "h" },
};

/** Split a repeated/comma-separated CLI value into trimmed strings. */
export function splitList(value) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function takeList(value) {
  return splitList(value);
}

function integer(name, raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `--${name} must be an integer between ${min} and ${max} (got ${raw})`,
    );
  }
  return value;
}

function fraction(name, raw) {
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`--${name} must be a number between 0 and 1 (got ${raw})`);
  }
  return value;
}

/**
 * Parse a human duration. Bare numbers are seconds; explicit suffixes are
 * `ms`, `s`, `m` and `h`. Examples: `10s`, `500ms`, `2m`, `90`.
 */
export function parseDurationMs(name, raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(String(raw).trim());
  if (!match) {
    throw new Error(
      `--${name} must look like 500ms, 10s, 2m or 1h (got ${raw})`,
    );
  }
  const amount = Number(match[1]);
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[
    (match[2] ?? "s").toLowerCase()
  ];
  const value = Math.round(amount * factor);
  if (!Number.isFinite(value) || value < 0 || value > MAX_DURATION_MS) {
    throw new Error(`--${name} is outside 0…${MAX_DURATION_MS}ms (got ${raw})`);
  }
  return value;
}

/** Parse `--scenario` values, expanding `all` and `smoke`. */
export function parseScenarioList(raw) {
  const requested = takeList(raw);
  if (requested.length === 0) return { ids: [], mode: "real" };
  const mode = requested.some((id) => id.toLowerCase() === "smoke")
    ? "smoke"
    : "real";
  const ids = [];
  for (const item of requested) {
    const upper = item.toUpperCase();
    if (upper === "ALL") {
      ids.push(...ALL_SCENARIOS);
      continue;
    }
    if (upper === "SMOKE") {
      ids.push(...SMOKE_SCENARIOS);
      continue;
    }
    if (!SCENARIO_LIST.test(item) || SCENARIO_DEFS[upper] === undefined) {
      throw new Error(
        `unknown scenario ${item}; use ${ALL_SCENARIOS.join(", ")}, all or smoke`,
      );
    }
    ids.push(upper);
  }
  return { ids: [...new Set(ids)], mode: ids.length === 0 ? "real" : mode };
}

/**
 * Resolve CLI values + environment into a validated configuration.
 *
 * Tokens are kept internally for the HTTP clients; `publicConfig()` removes
 * them before anything reaches the report.
 */
export function resolveConfig(cliValues = {}, env = {}) {
  const scenarios = parseScenarioList(cliValues.scenario);
  const smoke = scenarios.mode === "smoke" || cliValues.mock === true;
  const ids =
    scenarios.ids.length > 0
      ? scenarios.ids
      : cliValues.help
        ? []
        : smoke
          ? SMOKE_SCENARIOS
          : ["smoke"];
  const mode = smoke ? "smoke" : "real";

  if (cliValues.help || (scenarios.ids.length === 0 && !smoke)) {
    return { help: true, mode, scenarioIds: ids };
  }

  const overrides = {};
  const int = (key, value, options) => {
    const parsed = integer(key, value, options);
    if (parsed !== undefined) overrides[key] = parsed;
  };
  int("agents", cliValues.agents, { min: 0, max: 100_000 });
  int("humans", cliValues.humans, { min: 0, max: 100_000 });
  int("sse", cliValues.sse, { min: 0, max: 100_000 });
  int("concurrency", cliValues.concurrency, { min: 1, max: 100_000 });
  int("repeats", cliValues.repeats, { min: 1, max: 1_000 });
  const leaseMs = integer("lease-ms", cliValues["lease-ms"], {
    min: 1_000,
    max: 86_400_000,
  });
  if (leaseMs !== undefined) overrides.leaseMs = leaseMs;
  const seed = integer("seed", cliValues.seed, {
    min: 0,
    max: 2 ** 31 - 1,
  });
  if (seed !== undefined) overrides.seed = seed;
  int("mockPort", cliValues["mock-port"], { min: 0, max: 65_535 });
  int("mockBoards", cliValues["mock-boards"], { min: 1, max: 1_000 });
  int("mockCards", cliValues["mock-cards"], { min: 1, max: 100_000 });

  for (const [key, source] of [
    ["cadenceMs", "cadence"],
    ["durationMs", "duration"],
    ["rampMs", "ramp"],
    ["holdMs", "hold"],
  ]) {
    const parsed = parseDurationMs(source, cliValues[source]);
    if (parsed !== undefined) overrides[key] = parsed;
  }

  const jitter = fraction("jitter", cliValues.jitter);
  if (jitter !== undefined) overrides.jitter = jitter;

  if (cliValues["idle-endpoint"] !== undefined) {
    if (!["board", "ready"].includes(cliValues["idle-endpoint"])) {
      throw new Error("--idle-endpoint must be board or ready");
    }
    overrides.idleEndpoint = cliValues["idle-endpoint"];
  }

  const tokens = [
    ...takeList(cliValues.token),
    ...takeList(env.JANOSIK_PERF_TOKEN),
    ...takeList(env.PERF_TOKEN),
  ];
  if (tokens.length === 0 && cliValues.mock) {
    tokens.push("perf-smoke-token-1", "perf-smoke-token-2");
  }

  const explicitBoards = [
    ...takeList(cliValues.board),
    ...takeList(env.JANOSIK_PERF_BOARDS),
  ];
  const boardsCount =
    integer("boards", cliValues.boards, { min: 1, max: 10_000 }) ?? 1;

  if (!cliValues.mock && tokens.length === 0) {
    throw new Error(
      "no PAT: pass --token jnk_… or set JANOSIK_PERF_TOKEN (comma-separated for a token pool)",
    );
  }

  const baseUrl = String(cliValues["base-url"] ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error("--base-url must start with http:// or https://");
  }

  const apiPid = integer("api-pid", cliValues["api-pid"], { min: 1 });

  return {
    help: false,
    task: TASK,
    mode,
    scenarioIds: ids,
    baseUrl,
    tokens,
    explicitBoards,
    boardsCount,
    overrides,
    jitter: overrides.jitter ?? 0.2,
    seed: overrides.seed ?? 200_001,
    label: cliValues.label ?? `${mode === "smoke" ? "smoke" : "baseline"}`,
    output: cliValues.output,
    apiPid,
    apiProbe: cliValues["api-probe"],
    pgUrl: cliValues["pg-url"] ?? env.JANOSIK_PERF_PG_URL,
    psql: cliValues.psql ?? "psql",
    mock: cliValues.mock === true,
    mockPort: overrides.mockPort ?? 0,
    mockBoards: overrides.mockBoards ?? 1,
    mockCards: overrides.mockCards ?? 120,
  };
}

/** Effective per-scenario values: documented defaults, then CLI overrides. */
export function scenarioConfig(config, id) {
  const def = SCENARIO_DEFS[id];
  if (def === undefined) throw new Error(`unknown scenario ${id}`);
  const base = {
    jitter: config.jitter,
    leaseMs: 300_000,
    idleEndpoint: "board",
    ...def.defaults,
  };
  if (config.mode === "smoke" && SMOKE_DEFAULTS[id] !== undefined) {
    Object.assign(base, SMOKE_DEFAULTS[id]);
  }
  for (const [key, value] of Object.entries(config.overrides)) {
    if (value !== undefined) base[key] = value;
  }
  return { ...base, id, title: def.title };
}

/** The subset of config that is safe to write into a report. */
export function publicConfig(config) {
  return {
    task: config.task,
    mode: config.mode,
    scenarioIds: config.scenarioIds,
    baseUrl: config.baseUrl,
    tokenCount: config.tokens.length,
    explicitBoards: config.explicitBoards,
    boardsCount: config.boardsCount,
    jitter: config.jitter,
    seed: config.seed,
    label: config.label,
    apiPid: config.apiPid ?? null,
    apiProbe: config.apiProbe ?? null,
    pg: config.pgUrl ? { enabled: true } : { enabled: false },
    mock: config.mock
      ? {
          boards: config.mockBoards,
          cards: config.mockCards,
        }
      : null,
  };
}

/** Usage text shared by the CLI and `--help`. */
export function usage() {
  return [
    "Janosik agent-scale perf harness (TASK-200.1)",
    "",
    "Usage:",
    "  node scripts/perf/agent-scale.mjs --scenario S2 --token jnk_… [options]",
    "  npm run perf:smoke",
    "",
    "Scenarios (docs/PERF-AGENT-SCALE.md §7.1):",
    ...ALL_SCENARIOS.map((id) => `  ${id}  ${SCENARIO_DEFS[id].title}`),
    "  all     S1–S6 (heavy; dedicated host only)",
    "  smoke   S1, S2, S3, S6 against an in-process mock",
    "",
    "Common options:",
    "  -s, --scenario <id[,id]>  scenario list (required unless --mock/smoke)",
    "      --base-url <url>      default http://localhost:3000/api/v1",
    "      --token <pat>         PAT; repeat or comma-separate for a pool",
    "      --board <id>          explicit board id; repeat or comma-separate",
    "      --boards <n>          pick the first N accessible boards (default 1)",
    "      --agents <n>          agent workers (scenario default)",
    "      --humans <n>          human read workers for S3",
    "      --sse <n>             SSE streams for S3/S5",
    "      --cadence <dur>       per-agent delay, e.g. 10s (default per scenario)",
    "      --duration <dur>      scenario wall clock, e.g. 2m",
    "      --ramp <dur>          S4 start ramp / S5 connection ramp",
    "      --hold <dur>          S5 hold after the ramp",
    "      --concurrency <n>     S6 in-flight reads (default 500)",
    "      --repeats <n>         S6 rounds (default 1)",
    "      --jitter <0..1>       cadence jitter fraction (default 0.2)",
    "      --lease-ms <ms>       CLAIM_CARD lease (default 300000)",
    "      --idle-endpoint <e>   board | ready (default board; ready is 200.2)",
    "      --output <file.json>  JSON path; Markdown is written beside it",
    "      --label <text>        report label",
    "",
    "Instrumentation (all optional):",
    "      --api-pid <pid>       sample /proc/<pid>/status VmRSS",
    "      --api-probe <jsonl>   sample file written by api-preload.mjs",
    "      --pg-url <url>        read top pg_stat_statements queries via psql",
    "      --psql <path>         psql binary (default psql)",
    "",
    "Mock:",
    "      --mock                start the in-process mock API",
    "      --mock-port <port>    fixed mock port (default ephemeral)",
    "      --mock-boards <n>     mock boards (default 1)",
    "      --mock-cards <n>      cards per mock board (default 120)",
    "",
    "Examples:",
    "  npm run perf:smoke",
    '  npm run perf:agents -- --scenario S1 --token "$JANOSIK_PERF_TOKEN" --agents 100 --duration 5m',
    "  npm run perf:agents -- --scenario S2 --board <id> --agents 100 --duration 2m --label baseline-100",
    "  npm run perf:agents -- --scenario S6 --boards 1 --concurrency 500 --api-pid 1234",
    "",
    "See scripts/perf/README.md for the dedicated-host baseline procedure.",
  ].join("\n");
}

/** Parse `process.argv.slice(2)`; exported so tests can drive the CLI. */
export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: CLI_OPTIONS,
    strict: true,
    allowPositionals: false,
  });
  return values;
}
