import { Logger } from "@nestjs/common";
import {
  EventsController,
  parsePresence,
  presenceEnabledFor,
} from "./events.controller";
import { KeepAliveScheduler } from "@/realtime/keep-alive";

describe("SSE presence default (TASK-200.5)", () => {
  it("keeps presence on for a browser JWT and off for an agent PAT", () => {
    expect(presenceEnabledFor(undefined, "jwt")).toBe(true);
    expect(presenceEnabledFor(undefined, "pat")).toBe(false);
    expect(presenceEnabledFor(undefined, undefined)).toBe(true);
  });

  it("honours an explicit opt-in and opt-out for either principal", () => {
    expect(presenceEnabledFor("0", "jwt")).toBe(false);
    expect(presenceEnabledFor("false", "jwt")).toBe(false);
    expect(presenceEnabledFor("1", "pat")).toBe(true);
    expect(presenceEnabledFor("true", "pat")).toBe(true);
  });

  it("treats any other value as 'use the default'", () => {
    expect(parsePresence("")).toBeUndefined();
    expect(parsePresence("yes")).toBeUndefined();
    expect(presenceEnabledFor("yes", "pat")).toBe(false);
  });
});

describe("EventsController shutdown (TASK-200.5)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("stops every stream keep-alive timer on module destroy", async () => {
    const controller = new EventsController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const task = jest.fn();
    const scheduler = new KeepAliveScheduler({
      baseMs: 100,
      jitterMs: 0,
      task,
    });
    scheduler.start();
    const privateController = controller as unknown as {
      keepAlives: Set<KeepAliveScheduler>;
    };
    privateController.keepAlives.add(scheduler);

    controller.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(1000);
    expect(task).not.toHaveBeenCalled();
    expect(privateController.keepAlives.size).toBe(0);
    expect(scheduler.isStopped).toBe(true);
  });

  it("completes every open stream on module destroy (TASK-200.12)", () => {
    const controller = new EventsController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const first = jest.fn();
    const second = jest.fn();
    const privateController = controller as unknown as {
      streamClosers: Set<() => void>;
    };
    privateController.streamClosers.add(first);
    privateController.streamClosers.add(second);

    controller.onModuleDestroy();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(privateController.streamClosers.size).toBe(0);
  });

  it("aggregates overlap skips into one log line per minute", () => {
    jest.setSystemTime(new Date("2026-11-23T10:00:00Z"));
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    try {
      const controller = new EventsController(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const note = (
        controller as unknown as { noteKeepAliveSkip: () => void }
      ).noteKeepAliveSkip.bind(controller);

      for (let i = 0; i < 100; i += 1) note();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("1 skipped"));

      jest.advanceTimersByTime(60_000);
      note();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
