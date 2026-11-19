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

jest.mock("@/config/env", () => {
  const actual =
    jest.requireActual<typeof import("@/config/env")>("@/config/env");
  return { ...actual, env: { ...actual.env, NODE_ENV: "development" } };
});

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
    await Promise.all([comms.onModuleDestroy(), maintenance.onModuleDestroy()]);
    jest.useRealTimers();
  }
});

it("recovers local timers after a startup settings failure and preserves their cadence", async () => {
  jest.useFakeTimers();
  const digestIntervalHours = jest
    .fn()
    .mockRejectedValueOnce(new Error("DB unavailable"))
    .mockResolvedValue(1);
  const maintenanceIntervalMinutes = jest
    .fn()
    .mockRejectedValueOnce(new Error("DB unavailable"))
    .mockResolvedValue(1);
  const ops = {
    digestIntervalHours,
    reminderLeadHours: async () => 0,
    maintenanceIntervalMinutes,
  } as unknown as OpsSettingsService;
  const comms = new CommsSchedulerService(
    {} as PrismaService,
    ops,
    {} as NotificationDeliveryService,
    {} as EmailTemplateService,
  );
  const commsRun = jest.spyOn(comms, "run").mockResolvedValue({ sent: 0 });
  const maintenanceRun = jest.fn().mockResolvedValue([]);
  const maintenance = new MaintenanceQueueService(
    { run: maintenanceRun } as unknown as MaintenanceService,
    ops,
  );
  try {
    comms.onModuleInit();
    maintenance.onModuleInit();
    await jest.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_MS);
    expect(digestIntervalHours).toHaveBeenCalledTimes(2);
    expect(maintenanceIntervalMinutes).toHaveBeenCalledTimes(2);
    expect(maintenanceRun).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(commsRun).toHaveBeenCalledTimes(1);
    expect(commsRun).toHaveBeenCalledWith("digest");
    expect(maintenanceRun).toHaveBeenCalledTimes(60);
  } finally {
    await Promise.all([comms.onModuleDestroy(), maintenance.onModuleDestroy()]);
    jest.useRealTimers();
  }
});
