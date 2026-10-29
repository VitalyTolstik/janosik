import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  EXPORTS_QUEUE,
  ExportsService,
  type ExportsJob,
} from "./exports.service";

/**
 * BullMQ worker for background data exports (TASK-71) — registered only when
 * `REDIS_URL` is set. Builds the bundle and stores the artifact.
 */
@Processor(EXPORTS_QUEUE)
export class ExportsProcessor extends WorkerHost {
  constructor(private readonly exports: ExportsService) {
    super();
  }

  async process(job: Job<ExportsJob>): Promise<unknown> {
    await this.exports.build(job.data.exportId, {
      attemptsMade: job.attemptsMade,
      attempts: job.opts.attempts ?? 1,
    });
    return { exportId: job.data.exportId };
  }
}
