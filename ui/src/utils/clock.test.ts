import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * TASK-156: every due badge shares one minute tick and one pair of
 * focus/visibility listeners, instead of one timer per card.
 */
describe("clock", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("runs a single interval for all subscribers and fans out the tick", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    vi.resetModules();

    const interval = vi.spyOn(globalThis, "setInterval");
    const onWindow = vi.spyOn(window, "addEventListener");
    const onDocument = vi.spyOn(document, "addEventListener");
    const { getClockNow, subscribeClock } = await import("./clock");

    const alice = vi.fn();
    const bob = vi.fn();
    subscribeClock(alice);
    subscribeClock(bob);

    expect(interval).toHaveBeenCalledTimes(1);
    expect(onWindow).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(onDocument).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );

    const before = getClockNow();
    vi.advanceTimersByTime(60_000);

    expect(getClockNow()).toBeGreaterThan(before);
    expect(alice).toHaveBeenCalledTimes(1);
    expect(bob).toHaveBeenCalledTimes(1);
  });

  it("re-stamps the clock when the first subscriber joins after an idle (TASK-156 review)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    vi.resetModules();
    const { getClockNow, subscribeClock } = await import("./clock");

    // The module loaded three hours ago and nobody subscribed since: a
    // badge joining now would classify against 12:00 until the first
    // 60 s tick. It must see the current time instead.
    vi.setSystemTime(new Date("2026-10-29T15:00:00Z"));
    const listener = vi.fn();
    subscribeClock(listener);

    expect(getClockNow()).toBe(new Date("2026-10-29T15:00:00Z").getTime());
    // Re-stamping is not a tick: existing listeners are not woken.
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribes without disturbing the remaining subscribers", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    vi.resetModules();
    const { getClockNow, subscribeClock } = await import("./clock");

    const alice = vi.fn();
    const bob = vi.fn();
    const unsubscribeAlice = subscribeClock(alice);
    subscribeClock(bob);

    unsubscribeAlice();
    const before = getClockNow();
    vi.advanceTimersByTime(60_000);

    // Only the remaining subscriber is served; the clock itself keeps
    // running (one shared interval, never torn down per badge).
    expect(alice).not.toHaveBeenCalled();
    expect(bob).toHaveBeenCalledTimes(1);
    expect(getClockNow()).toBeGreaterThan(before);
  });
});
