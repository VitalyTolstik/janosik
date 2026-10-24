import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import type { AdminThrottleSettingsDto } from "@janosik/shared";
import { env } from "@/config/env";
import { setThrottleLimit } from "@/config/throttle";
import { PrismaService } from "@/common/prisma/prisma.service";

const SETTINGS_ID = "singleton";
/** Hard ceiling so a typo cannot silently disable the limiter for a minute. */
const MAX_LIMIT = 1_000_000;

/**
 * Global API rate limit (TASK-57) — the data plane behind the master panel's
 * "Traffic & limits" page. The limit is a singleton row that overrides the
 * `THROTTLE_LIMIT` env default; the throttler reads the live value on every
 * request, so an edit applies immediately, without a restart.
 */
@Injectable()
export class ThrottleSettingsService implements OnModuleInit {
  private readonly logger = new Logger(ThrottleSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Re-apply the saved row after a restart (the live value is per-process). */
  async onModuleInit(): Promise<void> {
    const row = await this.prisma.throttleSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (row === null) return;
    setThrottleLimit(row.limit);
    this.logger.log(`Saved rate limit applied: ${row.limit}/min`);
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
    return this.getPublic();
  }
}
