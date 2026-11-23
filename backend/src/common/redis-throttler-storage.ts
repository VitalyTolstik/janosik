import { Logger } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type Redis from "ioredis";

/**
 * The handful of Redis methods this adapter needs. Keeping them explicit
 * makes the unit tests trivially fakeable and documents that the adapter
 * never reaches for a connection of its own.
 */
type RedisThrottlerClient = Pick<Redis, "eval"> &
  Partial<Pick<Redis, "quit" | "disconnect">> & {
    status?: string;
  };

type ShutdownableThrottlerStorage = ThrottlerStorage & {
  onApplicationShutdown?: () => void;
};

/**
 * Shared throttler counters (B-8). With the default in-memory storage every
 * node counts on its own, so N nodes silently multiply the limit by N. When
 * `REDIS_URL` is set the counters live in Redis instead, one fixed window
 * per key, updated atomically by a single script:
 *
 * KEYS[1] hit counter, KEYS[2] block marker;
 * ARGV ttl ms, limit, block duration ms.
 * Returns {hits, ttl ms, blocked 0/1, block ttl ms}.
 */
const SCRIPT = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then
  local ttl = redis.call('PTTL', KEYS[1])
  return {tonumber(redis.call('GET', KEYS[1]) or '0'), ttl, 1, blocked}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}
`;

const PREFIX = "janosik:throttle:";

/**
 * Fails open to `fallback` (the in-process storage) when Redis errors: a
 * Redis outage must degrade rate limiting to per-node, never turn every
 * request into a 500.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastWarnAt = 0;

  constructor(
    private readonly redis: RedisThrottlerClient,
    private readonly fallback: ThrottlerStorage,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    const base = `${PREFIX}${throttlerName}:${key}`;
    let reply: [number, number, number, number];
    try {
      reply = (await this.redis.eval(
        SCRIPT,
        2,
        `${base}:hits`,
        `${base}:block`,
        String(ttl),
        String(limit),
        String(Math.max(1, blockDuration)),
      )) as [number, number, number, number];
    } catch (error) {
      if (Date.now() - this.lastWarnAt > 60_000) {
        this.lastWarnAt = Date.now();
        this.logger.warn(
          `Redis throttler storage unavailable, counting in-process: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
    const [hits, ttlMs, blocked, blockMs] = reply;
    return {
      totalHits: hits,
      // The throttler reports these in seconds (Retry-After).
      timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(blockMs / 1000)),
    };
  }

  /**
   * Release the shared connection and any fallback timers at shutdown
   * (TASK-200.12). Without this the ioredis socket keeps the Node process
   * alive after `app.close()`, so a Compose rollout would always end in
   * SIGKILL instead of a graceful stop.
   */
  async close(): Promise<void> {
    (this.fallback as ShutdownableThrottlerStorage).onApplicationShutdown?.();
    const client = this.redis;
    // A lazy, never-used connection has nothing to wait for; do not open one
    // just to close it.
    if (client.status === "wait" || client.status === "end") {
      client.disconnect?.();
      return;
    }
    if (typeof client.quit === "function") {
      const quit = client.quit.bind(client);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        timer.unref?.();
        void quit()
          .catch(() => undefined)
          .finally(() => {
            clearTimeout(timer);
            resolve();
          });
      });
    }
    // If Redis did not answer within the grace window, close the socket so a
    // rolling restart is never held hostage by a dead dependency.
    client.disconnect?.();
  }
}
