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
});
