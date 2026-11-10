import { HttpException } from "@nestjs/common";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  mirrorStandardRateLimitHeaders,
  rateLimitException,
  resetRateLimits,
  trackedRateLimitBuckets,
  type RateLimitHeaderSink,
} from "./rate-limit";

/** TASK-166.10: scoped buckets, headers and the429 payload. */
describe("consumeRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("counts one window and reports limit/remaining/reset", () => {
    const now = 1_700_000_000_000;
    const first = consumeRateLimit("token", "t1", 2, 60_000, now);
    expect(first).toMatchObject({
      scope: "token",
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAt: now + 60_000,
      retryAfter: 60,
    });
    const second = consumeRateLimit("token", "t1", 2, 60_000, now + 1_000);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    const third = consumeRateLimit("token", "t1", 2, 60_000, now + 2_000);
    expect(third.allowed).toBe(false);
    expect(third.retryAfter).toBe(58);
  });

  it("isolates scopes and ids", () => {
    const now = 1_700_000_000_000;
    consumeRateLimit("token", "a", 1, 60_000, now);
    expect(consumeRateLimit("token", "a", 1, 60_000, now).allowed).toBe(false);
    expect(consumeRateLimit("token", "b", 1, 60_000, now).allowed).toBe(true);
    expect(consumeRateLimit("session", "a", 1, 60_000, now).allowed).toBe(true);
    expect(consumeRateLimit("board", "a", 1, 60_000, now).allowed).toBe(true);
  });

  it("starts a fresh bucket after the window resets", () => {
    const now = 1_700_000_000_000;
    consumeRateLimit("board", "b1", 1, 60_000, now);
    expect(
      consumeRateLimit("board", "b1", 1, 60_000, now + 59_999).allowed,
    ).toBe(false);
    expect(
      consumeRateLimit("board", "b1", 1, 60_000, now + 60_000).allowed,
    ).toBe(true);
  });

  it("bounds the map by evicting expired and then oldest buckets", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < 20_000; i += 1) {
      consumeRateLimit("session", `s${i}`, 5, 60_000, now);
    }
    expect(trackedRateLimitBuckets()).toBeLessThanOrEqual(20_000);
    // A new bucket is still accepted rather than throwing.
    expect(
      consumeRateLimit("session", "fresh", 5, 60_000, now + 1).allowed,
    ).toBe(true);
  });
});

/** A tiny response double for the header contract. */
function responseSink(): RateLimitHeaderSink & {
  headers: Map<string, unknown>;
} {
  const headers = new Map<string, unknown>();
  return {
    headers,
    setHeader(name, value) {
      headers.set(name, value);
    },
    getHeader(name) {
      return headers.get(name) as string | number | string[] | undefined;
    },
  };
}

describe("applyRateLimitHeaders", () => {
  beforeEach(() => resetRateLimits());

  it("writes X-RateLimit-*, RateLimit-* and no Retry-After when allowed", () => {
    const decision = consumeRateLimit(
      "token",
      "t1",
      10,
      60_000,
      1_700_000_000_000,
    );
    const response = responseSink();
    applyRateLimitHeaders(response, decision);

    expect(response.headers.get("X-RateLimit-Limit")).toBe(10);
    expect(response.headers.get("X-RateLimit-Remaining")).toBe(9);
    expect(response.headers.get("X-RateLimit-Reset")).toBe(1_700_000_060);
    expect(response.headers.get("X-RateLimit-Scope")).toBe("token");
    expect(response.headers.get("RateLimit-Limit")).toBe(10);
    expect(response.headers.get("RateLimit-Remaining")).toBe(9);
    expect(response.headers.get("RateLimit-Reset")).toBe(60);
    expect(response.headers.has("Retry-After")).toBe(false);
  });

  it("adds Retry-After on a denied request", () => {
    consumeRateLimit("session", "s1", 1, 60_000, 1_700_000_000_000);
    const denied = consumeRateLimit(
      "session",
      "s1",
      1,
      60_000,
      1_700_000_001_000,
    );
    const response = responseSink();
    applyRateLimitHeaders(response, denied);
    expect(response.headers.get("Retry-After")).toBe(59);
    expect(response.headers.get("X-RateLimit-Remaining")).toBe(0);
  });

  it("keeps a tighter legacy header instead of advertising a looser bucket", () => {
    const response = responseSink();
    response.setHeader("X-RateLimit-Limit", 100);
    const board = consumeRateLimit("board", "b1", 600);
    applyRateLimitHeaders(response, board, { onlyIfTighter: true });
    expect(response.headers.get("X-RateLimit-Limit")).toBe(100);
    expect(response.headers.has("X-RateLimit-Scope")).toBe(false);
  });

  it("overwrites at equal or tighter ceilings", () => {
    const response = responseSink();
    response.setHeader("X-RateLimit-Limit", 600);
    const board = consumeRateLimit("board", "b1", 600);
    applyRateLimitHeaders(response, board, { onlyIfTighter: true });
    expect(response.headers.get("X-RateLimit-Scope")).toBe("board");
  });

  it("mirrors the legacy X-RateLimit budget into the standard names", () => {
    const response = responseSink();
    response.setHeader("X-RateLimit-Limit", "300");
    response.setHeader("X-RateLimit-Remaining", "12");
    response.setHeader("X-RateLimit-Reset", "45");
    mirrorStandardRateLimitHeaders(response);
    expect(response.headers.get("RateLimit-Limit")).toBe(300);
    expect(response.headers.get("RateLimit-Remaining")).toBe(12);
    expect(response.headers.get("RateLimit-Reset")).toBe(45);

    // An agent bucket already published wins over the mirror.
    response.setHeader("RateLimit-Limit", 2);
    mirrorStandardRateLimitHeaders(response);
    expect(response.headers.get("RateLimit-Limit")).toBe(2);
  });
});

describe("rateLimitException", () => {
  beforeEach(() => resetRateLimits());

  it("is a 429 with the stable envelope fields", () => {
    const decision = consumeRateLimit("board", "b1", 1);
    consumeRateLimit("board", "b1", 1);
    const denied = consumeRateLimit("board", "b1", 1);
    const exception = rateLimitException(
      denied,
      "Too many requests for this board",
    );
    expect(exception).toBeInstanceOf(HttpException);
    expect(exception.getStatus()).toBe(429);
    expect(exception.getResponse()).toMatchObject({
      message: "Too many requests for this board",
      code: "rate_limited",
      retryable: true,
      retryAfter: expect.any(Number),
      limit: 1,
      scope: "board",
    });
    expect(decision.allowed).toBe(true);
  });
});
