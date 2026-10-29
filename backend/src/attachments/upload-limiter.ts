import { HttpException, HttpStatus } from "@nestjs/common";

/** Fixed upload window. */
export const UPLOAD_WINDOW_MS = 60_000;
/** Hard cap on the bucket table so a user-id flood cannot grow it. */
const MAX_BUCKETS = 10_000;

/**
 * A bounded, per-key fixed-window counter for uploads (TASK-146, extracted in
 * the TASK-147 follow-up so the limit is unit-testable without the frozen
 * `env`). `limit()` is read per call; a non-positive limit disables it.
 *
 * Per-process: a multi-node deployment allows the budget per node.
 */
export class UploadLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(private readonly limit: () => number) {}

  /** Count one attempt for `key`, or throw `429` past the budget. */
  consume(key: string, now = Date.now()): void {
    const limit = this.limit();
    if (limit <= 0) return;
    const bucket = this.windows.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      if (this.windows.size >= MAX_BUCKETS) this.evict(now);
      this.windows.set(key, { count: 1, resetAt: now + UPLOAD_WINDOW_MS });
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      throw new HttpException(
        { message: "Too many uploads, try again shortly", field: "file" },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private evict(now: number): void {
    for (const [key, bucket] of this.windows) {
      if (bucket.resetAt <= now) this.windows.delete(key);
    }
    while (this.windows.size >= MAX_BUCKETS) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}
