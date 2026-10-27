import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { HttpStatus } from "@nestjs/common";
import { of } from "rxjs";
import type { OpsSettingsService } from "./ops-settings.service";
import { PerUserRateLimitInterceptor } from "./per-user-rate-limit.interceptor";

function context(url: string, userId?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: "GET",
        originalUrl: url,
        user: userId ? { id: userId } : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

const next = { handle: () => of(null) } as CallHandler;

function interceptor(limit: number | null) {
  const ops = {
    perUserRateLimit: jest.fn().mockResolvedValue(limit),
  } as unknown as OpsSettingsService;
  return new PerUserRateLimitInterceptor(ops);
}

describe("PerUserRateLimitInterceptor", () => {
  it("throttles a normal user beyond the configured budget", async () => {
    const guard = interceptor(2);
    const ctx = context("/api/v1/boards", "u1");

    await guard.intercept(ctx, next);
    await guard.intercept(ctx, next);
    await expect(guard.intercept(ctx, next)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it("never throttles the operator contour (admin/auth/health)", async () => {
    const guard = interceptor(1);

    for (const url of ["/api/v1/admin/flags", "/api/v1/auth/me"]) {
      const ctx = context(url, "master");
      await guard.intercept(ctx, next);
      await guard.intercept(ctx, next);
      await expect(guard.intercept(ctx, next)).resolves.toBeDefined();
    }
  });

  it("is a no-op when no limit is configured", async () => {
    const guard = interceptor(null);
    const ctx = context("/api/v1/boards", "u2");
    for (let i = 0; i < 5; i += 1) {
      await expect(guard.intercept(ctx, next)).resolves.toBeDefined();
    }
  });

  it("ignores anonymous requests", async () => {
    const guard = interceptor(1);
    const ctx = context("/api/v1/boards");
    await expect(guard.intercept(ctx, next)).resolves.toBeDefined();
    await expect(guard.intercept(ctx, next)).resolves.toBeDefined();
  });

  it("evicts users idle for a whole window (B-8: bounded map)", async () => {
    jest.useFakeTimers({ now: 5_000_000 });
    try {
      const guard = interceptor(1_000_000);
      for (let i = 0; i < 999; i += 1) {
        await guard.intercept(context("/api/v1/boards", `idle-${i}`), next);
      }
      expect(guard.trackedUsers).toBe(999);
      jest.setSystemTime(5_000_000 + 61_000);
      // The 1000th request triggers the sweep: only the active user stays.
      await guard.intercept(context("/api/v1/boards", "active"), next);
      expect(guard.trackedUsers).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
