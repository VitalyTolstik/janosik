import { env } from "./env";
import { throttleLimit } from "./throttle";

/**
 * TASK-166.10: ceilings for the agent-facing buckets.
 *
 * Both default to 0 = "derive from the live global limit", so an operator who
 * already tunes `THROTTLE_LIMIT` (or the master panel) does not have to learn
 * two more knobs, and an upgrade cannot silently tighten an existing install:
 * the session bucket starts at the same budget a single PAT already had, and
 * the board bucket is deliberately looser than one caller's global budget.
 */
let boardOverride: number | null = null;
let sessionOverride: number | null = null;

/** Per-agent-session budget, in requests per minute. */
export function agentSessionRateLimit(): number {
  if (sessionOverride !== null) return sessionOverride;
  return env.AGENT_SESSION_RATE_LIMIT > 0
    ? env.AGENT_SESSION_RATE_LIMIT
    : Math.max(60, throttleLimit());
}

/**
 * Per-board budget shared by all agent traffic on that board, in requests per
 * minute. `600` (twice the default global 300) keeps one noisy board from
 * consuming the node while leaving room for several agents working together.
 */
export function boardRateLimit(): number {
  if (boardOverride !== null) return boardOverride;
  return env.BOARD_RATE_LIMIT > 0
    ? env.BOARD_RATE_LIMIT
    : Math.max(600, throttleLimit() * 2);
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
