import {
  consumeRateLimit,
  resetRateLimits,
  type RateLimitDecision,
} from "./rate-limit";

/**
 * Per-token rate limit (TASK-157, extended by TASK-166.10). A personal API
 * token may carry its own requests-per-minute budget, enforced in
 * `JwtAuthGuard` once the token has authenticated (the global throttler runs
 * earlier and only knows the raw credential). In-memory and per-process —
 * like the login backoff — so a multi-node deployment allows the budget per
 * node; the shared bucket map is bounded so a churn of tokens can never grow
 * it without limit (the B23 lesson).
 */

/** Fixed window length. */
const WINDOW_MS = 60_000;

/**
 * Count one request against `tokenId`'s window and return the whole budget,
 * so the guard can answer with `RateLimit-*` headers and a real
 * `Retry-After` instead of a generic 429.
 */
export function consumeTokenRateLimit(
  tokenId: string,
  limitPerMinute: number,
  now: number = Date.now(),
): RateLimitDecision {
  return consumeRateLimit("token", tokenId, limitPerMinute, WINDOW_MS, now);
}

/**
 * Legacy boolean seam (TASK-157 callers/tests): true while the token is
 * inside its budget. New code should use {@link consumeTokenRateLimit}.
 */
export function consumeTokenRate(
  tokenId: string,
  limitPerMinute: number,
  now: number = Date.now(),
): boolean {
  return consumeTokenRateLimit(tokenId, limitPerMinute, now).allowed;
}

/** Test hook: drop every token counter (other scopes stay untouched). */
export function resetTokenRates(): void {
  resetRateLimits("token");
}
