import {
  applyRateLimitHeaders,
  consumeBoardRateLimit,
  rateLimitQueueException,
  resetRateLimits,
  trackedRateLimitBuckets,
  type RateLimitHeaderSink,
} from "./rate-limit";
import {
  BOARD_COMMAND_QUEUE_MAX_BYTES,
  BOARD_RATE_WAIT_MAX_STEPS,
  BoardCommandQueueAbortedError,
  BoardCommandQueueFullError,
  boardCommandQueueFullCount,
  boardCommandQueueStats,
  enqueueBoardCommand,
  resetBoardCommandQueues,
  trackedBoardCommandQueues,
  waitForBoardRateLimit,
} from "./board-rate-limit";
import { commandBodyBytes } from "./command-cost";

/**
 * TASK-200.3: the board bucket refills continuously, so a burst can wait for
 * the next slot instead of failing at a minute boundary.
 */
describe("consumeBoardRateLimit", () => {
  const T0 = 1_700_000_000_000;

  beforeEach(() => resetRateLimits());

  it("allows a full-minute burst, then refills smoothly", () => {
    // 60 req/min = one token per second.
    for (let i = 0; i < 60; i += 1) {
      expect(consumeBoardRateLimit("b1", 60, 60_000, T0).allowed).toBe(true);
    }
    const denied = consumeBoardRateLimit("b1", 60, 60_000, T0);
    expect(denied).toMatchObject({
      scope: "board",
      allowed: false,
      remaining: 0,
      retryAfter: 1,
    });
    expect(denied.nextTokenAt).toBe(T0 + 1_000);

    // Half a second later a request still cannot pass (half a token), but at
    // the one-second mark the bucket has refilled exactly one slot.
    expect(consumeBoardRateLimit("b1", 60, 60_000, T0 + 500).allowed).toBe(
      false,
    );
    expect(consumeBoardRateLimit("b1", 60, 60_000, T0 + 1_000).allowed).toBe(
      true,
    );
  });

  it("isolates boards and resets with the shared hook", () => {
    consumeBoardRateLimit("b1", 1, 60_000, T0);
    expect(consumeBoardRateLimit("b1", 1, 60_000, T0).allowed).toBe(false);
    expect(consumeBoardRateLimit("b2", 1, 60_000, T0).allowed).toBe(true);
    resetRateLimits("board");
    expect(consumeBoardRateLimit("b1", 1, 60_000, T0).allowed).toBe(true);
  });

  it("fails closed for a zero budget instead of dividing by zero", () => {
    const decision = consumeBoardRateLimit("b1", 0, 60_000, T0);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfter).toBe(60);
  });

  it("charges a batch by its command count", () => {
    // 60/min: a 10-command batch spends 10 tokens.
    const batch = consumeBoardRateLimit("b1", 60, 60_000, T0, 10);
    expect(batch).toMatchObject({ allowed: true, remaining: 50 });
    const rest = consumeBoardRateLimit("b1", 60, 60_000, T0, 50);
    expect(rest.allowed).toBe(true);
    expect(rest.remaining).toBe(0);
    // One more command now needs a whole refill token and is refused.
    expect(consumeBoardRateLimit("b1", 60, 60_000, T0).allowed).toBe(false);
    // A batch larger than the bucket cannot pass at once either.
    expect(consumeBoardRateLimit("b2", 5, 60_000, T0, 6).allowed).toBe(false);
  });

  it("does not refill when the clock moves backwards", () => {
    for (let i = 0; i < 60; i += 1) {
      consumeBoardRateLimit("b1", 60, 60_000, T0);
    }
    // Replaying an earlier timestamp must not rewind `updatedAt`; otherwise
    // the next forward tick would credit the same elapsed time twice.
    expect(consumeBoardRateLimit("b1", 60, 60_000, T0 - 1_000).allowed).toBe(
      false,
    );
    expect(consumeBoardRateLimit("b1", 60, 60_000, T0 + 500).allowed).toBe(
      false,
    );
    expect(consumeBoardRateLimit("b1", 60, 60_000, T0 + 1_000).allowed).toBe(
      true,
    );
  });

  it("reports RateLimit-Reset as the next token while a board token is free", () => {
    const headers = new Map<string, unknown>();
    const response: RateLimitHeaderSink = {
      setHeader: (name, value) => headers.set(name, value),
      getHeader: (name) =>
        headers.get(name) as string | number | string[] | undefined,
    };
    const board = consumeBoardRateLimit("b1", 60, 60_000, T0);
    expect(board.retryAfter).toBe(0);
    applyRateLimitHeaders(response, board);
    expect(headers.get("RateLimit-Reset")).toBe(0);
    expect(headers.get("X-RateLimit-Reset")).toBe(
      Math.ceil((T0 + 1_000) / 1000),
    );
  });

  it("bounds the continuously refilling board map", () => {
    for (let i = 0; i < 20_000; i += 1) {
      consumeBoardRateLimit(`b${i}`, 5, 60_000, T0);
    }
    expect(trackedRateLimitBuckets()).toBeLessThanOrEqual(20_000);
    expect(consumeBoardRateLimit("fresh", 5, 60_000, T0 + 1).allowed).toBe(
      true,
    );
  });
});

describe("waitForBoardRateLimit", () => {
  const T0 = 1_700_000_000_000;

  beforeEach(() => resetRateLimits());

  function fakeClock(start: number): {
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    sleeps: number[];
  } {
    let current = start;
    const sleeps: number[] = [];
    return {
      now: () => current,
      sleep: async (ms) => {
        sleeps.push(ms);
        current += ms;
      },
      sleeps,
    };
  }

  it("stops a frozen injected clock with a bounded wait, not a spin", async () => {
    for (let i = 0; i < 60; i += 1) {
      consumeBoardRateLimit("b1", 60, 60_000, T0);
    }
    let sleeps = 0;
    const outcome = await waitForBoardRateLimit("b1", {
      limit: 60,
      deadline: T0 + 1_500,
      now: () => T0,
      sleep: async () => {
        sleeps += 1;
      },
    });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.remaining).toBe(0);
    expect(sleeps).toBe(BOARD_RATE_WAIT_MAX_STEPS);
    // The frozen clock did not spend the token that will be available when a
    // real clock advances.
    expect(consumeBoardRateLimit("b1", 60, 60_000, T0 + 1_000).allowed).toBe(
      true,
    );
  });

  it("queues until the next token and reports the wait", async () => {
    for (let i = 0; i < 60; i += 1) {
      consumeBoardRateLimit("b1", 60, 60_000, T0);
    }
    const clock = fakeClock(T0);
    const outcome = await waitForBoardRateLimit("b1", {
      limit: 60,
      deadline: T0 + 1_500,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome.decision.allowed).toBe(true);
    expect(outcome.waitedMs).toBe(1_000);
    expect(clock.sleeps).toEqual([1_000]);
  });

  it("returns a 503-ready decision when the deadline passes first", async () => {
    for (let i = 0; i < 60; i += 1) {
      consumeBoardRateLimit("b1", 60, 60_000, T0);
    }
    const clock = fakeClock(T0);
    const outcome = await waitForBoardRateLimit("b1", {
      limit: 60,
      deadline: T0 + 500,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.remaining).toBe(0);
    expect(outcome.waitedMs).toBe(500);
    const exception = rateLimitQueueException(
      outcome.decision,
      "The board is busy",
    );
    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfter: 1,
      scope: "board",
    });
    // The token that became free at the deadline was not spent by the
    // exhausted waiter; the next request can still use it.
    expect(consumeBoardRateLimit("b1", 60, 60_000, T0 + 1_000).allowed).toBe(
      true,
    );
  });

  it("checks the deadline before the first consume", async () => {
    const clock = fakeClock(T0 + 2_000);
    const outcome = await waitForBoardRateLimit("b1", {
      limit: 2,
      deadline: T0 + 1_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.retryAfter).toBeGreaterThanOrEqual(1);
    expect(outcome.waitedMs).toBe(0);
    expect(clock.sleeps).toEqual([]);
    // The expired request did not spend one of the two tokens.
    expect(consumeBoardRateLimit("b1", 2, 60_000, T0 + 2_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("does not spend a token when the queue wait reaches the deadline", async () => {
    for (let i = 0; i < 60; i += 1) {
      consumeBoardRateLimit("b1", 60, 60_000, T0);
    }
    const clock = fakeClock(T0);
    const outcome = await waitForBoardRateLimit("b1", {
      limit: 60,
      deadline: T0 + 1_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.waitedMs).toBe(1_000);
    // Exactly one token refilled at the deadline; the waiter must leave it
    // for the retry rather than consuming it after its budget expired.
    expect(consumeBoardRateLimit("b1", 60, 60_000, T0 + 1_000).allowed).toBe(
      true,
    );
  });

  it("spends a batch's whole cost only when enough tokens are available", async () => {
    for (let i = 0; i < 60; i += 1) {
      consumeBoardRateLimit("b1", 60, 60_000, T0);
    }
    const clock = fakeClock(T0);
    const outcome = await waitForBoardRateLimit("b1", {
      limit: 60,
      cost: 2,
      deadline: T0 + 5_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome.decision.allowed).toBe(true);
    expect(outcome.waitedMs).toBe(2_000);
    expect(outcome.decision.remaining).toBe(0);
  });
});

describe("enqueueBoardCommand", () => {
  afterEach(() => resetBoardCommandQueues());

  it("admits waiters for one board in arrival order", async () => {
    const events: string[] = [];
    const first = enqueueBoardCommand("b1", async () => {
      events.push("a-start");
      await Promise.resolve();
      events.push("a-end");
    });
    const second = enqueueBoardCommand("b1", async () => {
      events.push("b-start");
      await Promise.resolve();
      events.push("b-end");
    });
    await Promise.all([first, second]);
    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    // The settled board entry is released.
    await Promise.resolve();
    expect(trackedBoardCommandQueues()).toBe(0);
  });

  it("does not wedge the queue when one waiter fails", async () => {
    await expect(
      enqueueBoardCommand("b1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(enqueueBoardCommand("b1", async () => "ok")).resolves.toBe(
      "ok",
    );
  });

  it("rejects a new waiter immediately when the board queue is full", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ran = false;
    const first = enqueueBoardCommand("b1", () => gate, { maxDepth: 1 });
    await expect(
      enqueueBoardCommand(
        "b1",
        async () => {
          ran = true;
          return "never";
        },
        { maxDepth: 1 },
      ),
    ).rejects.toBeInstanceOf(BoardCommandQueueFullError);
    expect(ran).toBe(false);
    release();
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    expect(trackedBoardCommandQueues()).toBe(0);
  });

  it("does not execute an aborted waiter", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = enqueueBoardCommand("b1", () => gate);
    const controller = new AbortController();
    let ran = false;
    const second = enqueueBoardCommand(
      "b1",
      async () => {
        ran = true;
        return "never";
      },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(second).rejects.toBeInstanceOf(BoardCommandQueueAbortedError);
    release();
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    expect(ran).toBe(false);
    expect(trackedBoardCommandQueues()).toBe(0);
  });

  it("rejects an oversized queued body even when depth has room", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = enqueueBoardCommand("b1", () => gate, {
      maxDepth: 4,
      bytes: 8,
      maxBytes: 10,
    });
    const error = await enqueueBoardCommand("b1", async () => "never", {
      maxDepth: 4,
      bytes: 5,
      maxBytes: 10,
    }).catch((reason) => reason);
    expect(error).toBeInstanceOf(BoardCommandQueueFullError);
    expect(error).toMatchObject({ reason: "bytes", depth: 1, bytes: 8 });
    expect(boardCommandQueueStats("b1")).toEqual({
      depth: 1,
      bytes: 8,
      links: 1,
    });
    release();
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    expect(boardCommandQueueStats("b1")).toEqual({
      depth: 0,
      bytes: 0,
      links: 0,
    });
  });

  it("accounts queued bytes and resets them when the queue drains", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = enqueueBoardCommand("b1", () => gate, { bytes: 4 });
    const second = enqueueBoardCommand("b1", async () => "ok", { bytes: 6 });
    expect(boardCommandQueueStats("b1")).toEqual({
      depth: 2,
      bytes: 10,
      links: 2,
    });
    expect(BOARD_COMMAND_QUEUE_MAX_BYTES).toBeGreaterThan(0);
    release();
    await Promise.all([first, second]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(boardCommandQueueStats("b1")).toEqual({
      depth: 0,
      bytes: 0,
      links: 0,
    });
  });

  it("enforces the byte cap on a compressed 100-command body", async () => {
    const body = {
      commands: Array.from({ length: 100 }, (_, index) => ({
        commandId: `cmd-${index}`,
        action: { type: "UPDATE_CARD", description: "x".repeat(1_024) },
      })),
    };
    const measured = commandBodyBytes({
      headers: { "content-encoding": "gzip", "content-length": "64" },
      body,
    });
    expect(measured).toBeGreaterThan(64);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const maxBytes = measured + 10;
    const first = enqueueBoardCommand("b1", () => gate, {
      maxDepth: 4,
      bytes: measured,
      maxBytes,
    });
    const error = await enqueueBoardCommand("b1", async () => "never", {
      maxDepth: 4,
      bytes: measured,
      maxBytes,
    }).catch((reason) => reason);
    expect(error).toBeInstanceOf(BoardCommandQueueFullError);
    expect(error).toMatchObject({ reason: "bytes" });
    release();
    await first;
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("bounds chained aborted nodes behind a gated head", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const head = enqueueBoardCommand("b1", () => gate, {
      maxDepth: 2,
      maxChain: 3,
    });
    let abortedCount = 0;
    let chainRejects = 0;
    for (let index = 0; index < 5; index += 1) {
      const controller = new AbortController();
      const waiter = enqueueBoardCommand("b1", async () => "never", {
        signal: controller.signal,
        maxDepth: 2,
        maxChain: 3,
      });
      controller.abort();
      const reason = await waiter.catch((error) => error);
      if (reason instanceof BoardCommandQueueAbortedError) abortedCount += 1;
      if (reason instanceof BoardCommandQueueFullError) chainRejects += 1;
    }
    expect(abortedCount).toBe(2);
    expect(chainRejects).toBe(3);
    expect(boardCommandQueueStats("b1")).toMatchObject({
      depth: 1,
      links: 3,
    });
    const full = await enqueueBoardCommand("b1", async () => "never", {
      maxDepth: 2,
      maxChain: 3,
    }).catch((reason) => reason);
    expect(full).toBeInstanceOf(BoardCommandQueueFullError);
    expect(full).toMatchObject({ reason: "chain" });
    expect(boardCommandQueueFullCount()).toBeGreaterThan(0);
    release();
    await head;
    await new Promise((resolve) => setImmediate(resolve));
    expect(boardCommandQueueStats("b1")).toEqual({
      depth: 0,
      bytes: 0,
      links: 0,
    });
  });

  it("releases an aborted waiter's slot, so a later command is accepted", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    // maxDepth 1: while this waiter is alive the queue has no room.
    const aborted = enqueueBoardCommand("b1", () => gate, {
      signal: controller.signal,
      maxDepth: 1,
    });
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(BoardCommandQueueAbortedError);
    expect(boardCommandQueueStats("b1")).toEqual({
      depth: 0,
      bytes: 0,
      links: 1,
    });

    // The aborted waiter's chained task is still behind the gate, but it is
    // released and must not reserve the slot or run its command.
    let ran = false;
    const later = enqueueBoardCommand(
      "b1",
      async () => {
        ran = true;
        return "ok";
      },
      { maxDepth: 1 },
    );
    release();
    await expect(later).resolves.toBe("ok");
    expect(ran).toBe(true);
  });

  it("rejects an already-aborted waiter before it enters the queue", async () => {
    const controller = new AbortController();
    controller.abort();
    const task = jest.fn(async () => "never");
    await expect(
      enqueueBoardCommand("b1", task, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(BoardCommandQueueAbortedError);
    expect(task).not.toHaveBeenCalled();
    expect(trackedBoardCommandQueues()).toBe(0);
  });
});
