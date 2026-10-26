import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import {
  TRANSCODE_QUEUE,
  TranscodeService,
  type TranscodeJob,
} from "./transcode.service";

/**
 * BullMQ worker for the video "ужиматор" (TASK-66) — registered only when
 * `REDIS_URL` is set (see `AttachmentsModule`). It hands each job to the
 * shared `process()`, the same code the in-process fallback runs, so the two
 * backends behave identically. A rejection lets BullMQ retry (and finally
 * dead-letter) the encode.
 */
@Processor(TRANSCODE_QUEUE)
export class TranscodeProcessor extends WorkerHost {
  constructor(private readonly transcode: TranscodeService) {
    super();
  }

  async process(job: Job<TranscodeJob>): Promise<unknown> {
    await this.transcode.process(job.data.attachmentId, {
      attemptsMade: job.attemptsMade,
      attempts: job.opts.attempts ?? 1,
    });
    return { attachmentId: job.data.attachmentId };
  }
}
