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
  /** Ceiling of the bucket, in budget units per window (weighted where noted). */
  limit: number;
  /** Budget units still allowed in the current window (never negative). */
  remaining: number;
  /**
   * Unix timestamp (ms) when the bucket is whole again: the fixed window's
   * end, or the moment the continuously refilling board bucket is full.
   */
  resetAt: number;
  /**
   * Whole seconds until the next admission (`Retry-After`), at least 1 when
   * the request is denied. For an allowed board token bucket this is `0`,
   * because a token is available now; for a fixed window it is the time to
   * the window reset. The IETF-style `RateLimit-Reset` header uses it.
   */
  retryAfter: number;
  /**
   * TASK-200.3: for the continuously refilling board bucket, the instant the
   * next request (or the next `cost` tokens) becomes admissible. Fixed-window
   * buckets leave it unset.
   */
  nextTokenAt?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * TASK-200.3: the board bucket is a token bucket, not a fixed window.
 *
 * A fixed window is a poor fit for a shared board: a swarm that drains the
 * minute budget waits for the window boundary even though a burst will pass
 * once the next window opens, and the server cannot queue briefly because no
 * slot frees until reset. A token bucket refills continuously at
 * `limit / windowMs`, so the command interceptor can wait for the next token
 * (bounded) instead of answering 429 at once, while `limit` stays the burst
 * capacity and the sustained per-minute rate.
 */
interface BoardBucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const boardBuckets = new Map<string, BoardBucket>();

/**
 * Count `cost` units against `scope:key` and describe the resulting budget.
 * A denied request still advances the counter — the bucket is already over
 * its ceiling, and the reset time does not move. TASK-200.3 charges a command
 * batch by its command count, so one request cannot spend a whole window's
 * budget for the work of a hundred commands.
 */
export function consumeRateLimit(
  scope: RateLimitScope,
  key: string,
  limitPerWindow: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  now: number = Date.now(),
  cost: number = 1,
): RateLimitDecision {
  const weight = Math.max(1, Math.floor(cost));
  const storageKey = `${scope}:${key}`;
  let bucket = buckets.get(storageKey);
  if (bucket === undefined || bucket.resetAt <= now) {
    if (bucket === undefined && buckets.size >= MAX_BUCKETS) evict(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(storageKey, bucket);
  }
  bucket.count += weight;
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
 * TASK-200.3: count `cost` units against a board's continuously refilling
 * bucket. The capacity is the configured per-minute limit, so a swarm may
 * still burst up to a full minute's budget; the refill rate makes an
 * over-budget command admissible again within milliseconds instead of waiting
 * for a window boundary. A batch is charged by its command count.
 */
export function consumeBoardRateLimit(
  key: string,
  limitPerWindow: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  now: number = Date.now(),
  cost: number = 1,
): RateLimitDecision {
  const weight = Math.max(1, Math.floor(cost));
  if (limitPerWindow <= 0) {
    return {
      scope: "board",
      allowed: false,
      limit: limitPerWindow,
      remaining: 0,
      resetAt: now + windowMs,
      retryAfter: Math.max(1, Math.ceil(windowMs / 1000)),
      nextTokenAt: now + windowMs,
    };
  }
  let bucket = boardBuckets.get(key);
  if (bucket === undefined) {
    if (boardBuckets.size >= MAX_BUCKETS) evictBoard(now, windowMs);
    bucket = { tokens: limitPerWindow, updatedAt: now };
    boardBuckets.set(key, bucket);
  } else {
    refillBoardBucket(bucket, limitPerWindow, windowMs, now);
  }
  const decision = describeBoardBucket(
    bucket.tokens,
    limitPerWindow,
    windowMs,
    now,
    weight,
    true,
  );
  if (decision.allowed) bucket.tokens -= weight;
  // A backwards clock must not rewind the refill origin: doing so would
  // credit the same elapsed time twice on the next forward tick.
  bucket.updatedAt = Math.max(bucket.updatedAt, now);
  return decision;
}

/**
 * Inspect a board's budget without spending a token. The queue uses this to
 * answer `503` when a request's deadline has already passed.
 */
export function inspectBoardRateLimit(
  key: string,
  limitPerWindow: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  now: number = Date.now(),
  cost: number = 1,
): RateLimitDecision {
  const weight = Math.max(1, Math.floor(cost));
  if (limitPerWindow <= 0) {
    return {
      scope: "board",
      allowed: false,
      limit: limitPerWindow,
      remaining: 0,
      resetAt: now + windowMs,
      retryAfter: Math.max(1, Math.ceil(windowMs / 1000)),
      nextTokenAt: now + windowMs,
    };
  }
  const bucket = boardBuckets.get(key);
  const tokens =
    bucket === undefined
      ? limitPerWindow
      : Math.min(
          limitPerWindow,
          bucket.tokens +
            Math.max(0, now - bucket.updatedAt) * (limitPerWindow / windowMs),
        );
  return describeBoardBucket(
    tokens,
    limitPerWindow,
    windowMs,
    now,
    weight,
    false,
  );
}

/** Refill in place; a backwards clock contributes no elapsed time. */
function refillBoardBucket(
  bucket: BoardBucket,
  limitPerWindow: number,
  windowMs: number,
  now: number,
): void {
  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(
    limitPerWindow,
    bucket.tokens + elapsed * (limitPerWindow / windowMs),
  );
}

/** Shape one board decision from an already-refilled token count. */
function describeBoardBucket(
  tokens: number,
  limitPerWindow: number,
  windowMs: number,
  now: number,
  cost: number,
  spend: boolean,
): RateLimitDecision {
  const rate = limitPerWindow / windowMs;
  const allowed = tokens >= cost;
  const available = spend && allowed ? tokens - cost : tokens;
  const msToNextToken = allowed ? 0 : (cost - tokens) / rate;
  const msToFull = (limitPerWindow - available) / rate;
  const nextTokenAt = now + Math.max(0, Math.ceil(msToNextToken));
  return {
    scope: "board",
    allowed,
    limit: limitPerWindow,
    remaining: Math.max(0, Math.floor(available)),
    resetAt: now + Math.max(1, Math.ceil(msToFull)),
    // An allowed board request has a token now; `RateLimit-Reset` is 0 until
    // the bucket is actually exhausted again.
    retryAfter: allowed ? 0 : Math.max(1, Math.ceil(msToNextToken / 1000)),
    nextTokenAt,
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

/** Same bound for the board bucket map; a full bucket is also droppable. */
function evictBoard(now: number, windowMs: number): void {
  for (const [key, bucket] of boardBuckets) {
    if (bucket.updatedAt + windowMs <= now) boardBuckets.delete(key);
  }
  while (boardBuckets.size >= MAX_BUCKETS) {
    const oldest = boardBuckets.keys().next().value;
    if (oldest === undefined) break;
    boardBuckets.delete(oldest);
  }
}

/** Test/ops hook: clear every bucket, or only one scope. */
export function resetRateLimits(scope?: RateLimitScope): void {
  if (scope === undefined) {
    buckets.clear();
    boardBuckets.clear();
    return;
  }
  if (scope === "board") {
    boardBuckets.clear();
    // A handful of unit tests still exercise the fixed-window helper with the
    // board scope; clearing both keeps the hook predictable.
  }
  const prefix = `${scope}:`;
  for (const key of buckets.keys()) {
    if (key.startsWith(prefix)) buckets.delete(key);
  }
}

/** Number of tracked buckets (observability/tests). */
export function trackedRateLimitBuckets(): number {
  return buckets.size + boardBuckets.size;
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
 * timestamp in seconds) and the IETF-style `RateLimit-*`. TASK-200.3 pins the
 * `RateLimit-Reset` semantics: seconds until the next admission for the
 * continuously refilling board bucket (0 while a token is available), and
 * seconds until the window reset for fixed buckets. `X-RateLimit-Reset` keeps
 * naming when the bucket is whole again (the fixed window end / full board
 * bucket), which is not the same instant. `Retry-After` is added only when
 * the request was denied.
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

/**
 * TASK-200.3: the answer for a command that exhausted its short queue.
 *
 * It is still the shared `rate_limited` envelope (`retryable`, `retryAfter`,
 * `scope`, `limit`), but `503` says "the server will take this work soon"
 * rather than "this caller is abusive", and every client already treats 503 as
 * retryable. The work was never applied, so retrying a command with the same
 * `commandId` stays idempotent.
 */
export function rateLimitQueueException(
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
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

/** Request property the scoped limiter and the request log share. */
export interface RateLimitedRequest {
  rateLimit?: RateLimitDecision;
  /**
   * TASK-200.3: true when the request was refused with the `rate_limited`
   * envelope. A `503` can also mean `board_write_timeout`, which is a real
   * server error, so telemetry cannot infer backpressure from the status
   * alone (an allowed request may carry budget headers and later fail).
   */
  rateLimited?: boolean;
}
