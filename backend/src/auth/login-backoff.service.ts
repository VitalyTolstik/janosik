import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import Redis from "ioredis";
import { env } from "@/config/env";

/** Failures tolerated before the account starts backing off (the 5th locks). */
export const LOGIN_FREE_ATTEMPTS = 5;
/** First lock after the free attempts; doubles per further failure. */
export const LOGIN_BASE_LOCK_MS = 30_000;
/** Ceiling of a single lock. */
export const LOGIN_MAX_LOCK_MS = 15 * 60 * 1000;
/** Failures older than this are forgotten. */
const FAILURE_WINDOW_MS = 60 * 60 * 1000;
/** In-memory map bound (without Redis). */
const MEMORY_MAX = 50_000;

interface FailureState {
  failures: number;
  lockedUntil: number;
  expiresAt: number;
}

/**
 * Per-account login backoff (B-8). The IP throttler alone does not stop a
 * distributed guesser (one try per IP), nor does it protect one account
 * from a botnet. After `LOGIN_FREE_ATTEMPTS` wrong passwords for the *same
 * email* the address is locked for an exponentially growing time
 * (30 s → 60 s → … ≤ 15 min); a successful login clears it.
 *
 * Keyed by the normalized email whether or not an account exists, so the
 * lock itself is no existence oracle. Shared through Redis when configured
 * (all nodes see one counter), else held in a bounded in-process map.
 */
@Injectable()
export class LoginBackoffService implements OnModuleDestroy {
  private readonly logger = new Logger(LoginBackoffService.name);
  private readonly memory = new Map<string, FailureState>();
  private readonly redis: Redis | null =
    env.REDIS_URL.trim().length > 0
      ? new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          commandTimeout: 500,
          lazyConnect: true,
        })
      : null;

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }

  /** Throws 429 while the address is locked. */
  async assertNotLocked(email: string): Promise<void> {
    const state = await this.read(this.key(email));
    const now = Date.now();
    if (state !== null && state.lockedUntil > now) {
      const retryAfter = Math.ceil((state.lockedUntil - now) / 1000);
      throw new HttpException(
        {
          message: `Too many failed sign-in attempts — try again in ${retryAfter} s`,
          code: "login_backoff",
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(email: string): Promise<void> {
    const key = this.key(email);
    const now = Date.now();
    if (this.redis !== null) {
      try {
        await this.redis.eval(
          `
          local raw = redis.call('GET', KEYS[1])
          local previous = raw and cjson.decode(raw) or { failures = 0 }
          local failures = previous.failures + 1
          local over = failures - tonumber(ARGV[2]) + 1
          local untilTime = 0
          if over > 0 then untilTime = tonumber(ARGV[1]) + math.min(tonumber(ARGV[4]), tonumber(ARGV[3]) * 2 ^ (over - 1)) end
          redis.call('SET', KEYS[1], cjson.encode({failures=failures, lockedUntil=untilTime, expiresAt=tonumber(ARGV[1])+tonumber(ARGV[5])}), 'PX', ARGV[5])
        `,
          1,
          key,
          now,
          LOGIN_FREE_ATTEMPTS,
          LOGIN_BASE_LOCK_MS,
          LOGIN_MAX_LOCK_MS,
          FAILURE_WINDOW_MS,
        );
        return;
      } catch (error) {
        this.warn(error);
      }
    }
    const existing = this.memory.get(key);
    const previous = existing && existing.expiresAt > now ? existing : null;
    const failures = (previous?.failures ?? 0) + 1;
    // The LOGIN_FREE_ATTEMPTS-th failure starts the first lock.
    const over = failures - LOGIN_FREE_ATTEMPTS + 1;
    const lockedUntil =
      over > 0
        ? now +
          Math.min(LOGIN_MAX_LOCK_MS, LOGIN_BASE_LOCK_MS * 2 ** (over - 1))
        : 0;
    if (this.memory.size >= MEMORY_MAX) this.prune();
    this.memory.delete(key);
    this.memory.set(key, {
      failures,
      lockedUntil,
      expiresAt: now + FAILURE_WINDOW_MS,
    });
  }

  async reset(email: string): Promise<void> {
    const key = this.key(email);
    this.memory.delete(key);
    await this.redis?.del(key).catch(() => undefined);
  }

  private key(email: string): string {
    const normalized = email.trim().toLowerCase();
    return `janosik:login-backoff:${createHash("sha256").update(normalized).digest("hex")}`;
  }

  private async read(key: string): Promise<FailureState | null> {
    if (this.redis !== null) {
      try {
        const raw = await this.redis.get(key);
        return raw === null ? null : (JSON.parse(raw) as FailureState);
      } catch (error) {
        this.warn(error);
      }
    }
    const state = this.memory.get(key);
    if (state === undefined) return null;
    if (state.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return state;
  }

  /** Drop expired entries; if still full, the oldest ones. */
  private prune(): void {
    const now = Date.now();
    for (const [key, state] of this.memory) {
      if (state.expiresAt <= now) this.memory.delete(key);
    }
    for (const key of this.memory.keys()) {
      if (this.memory.size < MEMORY_MAX) break;
      this.memory.delete(key);
    }
  }

  private warn(error: unknown): void {
    this.logger.warn(
      `Login backoff store unavailable, using memory: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
