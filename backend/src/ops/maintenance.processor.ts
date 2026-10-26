import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  MAINTENANCE_QUEUE,
  MaintenanceQueueService,
  type MaintenanceJob,
} from "./maintenance-queue.service";

/**
 * BullMQ worker for the maintenance sweeps (TASK-68) — registered only when
 * `REDIS_URL` is set. Handles both the scheduled `all` job and one-off
 * "run now" jobs.
 */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  constructor(private readonly maintenance: MaintenanceQueueService) {
    super();
  }

  async process(job: Job<MaintenanceJob>): Promise<unknown> {
    const results = await this.maintenance.process(job.data.job);
    return results;
  }
}
