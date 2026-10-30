/**
 * Per-token rate limit (TASK-157). A personal API token may carry its own
 * requests-per-minute budget, enforced in `JwtAuthGuard` once the token has
 * authenticated (the global throttler runs earlier and only knows the raw
 * credential). In-memory and per-process — like the login backoff — so a
 * multi-node deployment allows the budget per node; the map is bounded so a
 * churn of tokens can never grow it without limit (the B23 lesson).
 */

/** Sliding window length. */
const WINDOW_MS = 60_000;
/** Hard cap on tracked tokens. */
const MAX_ENTRIES = 10_000;

const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Count one request against `tokenId`'s window and answer whether it is
 * still within `limitPerMinute`. A request over the limit is not counted
 * further (the caller answers 429).
 */
export function consumeTokenRate(
  tokenId: string,
  limitPerMinute: number,
): boolean {
  const now = Date.now();
  let bucket = buckets.get(tokenId);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(tokenId, bucket);
    if (buckets.size > MAX_ENTRIES) {
      for (const [key, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(key);
      }
      if (buckets.size > MAX_ENTRIES) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined && oldest !== tokenId) buckets.delete(oldest);
      }
    }
  }
  bucket.count += 1;
  return bucket.count <= limitPerMinute;
}

/** Test hook: drop every counter. */
export function resetTokenRates(): void {
  buckets.clear();
}
