import { ConflictException, Logger, type MessageEvent } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import { Observable } from "rxjs";
import {
  EventsController,
  parsePresence,
  presenceEnabledFor,
} from "./events.controller";
import { KeepAliveScheduler } from "@/realtime/keep-alive";
import { SSE_BURST_GRACE_MS, SseFrameStore } from "@/realtime/sse-frames";

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

describe("EventsController setup errors (TASK-200.13)", () => {
  it("ends instead of throwing when setup fails after headers were sent", () => {
    const response = new SlowResponse();
    response.headersSent = true;
    const release = jest.fn();
    const controller = new EventsController(
      {} as never,
      { noteSlowSubscriber: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      new SseFrameStore(),
    );
    (
      controller as unknown as { stream: () => Observable<MessageEvent> }
    ).stream = () =>
      new Observable<MessageEvent>((subscriber) => {
        subscriber.error(new Error("late setup failure"));
      });

    expect(() =>
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
      ).serve("board-1", 0, "client-1", false, release, response.asResponse()),
    ).not.toThrow();
    expect(response.writableEnded).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("throws a synchronous setup error before any SSE headers are sent", () => {
    const response = new SlowResponse();
    const release = jest.fn();
    const controller = new EventsController(
      {} as never,
      { noteSlowSubscriber: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      new SseFrameStore(),
    );
    (
      controller as unknown as { stream: () => Observable<MessageEvent> }
    ).stream = () =>
      new Observable<MessageEvent>((subscriber) => {
        // e.g. the client id was claimed between the pre-check and `join`.
        subscriber.error(new ConflictException("client_id_taken"));
      });

    expect(() =>
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
      ).serve("board-1", 0, "client-1", true, release, response.asResponse()),
    ).toThrow(ConflictException);

    // The UI can still act on the 409: no 200 stream started.
    expect(response.flushHeaders).not.toHaveBeenCalled();
    expect(response.writes).toHaveLength(0);
    expect(response.destroyed).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("EventsController stream setup cleanup (TASK-200.13)", () => {
  it("leaves presence when watch() throws after a successful join", () => {
    const release = jest.fn();
    const leave = jest.fn();
    const controller = new EventsController(
      {} as never,
      {
        watch: () => {
          throw new Error("watch down");
        },
      } as never,
      {
        join: () => ({ roster: [], token: "presence-token" }),
        leave,
      } as never,
      {} as never,
      {} as never,
      new SseFrameStore(),
    );
    const errors: unknown[] = [];
    (
      controller as unknown as {
        stream: (
          boardId: string,
          since: number,
          clientId: string,
          presence: boolean,
          release: () => void,
          user: unknown,
          principal: unknown,
        ) => Observable<MessageEvent>;
      }
    )
      .stream(
        "board-1",
        0,
        "client-1",
        true,
        release,
        { id: "user-1" },
        { via: "jwt" },
      )
      .subscribe({ error: (error: unknown) => errors.push(error) });

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("watch down");
    expect(release).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledWith("board-1", "client-1", "presence-token");
  });
});

describe("EventsController slow subscribers (TASK-200.13)", () => {
  it("drops a blocked stream and records the realtime metric", () => {
    jest.useFakeTimers();
    try {
      const response = new SlowResponse();
      // The leading header newline is accepted; the first command frame fills
      // the socket, and the next three (200 KB each) queue above the soft
      // bound while still under the 16 MiB hard guard.
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
          for (let seq = 1; seq <= 4; seq += 1) {
            subscriber.next({ data: { ...big, seq } } as MessageEvent);
          }
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
      ).serve(
        "board-1",
        0,
        "client-1",
        false,
        jest.fn(),
        response.asResponse(),
      );

      // A queued burst gets a grace window; this reader never drains.
      expect(noteSlowSubscriber).not.toHaveBeenCalled();
      jest.advanceTimersByTime(SSE_BURST_GRACE_MS);
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
    } finally {
      jest.useRealTimers();
    }
  });
});

/** Minimal response for the slow-consumer wiring test. */
class SlowResponse extends EventEmitter {
  statusCode = 0;
  writableEnded = false;
  destroyed = false;
  headersSent = false;
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

  readonly flushHeaders = jest.fn();

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
