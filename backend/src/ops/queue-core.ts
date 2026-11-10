import { Logger } from "@nestjs/common";
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

/**
 * TASK-166.10: who caused a queued job. Optional and additive — a job created
 * by a scheduler or boot recovery has no request attribution and keeps the
 * old payload shape. Only opaque server ids ride along; never an email,
 * filename, comment or card content.
 */
export interface JobAttribution {
  actorType?: "human" | "agent" | "admin" | "system";
  actorId?: string;
  boardId?: string;
  apiTokenId?: string;
  agentSessionId?: string;
  runId?: string;
}

/** A job payload that can name its caller without changing existing jobs. */
export interface AttributedJob {
  attribution?: JobAttribution;
}

/** Drop absent fields so a legacy job payload stays byte-identical. */
export function jobAttribution(
  source: JobAttribution | undefined,
): JobAttribution | undefined {
  if (source === undefined) return undefined;
  const attribution: JobAttribution = {};
  if (source.actorType !== undefined) attribution.actorType = source.actorType;
  if (source.actorId !== undefined) attribution.actorId = source.actorId;
  if (source.boardId !== undefined) attribution.boardId = source.boardId;
  if (source.apiTokenId !== undefined) {
    attribution.apiTokenId = source.apiTokenId;
  }
  if (source.agentSessionId !== undefined) {
    attribution.agentSessionId = source.agentSessionId;
  }
  if (source.runId !== undefined) attribution.runId = source.runId;
  return Object.keys(attribution).length > 0 ? attribution : undefined;
}

/** One structured enqueue event, kept for ops/tests (bounded ring). */
export interface QueueJobEvent {
  event: "queue.job";
  queue: QueueName;
  job: string;
  at: number;
  attribution?: JobAttribution;
}

const queueLogger = new Logger("QueueJob");
const MAX_RECENT_JOBS = 100;
const recentJobs: QueueJobEvent[] = [];

/**
 * Record that a job was accepted with attribution. The same JSON line an
 * operator sees in the process log is kept in a bounded ring, so tests and a
 * future ops reader can verify the queue contract without scraping stdout.
 */
export function logQueueJob(
  queue: QueueName,
  job: string,
  attribution?: JobAttribution,
): QueueJobEvent {
  const event: QueueJobEvent = {
    event: "queue.job",
    queue,
    job,
    at: Date.now(),
    ...(attribution !== undefined ? { attribution } : {}),
  };
  recentJobs.push(event);
  if (recentJobs.length > MAX_RECENT_JOBS) recentJobs.shift();
  if (env.NODE_ENV !== "test") {
    queueLogger.log(JSON.stringify(event));
  }
  return event;
}

/** Newest-last copy of the enqueue events (TASK-166.10 ops/tests). */
export function recentQueueJobs(): QueueJobEvent[] {
  return recentJobs.map((event) => ({
    ...event,
    ...(event.attribution !== undefined
      ? { attribution: { ...event.attribution } }
      : {}),
  }));
}

/** Test hook: forget the ring. */
export function resetQueueJobLog(): void {
  recentJobs.length = 0;
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
