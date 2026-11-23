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

  it("counts two replicas against one Redis window", async () => {
    // Minimal shared backend: enough of the Lua contract to prove that both
    // adapters address the same keys and therefore share a limit.
    const hits = new Map<string, number>();
    const evalScript = jest.fn(
      async (
        _script: string,
        _keys: number,
        hitKey: string,
        _blockKey: string,
        ttl: string,
        limit: string,
        blockMs: string,
      ) => {
        const total = (hits.get(hitKey) ?? 0) + 1;
        hits.set(hitKey, total);
        return total > Number(limit)
          ? [total, Number(ttl), 1, Number(blockMs)]
          : [total, Number(ttl), 0, 0];
      },
    );
    const first = new RedisThrottlerStorage(
      { eval: evalScript } as never,
      new ThrottlerStorageService(),
    );
    const second = new RedisThrottlerStorage(
      { eval: evalScript } as never,
      new ThrottlerStorageService(),
    );

    const a = await first.increment("user:u1", 60_000, 2, 60_000, "default");
    const b = await second.increment("user:u1", 60_000, 2, 60_000, "default");
    const c = await first.increment("user:u1", 60_000, 2, 60_000, "default");

    expect([a.totalHits, b.totalHits, c.totalHits]).toEqual([1, 2, 3]);
    expect(c.isBlocked).toBe(true);
    expect(evalScript.mock.calls[1]?.[2]).toBe(
      "janosik:throttle:default:user:u1:hits",
    );
  });

  it("closes the Redis connection and clears fallback timers on shutdown", async () => {
    const quit = jest.fn().mockResolvedValue("OK");
    const fallback = new ThrottlerStorageService();
    const shutdown = jest.spyOn(fallback, "onApplicationShutdown");
    const storage = new RedisThrottlerStorage(
      { eval: jest.fn(), quit } as never,
      fallback,
    );

    await storage.close();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("does not open a lazy connection just to close it", async () => {
    const quit = jest.fn().mockResolvedValue("OK");
    const disconnect = jest.fn();
    const fallback = new ThrottlerStorageService();
    const storage = new RedisThrottlerStorage(
      { eval: jest.fn(), quit, disconnect, status: "wait" } as never,
      fallback,
    );

    await storage.close();

    expect(quit).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    fallback.onApplicationShutdown();
  });
});
