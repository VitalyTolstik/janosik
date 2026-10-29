import type { ExecutionContext } from "@nestjs/common";
import { ShareThrottlerGuard } from "./share-throttler.guard";

/** TASK-146/TASK-147 follow-up: token shape keying and true-LRU eviction. */
function ctx(
  token: string,
  ip = "1.1.1.1",
  handler = "board",
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params: { token }, ip }) }),
    getHandler: () => ({ name: handler }),
  } as unknown as ExecutionContext;
}

/** White-box view of the private bucket table. */
function buckets(guard: ShareThrottlerGuard): Map<string, unknown> {
  return (guard as unknown as { buckets: Map<string, unknown> }).buckets;
}

describe("ShareThrottlerGuard", () => {
  it("keys a malformed token by IP, a valid one by token", () => {
    const guard = new ShareThrottlerGuard();
    // Test SHARE_RATE_LIMIT is 50: 50 malformed paths from one IP share a
    // bucket, the 51st trips it.
    for (let index = 0; index < 50; index += 1) {
      expect(guard.canActivate(ctx(`bad${index}`))).toBe(true);
    }
    expect(() => guard.canActivate(ctx("still-bad"))).toThrow();
    // A real-shaped token gets its own budget, untouched by the IP flood.
    expect(guard.canActivate(ctx("A".repeat(20)))).toBe(true);
  });

  it("evicts least-recently-used buckets, not the oldest inserted", () => {
    const guard = new ShareThrottlerGuard();
    const map = buckets(guard);
    const max = 10_000;
    const token = (index: number): string =>
      `t${index.toString().padStart(15, "0")}`;
    for (let index = 0; index < max; index += 1) {
      guard.canActivate(ctx(token(index)));
    }
    expect(map.size).toBe(max);
    // Touch the first bucket: it moves to the most-recently-used end.
    guard.canActivate(ctx(token(0)));
    // One more distinct token forces an eviction: the LRU is now t1, not t0.
    guard.canActivate(ctx(token(9_999_999)));
    expect(map.has(`share:${token(0)}`)).toBe(true);
    expect(map.has(`share:${token(1)}`)).toBe(false);
  });
});
