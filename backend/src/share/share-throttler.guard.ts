import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Request } from "express";
import { env } from "@/config/env";

/** Fixed window of the per-token public budget. */
const WINDOW_MS = 60_000;

/**
 * Hard ceiling on tracked buckets (B23). Without it a flood of distinct —
 * especially invalid — tokens creates one bucket each and the map grows
 * without bound. Past the cap expired buckets go first, then the oldest
 * inserted (its window is the closest to resetting).
 */
const MAX_BUCKETS = 10_000;

/** Shape of a real share token; anything else is keyed by IP instead. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Per-token rate limit for the public share contour (TASK-58, §7.9.4).
 *
 * The global throttler (TASK-57) keys by client IP, so one popular link could
 * still be hammered from many IPs. This guard gives each **token** its own
 * fixed 60-second budget: a single link is bounded regardless of how many
 * readers hit it. Deliberately self-contained rather than a `ThrottlerGuard`
 * subclass — the base class resolves its tracker through a shared
 * `commonOptions` object, so a subclass override is silently ignored once the
 * global guard has initialized it.
 *
 * Malformed tokens never get their own bucket (an invalid path is keyed by
 * IP), and the table is capped (B23). Per-node budgets still multiply by the
 * number of nodes; a Redis-backed limiter would unify them.
 *
 * The OG preview (heavier to render) gets the tighter `SHARE_OG_RATE_LIMIT`.
 */
@Injectable()
export class ShareThrottlerGuard implements CanActivate {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { params: Record<string, string> }>();
    const token = request.params?.token;
    const key =
      typeof token === "string" && TOKEN_SHAPE.test(token)
        ? `share:${token}`
        : `share-ip:${String(request.ip ?? "unknown")}`;
    const limit =
      context.getHandler().name === "og"
        ? env.SHARE_OG_RATE_LIMIT
        : env.SHARE_RATE_LIMIT;

    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      if (this.buckets.size >= MAX_BUCKETS) this.evict(now);
      this.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      throw new ThrottlerException();
    }
    // Refresh the insertion order so eviction is true LRU (TASK-147
    // follow-up): without this an actively-hit bucket keeps its old position
    // and is the first evicted when the table fills, silently resetting the
    // limit of a legitimate, popular link.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    return true;
  }

  private evict(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    // Still full: drop the least-recently-used entries (Map preserves
    // insertion order and hits re-insert, see `canActivate`) to make room, so
    // the table can never exceed MAX_BUCKETS.
    while (this.buckets.size >= MAX_BUCKETS) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}
