import { env } from "./env";
import { throttleLimit } from "./throttle";

/**
 * TASK-166.10 / TASK-200.3: budgets for the agent-facing buckets.
 *
 * All four knobs default to 0 = "derive from the live global limit", so an
 * operator who already tunes `THROTTLE_LIMIT` (or the master panel) does not
 * have to learn a matrix of new values. TASK-200.3 resized the derivations for
 * swarms: the board bucket is now a **safety ceiling** (a single board can no
 * longer be starved by the default it inherited from one caller's budget),
 * while the per-token and per-session buckets carry the fairness.
 *
 * The formulas are exported as pure functions so the sizing is testable and
 * the docs can state exact numbers:
 *
 * - session: `max(600, THROTTLE_LIMIT)` weighted units — one runaway agent
 *   session; a batch spends its command count here too;
 * - token:   `max(600, ceil(THROTTLE_LIMIT / 4))` weighted units — one abusive
 *   key cannot consume a board; a token is usually shared by one agent/run. An
 *   explicit token `rateLimitPerMinute` is a ceiling too: the effective budget
 *   is `min(explicit, derived)`, so a 100k/min PAT cannot bypass the share
 *   when `THROTTLE_LIMIT` is raised;
 * - board:   `max(12000, 2 × THROTTLE_LIMIT)` weighted units — a high safety
 *   ceiling for every agent on that board together;
 * - command queue: 1500 ms (maximum 30 000 ms) — a burst waits briefly for the
 *   board bucket to refill instead of failing immediately.
 */
export const AGENT_SESSION_RATE_LIMIT_MIN = 600;
export const AGENT_TOKEN_RATE_LIMIT_MIN = 600;
export const AGENT_TOKEN_RATE_LIMIT_DIVISOR = 4;
export const BOARD_RATE_LIMIT_MIN = 12_000;
export const BOARD_RATE_LIMIT_FACTOR = 2;
export const AGENT_COMMAND_QUEUE_MS_DEFAULT = 1_500;

let boardOverride: number | null = null;
let sessionOverride: number | null = null;
let tokenOverride: number | null = null;
let commandQueueOverride: number | null = null;

/** Pure derivation of the per-agent-session budget. */
export function deriveAgentSessionRateLimit(
  globalLimit: number,
  configured: number,
): number {
  if (configured > 0) return configured;
  return Math.max(AGENT_SESSION_RATE_LIMIT_MIN, globalLimit);
}

/**
 * Pure derivation of the per-token agent budget. The global throttler already
 * keys a PAT separately, so this bucket matters most when an operator raises
 * `THROTTLE_LIMIT` for a swarm: a key without an explicit
 * `rateLimitPerMinute` then keeps a quarter of the global window instead of
 * inheriting the whole of it. An explicit limit is a ceiling as well; use
 * {@link effectiveAgentTokenRateLimit} so it cannot exceed the derived share.
 */
export function deriveAgentTokenRateLimit(
  globalLimit: number,
  configured: number,
): number {
  if (configured > 0) return configured;
  return Math.max(
    AGENT_TOKEN_RATE_LIMIT_MIN,
    Math.ceil(globalLimit / AGENT_TOKEN_RATE_LIMIT_DIVISOR),
  );
}

/**
 * The budget a token may actually spend: the tighter of its explicit
 * `rateLimitPerMinute` and the derived share. `null`/`undefined` means the key
 * has no explicit limit, so the derived share is its budget.
 */
export function effectiveAgentTokenRateLimit(
  explicit: number | null | undefined,
  derived: number = agentTokenRateLimit(),
): number {
  return explicit === null || explicit === undefined
    ? derived
    : Math.min(explicit, derived);
}

/**
 * Pure derivation of the per-board safety ceiling. `12000` requests/min is
 * 200 req/s — above the measured one-board command ceiling (~42–48/s) and the
 * idle cadence of a few hundred agents, but far below a node's raw HTTP
 * ceiling. An operator sizing a larger rig pins `BOARD_RATE_LIMIT`.
 */
export function deriveBoardRateLimit(
  globalLimit: number,
  configured: number,
): number {
  if (configured > 0) return configured;
  return Math.max(BOARD_RATE_LIMIT_MIN, globalLimit * BOARD_RATE_LIMIT_FACTOR);
}

/** Per-agent-session budget, in requests per minute. */
export function agentSessionRateLimit(): number {
  if (sessionOverride !== null) return sessionOverride;
  return deriveAgentSessionRateLimit(
    throttleLimit(),
    env.AGENT_SESSION_RATE_LIMIT,
  );
}

/** Per-token agent budget, in requests per minute, for keys without an explicit limit. */
export function agentTokenRateLimit(): number {
  if (tokenOverride !== null) return tokenOverride;
  return deriveAgentTokenRateLimit(throttleLimit(), env.AGENT_TOKEN_RATE_LIMIT);
}

/**
 * Per-board budget shared by all agent traffic on that board, in requests per
 * minute. Kept as a high safety ceiling: fairness comes from the token and
 * session buckets so one noisy agent cannot exhaust it for everyone else.
 */
export function boardRateLimit(): number {
  if (boardOverride !== null) return boardOverride;
  return deriveBoardRateLimit(throttleLimit(), env.BOARD_RATE_LIMIT);
}

/**
 * How long a command may wait for the board bucket to refill before the API
 * answers `503 rate_limited` with a real `Retry-After`.
 */
export function agentCommandQueueMs(): number {
  if (commandQueueOverride !== null) return commandQueueOverride;
  return env.AGENT_COMMAND_QUEUE_MS;
}

/**
 * Runtime override for tests and embedders. `null` restores the env/global
 * derivation. Mirrors `setThrottleLimit`: no restart, no persisted setting.
 */
export function setBoardRateLimit(limit: number | null): void {
  boardOverride = limit;
}

/** Runtime override for the per-session budget; `null` restores the default. */
export function setAgentSessionRateLimit(limit: number | null): void {
  sessionOverride = limit;
}

/** Runtime override for the per-token agent budget; `null` restores the default. */
export function setAgentTokenRateLimit(limit: number | null): void {
  tokenOverride = limit;
}

/** Runtime override for the command queue wait; `null` restores the env value. */
export function setAgentCommandQueueMs(ms: number | null): void {
  commandQueueOverride = ms;
}
