import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  BROADCAST_QUEUE,
  BroadcastQueueService,
  type BroadcastJob,
} from "./broadcast-queue.service";

/**
 * BullMQ worker for the outgoing-mail fan-out (TASK-62) — registered only
 * when `REDIS_URL` is set (see `OpsModule`). It hands each job to the shared
 * `deliver()`, which is also what the in-process fallback calls, so the two
 * backends run the exact same delivery code.
 */
@Processor(BROADCAST_QUEUE)
export class BroadcastProcessor extends WorkerHost {
  constructor(private readonly broadcasts: BroadcastQueueService) {
    super();
  }

  async process(job: Job<BroadcastJob>): Promise<unknown> {
    return this.broadcasts.deliver(job.data);
  }
}
