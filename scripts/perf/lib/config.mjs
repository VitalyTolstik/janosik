// TASK-200.1 — agent-scale harness configuration.
//
// Pure helpers: no filesystem, network or clock access, so the CLI surface and
// every derived default can be unit-tested with `node --test`.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { redactUrl } from "./redact.mjs";

export const TASK = "TASK-200.1";
export const DEFAULT_BASE_URL = "http://localhost:3000/api/v1";
export const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

/**
 * Scenario defaults from `docs/PERF-AGENT-SCALE.md` §7.1 and
 * `docs/TASK-200-agent-scale-performance.md` §200.1. `durationMs` is the work
 * window *after* the S4 ramp; S5 uses `rampMs + holdMs`.
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
      watchCadenceMs: 3_000,
      mix: { reads: 0.6, writes: 0.3, comments: 0.1 },
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
    // The approved profile in docs/PERF-AGENT-SCALE.md §7.1 is 0 → 5,000
    // streams; the task spec repeats 5,000. Keep 5,000 explicit.
    defaults: { sse: 5_000, rampMs: 300_000, holdMs: 600_000 },
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
    watchCadenceMs: 250,
  },
  S4: {
    agents: 3,
    cadenceMs: 250,
    durationMs: 2_000,
    rampMs: 1_000,
    burst: true,
  },
  S5: { sse: 5, rampMs: 1_000, holdMs: 1_000 },
  S6: { concurrency: 4, repeats: 1 },
};

/** Hard ceilings so `--mock` can never turn into an accidental heavy run. */
export const SMOKE_CAPS = {
  agents: 8,
  humans: 8,
  sse: 20,
  concurrency: 50,
  repeats: 2,
  cadenceMs: 5_000,
  watchCadenceMs: 5_000,
  durationMs: 30_000,
  rampMs: 10_000,
  holdMs: 10_000,
};

/** Mock profiles are correctness checks; they cannot request a heavy board. */
export const MOCK_LIMITS = { boards: 16, cards: 2_000 };

export function clampMockSizes({ boards, cards }) {
  return {
    boards: Math.min(Math.max(1, boards), MOCK_LIMITS.boards),
    cards: Math.min(Math.max(1, cards), MOCK_LIMITS.cards),
  };
}

const SCENARIO_LIST = /^[A-Za-z0-9]+$/;

export const CLI_OPTIONS = {
  scenario: { type: "string", multiple: true, short: "s" },
  "base-url": { type: "string" },
  token: { type: "string", multiple: true },
  "token-file": { type: "string", multiple: true },
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
  "watch-cadence": { type: "string" },
  mix: { type: "string" },
  burst: { type: "boolean" },
  "no-burst": { type: "boolean" },
  "lease-ms": { type: "string" },
  jitter: { type: "string" },
  seed: { type: "string" },
  "idle-endpoint": { type: "string" },
  output: { type: "string" },
  label: { type: "string" },
  driver: { type: "string" },
  "mcp-processes": { type: "string" },
  "shared-identity": { type: "boolean" },
  "require-ok": { type: "boolean" },
  recycle: { type: "boolean" },
  "recycle-token": { type: "string" },
  "recycle-token-file": { type: "string" },
  "api-pid": { type: "string" },
  "api-probe": { type: "string" },
  "api-inspect": { type: "string" },
  "cpu-profile": { type: "string" },
  "pg-url": { type: "string" },
  psql: { type: "string" },
  "pg-activity": { type: "boolean" },
  "pg-activity-interval": { type: "string" },
  "redis-url": { type: "string" },
  "redis-cli": { type: "string" },
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

function readTokenFiles(value) {
  const files = takeList(value);
  const tokens = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      throw new Error(
        `cannot read token file ${file}: ${error instanceof Error ? error.message : error}`,
        { cause: error },
      );
    }
    tokens.push(...text.split(/[\s,]+/).filter(Boolean));
  }
  return tokens;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== ""))];
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

/**
 * Parse the S3 action mix. Accepts percentages (`60/30/10`) or fractions
 * (`0.6/0.3/0.1`) for reads/writes/comments; the three values must sum to
 * roughly one.
 */
export function parseMix(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parts = String(raw)
    .split("/")
    .map((part) => part.trim());
  if (parts.length !== 3) {
    throw new Error("--mix must look like reads/writes/comments (60/30/10)");
  }
  let values = parts.map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("--mix values must be non-negative numbers");
  }
  const sum = values.reduce((total, value) => total + value, 0);
  if (sum === 0) throw new Error("--mix values must not all be zero");
  if (Math.abs(sum - 100) <= 0.01) {
    values = values.map((value) => value / 100);
  } else if (Math.abs(sum - 1) > 0.01) {
    throw new Error("--mix values must sum to 100 (percent) or 1 (fractions)");
  }
  const [reads, writes, comments] = values;
  return { reads, writes, comments };
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
 * Token precedence: `--token-file` (newline/comma-separated) >
 * `JANOSIK_PERF_TOKEN` > `PERF_TOKEN`. `--token` is rejected because argv is
 * visible through `/proc/<pid>/cmdline`. The map is deduplicated;
 * `publicConfig()` only exposes the count.
 */
export function resolveConfig(cliValues = {}, env = {}) {
  if (cliValues.token !== undefined) {
    throw new Error(
      "--token is no longer accepted in argv (visible through /proc/<pid>/cmdline); use JANOSIK_PERF_TOKEN or --token-file",
    );
  }
  if (cliValues["recycle-token"] !== undefined) {
    throw new Error(
      "--recycle-token is no longer accepted in argv; use JANOSIK_PERF_RECYCLE_TOKEN or --recycle-token-file",
    );
  }
  const scenarios = parseScenarioList(cliValues.scenario);
  const mock = cliValues.mock === true;
  if (cliValues.help === true) {
    return { help: true, mode: "real", scenarioIds: scenarios.ids };
  }
  if (scenarios.mode === "smoke" && !mock) {
    throw new Error(
      "--scenario smoke needs --mock; smoke profiles are in-process correctness checks, not real baselines",
    );
  }
  const smoke = scenarios.mode === "smoke" || mock;
  let ids = scenarios.ids;
  if (ids.length === 0) {
    if (!mock) {
      throw new Error(
        "--scenario is required; use S1…S6, all, or --scenario smoke --mock",
      );
    }
    ids = SMOKE_SCENARIOS;
  }
  const mode = smoke ? "smoke" : "real";

  const overrides = {};
  const int = (key, value, options) => {
    const parsed = integer(key, value, options);
    if (parsed !== undefined) overrides[key] = parsed;
  };
  int("agents", cliValues.agents, { min: 1, max: 100_000 });
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
  const mcpProcesses = integer("mcp-processes", cliValues["mcp-processes"], {
    min: 1,
    max: 100_000,
  });

  for (const [key, source] of [
    ["cadenceMs", "cadence"],
    ["durationMs", "duration"],
    ["rampMs", "ramp"],
    ["holdMs", "hold"],
    ["watchCadenceMs", "watch-cadence"],
  ]) {
    const parsed = parseDurationMs(source, cliValues[source]);
    if (parsed !== undefined) overrides[key] = parsed;
  }
  const activityInterval = parseDurationMs(
    "pg-activity-interval",
    cliValues["pg-activity-interval"],
  );
  if (activityInterval !== undefined) {
    overrides.pgActivityIntervalMs = activityInterval;
  }
  const mix = parseMix(cliValues.mix);
  if (mix !== undefined) overrides.mix = mix;
  if (cliValues["no-burst"] === true) overrides.burst = false;
  else if (cliValues.burst === true) overrides.burst = true;

  const jitter = fraction("jitter", cliValues.jitter);
  if (jitter !== undefined) overrides.jitter = jitter;

  if (cliValues["idle-endpoint"] !== undefined) {
    if (!["board", "ready"].includes(cliValues["idle-endpoint"])) {
      throw new Error("--idle-endpoint must be board or ready");
    }
    overrides.idleEndpoint = cliValues["idle-endpoint"];
  }

  const fileTokens = readTokenFiles(cliValues["token-file"]);
  const envTokens = takeList(env.JANOSIK_PERF_TOKEN);
  const fallbackTokens = takeList(env.PERF_TOKEN);
  const tokens = unique(
    fileTokens.length > 0
      ? fileTokens
      : envTokens.length > 0
        ? envTokens
        : fallbackTokens,
  );
  if (tokens.length === 0 && mock) {
    tokens.push("perf-smoke-token-1", "perf-smoke-token-2");
  }

  const explicitBoards = unique([
    ...takeList(cliValues.board),
    ...(mock ? [] : takeList(env.JANOSIK_PERF_BOARDS)),
  ]);
  const boardsCount = mock
    ? 1
    : (integer("boards", cliValues.boards, { min: 1, max: 10_000 }) ?? 1);

  if (!mock && tokens.length === 0) {
    throw new Error(
      "no PAT: set JANOSIK_PERF_TOKEN or pass --token-file (comma-separated pools)",
    );
  }

  const driver = String(cliValues.driver ?? "http").toLowerCase();
  if (!["http", "mcp"].includes(driver)) {
    throw new Error("--driver must be http or mcp");
  }
  if (driver === "mcp") {
    const unsupported = ids.filter((id) => ["S3", "S5", "S6"].includes(id));
    if (unsupported.length > 0) {
      throw new Error(
        `--driver mcp supports S1/S2/S4 only; rejected ${unsupported.join(", ")} (S3 mixed and S5/S6 SSE/read probes are HTTP-only)`,
      );
    }
  }

  const baseUrl = String(cliValues["base-url"] ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error("--base-url must start with http:// or https://");
  }

  const apiPid = integer("api-pid", cliValues["api-pid"], { min: 1 });
  const apiInspect = cliValues["api-inspect"];
  if (apiInspect !== undefined && !/^wss?:\/\//.test(String(apiInspect))) {
    throw new Error("--api-inspect must be a ws:// or wss:// URL");
  }
  if (apiInspect !== undefined && cliValues["cpu-profile"] === undefined) {
    throw new Error(
      "--api-inspect needs --cpu-profile <file|dir> for the stopped profile",
    );
  }
  const recycle = cliValues.recycle === true;
  const recycleFileTokens = readTokenFiles(cliValues["recycle-token-file"]);
  const recycleTokenRaw =
    recycleFileTokens[0] ?? env.JANOSIK_PERF_RECYCLE_TOKEN;
  const recycleToken =
    typeof recycleTokenRaw === "string" && recycleTokenRaw.trim() !== ""
      ? recycleTokenRaw.trim()
      : undefined;
  if (recycle && !mock && recycleToken === undefined) {
    throw new Error(
      "--recycle needs JANOSIK_PERF_RECYCLE_TOKEN or --recycle-token-file: use a dedicated board ADMIN PAT",
    );
  }

  const mockSize = clampMockSizes({
    boards: overrides.mockBoards ?? 1,
    cards: overrides.mockCards ?? 120,
  });

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
    driver,
    mcpProcesses:
      mock && mcpProcesses !== undefined
        ? Math.min(mcpProcesses, 2)
        : (mcpProcesses ?? null),
    allowSharedIdentity: cliValues["shared-identity"] === true,
    requireOk: cliValues["require-ok"] === true,
    recycle,
    // Mock recycle needs a board ADMIN; the default smoke tokens are MEMBER.
    recycleToken: recycleToken ?? (mock ? "perf-smoke-admin" : undefined),
    apiPid,
    apiProbe: cliValues["api-probe"],
    apiInspect,
    cpuProfile: cliValues["cpu-profile"],
    pgUrl: cliValues["pg-url"] ?? (mock ? undefined : env.JANOSIK_PERF_PG_URL),
    pgActivity: cliValues["pg-activity"] === true,
    pgActivityIntervalMs: activityInterval ?? 2_000,
    psql: cliValues.psql ?? "psql",
    redisUrl:
      cliValues["redis-url"] ?? (mock ? undefined : env.JANOSIK_PERF_REDIS_URL),
    redisCli: cliValues["redis-cli"] ?? "redis-cli",
    mock,
    mockPort: overrides.mockPort ?? 0,
    mockBoards: mockSize.boards,
    mockCards: mockSize.cards,
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
  if (config.mode === "smoke") {
    for (const [key, cap] of Object.entries(SMOKE_CAPS)) {
      if (typeof base[key] === "number") base[key] = Math.min(base[key], cap);
    }
  }
  return { ...base, id, title: def.title };
}

/**
 * Reject profiles that cannot produce a measurement. A zero-agent scenario,
 * a zero cadence or a zero duration would exit 0 with no data, which is the
 * failure mode this harness exists to prevent.
 */
export function validateScenarioConfig(config, id) {
  const scenario = scenarioConfig(config, id);
  const fail = (message) => {
    throw new Error(`${id}: ${message}`);
  };
  if (["S1", "S2", "S3", "S4"].includes(id)) {
    if (!(scenario.agents > 0)) fail("--agents must be greater than zero");
    if (!(scenario.cadenceMs > 0)) fail("--cadence must be greater than zero");
    if (!(scenario.durationMs > 0))
      fail("--duration must be greater than zero");
  }
  if (id === "S3") {
    if (!(scenario.watchCadenceMs > 0)) {
      fail("--watch-cadence must be greater than zero");
    }
    const { reads, writes, comments } = scenario.mix ?? {};
    for (const [name, value] of Object.entries({ reads, writes, comments })) {
      if (!Number.isFinite(value) || value < 0) {
        fail(`--mix ${name} must be a non-negative number`);
      }
    }
    if (Math.abs(reads + writes + comments - 1) > 0.01) {
      fail("--mix reads/writes/comments must sum to 1");
    }
  }
  if (id === "S4") {
    if (!(scenario.rampMs >= 0)) fail("--ramp must not be negative");
    // `durationMs` is measured after the ramp, so ramp < duration is not
    // required; report both windows so a short work window is visible.
  }
  if (id === "S5") {
    if (!(scenario.sse > 0)) fail("--sse must be greater than zero");
    if (!(scenario.rampMs >= 0)) fail("--ramp must not be negative");
    if (!(scenario.holdMs > 0)) fail("--hold must be greater than zero");
  }
  if (id === "S6") {
    if (!(scenario.concurrency > 0)) {
      fail("--concurrency must be greater than zero");
    }
    if (!(scenario.repeats > 0)) fail("--repeats must be greater than zero");
  }
  return scenario;
}

/** The subset of config that is safe to write into a report. */
export function publicConfig(config) {
  return {
    task: config.task,
    mode: config.mode,
    driver: config.driver,
    scenarioIds: config.scenarioIds,
    baseUrl: redactUrl(config.baseUrl),
    tokenCount: unique(config.tokens).length,
    allowSharedIdentity: config.allowSharedIdentity === true,
    requireOk: config.requireOk === true,
    recycle: config.recycle === true,
    explicitBoards: config.explicitBoards,
    resolvedBoards: config.resolvedBoards ?? config.explicitBoards,
    boardsCount: config.boardsCount,
    mcpProcesses: config.mcpProcesses,
    jitter: config.jitter,
    seed: config.seed,
    label: config.label,
    apiPid: config.apiPid ?? null,
    apiProbe: config.apiProbe ?? null,
    apiInspect: config.apiInspect ?? null,
    cpuProfile: config.cpuProfile ?? null,
    pg: config.pgUrl
      ? {
          enabled: true,
          url: redactUrl(config.pgUrl),
          activity: config.pgActivity,
        }
      : { enabled: false, activity: false },
    redis: config.redisUrl
      ? { enabled: true, url: redactUrl(config.redisUrl) }
      : { enabled: false },
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
    "  node scripts/perf/agent-scale.mjs --scenario S2 [options]",
    "  npm run perf:smoke",
    "",
    "Secrets: set JANOSIK_PERF_TOKEN (pool) or pass --token-file; argv token flags are rejected.",
    "",
    "Scenarios (docs/PERF-AGENT-SCALE.md §7.1):",
    ...ALL_SCENARIOS.map((id) => `  ${id}  ${SCENARIO_DEFS[id].title}`),
    "  all     S1–S6 (heavy; dedicated host only)",
    "  smoke   S1, S2, S3, S6 against an in-process mock (--mock required)",
    "",
    "Common options:",
    "  -s, --scenario <id[,id]>  scenario list (required; use smoke --mock)",
    "      --base-url <url>      default http://localhost:3000/api/v1",
    "      --token-file <path>   PAT pool file (newline/comma-separated; preferred over env only by precedence)",
    "      --board <id>          explicit board id; repeat or comma-separate",
    "      --boards <n>          pick the first N accessible boards (default 1)",
    "      --agents <n>          agent workers/processes (scenario default)",
    "      --humans <n>          human read workers for S3",
    "      --sse <n>             SSE streams for S3/S5",
    "      --cadence <dur>       per-agent delay, e.g. 10s (default per scenario)",
    "      --watch-cadence <dur> S3 human Watch cadence (default 3s)",
    "      --mix <r/w/c>         S3 action mix, default 60/30/10",
    "      --duration <dur>      work window, e.g. 2m (after the S4 ramp)",
    "      --ramp <dur>          S4 start ramp / S5 connection ramp",
    "      --burst               synchronize S4 workers at the end of the ramp (default)",
    "      --no-burst            stagger S4 worker starts across the ramp",
    "      --hold <dur>          S5 hold after the ramp actually completes",
    "      --concurrency <n>     S6 in-flight reads (default 500)",
    "      --repeats <n>         S6 rounds (default 1)",
    "      --jitter <0..1>       cadence jitter fraction (default 0.2)",
    "      --seed <n>            deterministic jitter/mix seed (default 200001)",
    "      --lease-ms <ms>       CLAIM_CARD lease (default 300000)",
    "      --idle-endpoint <e>   board | ready (default board; ready is 200.2)",
    "      --driver <http|mcp>   HTTP PAT loop (default) or real MCP stdio (not S3)",
    "      --mcp-processes <n>   MCP process count (default: agents)",
    "      --shared-identity     allow more agents than PATs (same identity)",
    "      --require-ok          exit 1 unless every scenario is ok (not partial)",
    "      --recycle             move Done cards back when the board drains",
    "      --recycle-token-file <path> dedicated board ADMIN PAT file for --recycle",
    "      --output <file.json>  JSON path; Markdown is written beside it",
    "      --label <text>        report label",
    "",
    "Instrumentation (all optional):",
    "      --api-pid <pid>       sample /proc/<pid>/status VmRSS",
    "      --api-probe <jsonl>   sample file written by api-preload.mjs",
    "      --api-inspect <ws://…> live inspector URL; start/stop V8 Profiler",
    "      --cpu-profile <path>  API .cpuprofile file or directory (Top-10)",
    "      --pg-url <url>        PostgreSQL URL (userinfo stripped in reports)",
    "      --pg-activity         sample pg_stat_activity states/waits",
    "      --pg-activity-interval <dur>  sample interval (default 2s)",
    "      --psql <path>         psql binary (default psql)",
    "      --redis-url <url>     Redis URL for INFO sampling (redacted)",
    "      --redis-cli <path>    redis-cli binary (default redis-cli)",
    "",
    "Mock:",
    "      --mock                start the in-process mock API",
    "      --mock-port <port>    fixed mock port (default ephemeral)",
    "      --mock-boards <n>     mock boards (default 1)",
    "      --mock-cards <n>      cards per mock board (default 120)",
    "",
    "Exit codes: 0 ok/partial, 1 failed or zero-work, 2 config/preflight, 130 interrupted.",
    "",
    "Examples:",
    "  npm run perf:smoke",
    "  npm run perf:agents -- --scenario S1 --agents 100 --duration 5m",
    "  npm run perf:agents -- --scenario S2 --board <id> --agents 100 --duration 2m --label baseline-100",
    "  npm run perf:agents -- --scenario S3 --board <id> --agents 500 --humans 50 --sse 100",
    "  npm run perf:agents -- --scenario S5 --sse 5000 --ramp 5m --hold 10m --api-pid 1234",
    "  npm run perf:agents -- --scenario S2 --driver mcp --agents 2 --mock",
    "  npm run perf:agents -- --scenario S2 --cpu-profile /tmp/api.cpuprofile --pg-activity",
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
