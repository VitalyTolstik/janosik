import { Injectable, Logger } from "@nestjs/common";
import { MailerService } from "@/mailer/mailer.service";

export interface BroadcastJob {
  emails: string[];
  subject: string;
  text: string;
  html: string;
}

/**
 * In-process broadcast queue (TASK-62). A newsletter fan-out must not block
 * the request that triggered it, so letters are drained in the background,
 * one address at a time, and a single bad address never stops the rest.
 *
 * Why not Bull/BullMQ: Bull needs Redis, which this self-hosted single-node
 * stack does not ship (§7.0 — the MVP runs in one process, like the video
 * transcode and demo runners). This class is the seam: swap its `enqueue`
 * body for `queue.add(...)` and add a `@Processor` when a second node (and
 * Redis) exists — nothing else in the codebase knows how fan-out works.
 */
@Injectable()
export class BroadcastQueueService {
  private readonly logger = new Logger(BroadcastQueueService.name);
  private readonly pending: BroadcastJob[] = [];
  private draining = false;
  private processed = 0;
  private failed = 0;

  constructor(private readonly mailer: MailerService) {}

  /** Jobs waiting to drain (observability). */
  get size(): number {
    return this.pending.length;
  }

  stats(): { pending: number; processed: number; failed: number } {
    return {
      pending: this.pending.length,
      processed: this.processed,
      failed: this.failed,
    };
  }

  /** Queues a fan-out; returns immediately. */
  enqueue(job: BroadcastJob): void {
    if (job.emails.length === 0) return;
    this.pending.push(job);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift();
        if (!job) break;
        for (const to of job.emails) {
          try {
            await this.mailer.send({
              to,
              subject: job.subject,
              text: job.text,
              html: job.html,
            });
            this.processed += 1;
          } catch (error) {
            this.failed += 1;
            this.logger.warn(
              `Broadcast to ${to} failed: ${
                error instanceof Error ? error.message : "unknown"
              }`,
            );
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
