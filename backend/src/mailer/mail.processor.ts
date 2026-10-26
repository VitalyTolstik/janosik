import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  MAIL_QUEUE,
  MailQueueService,
  type MailJob,
} from "./mail-queue.service";

/**
 * BullMQ worker for transactional mail (TASK-67) — registered only when
 * `REDIS_URL` is set. Delegates to the shared `deliver()`, the same code the
 * in-process fallback runs, so log-mode/`outbox` behave identically.
 */
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  constructor(private readonly mail: MailQueueService) {
    super();
  }

  async process(job: Job<MailJob>): Promise<unknown> {
    await this.mail.deliver(job.data);
    return { to: job.data.to };
  }
}
