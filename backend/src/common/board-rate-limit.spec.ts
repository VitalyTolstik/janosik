import {
  consumeBoardRateLimit,
  rateLimitQueueException,
  resetRateLimits,
} from "./rate-limit";
import {
  enqueueBoardCommand,
  resetBoardCommandQueues,
  trackedBoardCommandQueues,
  waitForBoardRateLimit,
} from "./board-rate-limit";

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
});
