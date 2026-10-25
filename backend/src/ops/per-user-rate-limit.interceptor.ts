import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { OpsSettingsService } from "./ops-settings.service";

/**
 * Per-user rate limit (TASK-61). The global throttler keys on the client IP;
 * this adds a tighter, per-authenticated-user budget an operator can set from
 * the panel. Runs as an interceptor so `req.user` is already populated by the
 * route's auth guard. In-process sliding window — single-node MVP, like the
 * rest of the runtime (§7.0).
 */
@Injectable()
export class PerUserRateLimitInterceptor implements NestInterceptor {
  private readonly hits = new Map<string, number[]>();
  private cached: { at: number; value: number | null } | null = null;

  constructor(private readonly ops: OpsSettingsService) {}

  private async limit(): Promise<number | null> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < 5_000) return this.cached.value;
    const value = await this.ops.perUserRateLimit();
    this.cached = { at: now, value };
    return value;
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { id: string } }>();
    const userId = request.user?.id;
    if (userId) {
      const limit = await this.limit();
      if (limit !== null && limit > 0) {
        const now = Date.now();
        const recent = (this.hits.get(userId) ?? []).filter(
          (t) => now - t < 60_000,
        );
        if (recent.length >= limit) {
          throw new HttpException(
            "Too many requests",
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        recent.push(now);
        this.hits.set(userId, recent);
      }
    }
    return next.handle();
  }
}
