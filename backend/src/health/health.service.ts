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

const REDIS_PING_TIMEOUT_MS = 1_000;

/**
 * Readiness probe (TASK-119): the DB is mandatory (a failed ping is a 503),
 * while Redis is optional — a self-host without it reports `redis: disabled`
 * and stays ready, but a *configured yet unreachable* Redis (queues,
 * broadcast, realtime all depend on it) is surfaced as a 503 so an
 * orchestrator can hold traffic instead of failing jobs silently.
 */
@Injectable()
export class HealthService implements OnModuleDestroy {
  private client: Redis | null = null;

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

  async check(): Promise<HealthReport> {
    const redis = await this.checkRedis();
    try {
      await this.prisma.ping();
    } catch (error) {
      this.prisma.logError("health: db ping failed", error);
      throw new HttpException(
        { status: "error", db: "down", redis } satisfies HealthReport,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (redis === "down") {
      throw new HttpException(
        { status: "error", db: "up", redis } satisfies HealthReport,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: "ok", db: "up", redis };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
      this.client = null;
    }
  }
}
