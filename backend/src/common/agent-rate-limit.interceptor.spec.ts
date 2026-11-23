import {
  HttpException,
  Logger,
  type CallHandler,
  type ExecutionContext,
} from "@nestjs/common";
import { EventEmitter } from "node:events";
import { lastValueFrom, of } from "rxjs";
import type { Response } from "express";
import {
  setAgentCommandQueueMs,
  setAgentSessionRateLimit,
  setAgentTokenRateLimit,
  setBoardRateLimit,
} from "@/config/rate-limit";
import {
  enqueueBoardCommand,
  resetBoardCommandQueues,
  trackedBoardCommandQueues,
} from "./board-rate-limit";
import { resetRateLimits } from "./rate-limit";
import {
  AgentRateLimitInterceptor,
  agentSessionIdOf,
  boardIdOf,
  isQueueableCommand,
} from "./agent-rate-limit.interceptor";

function context(requestInit: Record<string, unknown>) {
  const headers = new Map<string, unknown>();
  const request = Object.assign(new EventEmitter(), requestInit);
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    setHeader: (name: string, value: unknown) => headers.set(name, value),
    getHeader: (name: string) => headers.get(name),
  }) as unknown as Response;
  const http = {
    getRequest: () => request,
    getResponse: () => response,
  };
  return {
    headers,
    request,
    response,
    context: {
      getType: () => "http",
      switchToHttp: () => http,
    } as unknown as ExecutionContext,
  };
}

async function run(ctx: ExecutionContext, handler: CallHandler = next) {
  return lastValueFrom(
    await new AgentRateLimitInterceptor().intercept(ctx, handler),
  );
}

/** Narrow a rejected value for assertions without weakening the test. */
function asHttpException(value: unknown): HttpException {
  expect(value).toBeInstanceOf(HttpException);
  return value as HttpException;
}

const next: CallHandler = { handle: () => of({ ok: true }) };

function batchCommands(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    commandId: `cmd-${index}`,
    action: { type: "RENAME_BOARD" },
  }));
}

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
    // The derived token bucket is looser than the board's, so the response
    // names the board.
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

    // One abusive key burns its two-request token budget.
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

  it("charges a batch by its command count on the board budget", async () => {
    setBoardRateLimit(4);
    setAgentTokenRateLimit(100);
    setAgentCommandQueueMs(0);
    const batch = (commandCount: number) =>
      context({
        auth: { via: "pat", apiTokenId: "batch-token" },
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands/batch",
        params: { id: "b1" },
        body: { commands: batchCommands(commandCount) },
      });

    const first = batch(2);
    await expect(run(first.context)).resolves.toEqual({ ok: true });
    expect(first.headers.get("X-RateLimit-Remaining")).toBe(2);

    const single = context({
      auth: { via: "pat", apiTokenId: "batch-token" },
      method: "POST",
      originalUrl: "/api/v1/boards/b1/commands",
      params: { id: "b1" },
      body: { action: {} },
    });
    await expect(run(single.context)).resolves.toEqual({ ok: true });

    // Two more commands need two tokens; only one is left, and a queue wait
    // of zero must answer 503 instead of admitting the amplified request.
    const denied = asHttpException(
      await run(batch(2).context).catch((error) => error),
    );
    expect(denied.getStatus()).toBe(503);
    expect(denied.getResponse()).toMatchObject({
      code: "rate_limited",
      scope: "board",
      retryable: true,
    });

    // The batch's weight also applies to its token budget.
    resetRateLimits();
    setBoardRateLimit(1000);
    setAgentTokenRateLimit(3);
    await expect(run(batch(2).context)).resolves.toEqual({ ok: true });
    const tokenDenied = asHttpException(
      await run(batch(2).context).catch((error) => error),
    );
    expect(tokenDenied.getStatus()).toBe(429);
    expect(tokenDenied.getResponse()).toMatchObject({ scope: "token" });

    // The batch's weight also applies to its session budget.
    resetRateLimits();
    setBoardRateLimit(1_000);
    setAgentTokenRateLimit(100);
    setAgentSessionRateLimit(3);
    const sessionBatch = (commandCount: number) =>
      context({
        auth: { via: "pat", apiTokenId: "session-batch-token" },
        agentSession: { id: "session-batch" },
        method: "POST",
        originalUrl: "/api/v1/boards/b1/commands/batch",
        params: { id: "b1" },
        body: { commands: batchCommands(commandCount) },
      });
    await expect(run(sessionBatch(2).context)).resolves.toEqual({ ok: true });
    const sessionDenied = asHttpException(
      await run(sessionBatch(2).context).catch((error) => error),
    );
    expect(sessionDenied.getStatus()).toBe(429);
    expect(sessionDenied.getResponse()).toMatchObject({ scope: "session" });

    // A parallel quiet token still fits on the same board.
    setAgentSessionRateLimit(null);
    const quiet = context({
      auth: { via: "pat", apiTokenId: "quiet-batch-token" },
      method: "POST",
      originalUrl: "/api/v1/boards/b1/commands/batch",
      params: { id: "b1" },
      body: { commands: batchCommands(1) },
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
    expect(Number(second.headers.get("X-RateLimit-Queued-Ms"))).toBeLessThan(
      100,
    );
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

  it("sets X-RateLimit-Queued-Ms to zero and samples a full-queue log", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    setBoardRateLimit(1);
    setAgentCommandQueueMs(0);
    const first = context({
      auth: { via: "pat", apiTokenId: "full-token" },
      method: "POST",
      originalUrl: "/api/v1/boards/b1/commands",
      params: { id: "b1" },
    });
    await expect(run(first.context)).resolves.toEqual({ ok: true });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiters = Array.from({ length: 64 }, () =>
      enqueueBoardCommand("b1", () => gate),
    );
    // Reuse one interceptor so the 10 s sampling window is exercised.
    const interceptor = new AgentRateLimitInterceptor();
    const runShared = async (ctx: ExecutionContext) =>
      lastValueFrom(await interceptor.intercept(ctx, next));
    const full = context({
      auth: { via: "pat", apiTokenId: "full-token" },
      method: "POST",
      originalUrl: "/api/v1/boards/b1/commands",
      params: { id: "b1" },
    });
    const error = asHttpException(
      await runShared(full.context).catch((reason) => reason),
    );
    expect(error.getStatus()).toBe(503);
    expect(full.headers.get("X-RateLimit-Queued-Ms")).toBe(0);
    const secondFull = context({
      auth: { via: "pat", apiTokenId: "full-token" },
      method: "POST",
      originalUrl: "/api/v1/boards/b1/commands",
      params: { id: "b1" },
    });
    await expect(runShared(secondFull.context)).rejects.toMatchObject({
      status: 503,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("command queue full (depth)"),
    );
    warn.mockRestore();
    release();
    await Promise.all(waiters);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("drops a queued command when the client aborts the request", async () => {
    setBoardRateLimit(1);
    setAgentCommandQueueMs(30_000);
    const command = {
      auth: { via: "pat", apiTokenId: "abort-token" },
      method: "POST",
      originalUrl: "/api/v1/boards/b1/commands",
      params: { id: "b1" },
    };
    await expect(run(context(command).context)).resolves.toEqual({ ok: true });

    const handler: CallHandler = { handle: jest.fn(() => of({ ok: true })) };
    const second = context(command);
    const pending = run(second.context, handler).catch((error) => error);
    await new Promise((resolve) => setImmediate(resolve));
    expect(trackedBoardCommandQueues()).toBe(1);
    second.request.emit("aborted");

    const error = asHttpException(await pending);
    expect(error.getStatus()).toBe(408);
    expect(Number(second.headers.get("X-RateLimit-Queued-Ms"))).toBeLessThan(
      100,
    );
    expect(handler.handle).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    expect(trackedBoardCommandQueues()).toBe(0);
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
    // `import`, `ready` and `search` are account/workspace routes, not board
    // ids for rate-limit attribution.
    for (const path of [
      "/api/v1/boards/import",
      "/api/v1/boards/ready",
      "/api/v1/boards/search",
    ]) {
      expect(boardIdOf({ originalUrl: path } as never)).toBeUndefined();
    }
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
