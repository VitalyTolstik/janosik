import {
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { env } from "@/config/env";
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  redisQueueStats,
  type QueueStats,
} from "./queue-core";
import {
  MaintenanceService,
  type MaintenanceJobName,
  type MaintenanceRunResult,
} from "./maintenance.service";
import { OpsSettingsService } from "./ops-settings.service";

/**
 * TASK-68 — the `maintenance` queue and its schedule. On Redis a BullMQ
 * **Job Scheduler** runs `all` sweeps on a configurable interval (Ops panel),
 * surviving restarts; "run now" enqueues the same job. Without Redis it runs
 * the sweeps inline (and a plain unref'd timer stands in for the scheduler),
 * so a self-host still cleans up — it just loses the schedule on restart.
 */
export const MAINTENANCE_QUEUE = QUEUE_NAMES.maintenance;
export const MAINTENANCE_JOB = "sweep";
export const MAINTENANCE_SCHEDULER_ID = "maintenance-all";

/** Default cadence when nothing is configured: once an hour. */
const DEFAULT_INTERVAL_MINUTES = 60;

export interface MaintenanceJob {
  job: MaintenanceJobName;
}

@Injectable()
export class MaintenanceQueueService implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceQueueService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly ops: OpsSettingsService,
    @Optional()
    @InjectQueue(MAINTENANCE_QUEUE)
    private readonly queue?: Queue<MaintenanceJob>,
  ) {}

  get usingRedis(): boolean {
    return this.queue !== undefined;
  }

  async onModuleInit(): Promise<void> {
    await this.applySchedule().catch((error: unknown) => {
      this.logger.warn(`Schedule setup failed: ${String(error)}`);
    });
  }

  /** Enqueue (Redis) or run inline (fallback) one sweep / all sweeps. */
  async runNow(job: MaintenanceJobName): Promise<{
    queued: boolean;
    results: MaintenanceRunResult[];
  }> {
    if (this.queue) {
      await this.queue.add(MAINTENANCE_JOB, { job }, DEFAULT_JOB_OPTIONS);
      return { queued: true, results: [] };
    }
    return { queued: false, results: await this.maintenance.run(job) };
  }

  /** Executes a job (worker entry point + inline fallback). */
  async process(job: MaintenanceJobName): Promise<MaintenanceRunResult[]> {
    return this.maintenance.run(job);
  }

  /**
   * (Re)installs the recurring sweep from the configured interval. On Redis
   * this is `upsertJobScheduler`; without Redis it is a plain timer (skipped
   * in tests so the process has no dangling handle).
   */
  async applySchedule(): Promise<void> {
    const minutes =
      (await this.ops.maintenanceIntervalMinutes()) ?? DEFAULT_INTERVAL_MINUTES;
    if (this.queue) {
      if (minutes <= 0) {
        await this.queue.removeJobScheduler(MAINTENANCE_SCHEDULER_ID);
        return;
      }
      await this.queue.upsertJobScheduler(
        MAINTENANCE_SCHEDULER_ID,
        { every: minutes * 60_000 },
        { name: MAINTENANCE_JOB, data: { job: "all" } },
      );
      return;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (minutes <= 0 || env.NODE_ENV === "test") return;
    this.timer = setInterval(() => {
      void this.maintenance.run("all").catch(() => undefined);
    }, minutes * 60_000);
    this.timer.unref();
  }

  async stats(): Promise<QueueStats> {
    if (this.queue) return redisQueueStats(this.queue);
    return { pending: 0, processed: 0, failed: 0, backend: "memory" };
  }
}
