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
});
