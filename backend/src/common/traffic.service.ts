import { Injectable } from "@nestjs/common";
import type {
  AdminTrafficDto,
  AdminTrafficTelemetryDto,
} from "@janosik/shared";
import { throttleLimit } from "@/config/throttle";
import type { RateLimitScope } from "./rate-limit";

const WINDOW_SECONDS = 60;

/** Who issued a request (TASK-166.10 structured request log). */
export type RequestActorType = "human" | "agent" | "admin" | "anonymous";

/** Operations the request log classifies without touching request bodies. */
export type OperationKind =
  | "approval_created"
  | "approval_decided"
  | "agent_paused"
  | "agent_resumed"
  | "run_applied"
  | "run_reverted";

/**
 * One completed request, as produced by the request-log middleware and
 * consumed by the ops metrics. This is the reusable seam the task asks for:
 * the log line and the counters come from the same fields.
 */
export interface RequestSample {
  at?: number;
  status: number;
  durationMs: number;
  actorType: RequestActorType;
  write: boolean;
  rateLimit?: {
    scope: RateLimitScope;
    limit: number;
    remaining: number;
    resetAt: number;
  };
  operation?: OperationKind;
}

interface RollingCounter {
  counts: number[];
  stamps: number[];
}

/** Bounded latency samples behind the rolling p50/p95. */
const LATENCY_SAMPLES = 512;

/**
 * Live API request-rate counters (TASK-57) plus the TASK-166.10 metrics
 * breakdown. Two rolling 60-second rings — one for arrivals, one for
 * rate-limiter rejections — so the master panel can render "requests per
 * minute" while a demo storm runs, and verify the limit is doing its job.
 * In-memory and per-instance on purpose: it is an observability gauge, not a
 * billing counter, and must add no I/O to the hot request path.
 */
@Injectable()
export class TrafficService {
  private readonly requestCounts = new Array<number>(WINDOW_SECONDS).fill(0);
  private readonly requestStamps = new Array<number>(WINDOW_SECONDS).fill(-1);
  private readonly throttledCounts = new Array<number>(WINDOW_SECONDS).fill(0);
  private readonly throttledStamps = new Array<number>(WINDOW_SECONDS).fill(-1);

  /** TASK-166.10 labelled counters, created on first use. */
  private readonly labelled = new Map<string, RollingCounter>();

  /** Ring of `{ at, ms }`; older entries are ignored at snapshot time. */
  private readonly latency = new Array<{ at: number; ms: number }>(
    LATENCY_SAMPLES,
  );
  private latencyCursor = 0;

  /** One API request arrived, whatever its outcome. Called by the middleware. */
  recordRequest(at: number = Date.now()): void {
    this.bump(this.requestCounts, this.requestStamps, at);
  }

  /** The rate limiter rejected a request (HTTP 429). Called by the filter. */
  recordThrottled(at: number = Date.now()): void {
    this.bump(this.throttledCounts, this.throttledStamps, at);
  }

  /**
   * TASK-166.10: one completed request. Called by the request-log middleware
   * after the response is finished, so status, duration and attribution are
   * final.
   */
  recordCompleted(sample: RequestSample): void {
    const at = sample.at ?? Date.now();
    this.bumpLabel(`actor.${sample.actorType}`, at);
    if (sample.write) this.bumpLabel("writes", at);
    if (sample.status >= 500) this.bumpLabel("errors", at);
    if (sample.status === 429) {
      this.bumpLabel("rate_limit.total", at);
      this.bumpLabel(`rate_limit.${sample.rateLimit?.scope ?? "ip"}`, at);
    }
    if (sample.operation !== undefined) {
      this.bumpLabel(`operation.${sample.operation}`, at);
    }
    this.recordLatency(sample.durationMs, at);
  }

  /** Rolling snapshot for `GET /admin/traffic`. */
  snapshot(at: number = Date.now()): AdminTrafficDto {
    const nowSec = Math.floor(at / 1000);
    const perSecond: number[] = [];
    for (let age = WINDOW_SECONDS - 1; age >= 0; age -= 1) {
      perSecond.push(
        this.read(this.requestCounts, this.requestStamps, nowSec - age),
      );
    }
    return {
      lastMinute: perSecond.reduce((sum, count) => sum + count, 0),
      perSecond,
      throttledLastMinute: this.sum(
        this.throttledCounts,
        this.throttledStamps,
        nowSec,
      ),
      limit: throttleLimit(),
      at,
      telemetry: this.telemetry(at),
    };
  }

  /** TASK-166.10: 60-second breakdown shared by the panel and tests. */
  private telemetry(at: number): AdminTrafficTelemetryDto {
    const nowSec = Math.floor(at / 1000);
    const count = (key: string): number => this.labelledSnapshot(key, nowSec);
    const latency = this.latencySnapshot(at);
    return {
      requests: {
        human: count("actor.human"),
        agent: count("actor.agent"),
        admin: count("actor.admin"),
        anonymous: count("actor.anonymous"),
      },
      writes: count("writes"),
      errors: count("errors"),
      rateLimited: {
        total: count("rate_limit.total"),
        ip: count("rate_limit.ip"),
        token: count("rate_limit.token"),
        session: count("rate_limit.session"),
        board: count("rate_limit.board"),
      },
      operations: {
        approvalsCreated: count("operation.approval_created"),
        approvalsDecided: count("operation.approval_decided"),
        agentsPaused: count("operation.agent_paused"),
        agentsResumed: count("operation.agent_resumed"),
        runsApplied: count("operation.run_applied"),
        runsReverted: count("operation.run_reverted"),
      },
      latencyMs: latency,
    };
  }

  private recordLatency(ms: number, at: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.latency[this.latencyCursor] = { at, ms };
    this.latencyCursor = (this.latencyCursor + 1) % LATENCY_SAMPLES;
  }

  private latencySnapshot(at: number): {
    count: number;
    p50: number;
    p95: number;
    max: number;
  } {
    const cutoff = at - WINDOW_SECONDS * 1000;
    const values = this.latency
      .filter((entry) => entry !== undefined && entry.at >= cutoff)
      .map((entry) => entry.ms)
      .sort((a, b) => a - b);
    if (values.length === 0) return { count: 0, p50: 0, p95: 0, max: 0 };
    const percentile = (fraction: number): number =>
      values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
    return {
      count: values.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      max: values[values.length - 1] ?? 0,
    };
  }

  private bumpLabel(key: string, at: number): void {
    let counter = this.labelled.get(key);
    if (counter === undefined) {
      counter = {
        counts: new Array<number>(WINDOW_SECONDS).fill(0),
        stamps: new Array<number>(WINDOW_SECONDS).fill(-1),
      };
      this.labelled.set(key, counter);
    }
    this.bump(counter.counts, counter.stamps, at);
  }

  private labelledSnapshot(key: string, nowSec: number): number {
    const counter = this.labelled.get(key);
    return counter === undefined
      ? 0
      : this.sum(counter.counts, counter.stamps, nowSec);
  }

  private slot(sec: number): number {
    return ((sec % WINDOW_SECONDS) + WINDOW_SECONDS) % WINDOW_SECONDS;
  }

  private bump(counts: number[], stamps: number[], at: number): void {
    const sec = Math.floor(at / 1000);
    const index = this.slot(sec);
    if (stamps[index] !== sec) {
      stamps[index] = sec;
      counts[index] = 0;
    }
    counts[index] += 1;
  }

  private read(counts: number[], stamps: number[], sec: number): number {
    const index = this.slot(sec);
    return stamps[index] === sec ? counts[index] : 0;
  }

  private sum(counts: number[], stamps: number[], nowSec: number): number {
    let total = 0;
    for (let age = 0; age < WINDOW_SECONDS; age += 1) {
      total += this.read(counts, stamps, nowSec - age);
    }
    return total;
  }
}
