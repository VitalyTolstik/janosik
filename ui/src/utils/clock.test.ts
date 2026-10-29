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
});
