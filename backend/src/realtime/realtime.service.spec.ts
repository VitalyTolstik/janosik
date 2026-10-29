import { RealtimeService } from "./realtime.service";

/** TASK-102: a board's channel must not outlive its last subscriber. */
describe("RealtimeService.watch", () => {
  it("releases the channel when the last watcher unsubscribes", () => {
    const realtime = new RealtimeService();
    const first = realtime.watch("b1").subscribe(() => undefined);
    const second = realtime.watch("b1").subscribe(() => undefined);
    expect(realtime.activeBoards).toBe(1);

    first.unsubscribe();
    expect(realtime.activeBoards).toBe(1);

    second.unsubscribe();
    expect(realtime.activeBoards).toBe(0);
  });

  it("does not resurrect a released channel on publish", () => {
    const realtime = new RealtimeService();
    realtime.publish("b1", { type: "presence", op: "sync", users: [] });
    expect(realtime.activeBoards).toBe(0);
  });
});

/** TASK-146: a bounded number of live streams per instance/user/board. */
describe("RealtimeService.reserveSubscriber", () => {
  it("refuses past the per-user cap and frees a slot on release", () => {
    const realtime = new RealtimeService();
    const releases: Array<() => void> = [];
    for (;;) {
      const admission = realtime.reserveSubscriber("b1", "u1");
      if (!admission.ok) {
        expect(admission.reason).toBe("user");
        break;
      }
      releases.push(admission.release);
    }
    expect(releases.length).toBeGreaterThan(0);
    expect(realtime.subscriberCount).toBe(releases.length);

    // Release is idempotent and a freed slot is reusable.
    const release = releases[0];
    release();
    release();
    expect(realtime.subscriberCount).toBe(releases.length - 1);
    expect(realtime.reserveSubscriber("b1", "u1").ok).toBe(true);
  });

  it("counts users and boards independently", () => {
    const realtime = new RealtimeService();
    expect(realtime.reserveSubscriber("b1", "u1").ok).toBe(true);
    expect(realtime.reserveSubscriber("b2", "u2").ok).toBe(true);
    expect(realtime.subscriberCount).toBe(2);
  });
});
