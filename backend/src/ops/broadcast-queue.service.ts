import { Injectable, Logger, Optional } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { MailerService } from "@/mailer/mailer.service";

/** Queue + job names for the outgoing-mail fan-out (TASK-62). */
export const BROADCAST_QUEUE = "broadcast";
export const BROADCAST_JOB = "broadcast";

export interface BroadcastJob {
  emails: string[];
  subject: string;
  text: string;
  html: string;
}

interface BroadcastStats {
  pending: number;
  processed: number;
  failed: number;
  backend: "redis" | "memory";
}

/**
 * Outgoing-mail fan-out (TASK-62). Two backends behind one seam:
 *
 * - **BullMQ on Redis** when `REDIS_URL` is set — the queue survives restarts,
 *   retries with backoff and can be scaled to workers on other nodes. This is
 *   the default in a real deployment (the `redis` service in docker-compose).
 * - **In-process** otherwise — a self-host without Redis still broadcasts, it
 *   just loses the queue on a restart. Nothing downstream knows which is on.
 */
@Injectable()
export class BroadcastQueueService {
  private readonly logger = new Logger(BroadcastQueueService.name);
  private readonly pending: BroadcastJob[] = [];
  private draining = false;
  private processed = 0;
  private failed = 0;

  constructor(
    private readonly mailer: MailerService,
    @Optional()
    @InjectQueue(BROADCAST_QUEUE)
    private readonly queue?: Queue<BroadcastJob>,
  ) {}

  /** True when the BullMQ/Redis backend is active. */
  get usingRedis(): boolean {
    return this.queue !== undefined;
  }

  /** Queues a fan-out; returns once the job is accepted (not delivered). */
  async enqueue(job: BroadcastJob): Promise<void> {
    if (job.emails.length === 0) return;
    if (this.queue) {
      try {
        await this.queue.add(BROADCAST_JOB, job, {
          attempts: 3,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        });
        return;
      } catch (error) {
        // Redis hiccup: don't lose the mail — fall back to the in-process drain.
        this.logger.warn(
          `BullMQ enqueue failed, falling back to in-process: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
      }
    }
    this.pending.push(job);
    // Awaited so a caller can flush the fallback queue; the HTTP path calls
    // `enqueue()` without awaiting, so a request is never blocked by SMTP.
    await this.drain();
  }

  /**
   * Delivers one job's letters. Per-address resilience: one bad address never
   * stops the rest. Used by the BullMQ processor and the in-process fallback.
   */
  async deliver(job: BroadcastJob): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const to of job.emails) {
      try {
        await this.mailer.send({
          to,
          subject: job.subject,
          text: job.text,
          html: job.html,
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Broadcast to ${to} failed: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
      }
    }
    this.processed += sent;
    this.failed += failed;
    return { sent, failed };
  }

  async stats(): Promise<BroadcastStats> {
    if (this.queue) {
      const counts = await this.queue.getJobCounts(
        "waiting",
        "active",
        "delayed",
        "completed",
        "failed",
      );
      return {
        pending:
          (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0),
        processed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        backend: "redis",
      };
    }
    return {
      pending: this.pending.length,
      processed: this.processed,
      failed: this.failed,
      backend: "memory",
    };
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift();
        if (job) await this.deliver(job);
      }
    } finally {
      this.draining = false;
    }
  }
}
