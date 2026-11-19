import type { Queue } from "bullmq";
import type { PrismaService } from "@/common/prisma/prisma.service";
import type { NotificationDeliveryService } from "@/mailer/notification-delivery.service";
import type { EmailTemplateService } from "./email-template.service";
import type { MaintenanceService } from "./maintenance.service";
import type { OpsSettingsService } from "./ops-settings.service";
import {
  CommsSchedulerService,
  DIGEST_SCHEDULER_ID,
  REMINDERS_SCHEDULER_ID,
  type CommsJob,
} from "./comms-scheduler.service";
import {
  MaintenanceQueueService,
  MAINTENANCE_SCHEDULER_ID,
  type MaintenanceJob,
} from "./maintenance-queue.service";
import { SCHEDULE_RECONCILE_MS } from "./recurring-schedule";

function redisSchedules<Data>() {
  const active = new Map<string, number>();
  const upsert = jest.fn(async (id: string, { every }: { every: number }) => {
    active.set(id, every);
  });
  const remove = jest.fn(async (id: string) => active.delete(id));
  const state = { available: false };
  const queue = {
    getJobScheduler: jest.fn(async (id: string) => {
      if (!state.available) throw new Error("Redis unavailable");
      const every = active.get(id);
      return every === undefined ? undefined : { every, next: 42 };
    }),
    upsertJobScheduler: upsert,
    removeJobScheduler: remove,
  } as unknown as Queue<Data>;
  return { queue, active, state, upsert, remove };
}

it("reconciles digest, reminders and maintenance after startup Redis failure and runtime key loss", async () => {
  jest.useFakeTimers();
  const commsRedis = redisSchedules<CommsJob>();
  const maintenanceRedis = redisSchedules<MaintenanceJob>();
  const digestIntervalHours = jest.fn().mockResolvedValue(24);
  const ops = {
    digestIntervalHours,
    reminderLeadHours: async () => 6,
    maintenanceIntervalMinutes: async () => 30,
  } as unknown as OpsSettingsService;
  const comms = new CommsSchedulerService(
    {} as PrismaService,
    ops,
    {} as NotificationDeliveryService,
    {} as EmailTemplateService,
    commsRedis.queue,
  );
  const maintenance = new MaintenanceQueueService(
    {} as MaintenanceService,
    ops,
    maintenanceRedis.queue,
  );
  try {
    await Promise.all([comms.onModuleInit(), maintenance.onModuleInit()]);
    await jest.advanceTimersByTimeAsync(0);
    expect(commsRedis.active.size).toBe(0);
    expect(maintenanceRedis.active.size).toBe(0);

    commsRedis.state.available = true;
    maintenanceRedis.state.available = true;
    await jest.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_MS);
    expect(commsRedis.active.get(DIGEST_SCHEDULER_ID)).toBe(86_400_000);
    expect(commsRedis.active.get(REMINDERS_SCHEDULER_ID)).toBe(21_600_000);
    expect(maintenanceRedis.active.get(MAINTENANCE_SCHEDULER_ID)).toBe(
      1_800_000,
    );

    await jest.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_MS);
    expect(commsRedis.upsert).toHaveBeenCalledTimes(2);
    expect(maintenanceRedis.upsert).toHaveBeenCalledTimes(1);

    commsRedis.active.delete(DIGEST_SCHEDULER_ID);
    maintenanceRedis.active.clear();
    await jest.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_MS);
    expect(commsRedis.active.get(DIGEST_SCHEDULER_ID)).toBe(86_400_000);
    expect(maintenanceRedis.active.get(MAINTENANCE_SCHEDULER_ID)).toBe(
      1_800_000,
    );

    commsRedis.state.available = false;
    digestIntervalHours.mockResolvedValue(0);
    comms.refreshSchedule();
    await jest.advanceTimersByTimeAsync(0);
    expect(commsRedis.active.has(DIGEST_SCHEDULER_ID)).toBe(true);
    commsRedis.state.available = true;
    await jest.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_MS);
    expect(commsRedis.active.has(DIGEST_SCHEDULER_ID)).toBe(false);
    expect(commsRedis.remove).toHaveBeenCalledWith(DIGEST_SCHEDULER_ID);
  } finally {
    comms.onModuleDestroy();
    maintenance.onModuleDestroy();
    jest.useRealTimers();
  }
});
