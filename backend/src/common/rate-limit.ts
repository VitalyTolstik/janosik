import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * TASK-166.10: the shared bucket limiter behind every agent-facing budget.
 *
 * The global `@nestjs/throttler` guard still answers "how many requests may
 * this principal send?" for browsers and legacy keys. This module adds the
 * tighter agent buckets the ADR asks for — one per API token, one per agent
 * session and one per board — and, unlike the old boolean helper, returns the
 * full budget so a handler can print the `RateLimit-*` headers and a precise
 * `Retry-After`.
 *
 * In-process and per-node on purpose, exactly like `token-rate-limit` and the
 * login backoff: this is an operational guard, not a billing counter, and it
 * must not add I/O to the hot path. The map is bounded so a churn of invented
 * session/board ids cannot grow it without limit.
 */

/** Fixed window length used by every scoped bucket. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Hard cap on tracked buckets across all scopes. */
const MAX_BUCKETS = 20_000;

export type RateLimitScope = "ip" | "token" | "session" | "board";

/** The answer of one bucket after counting the current request. */
export interface RateLimitDecision {
  scope: RateLimitScope;
  allowed: boolean;
  /** Ceiling of the bucket, in requests per window. */
  limit: number;
  /** Requests still allowed in the current window (never negative). */
  remaining: number;
  /** Unix timestamp (ms) when the current window resets. */
  resetAt: number;
  /** Whole seconds until the reset, at least 1 (`Retry-After`). */
  retryAfter: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Count one request against `scope:key` and describe the resulting budget.
 * A denied request still advances the counter — the bucket is already over
 * its ceiling, and the reset time does not move.
 */
export function consumeRateLimit(
  scope: RateLimitScope,
  key: string,
  limitPerWindow: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  now: number = Date.now(),
): RateLimitDecision {
  const storageKey = `${scope}:${key}`;
  let bucket = buckets.get(storageKey);
  if (bucket === undefined || bucket.resetAt <= now) {
    if (bucket === undefined && buckets.size >= MAX_BUCKETS) evict(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(storageKey, bucket);
  }
  bucket.count += 1;
  const remaining = Math.max(0, limitPerWindow - bucket.count);
  return {
    scope,
    allowed: bucket.count <= limitPerWindow,
    limit: limitPerWindow,
    remaining,
    resetAt: bucket.resetAt,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * Drop expired buckets, then the oldest live one, so a flood of distinct ids
 * can never grow the map past `MAX_BUCKETS`. The current key may be the
 * oldest; deleting it is harmless (its window is the closest to resetting).
 */
function evict(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

/** Test/ops hook: clear every bucket, or only one scope. */
export function resetRateLimits(scope?: RateLimitScope): void {
  if (scope === undefined) {
    buckets.clear();
    return;
  }
  const prefix = `${scope}:`;
  for (const key of buckets.keys()) {
    if (key.startsWith(prefix)) buckets.delete(key);
  }
}

/** Number of tracked buckets (observability/tests). */
export function trackedRateLimitBuckets(): number {
  return buckets.size;
}

/** Shape of the response surface the header helper needs. */
export interface RateLimitHeaderSink {
  setHeader(name: string, value: string | number): unknown;
  getHeader(name: string): number | string | string[] | undefined;
}

/**
 * Mirror a legacy `X-RateLimit-*` budget into the IETF-style `RateLimit-*`
 * names. The global throttler only writes the `X-` family; clients that look
 * for the standard names should still see a budget on browser and legacy
 * requests. Existing `RateLimit-*` values (the agent buckets) win.
 */
export function mirrorStandardRateLimitHeaders(
  response: RateLimitHeaderSink,
): void {
  const number = (name: string): number | undefined => {
    const value = response.getHeader(name);
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : undefined;
    return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
  };
  const limit = number("X-RateLimit-Limit");
  const remaining = number("X-RateLimit-Remaining");
  const reset = number("X-RateLimit-Reset");
  if (limit === undefined || remaining === undefined) return;
  if (response.getHeader("RateLimit-Limit") === undefined) {
    response.setHeader("RateLimit-Limit", limit);
  }
  if (response.getHeader("RateLimit-Remaining") === undefined) {
    response.setHeader("RateLimit-Remaining", remaining);
  }
  if (
    reset !== undefined &&
    response.getHeader("RateLimit-Reset") === undefined
  ) {
    response.setHeader("RateLimit-Reset", reset);
  }
}

/**
 * Put the budget on the response.
 *
 * Two families are written: the ADR's `X-RateLimit-*` (`Reset` is a Unix
 * timestamp in seconds) and the IETF-style `RateLimit-*` (`Reset` is seconds
 * until reset). `Retry-After` is added only when the request was denied.
 *
 * With `onlyIfTighter` the headers are not overwritten when the existing
 * global throttle already describes a lower ceiling — the response then
 * always names the bucket that will actually reject the caller first.
 */
export function applyRateLimitHeaders(
  response: RateLimitHeaderSink,
  decision: RateLimitDecision,
  options: { onlyIfTighter?: boolean } = {},
): void {
  if (options.onlyIfTighter === true && decision.allowed) {
    const existing = Number(response.getHeader("X-RateLimit-Limit"));
    if (
      Number.isFinite(existing) &&
      existing > 0 &&
      existing < decision.limit
    ) {
      return;
    }
  }
  response.setHeader("X-RateLimit-Limit", decision.limit);
  response.setHeader("X-RateLimit-Remaining", decision.remaining);
  response.setHeader("X-RateLimit-Reset", Math.ceil(decision.resetAt / 1000));
  response.setHeader("X-RateLimit-Scope", decision.scope);
  response.setHeader("RateLimit-Limit", decision.limit);
  response.setHeader("RateLimit-Remaining", decision.remaining);
  response.setHeader("RateLimit-Reset", decision.retryAfter);
  if (!decision.allowed) {
    response.setHeader("Retry-After", decision.retryAfter);
  }
}

/** A `429 rate_limited` exception carrying the budget and `Retry-After`. */
export function rateLimitException(
  decision: RateLimitDecision,
  message: string,
): HttpException {
  return new HttpException(
    {
      message,
      code: "rate_limited",
      retryable: true,
      retryAfter: decision.retryAfter,
      limit: decision.limit,
      scope: decision.scope,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** Request property the scoped limiter and the request log share. */
export interface RateLimitedRequest {
  rateLimit?: RateLimitDecision;
}
