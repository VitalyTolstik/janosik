import type { Queue } from "bullmq";
import { env } from "@/config/env";

/**
 * Shared scaffolding for the BullMQ queues (ROADMAP §7.11, TASK-62…73).
 *
 * Every queue follows the same contract: when `REDIS_URL` is configured the
 * job goes to Redis (survives restarts, retries, scales to workers on other
 * nodes); otherwise it drains in-process, so a self-host without Redis keeps
 * working and the e2e suite never needs a container. The queue name is the
 * one constant both the service and its worker import — never a bare string.
 */
export const QUEUE_NAMES = {
  broadcast: "broadcast",
  mail: "mail",
  transcode: "transcode",
  maintenance: "maintenance",
  demo: "demo",
  media: "media",
  exports: "exports",
  comms: "comms",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** True when the BullMQ/Redis backend is configured for the process. */
export const queuesEnabled: boolean = env.REDIS_URL.trim().length > 0;

/** Standard retry policy: a few attempts with exponential backoff. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export interface QueueStats {
  pending: number;
  processed: number;
  failed: number;
  backend: "redis" | "memory";
}

/** Counts a BullMQ queue the same way for every consumer (observability). */
export async function redisQueueStats(queue: Queue): Promise<QueueStats> {
  const counts = await queue.getJobCounts(
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
