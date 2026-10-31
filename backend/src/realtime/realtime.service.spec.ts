import { Logger } from "@nestjs/common";
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

  it("exempts anonymous (public share) streams from the per-user cap", () => {
    const realtime = new RealtimeService();
    const releases: Array<() => void> = [];
    // Well past SSE_MAX_PER_USER (32): a popular share link must not be
    // throttled as if it were one user.
    for (let index = 0; index < 40; index += 1) {
      const admission = realtime.reserveSubscriber("b1", null);
      expect(admission.ok).toBe(true);
      if (admission.ok) releases.push(admission.release);
    }
    expect(realtime.subscriberCount).toBe(40);
    for (const release of releases) release();
    expect(realtime.subscriberCount).toBe(0);
  });
});

/** TASK-140: the live-stream count and refusals are visible in the logs. */
describe("RealtimeService connection logging", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("logs the live count once a minute while streams are open", () => {
    jest.useFakeTimers();
    const log = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    const realtime = new RealtimeService();
    realtime.onModuleInit();
    const admission = realtime.reserveSubscriber("b1", "u1");
    expect(admission.ok).toBe(true);

    jest.advanceTimersByTime(60_000);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Live SSE connections: 1"),
    );

    if (admission.ok) admission.release();
    void realtime.onModuleDestroy();
  });

  it("stays quiet while no stream is (or was) open", () => {
    jest.useFakeTimers();
    const log = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    const realtime = new RealtimeService();
    realtime.onModuleInit();
    jest.advanceTimersByTime(180_000);
    expect(log).not.toHaveBeenCalled();
    void realtime.onModuleDestroy();
  });

  it("warns when a stream is refused past a cap", () => {
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const realtime = new RealtimeService();
    // Exhaust the per-user cap; the refusal must be logged with its reason.
    for (let index = 0; index < 100; index += 1) {
      if (!realtime.reserveSubscriber("b1", "u1").ok) break;
    }
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("SSE stream refused (user limit"),
    );
  });
});
