import type { PrismaService } from "@/common/prisma/prisma.service";
import { OpsSettingsService } from "./ops-settings.service";

/**
 * TASK-153 (B15): the maintenance guard asks for this singleton on every
 * request before auth. A short TTL must collapse those asks to one query,
 * while a panel write invalidates the cache immediately.
 */
describe("OpsSettingsService cache", () => {
  function makePrisma() {
    const row = {
      id: "singleton",
      maintenanceMode: false,
      maintenanceMessage: null,
      perUserRateLimit: null,
      retentionDays: 30,
      maintenanceIntervalMinutes: null,
      digestIntervalHours: null,
      reminderLeadHours: null,
      registrationEnabled: null,
      publicSharesEnabled: null,
      updatedBy: null,
      updatedAt: new Date(),
    };
    return {
      row,
      opsSettings: {
        findUnique: jest.fn().mockResolvedValue(row),
        upsert: jest.fn().mockResolvedValue(row),
      },
    };
  }

  const prismaOf = (mock: ReturnType<typeof makePrisma>) =>
    mock as unknown as PrismaService;

  it("serves repeated reads from one query", async () => {
    const prisma = makePrisma();
    const service = new OpsSettingsService(prismaOf(prisma));

    await service.maintenance();
    await service.maintenance();
    await service.retentionDays();

    expect(prisma.opsSettings.findUnique).toHaveBeenCalledTimes(1);
  });

  it("invalidates on a panel write", async () => {
    const prisma = makePrisma();
    const service = new OpsSettingsService(prismaOf(prisma));

    await service.maintenance();
    await service.update({ maintenanceMode: true }, "owner@example.com");
    await service.maintenance();

    // Initial read, then one fresh read for the write (which warms the cache).
    expect(prisma.opsSettings.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.opsSettings.upsert).toHaveBeenCalledTimes(1);
  });
});
