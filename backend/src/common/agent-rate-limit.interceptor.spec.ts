import {
  HttpException,
  type CallHandler,
  type ExecutionContext,
} from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import type { Response } from "express";
import {
  setAgentSessionRateLimit,
  setBoardRateLimit,
} from "@/config/rate-limit";
import { resetRateLimits } from "./rate-limit";
import {
  AgentRateLimitInterceptor,
  boardIdOf,
} from "./agent-rate-limit.interceptor";

function context(request: Record<string, unknown>) {
  const headers = new Map<string, unknown>();
  const response = {
    setHeader: (name: string, value: unknown) => headers.set(name, value),
    getHeader: (name: string) => headers.get(name),
  } as unknown as Response;
  const http = {
    getRequest: () => request,
    getResponse: () => response,
  };
  return {
    headers,
    context: {
      getType: () => "http",
      switchToHttp: () => http,
    } as unknown as ExecutionContext,
  };
}

const next: CallHandler = { handle: () => of({ ok: true }) };

describe("AgentRateLimitInterceptor (TASK-166.10)", () => {
  beforeEach(() => {
    resetRateLimits();
    setBoardRateLimit(null);
    setAgentSessionRateLimit(null);
  });

  afterEach(() => {
    setBoardRateLimit(null);
    setAgentSessionRateLimit(null);
    resetRateLimits();
  });

  it("leaves browser sessions on the legacy throttle", async () => {
    setBoardRateLimit(1);
    const { context: ctx, headers } = context({
      auth: { via: "jwt" },
      originalUrl: "/api/v1/boards/b1",
      params: { id: "b1" },
    });
    await expect(
      lastValueFrom(new AgentRateLimitInterceptor().intercept(ctx, next)),
    ).resolves.toEqual({ ok: true });
    expect(headers.size).toBe(0);
    // A second request must still pass: no new browser bucket exists.
    await expect(
      lastValueFrom(new AgentRateLimitInterceptor().intercept(ctx, next)),
    ).resolves.toEqual({ ok: true });
  });

  it("applies a board bucket to PAT traffic and returns headers", async () => {
    setBoardRateLimit(2);
    const { context: ctx, headers } = context({
      auth: { via: "pat", apiTokenId: "t1" },
      originalUrl: "/api/v1/boards/b1",
      params: { id: "b1" },
    });
    await lastValueFrom(new AgentRateLimitInterceptor().intercept(ctx, next));
    expect(headers.get("X-RateLimit-Limit")).toBe(2);
    expect(headers.get("X-RateLimit-Remaining")).toBe(1);
    expect(headers.get("X-RateLimit-Scope")).toBe("board");

    await lastValueFrom(new AgentRateLimitInterceptor().intercept(ctx, next));
    await expect(async () =>
      lastValueFrom(new AgentRateLimitInterceptor().intercept(ctx, next)),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("isolates boards and sessions", async () => {
    setBoardRateLimit(1);
    setAgentSessionRateLimit(1);
    const first = context({
      auth: { via: "pat", apiTokenId: "t1" },
      originalUrl: "/api/v1/boards/b1",
      params: { id: "b1" },
      agentSession: { id: "s1" },
    });
    await lastValueFrom(
      new AgentRateLimitInterceptor().intercept(first.context, next),
    );

    // Same board, second agent session: the board bucket is exhausted.
    const second = context({
      auth: { via: "pat", apiTokenId: "t2" },
      originalUrl: "/api/v1/boards/b1",
      params: { id: "b1" },
      agentSession: { id: "s2" },
    });
    await expect(async () =>
      lastValueFrom(
        new AgentRateLimitInterceptor().intercept(second.context, next),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    // Another board and an unused session are independent.
    const other = context({
      auth: { via: "pat", apiTokenId: "t1" },
      originalUrl: "/api/v1/boards/b2",
      params: { id: "b2" },
      agentSession: { id: "s3" },
    });
    await expect(
      lastValueFrom(
        new AgentRateLimitInterceptor().intercept(other.context, next),
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("reads a session from the header, path or SSE query", () => {
    expect(boardIdOf({ originalUrl: "/api/v1/boards/b1/cards" } as never)).toBe(
      "b1",
    );
    expect(
      boardIdOf({
        originalUrl: "/api/v1/cards/c1/comments",
        boardMembership: { boardId: "resolved" },
      } as never),
    ).toBe("resolved");
    expect(
      boardIdOf({ originalUrl: "/api/v1/admin/boards/b9/metrics" } as never),
    ).toBe("b9");
    // `import` is an account route, not a board id.
    expect(
      boardIdOf({ originalUrl: "/api/v1/boards/import" } as never),
    ).toBeUndefined();
  });
});
