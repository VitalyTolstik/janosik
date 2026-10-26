import { Injectable, Logger, Optional } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { MailerService } from "@/mailer/mailer.service";

/** Queue + job names for the outgoing-mail fan-out (TASK-62). */
export const BROADCAST_QUEUE = "broadcast";
export const BROADCAST_JOB = "broadcast";

/** One letter to one recipient — the unit a retry works on (TASK-110). */
export interface BroadcastJob {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** A fan-out request: the same letter to many inboxes. */
export interface BroadcastRequest {
  /** Stable key for deterministic per-recipient `jobId`s (dedupes retries). */
  id?: string;
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
 *
 * One job per recipient (TASK-110): a retry then re-sends only the address
 * that failed instead of the whole list, and a deterministic `jobId` keeps a
 * re-enqueue from duplicating a recipient.
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

  /**
   * Fans a letter out: one job per recipient. Returns once the jobs are
   * accepted (not delivered). With Redis each recipient is retried on its
   * own; without it the in-process drain delivers once, logging failures.
   */
  async enqueue(request: BroadcastRequest): Promise<void> {
    const { emails, id, ...message } = request;
    if (emails.length === 0) return;
    const jobs: BroadcastJob[] = emails.map((to) => ({ to, ...message }));
    if (this.queue) {
      for (const job of jobs) {
        try {
          await this.queue.add(BROADCAST_JOB, job, {
            attempts: 3,
            backoff: { type: "exponential", delay: 2_000 },
            // Deterministic id → a re-enqueue of the same broadcast never
            // adds a second job for the same recipient (TASK-110).
            jobId: id ? `${id}:${job.to}` : undefined,
            removeOnComplete: 100,
            removeOnFail: 500,
          });
        } catch (error) {
          // Redis hiccup: don't lose the mail — fall back to the in-process drain.
          this.logger.warn(
            `BullMQ enqueue failed, falling back to in-process: ${
              error instanceof Error ? error.message : "unknown"
            }`,
          );
          this.pending.push(job);
        }
      }
      await this.drain();
      return;
    }
    this.pending.push(...jobs);
    // Awaited so a caller can flush the fallback queue; the HTTP path calls
    // `enqueue()` without awaiting, so a request is never blocked by SMTP.
    await this.drain();
  }

  /**
   * Delivers one letter. Throws on failure (TASK-110) so the BullMQ job
   * retries *this* recipient; the in-process drain catches to keep going.
   */
  async deliver(job: BroadcastJob): Promise<{ sent: number }> {
    try {
      await this.mailer.send({
        to: job.to,
        subject: job.subject,
        text: job.text,
        html: job.html,
      });
      this.processed += 1;
      return { sent: 1 };
    } catch (error) {
      this.failed += 1;
      this.logger.warn(
        `Broadcast to ${job.to} failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      throw error;
    }
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
        if (!job) continue;
        try {
          await this.deliver(job);
        } catch {
          // Already logged; a bad address must not stop the rest.
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
