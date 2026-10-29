import {
  HttpException,
  HttpStatus,
  Injectable,
  type OnModuleDestroy,
} from "@nestjs/common";
import Redis from "ioredis";
import { env } from "@/config/env";
import { PrismaService } from "@/common/prisma/prisma.service";

export interface HealthReport {
  status: "ok" | "error";
  db: "up" | "down";
  /** `disabled` when no Redis is configured (bare self-host, ROADMAP §7.11). */
  redis: "up" | "down" | "disabled";
}

export interface HealthLiveness {
  status: "ok";
}

const REDIS_PING_TIMEOUT_MS = 1_000;
/**
 * Readiness is cached this long (TASK-147, B2). A k8s probe, a compose
 * healthcheck and a load balancer can all poll at once; without a cache every
 * poll opens a DB query and a Redis ping, and a hammered `/health` becomes a
 * connection-pool amplifier. Two seconds is well below any sane probe period.
 */
const READY_CACHE_MS = 2_000;

/**
 * Liveness vs readiness (TASK-119, split in TASK-147/B2).
 *
 * - `liveness()` — "the process is up": no I/O, always 200. An orchestrator
 *   restarts a container on this failing, so it must never depend on the DB.
 * - `ready()` — "this instance can serve traffic": the DB is mandatory (a
 *   failed ping is a 503), while Redis is optional — a self-host without it
 *   reports `redis: disabled` and stays ready, but a *configured yet
 *   unreachable* Redis (queues, broadcast, realtime all depend on it) is
 *   surfaced as a 503 so an orchestrator can hold traffic instead of failing
 *   jobs silently.
 *
 * `ready()` caches its answer for {@link READY_CACHE_MS} and de-duplicates a
 * concurrent burst into one probe, so probe traffic no longer reaches the DB
 * or Redis on every request.
 */
@Injectable()
export class HealthService implements OnModuleDestroy {
  private client: Redis | null = null;
  private cached: { report: HealthReport; at: number } | null = null;
  private inflight: Promise<HealthReport> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private redisClient(): Redis {
    if (!this.client) {
      this.client = new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: REDIS_PING_TIMEOUT_MS,
      });
      // Without a listener an unreachable Redis emits an unhandled 'error'.
      this.client.on("error", () => undefined);
    }
    return this.client;
  }

  private async checkRedis(): Promise<HealthReport["redis"]> {
    if (env.REDIS_URL.trim().length === 0) return "disabled";
    try {
      const client = this.redisClient();
      if (client.status === "wait" || client.status === "end") {
        await client.connect();
      }
      await Promise.race([
        client.ping(),
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("redis ping timeout")),
            REDIS_PING_TIMEOUT_MS,
          ),
        ),
      ]);
      return "up";
    } catch {
      return "down";
    }
  }

  /** Liveness: no dependencies touched (TASK-147, B2). */
  liveness(): HealthLiveness {
    return { status: "ok" };
  }

  /**
   * Readiness, cached and single-flight. Returns the report on success and
   * throws the same 503 body as before when a dependency is down — callers
   * (and the e2e tests) see no change in shape.
   */
  async ready(): Promise<HealthReport> {
    const now = Date.now();
    if (this.cached !== null && now - this.cached.at < READY_CACHE_MS) {
      return this.settle(this.cached.report);
    }
    if (this.inflight === null) {
      this.inflight = this.probe()
        .then((report) => {
          this.cached = { report, at: Date.now() };
          return report;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.settle(await this.inflight);
  }

  /** Runs the actual DB + Redis checks; never throws, so it can be cached. */
  private async probe(): Promise<HealthReport> {
    const redis = await this.checkRedis();
    try {
      await this.prisma.ping();
    } catch (error) {
      this.prisma.logError("health: db ping failed", error);
      return { status: "error", db: "down", redis };
    }
    if (redis === "down") {
      return { status: "error", db: "up", redis };
    }
    return { status: "ok", db: "up", redis };
  }

  private settle(report: HealthReport): HealthReport {
    if (report.status === "error") {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
      this.client = null;
    }
  }
}
