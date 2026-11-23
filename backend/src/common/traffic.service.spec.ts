import { TrafficService } from "./traffic.service";
import { throttleLimit } from "@/config/throttle";

/**
 * TrafficService (TASK-57): a rolling 60s gauge over two per-second rings.
 * Time is passed explicitly so the window can be exercised without fake
 * timers.
 */
describe("TrafficService", () => {
  it("counts arrivals in a rolling window and returns 60 buckets", () => {
    const traffic = new TrafficService();
    const base = 1_700_000_000_000;
    traffic.recordRequest(base);
    traffic.recordRequest(base + 1_000);

    const snapshot = traffic.snapshot(base + 1_000);
    expect(snapshot.lastMinute).toBe(2);
    expect(snapshot.perSecond).toHaveLength(60);
    // The two arrivals sit at the two newest buckets.
    expect(snapshot.perSecond[59]).toBe(1);
    expect(snapshot.perSecond[58]).toBe(1);
  });

  it("ages out seconds older than the window", () => {
    const traffic = new TrafficService();
    const base = 1_800_000_000_000;
    traffic.recordRequest(base);
    expect(traffic.snapshot(base + 61_000).lastMinute).toBe(0);
  });

  it("counts rate-limiter rejections separately", () => {
    const traffic = new TrafficService();
    const base = 1_900_000_000_000;
    traffic.recordRequest(base);
    traffic.recordThrottled(base);
    traffic.recordThrottled(base + 500);

    const snapshot = traffic.snapshot(base + 1_000);
    expect(snapshot.lastMinute).toBe(1);
    expect(snapshot.throttledLastMinute).toBe(2);
  });

  it("orders perSecond oldest → newest", () => {
    const traffic = new TrafficService();
    const base = 2_000_000_000_000;
    traffic.recordRequest(base);
    traffic.recordRequest(base + 59_000);

    const snapshot = traffic.snapshot(base + 59_000);
    expect(snapshot.perSecond[0]).toBe(1); // oldest second
    expect(snapshot.perSecond[59]).toBe(1); // newest second
  });

  it("reports the live limit from the throttle state", () => {
    const traffic = new TrafficService();
    expect(traffic.snapshot().limit).toBe(throttleLimit());
  });

  it("breaks completed requests down by actor, writes and rate-limit scope", () => {
    const traffic = new TrafficService();
    const base = 2_100_000_000_000;
    traffic.recordCompleted({
      at: base,
      status: 200,
      durationMs: 10,
      actorType: "agent",
      write: true,
      operation: "run_applied",
    });
    traffic.recordCompleted({
      at: base + 1_000,
      status: 200,
      durationMs: 30,
      actorType: "human",
      write: false,
    });
    traffic.recordCompleted({
      at: base + 2_000,
      status: 429,
      durationMs: 50,
      actorType: "agent",
      write: false,
      rateLimit: {
        scope: "token",
        limit: 2,
        remaining: 0,
        resetAt: base + 60_000,
      },
    });
    traffic.recordCompleted({
      at: base + 3_000,
      status: 503,
      durationMs: 70,
      actorType: "human",
      write: false,
    });

    const snapshot = traffic.snapshot(base + 4_000);
    expect(snapshot.telemetry).toMatchObject({
      requests: { human: 2, agent: 2, admin: 0, anonymous: 0 },
      writes: 1,
      errors: 1,
      rateLimited: { total: 1, token: 1, session: 0, board: 0, ip: 0 },
      operations: { runsApplied: 1 },
      latencyMs: { count: 4, p50: 50, p95: 70, max: 70 },
    });
  });

  it("counts the queued 503 as backpressure, not a 5xx error", () => {
    const traffic = new TrafficService();
    const base = 2_150_000_000_000;
    traffic.recordCompleted({
      at: base,
      status: 503,
      durationMs: 1_200,
      actorType: "agent",
      write: true,
      rateLimit: {
        scope: "board",
        limit: 12_000,
        remaining: 0,
        resetAt: base + 60_000,
      },
      rateLimited: true,
    });

    expect(traffic.snapshot(base + 1_000).telemetry).toMatchObject({
      errors: 0,
      rateLimited: { total: 1, board: 1, ip: 0, token: 0, session: 0 },
    });
  });

  it("still counts a board write timeout as a 5xx error", () => {
    const traffic = new TrafficService();
    const base = 2_160_000_000_000;
    traffic.recordCompleted({
      at: base,
      status: 503,
      durationMs: 900,
      actorType: "agent",
      write: true,
      // The request was allowed and carried budget headers; then the write
      // lock timed out. This is not backpressure.
      rateLimit: {
        scope: "board",
        limit: 12_000,
        remaining: 3,
        resetAt: base + 60_000,
      },
    });

    expect(traffic.snapshot(base + 1_000).telemetry).toMatchObject({
      errors: 1,
      rateLimited: { total: 0, board: 0 },
    });
  });

  it("ages completed-request counters out of the 60s window", () => {
    const traffic = new TrafficService();
    const base = 2_200_000_000_000;
    traffic.recordCompleted({
      at: base,
      status: 200,
      durationMs: 5,
      actorType: "agent",
      write: true,
    });
    const later = traffic.snapshot(base + 61_000);
    expect(later.telemetry?.requests.agent).toBe(0);
    expect(later.telemetry?.writes).toBe(0);
    expect(later.telemetry?.latencyMs.count).toBe(0);
  });
});
