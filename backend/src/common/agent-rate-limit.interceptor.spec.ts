import {
  HttpException,
  type CallHandler,
  type ExecutionContext,
} from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import type { Response } from "express";
import {
  setAgentCommandQueueMs,
  setAgentSessionRateLimit,
  setAgentTokenRateLimit,
  setBoardRateLimit,
} from "@/config/rate-limit";
import { resetBoardCommandQueues } from "./board-rate-limit";
import { resetRateLimits } from "./rate-limit";
import {
  AgentRateLimitInterceptor,
  agentSessionIdOf,
  boardIdOf,
  isQueueableCommand,
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

async function run(ctx: ExecutionContext) {
  return lastValueFrom(
    await new AgentRateLimitInterceptor().intercept(ctx, next),
  );
}

/** Narrow a rejected value for assertions without weakening the test. */
function asHttpException(value: unknown): HttpException {
  expect(value).toBeInstanceOf(HttpException);
  return value as HttpException;
}

const next: CallHandler = { handle: () => of({ ok: true }) };

describe("AgentRateLimitInterceptor (TASK-166.10 / TASK-200.3)", () => {
  beforeEach(() => {
    resetRateLimits();
    resetBoardCommandQueues();
    setBoardRateLimit(null);
    setAgentSessionRateLimit(null);
    setAgentTokenRateLimit(null);
    setAgentCommandQueueMs(null);
  });

  afterEach(() => {
    setBoardRateLimit(null);
    setAgentSessionRateLimit(null);
    setAgentTokenRateLimit(null);
    setAgentCommandQueueMs(null);
    resetRateLimits();
    resetBoardCommandQueues();
  });

  it("leaves browser sessions on the legacy throttle", async () => {
    setBoardRateLimit(1);
    const { context: ctx, headers } = context({
      auth: { via: "jwt" },
      originalUrl: "/api/v1/boards/b1",
      params: { id: "b1" },
    });
    await expect(run(ctx)).resolves.toEqual({ ok: true });
    expect(headers.size).toBe(0);
    // A second request must still pass: no new browser bucket exists.
    await expect(run(ctx)).resolves.toEqual({ ok: true });
  });

  it("applies a board bucket to PAT traffic and returns headers", async () => {
    setBoardRateLimit(2);
    const { context: ctx, headers } = context({
      auth: { via: "pat", apiTokenId: "t1" },
      originalUrl: "/api/v1/boards/b1",
      params: { id: "b1" },
    });
    await run(ctx);
    // The token bucket's remaining (599) is looser than the board's, so the
    // response names the board.
    expect(headers.get("X-RateLimit-Limit")).toBe(2);
    expect(headers.get("X-RateLimit-Remaining")).toBe(1);
    expect(headers.get("X-RateLimit-Scope")).toBe("board");

    await run(ctx);
    await expect(run(ctx)).rejects.toMatchObject({ status: 429 });
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
    await run(first.context);

    // Same board, second agent session: the board bucket is exhausted.
    const second = context({
      auth: { via: "pat", apiTokenId: "t2" },
      originalUrl: "/api/v1/boards/b1",
      params: { id: "b1" },
      agentSession: { id: "s2" },
    });
    await expect(run(second.context)).rejects.toBeInstanceOf(HttpException);

    // Another board and an unused session are independent.
    const other = context({
      auth: { via: "pat", apiTokenId: "t1" },
      originalUrl: "/api/v1/boards/b2",
      params: { id: "b2" },
      agentSession: { id: "s3" },
    });
    await expect(run(other.context)).resolves.toEqual({ ok: true });
  });

  it("carries 100 agents on one board, then stops one noisy token", async () => {
    setBoardRateLimit(120);
    setAgentTokenRateLimit(20);

    // 100 sessions working one board: every one is inside both the board and
    // the per-session budget, so no 429 and no queueing.
    const agents = Array.from({ length: 100 }, (_, index) =>
      context({
        auth: { via: "pat", apiTokenId: `token-${index}` },
        originalUrl: "/api/v1/boards/swarm",
        params: { id: "swarm" },
        agentSession: { id: `session-${index}` },
      }),
    );
    await expect(
      Promise.all(agents.map((agent) => run(agent.context))),
    ).resolves.toHaveLength(100);

    // One abusive key burns its 20-request token budget.
    setAgentTokenRateLimit(2);
    const noisy = context({
      auth: { via: "pat", apiTokenId: "noisy" },
      originalUrl: "/api/v1/boards/swarm",
      params: { id: "swarm" },
      agentSession: { id: "noisy-session" },
    });
    await run(noisy.context);
    await run(noisy.context);
    const denied = asHttpException(
      await run(noisy.context).catch((error) => error),
    );
    expect(denied.getStatus()).toBe(429);
    expect(denied.getResponse()).toMatchObject({ scope: "token" });

    // A different token on the same board is still admitted.
    const quiet = context({
      auth: { via: "pat", apiTokenId: "quiet" },
      originalUrl: "/api/v1/boards/swarm",
      params: { id: "swarm" },
      agentSession: { id: "quiet-session" },
    });
    await expect(run(quiet.context)).resolves.toEqual({ ok: true });
  });

  it("queues command writes but answers 503 Retry-After when the wait is spent", async () => {
    setBoardRateLimit(1);
    setAgentCommandQueueMs(0);
    const command = context({
      auth: { via: "pat", apiTokenId: "t1" },
      method: "POST",
      originalUrl: "/api/v1/boards/b1/commands",
      params: { id: "b1" },
    });
    await expect(run(command.context)).resolves.toEqual({ ok: true });

    const second = context({
      auth: { via: "pat", apiTokenId: "t1" },
      method: "POST",
      originalUrl: "/api/v1/boards/b1/commands",
      params: { id: "b1" },
    });
    const denied = asHttpException(
      await run(second.context).catch((error) => error),
    );
    expect(denied.getStatus()).toBe(503);
    expect(denied.getResponse()).toMatchObject({
      code: "rate_limited",
      retryable: true,
      scope: "board",
    });
    expect(second.headers.get("Retry-After")).toBeGreaterThanOrEqual(1);
    expect(denied.getResponse()).toMatchObject({
      retryAfter: second.headers.get("Retry-After"),
    });

    // Reads on the same board keep the immediate 429 rather than queueing.
    const read = context({
      auth: { via: "pat", apiTokenId: "t1" },
      method: "GET",
      originalUrl: "/api/v1/boards/b1",
      params: { id: "b1" },
    });
    const readDenied = asHttpException(
      await run(read.context).catch((error) => error),
    );
    expect(readDenied.getStatus()).toBe(429);
  });

  it("uses only verified sessions, never untrusted path or query IDs", () => {
    expect(
      agentSessionIdOf({
        originalUrl: "/api/v1/boards/b1/agent-sessions/s1/heartbeat",
        params: { sessionId: "s1" },
      } as never),
    ).toBeUndefined();
    expect(
      agentSessionIdOf({
        originalUrl: "/api/v1/boards/b1/events?session=s1",
      } as never),
    ).toBeUndefined();
    expect(agentSessionIdOf({ rateLimitSessionId: "s1" } as never)).toBe("s1");
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

  it("queues only board command POSTs", () => {
    expect(
      isQueueableCommand({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands",
      }),
    ).toBe(true);
    expect(
      isQueueableCommand({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands/batch",
      }),
    ).toBe(true);
    expect(
      isQueueableCommand({
        method: "GET",
        originalUrl: "/api/v1/boards/b1/commands",
      }),
    ).toBe(false);
    expect(
      isQueueableCommand({
        method: "POST",
        originalUrl: "/api/v1/boards/b1/plans/apply",
      }),
    ).toBe(false);
    expect(
      isQueueableCommand({
        method: "POST",
        originalUrl: "/api/v1/cards/c1/comments",
      }),
    ).toBe(false);
  });
});
