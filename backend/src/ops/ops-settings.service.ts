import { Injectable } from "@nestjs/common";
import type {
  AdminOpsSettingsDto,
  AdminUpdateOpsSettingsRequest,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";

const SINGLETON = "singleton";

/**
 * Operational singleton (TASK-61/63): maintenance mode, a per-user rate-limit
 * override and the soft-delete retention window. `null` fields fall back to
 * the env/runtime default, so an untouched install behaves exactly as before.
 */
@Injectable()
export class OpsSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async row() {
    return this.prisma.opsSettings.findUnique({ where: { id: SINGLETON } });
  }

  async get(): Promise<AdminOpsSettingsDto> {
    const row = await this.row();
    return {
      maintenanceMode: row?.maintenanceMode ?? false,
      maintenanceMessage: row?.maintenanceMessage ?? null,
      perUserRateLimit: row?.perUserRateLimit ?? null,
      retentionDays: row?.retentionDays ?? null,
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

    await this.prisma.opsSettings.upsert({
      where: { id: SINGLETON },
      create: {
        id: SINGLETON,
        maintenanceMode: dto.maintenanceMode ?? false,
        maintenanceMessage: dto.maintenanceMessage ?? null,
        perUserRateLimit: dto.perUserRateLimit ?? null,
        retentionDays: dto.retentionDays ?? null,
        updatedBy,
      },
      update: data,
    });
    return this.get();
  }
}
