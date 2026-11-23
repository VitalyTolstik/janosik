import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ThrottlerStorageService } from "@nestjs/throttler";
import Redis from "ioredis";
import { env } from "@/config/env";
import { RedisThrottlerStorage } from "./redis-throttler-storage";

/** DI token for the shared storage, so the lifecycle hook can close it. */
export const SHARED_THROTTLER_STORAGE = Symbol("SHARED_THROTTLER_STORAGE");

export interface SharedThrottler {
  storage: RedisThrottlerStorage;
  client: Redis;
}

/**
 * TASK-200.12: the optional Redis-backed global throttler.
 *
 * `REDIS_URL` empty (a bare single-replica self-host) → `undefined`, and the
 * stock in-process `@nestjs/throttler` storage is used. Set → every replica
 * counts the same (principal, window) keys in Redis, so N replicas do not
 * multiply `THROTTLE_LIMIT`. The adapter fails open to the in-process storage
 * if Redis goes away; see `RedisThrottlerStorage`.
 *
 * The client is created lazily, so a configured-but-idle self-host opens no
 * connection until the first rate-limited request.
 */
export function createSharedThrottlerStorage(
  url: string = env.REDIS_URL,
): SharedThrottler | undefined {
  if (url.trim() === "") return undefined;
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    commandTimeout: 500,
    lazyConnect: true,
  });
  return {
    storage: new RedisThrottlerStorage(client, new ThrottlerStorageService()),
    client,
  };
}

/**
 * Close the shared throttler connection on application shutdown (TASK-200.12).
 * `RedisThrottlerStorage` is not a Nest provider itself, so without this hook
 * its ioredis socket would keep the process alive after `app.close()` and a
 * rolling restart would wait for SIGKILL.
 */
@Injectable()
export class SharedThrottlerShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(SHARED_THROTTLER_STORAGE)
    private readonly storage: RedisThrottlerStorage,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.storage.close();
  }
}
