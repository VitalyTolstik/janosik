import { KeepAliveScheduler, keepAliveDelay } from "./keep-alive";

describe("keepAliveDelay (TASK-200.5)", () => {
  it("stays inside [base, base + jitter]", () => {
    expect(keepAliveDelay(25_000, 2_500, () => 0)).toBe(25_000);
    expect(keepAliveDelay(25_000, 2_500, () => 0.999999)).toBe(27_500);
    expect(keepAliveDelay(25_000, 0, () => 0.5)).toBe(25_000);
  });

  it("never goes below the base for a negative jitter", () => {
    expect(keepAliveDelay(60_000, -100, () => 0.5)).toBe(60_000);
  });
});

describe("KeepAliveScheduler (TASK-200.5)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("fires with jitter and keeps one timer across start() calls", async () => {
    const task = jest.fn();
    const scheduler = new KeepAliveScheduler({
      baseMs: 1000,
      jitterMs: 100,
      random: () => 0.5,
      task,
    });
    scheduler.start();
    scheduler.start();
    await jest.advanceTimersByTimeAsync(1049);
    expect(task).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("skips a beat while the previous tick is still running", async () => {
    let release: (() => void) | undefined;
    const task = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const onSkip = jest.fn();
    const scheduler = new KeepAliveScheduler({
      baseMs: 100,
      jitterMs: 0,
      task,
      onSkip,
    });
    scheduler.start();
    await jest.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(1);
    expect(scheduler.tickInFlight).toBe(true);

    // Two further beats pass while the first task is unresolved: no second
    // validation query set is allowed to start.
    await jest.advanceTimersByTimeAsync(200);
    expect(task).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(2);

    release?.();
    await jest.advanceTimersByTimeAsync(1);
    expect(scheduler.tickInFlight).toBe(false);
    await jest.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("stop() clears the timer and prevents rescheduling after an in-flight tick", async () => {
    let release: (() => void) | undefined;
    const task = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const scheduler = new KeepAliveScheduler({
      baseMs: 100,
      jitterMs: 0,
      task,
    });
    scheduler.start();
    await jest.advanceTimersByTimeAsync(100);
    scheduler.stop();
    release?.();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(scheduler.isStopped).toBe(true);
  });

  it("start() after stop() is a no-op", async () => {
    const task = jest.fn();
    const scheduler = new KeepAliveScheduler({
      baseMs: 100,
      jitterMs: 0,
      task,
    });
    scheduler.stop();
    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    expect(task).not.toHaveBeenCalled();
  });
});
