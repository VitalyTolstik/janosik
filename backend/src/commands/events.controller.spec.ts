import { Logger, type MessageEvent } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import { Observable } from "rxjs";
import {
  EventsController,
  parsePresence,
  presenceEnabledFor,
} from "./events.controller";
import { KeepAliveScheduler } from "@/realtime/keep-alive";
import { SseFrameStore } from "@/realtime/sse-frames";

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

describe("EventsController slow subscribers (TASK-200.13)", () => {
  it("drops a blocked stream and records the realtime metric", () => {
    const response = new SlowResponse();
    // The leading header newline is accepted; the first command frame fills
    // the socket, and the second one (200 KB) would exceed the buffer bound.
    response.accept(true, false);
    const noteSlowSubscriber = jest.fn();
    const store = new SseFrameStore();
    const controller = new EventsController(
      {} as never,
      { noteSlowSubscriber } as never,
      {} as never,
      {} as never,
      {} as never,
      store,
    );
    const big = {
      type: "command",
      seq: 1,
      action: { type: "UPDATE_CARD", description: "x".repeat(200_000) },
    };
    const teardown = jest.fn();
    (
      controller as unknown as { stream: () => Observable<MessageEvent> }
    ).stream = () =>
      new Observable<MessageEvent>((subscriber) => {
        subscriber.next({ data: big } as MessageEvent);
        subscriber.next({ data: { ...big, seq: 2 } } as MessageEvent);
        // Deliberately no complete(): the slow close happens while subscribe
        // is still running, before `serve` owns a Subscription.
        return teardown;
      });

    (
      controller as unknown as {
        serve: (
          boardId: string,
          since: number,
          clientId: string,
          presence: boolean,
          release: () => void,
          res: Response,
        ) => void;
      }
    ).serve("board-1", 0, "client-1", false, jest.fn(), response.asResponse());

    expect(noteSlowSubscriber).toHaveBeenCalledWith(
      "board-1",
      expect.objectContaining({ reason: "buffer" }),
    );
    expect(response.destroyed).toBe(true);
    // The stream teardown (which releases the admission slot and stops the
    // keep-alive) ran even though the close happened during subscribe.
    expect(teardown).toHaveBeenCalledTimes(1);
    // Nothing after the disconnect is written.
    expect(response.writes.length).toBeLessThanOrEqual(2);
  });
});

/** Minimal response for the slow-consumer wiring test. */
class SlowResponse extends EventEmitter {
  statusCode = 0;
  writableEnded = false;
  destroyed = false;
  readonly writes: Buffer[] = [];
  readonly socket = {
    setKeepAlive: jest.fn(),
    setNoDelay: jest.fn(),
    setTimeout: jest.fn(),
  };
  private readonly results: boolean[] = [];

  accept(...values: boolean[]): void {
    this.results.push(...values);
  }

  write(chunk: string | Buffer): boolean {
    this.writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return this.results.length === 0 ? true : (this.results.shift() as boolean);
  }

  setHeader(): this {
    return this;
  }

  flushHeaders(): void {}

  end(): void {
    this.writableEnded = true;
    this.emit("close");
  }

  destroy(): void {
    this.destroyed = true;
    this.writableEnded = true;
    this.emit("close");
  }

  asResponse(): Response {
    return this as unknown as Response;
  }
}
