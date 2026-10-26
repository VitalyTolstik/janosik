import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { MEDIA_QUEUE, MediaService, type MediaJob } from "./media.service";

/**
 * BullMQ worker for media derivatives (TASK-70) — registered only when
 * `REDIS_URL` is set. Delegates to the shared `process()`, the same code the
 * in-process fallback runs.
 */
@Processor(MEDIA_QUEUE)
export class MediaProcessor extends WorkerHost {
  constructor(private readonly media: MediaService) {
    super();
  }

  async process(job: Job<MediaJob>): Promise<unknown> {
    await this.media.process(job.data.attachmentId);
    return { attachmentId: job.data.attachmentId };
  }
}
