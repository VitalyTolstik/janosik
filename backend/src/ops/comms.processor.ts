import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  COMMS_QUEUE,
  CommsSchedulerService,
  type CommsJob,
} from "./comms-scheduler.service";

/**
 * BullMQ worker for the scheduled comms (TASK-72) — registered only when
 * `REDIS_URL` is set. Runs the digest or the due reminders.
 */
@Processor(COMMS_QUEUE)
export class CommsProcessor extends WorkerHost {
  constructor(private readonly comms: CommsSchedulerService) {
    super();
  }

  async process(job: Job<CommsJob>): Promise<unknown> {
    return this.comms.run(job.data.kind);
  }
}
