import { ThrottlerStorageService } from "@nestjs/throttler";
import { RedisThrottlerStorage } from "./redis-throttler-storage";

describe("RedisThrottlerStorage (B-8)", () => {
  it("maps the script reply to a throttler record (seconds)", async () => {
    const redis = { eval: jest.fn().mockResolvedValue([7, 42_100, 0, 0]) };
    const storage = new RedisThrottlerStorage(
      redis as never,
      new ThrottlerStorageService(),
    );
    const record = await storage.increment(
      "user:u1",
      60_000,
      300,
      60_000,
      "default",
    );
    expect(record).toEqual({
      totalHits: 7,
      timeToExpire: 43,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(redis.eval.mock.calls[0].slice(1, 4)).toEqual([
      2,
      "janosik:throttle:default:user:u1:hits",
      "janosik:throttle:default:user:u1:block",
    ]);
  });

  it("fails open to the in-process storage when Redis errors", async () => {
    const redis = { eval: jest.fn().mockRejectedValue(new Error("down")) };
    const fallback = new ThrottlerStorageService();
    const storage = new RedisThrottlerStorage(redis as never, fallback);
    const record = await storage.increment(
      "ip:1",
      60_000,
      10,
      60_000,
      "default",
    );
    expect(record.totalHits).toBe(1);
    expect(record.isBlocked).toBe(false);
    fallback.onApplicationShutdown();
  });
});
