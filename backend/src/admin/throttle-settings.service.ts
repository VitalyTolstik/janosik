import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { AdminThrottleSettingsDto } from "@janosik/shared";
import { env } from "@/config/env";
import { setThrottleLimit } from "@/config/throttle";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RealtimeService } from "@/realtime/realtime.service";

const SETTINGS_ID = "singleton";
/** Hard ceiling so a typo cannot silently disable the limiter for a minute. */
const MAX_LIMIT = 1_000_000;

/**
 * Global API rate limit (TASK-57) — the data plane behind the master panel's
 * "Traffic & limits" page. The limit is a singleton row that overrides the
 * `THROTTLE_LIMIT` env default; the throttler reads the live value on every
 * request, so an edit applies immediately, without a restart.
 *
 * TASK-200.12: with several API replicas the live value is per process, so a
 * panel edit also travels on the realtime control channel. Every replica
 * applies it without a restart; if Redis is unavailable the editing replica
 * still applies it locally and the others pick it up on their next boot (the
 * pre-200.12 behaviour).
 */
@Injectable()
export class ThrottleSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThrottleSettingsService.name);
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Re-apply the saved row after a restart (the live value is per-process). */
  async onModuleInit(): Promise<void> {
    this.unsubscribe = this.realtime.onInvalidation((event) => {
      if (event.kind === "throttle") setThrottleLimit(event.limit);
    });
    const row = await this.prisma.throttleSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (row === null) return;
    setThrottleLimit(row.limit);
    this.logger.log(`Saved rate limit applied: ${row.limit}/min`);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** The active limit, with its source (saved row or env default). */
  async getPublic(): Promise<AdminThrottleSettingsDto> {
    const row = await this.prisma.throttleSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (row !== null) {
      return {
        limit: row.limit,
        source: "db",
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
      };
    }
    return {
      limit: env.THROTTLE_LIMIT,
      source: "env",
      updatedBy: null,
      updatedAt: null,
    };
  }

  /** Validate, persist and apply a new limit. */
  async update(
    limit: number,
    updatedBy: string,
  ): Promise<AdminThrottleSettingsDto> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException({
        message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
        field: "limit",
      });
    }
    const row = await this.prisma.throttleSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, limit, updatedBy },
      update: { limit, updatedBy },
    });
    setThrottleLimit(row.limit);
    // TASK-200.12: the local setter above covers this replica; the control
    // frame makes every peer apply the same value immediately. The listener
    // is idempotent, so the local echo is harmless.
    this.realtime.publishInvalidation({
      kind: "throttle",
      limit: row.limit,
    });
    return this.getPublic();
  }
}
