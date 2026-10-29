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

  it("an in-flight read resolving after invalidate() must not overwrite the fresh cache (TASK-156, item 42)", async () => {
    const prisma = makePrisma();
    const service = new OpsSettingsService(prismaOf(prisma));
    const fresh = { ...prisma.row, maintenanceMode: true };

    // A cold-cache read whose DB round-trip is still in flight…
    let resolveStale: ((row: typeof prisma.row) => void) | undefined;
    const staleRead = new Promise<typeof prisma.row>((resolve) => {
      resolveStale = resolve;
    });
    prisma.opsSettings.findUnique
      .mockImplementationOnce(() => staleRead)
      .mockResolvedValue(fresh);
    const stale = service.maintenance();

    // …while a panel write lands and warms the cache with the fresh row…
    await service.update({ maintenanceMode: true }, "owner@example.com");

    // …and only now does the stale row arrive, after `invalidate()` ran.
    resolveStale?.(prisma.row);
    await expect(stale).resolves.toMatchObject({ mode: false });

    // The row the update wrote must still own the cache — the stale
    // in-flight read may answer its own caller, but must not overwrite.
    await expect(service.maintenance()).resolves.toMatchObject({ mode: true });
    expect(prisma.opsSettings.findUnique).toHaveBeenCalledTimes(2);
  });
});
