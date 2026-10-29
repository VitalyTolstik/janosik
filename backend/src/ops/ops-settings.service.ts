import { Injectable } from "@nestjs/common";
import type {
  AdminOpsSettingsDto,
  AdminUpdateOpsSettingsRequest,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";

const SINGLETON = "singleton";

/**
 * How long a fetched singleton is trusted (TASK-153, B15). `MaintenanceGuard`
 * used to read the row before auth on *every* request, so the guard was an
 * unindexed DB round-trip on the hottest path; a short TTL keeps panel edits
 * visible within seconds while removing that cost.
 */
const CACHE_TTL_MS = 15_000;

type OpsRow = Awaited<ReturnType<PrismaService["opsSettings"]["findUnique"]>>;

/**
 * Operational singleton (TASK-61/63): maintenance mode, a per-user rate-limit
 * override and the soft-delete retention window. `null` fields fall back to
 * the env/runtime default, so an untouched install behaves exactly as before.
 */
@Injectable()
export class OpsSettingsService {
  private cached: { row: OpsRow; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async row(): Promise<OpsRow> {
    if (this.cached !== null && Date.now() - this.cached.at < CACHE_TTL_MS) {
      return this.cached.row;
    }
    const row = await this.prisma.opsSettings.findUnique({
      where: { id: SINGLETON },
    });
    this.cached = { row, at: Date.now() };
    return row;
  }

  /** Drop the cached singleton after a panel write (same process). */
  invalidate(): void {
    this.cached = null;
  }

  async get(): Promise<AdminOpsSettingsDto> {
    const row = await this.row();
    return {
      maintenanceMode: row?.maintenanceMode ?? false,
      maintenanceMessage: row?.maintenanceMessage ?? null,
      perUserRateLimit: row?.perUserRateLimit ?? null,
      retentionDays: row?.retentionDays ?? null,
      maintenanceIntervalMinutes: row?.maintenanceIntervalMinutes ?? null,
      digestIntervalHours: row?.digestIntervalHours ?? null,
      reminderLeadHours: row?.reminderLeadHours ?? null,
      queuesDashboard: env.QUEUES_DASHBOARD,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt.getTime() ?? null,
    };
  }

  /** Cheap accessor for request-time checks (maintenance middleware). */
  async maintenance(): Promise<{ mode: boolean; message: string | null }> {
    const row = await this.row();
    return {
      mode: row?.maintenanceMode ?? false,
      message: row?.maintenanceMessage ?? null,
    };
  }

  async retentionDays(): Promise<number | null> {
    return (await this.row())?.retentionDays ?? null;
  }

  async maintenanceIntervalMinutes(): Promise<number | null> {
    return (await this.row())?.maintenanceIntervalMinutes ?? null;
  }

  async digestIntervalHours(): Promise<number | null> {
    return (await this.row())?.digestIntervalHours ?? null;
  }

  async reminderLeadHours(): Promise<number | null> {
    return (await this.row())?.reminderLeadHours ?? null;
  }

  async perUserRateLimit(): Promise<number | null> {
    return (await this.row())?.perUserRateLimit ?? null;
  }

  async update(
    dto: AdminUpdateOpsSettingsRequest,
    updatedBy: string,
  ): Promise<AdminOpsSettingsDto> {
    const data: Record<string, unknown> = { updatedBy };
    if (dto.maintenanceMode !== undefined)
      data.maintenanceMode = dto.maintenanceMode;
    if (dto.maintenanceMessage !== undefined)
      data.maintenanceMessage = dto.maintenanceMessage;
    if (dto.perUserRateLimit !== undefined)
      data.perUserRateLimit = dto.perUserRateLimit;
    if (dto.retentionDays !== undefined) data.retentionDays = dto.retentionDays;
    if (dto.maintenanceIntervalMinutes !== undefined) {
      data.maintenanceIntervalMinutes = dto.maintenanceIntervalMinutes;
    }
    if (dto.digestIntervalHours !== undefined)
      data.digestIntervalHours = dto.digestIntervalHours;
    if (dto.reminderLeadHours !== undefined)
      data.reminderLeadHours = dto.reminderLeadHours;

    await this.prisma.opsSettings.upsert({
      where: { id: SINGLETON },
      create: {
        id: SINGLETON,
        maintenanceMode: dto.maintenanceMode ?? false,
        maintenanceMessage: dto.maintenanceMessage ?? null,
        perUserRateLimit: dto.perUserRateLimit ?? null,
        retentionDays: dto.retentionDays ?? null,
        maintenanceIntervalMinutes: dto.maintenanceIntervalMinutes ?? null,
        digestIntervalHours: dto.digestIntervalHours ?? null,
        reminderLeadHours: dto.reminderLeadHours ?? null,
        updatedBy,
      },
      update: data,
    });
    this.invalidate();
    return this.get();
  }
}
