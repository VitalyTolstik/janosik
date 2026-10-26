import { Injectable, Logger, Optional } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import {
  QUEUE_NAMES,
  redisQueueStats,
  type QueueStats,
} from "@/ops/queue-core";

/**
 * TASK-69 — the demo swarm as a BullMQ job (queue `demo`). Starting a run
 * enqueues one job per `DemoRun`; the worker drives the swarm with progress
 * and can be cancelled by removing the job (plus the DB `stopping` flag the
 * run checks between acts). Without Redis the swarm runs in-process as
 * before — `enqueue` reports `false` and `DemoService` falls back to its own
 * launcher, so a self-host keeps the demo.
 */
export const DEMO_QUEUE = QUEUE_NAMES.demo;
export const DEMO_JOB = "run";

export interface DemoJob {
  runId: string;
}

@Injectable()
export class DemoQueueService {
  private readonly logger = new Logger(DemoQueueService.name);

  constructor(
    @Optional()
    @InjectQueue(DEMO_QUEUE)
    private readonly queue?: Queue<DemoJob>,
  ) {}

  get usingRedis(): boolean {
    return this.queue !== undefined;
  }

  /** Enqueues a run; returns false when there is no Redis backend. */
  async enqueue(runId: string): Promise<boolean> {
    if (!this.queue) return false;
    try {
      await this.queue.add(
        DEMO_JOB,
        { runId },
        {
          jobId: runId,
          attempts: 1,
          removeOnComplete: 50,
          removeOnFail: 200,
        },
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Demo enqueue failed, running in-process: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      return false;
    }
  }

  /** Best-effort job removal when a run is stopped. */
  async cancel(runId: string): Promise<void> {
    if (!this.queue) return;
    const job = await this.queue.getJob(runId);
    await job?.remove().catch(() => undefined);
  }

  async stats(): Promise<QueueStats> {
    if (this.queue) return redisQueueStats(this.queue);
    return { pending: 0, processed: 0, failed: 0, backend: "memory" };
  }
}
