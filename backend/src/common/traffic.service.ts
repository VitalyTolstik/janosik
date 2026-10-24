import { Injectable } from "@nestjs/common";
import type { AdminTrafficDto } from "@janosik/shared";
import { throttleLimit } from "@/config/throttle";

const WINDOW_SECONDS = 60;

/**
 * Live API request-rate counters (TASK-57). Two rolling 60-second rings —
 * one for arrivals, one for rate-limiter rejections — so the master panel can
 * render "requests per minute" while a demo storm runs, and verify the limit
 * is doing its job. In-memory and per-instance on purpose: it is an
 * observability gauge, not a billing counter, and must add no I/O to the hot
 * request path.
 */
@Injectable()
export class TrafficService {
  private readonly requestCounts = new Array<number>(WINDOW_SECONDS).fill(0);
  private readonly requestStamps = new Array<number>(WINDOW_SECONDS).fill(-1);
  private readonly throttledCounts = new Array<number>(WINDOW_SECONDS).fill(0);
  private readonly throttledStamps = new Array<number>(WINDOW_SECONDS).fill(-1);

  /** One API request arrived, whatever its outcome. Called by the middleware. */
  recordRequest(at: number = Date.now()): void {
    this.bump(this.requestCounts, this.requestStamps, at);
  }

  /** The rate limiter rejected a request (HTTP 429). Called by the filter. */
  recordThrottled(at: number = Date.now()): void {
    this.bump(this.throttledCounts, this.throttledStamps, at);
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
    };
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
