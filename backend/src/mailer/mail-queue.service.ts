import { Injectable, Logger, Optional } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  redisQueueStats,
  type QueueStats,
} from "@/ops/queue-core";
import { MailerService } from "./mailer.service";

/**
 * TASK-67 — transactional mail through the `mail` queue. Verification codes,
 * email-change notices and one-off letters are enqueued instead of sent
 * inline, so a slow or failing SMTP transport no longer fails the request
 * that triggered the mail (register/resend/change return immediately). On
 * Redis the job retries with backoff; without Redis it drains in-process
 * right away, which is also what keeps the e2e `outbox` populated before the
 * request returns (tests never need a container).
 */
export const MAIL_QUEUE = QUEUE_NAMES.mail;
export const MAIL_JOB = "send";

export interface MailJob {
  to: string;
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class MailQueueService {
  private readonly logger = new Logger(MailQueueService.name);
  private readonly pending: MailJob[] = [];
  private draining = false;
  private processed = 0;
  private failed = 0;

  constructor(
    private readonly mailer: MailerService,
    @Optional()
    @InjectQueue(MAIL_QUEUE)
    private readonly queue?: Queue<MailJob>,
  ) {}

  get usingRedis(): boolean {
    return this.queue !== undefined;
  }

  /** Queue one letter; resolves once accepted (not delivered). */
  async enqueue(job: MailJob): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add(MAIL_JOB, job, DEFAULT_JOB_OPTIONS);
        return;
      } catch (error) {
        this.logger.warn(
          `BullMQ enqueue failed, falling back to in-process: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
      }
    }
    this.pending.push(job);
    await this.drain();
  }

  /** Delivers one letter through the live transport (worker + fallback). */
  async deliver(job: MailJob): Promise<void> {
    try {
      await this.mailer.send(job);
      this.processed += 1;
    } catch (error) {
      this.failed += 1;
      throw error;
    }
  }

  async stats(): Promise<QueueStats> {
    if (this.queue) return redisQueueStats(this.queue);
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
        } catch (error) {
          // Best-effort in log/self-host mode: a failed letter must not fail
          // the caller. In Redis mode the worker owns retries instead.
          this.logger.warn(
            `Mail to ${job.to} failed: ${
              error instanceof Error ? error.message : "unknown"
            }`,
          );
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
