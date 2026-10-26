import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { DEMO_QUEUE, type DemoJob } from "./demo-queue.service";
import { DemoService } from "./demo.service";

/**
 * BullMQ worker for the demo swarm (TASK-69) — registered only when
 * `REDIS_URL` is set. Drives one `DemoRun` end to end with progress.
 */
@Processor(DEMO_QUEUE)
export class DemoProcessor extends WorkerHost {
  constructor(private readonly demo: DemoService) {
    super();
  }

  async process(job: Job<DemoJob>): Promise<unknown> {
    return this.demo.executeRun(job.data.runId, async (done, total) => {
      await job.updateProgress(Math.round((done / Math.max(1, total)) * 100));
    });
  }
}
