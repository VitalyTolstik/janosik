import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Request } from "express";
import { env } from "@/config/env";

/** Fixed window of the per-token public budget. */
const WINDOW_MS = 60_000;

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
      typeof token === "string" && token.length > 0
        ? `share:${token}`
        : `share-ip:${String(request.ip ?? "unknown")}`;
    const limit =
      context.getHandler().name === "og"
        ? env.SHARE_OG_RATE_LIMIT
        : env.SHARE_RATE_LIMIT;

    const now = Date.now();
    if (this.buckets.size > 10_000) this.prune(now);
    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      throw new ThrottlerException();
    }
    return true;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
