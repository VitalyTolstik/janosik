import { EventEmitter } from "node:events";
import type { Response } from "express";
import { SSE_BURST_GRACE_MS, SseConnection, SseFrameStore } from "./sse-frames";

/** Minimal Express response the writer can drive without a socket. */
class FakeResponse extends EventEmitter {
  statusCode = 0;
  readonly headers: Record<string, string | number | string[]> = {};
  writableEnded = false;
  destroyed = false;
  readonly writes: Buffer[] = [];
  readonly flushHeaders = jest.fn();
  readonly socket = {
    setKeepAlive: jest.fn(),
    setNoDelay: jest.fn(),
    setTimeout: jest.fn(),
  };
  private readonly results: boolean[] = [];

  /** Queue the next `write()` return values (default: true). */
  accept(...values: boolean[]): void {
    this.results.push(...values);
  }

  write(chunk: string | Buffer): boolean {
    if (this.destroyed || this.writableEnded) {
      throw new Error("write after end");
    }
    this.writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return this.results.length === 0 ? true : (this.results.shift() as boolean);
  }

  setHeader(name: string, value: string | number | string[]): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  end(): void {
    if (this.writableEnded) return;
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

function connection(
  response: FakeResponse,
  overrides: Partial<{
    frames: SseFrameStore;
    maxBufferBytes: number;
    slowCloseMs: number;
    burstGraceMs: number;
    onSlowConsumer: (info: {
      reason: "buffer" | "timeout";
      queuedBytes: number;
      queuedFrames: number;
    }) => void;
    onClose: () => void;
  }> = {},
): SseConnection {
  return new SseConnection(response.asResponse(), {
    frames: overrides.frames ?? new SseFrameStore(),
    maxBufferBytes: overrides.maxBufferBytes ?? 1_000_000,
    slowCloseMs: overrides.slowCloseMs ?? 0,
    burstGraceMs: overrides.burstGraceMs,
    onSlowConsumer: overrides.onSlowConsumer,
    onClose: overrides.onClose,
  });
}

describe("SseFrameStore (TASK-200.13)", () => {
  it("serializes an event once and reuses the same Buffer for every subscriber", () => {
    const store = new SseFrameStore();
    const event = { type: "command", seq: 7, action: { type: "ADD_COLUMN" } };
    const stringify = jest.spyOn(JSON, "stringify");
    try {
      const first = store.frame(event);
      const second = store.frame(event);

      expect(stringify).toHaveBeenCalledTimes(1);
      expect(first).toBe(second);
      // Identity, not just equality: `res.write` receives the same bytes.
      expect(first.bytes).toBe(second.bytes);
      expect(store.builtCount).toBe(1);
      expect(first.bytes.toString("utf8")).toBe(
        `id: 1\ndata: ${JSON.stringify(event)}\n\n`,
      );
    } finally {
      stringify.mockRestore();
    }
  });

  it("does not alias different events and assigns increasing ids", () => {
    const store = new SseFrameStore();
    const first = store.frame({ type: "keepalive" });
    const second = store.frame({ type: "keepalive" });

    expect(store.builtCount).toBe(2);
    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(first.bytes).not.toBe(second.bytes);
  });

  it("shares a catch-up frame by command seq across fresh subscriber objects", () => {
    const store = new SseFrameStore();
    const first = store.frame({
      type: "command",
      seq: 7,
      action: { type: "UPDATE_CARD", description: "x".repeat(64 * 1024) },
    });
    const second = store.frame({
      type: "command",
      seq: 7,
      action: { type: "UPDATE_CARD", description: "x".repeat(64 * 1024) },
    });

    expect(store.builtCount).toBe(1);
    expect(store.cachedCommandFrames).toBe(1);
    expect(store.cachedCommandBytes).toBe(first.bytes.length);
    expect(second.bytes).toBe(first.bytes);
  });

  it("keeps the SSE data: framing for plain strings and embedded newlines", () => {
    const store = new SseFrameStore();
    expect(store.frame("ping").bytes.toString("utf8")).toBe(
      "id: 1\ndata: ping\n\n",
    );
    expect(store.frame("one\ntwo\r\nthree").bytes.toString("utf8")).toBe(
      "id: 2\ndata: one\ndata: two\ndata: three\n\n",
    );
  });
});

describe("SseConnection headers and fan-out (TASK-200.13)", () => {
  it("writes the same frame Buffer to every healthy subscriber", () => {
    const store = new SseFrameStore();
    const first = new FakeResponse();
    const second = new FakeResponse();
    const a = connection(first, { frames: store });
    const b = connection(second, { frames: store });
    a.open();
    b.open();

    const event = { type: "command", seq: 3 };
    a.write(event);
    b.write(event);

    expect(store.builtCount).toBe(1);
    // First write is the leading newline Nest's SseStream sends.
    expect(first.writes).toHaveLength(2);
    expect(second.writes).toHaveLength(2);
    expect(first.writes[1]).toBe(second.writes[1]);
    expect(a.bufferedFrames).toBe(0);
    expect(b.bufferedFrames).toBe(0);
  });

  it("shares 100 catch-up frames across three subscribers", () => {
    const store = new SseFrameStore();
    const responses = Array.from({ length: 3 }, () => new FakeResponse());
    const writers = responses.map((response) =>
      connection(response, { frames: store }),
    );
    for (const writer of writers) writer.open();
    const description = "x".repeat(64 * 1024);

    // Each subscriber runs its own delta query and gets fresh objects; the
    // store must still build one Buffer per command seq.
    for (const writer of writers) {
      for (let seq = 1; seq <= 100; seq += 1) {
        writer.write({
          type: "command",
          seq,
          action: { type: "UPDATE_CARD", description },
        });
      }
    }

    expect(store.builtCount).toBe(100);
    expect(store.cachedCommandFrames).toBe(100);
    expect(store.cachedCommandBytes).toBeLessThan(8 * 1024 * 1024);
    for (let seq = 0; seq < 100; seq += 1) {
      const frame = responses[0]?.writes[seq + 1];
      expect(frame).toBeDefined();
      for (const response of responses) {
        expect(response.writes[seq + 1]).toBe(frame);
      }
    }
  });

  it("uses one build for a large fan-out", () => {
    const store = new SseFrameStore();
    const responses = Array.from({ length: 64 }, () => new FakeResponse());
    const writers = responses.map((response) =>
      connection(response, { frames: store }),
    );
    for (const writer of writers) writer.open();

    const event = { type: "command", seq: 42, touches: [] };
    for (const writer of writers) writer.write(event);

    expect(store.builtCount).toBe(1);
    const frame = responses[0]?.writes[1];
    expect(frame).toBeDefined();
    for (const response of responses) {
      expect(response.writes[1]).toBe(frame);
    }
  });

  it("sets the documented SSE headers and socket options", () => {
    const response = new FakeResponse();
    const writer = connection(response);
    writer.open();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");
    expect(response.headers["x-accel-buffering"]).toBe("no");
    expect(response.flushHeaders).toHaveBeenCalledTimes(1);
    expect(response.writes[0]?.toString("utf8")).toBe("\n");
    expect(response.socket.setKeepAlive).toHaveBeenCalledWith(true);
    expect(response.socket.setNoDelay).toHaveBeenCalledWith(true);
    expect(response.socket.setTimeout).toHaveBeenCalledWith(0);
  });
});

describe("SseConnection backpressure (TASK-200.13)", () => {
  it("queues a bounded number of frames and flushes them in order on drain", () => {
    const store = new SseFrameStore();
    const response = new FakeResponse();
    const writer = connection(response, {
      frames: store,
      maxBufferBytes: 1_000_000,
    });
    writer.open();
    const one = { seq: 1 };
    const two = { seq: 2 };
    const three = { seq: 3 };
    const first = store.frame(one);
    const second = store.frame(two);
    const third = store.frame(three);

    // The first frame fills the socket: it is already accepted by Node, so it
    // must not be queued or resent.
    response.accept(false);
    writer.write(one);
    expect(writer.bufferedFrames).toBe(0);

    writer.write(two);
    writer.write(three);
    expect(writer.bufferedFrames).toBe(2);
    expect(writer.bufferedBytes).toBe(second.bytes.length + third.bytes.length);

    response.emit("drain");
    expect(writer.bufferedFrames).toBe(0);
    expect(writer.bufferedBytes).toBe(0);
    expect(response.writes.slice(1)).toEqual([
      first.bytes,
      second.bytes,
      third.bytes,
    ]);
  });

  it("flushes a queued final frame before a graceful end", () => {
    const store = new SseFrameStore();
    const response = new FakeResponse();
    const closed = jest.fn();
    const writer = connection(response, { frames: store, onClose: closed });
    writer.open();
    const one = { seq: 1 };
    const two = { seq: 2 };

    response.accept(false);
    writer.write(one);
    writer.write(two);
    writer.end();
    expect(writer.isClosed).toBe(false);
    expect(response.writableEnded).toBe(false);

    response.emit("drain");
    expect(writer.isClosed).toBe(true);
    expect(response.writableEnded).toBe(true);
    expect(response.writes.slice(1)).toEqual([
      store.frame(one).bytes,
      store.frame(two).bytes,
    ]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("keeps listening for drain across repeated backpressure cycles", () => {
    const store = new SseFrameStore();
    const response = new FakeResponse();
    const writer = connection(response, { frames: store });
    writer.open();
    const events = [{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }];
    const bytes = events.map((event) => store.frame(event).bytes);

    response.accept(false, true, false, true);
    writer.write(events[0]);
    writer.write(events[1]);
    response.emit("drain");
    writer.write(events[2]);
    writer.write(events[3]);
    response.emit("drain");

    expect(writer.bufferedFrames).toBe(0);
    expect(response.writes.slice(1)).toEqual(bytes);
  });

  it("lets a synchronous burst exceed the soft bound and drain without a drop", () => {
    const store = new SseFrameStore();
    const response = new FakeResponse();
    const slow = jest.fn();
    const event = { seq: 1 };
    const frame = store.frame(event);
    const writer = connection(response, {
      frames: store,
      maxBufferBytes: frame.bytes.length * 2,
      onSlowConsumer: slow,
    });
    writer.open();
    response.accept(false);
    writer.write(event); // blocked; already accepted by Node
    // One batch turn: three frames cross the soft bound (2 frames) but stay
    // well inside the 16 MiB hard guard, and `drain` cannot fire until this
    // synchronous burst ends.
    writer.write(event);
    writer.write(event);
    writer.write(event);
    expect(writer.bufferedFrames).toBe(3);
    expect(writer.isClosed).toBe(false);
    expect(slow).not.toHaveBeenCalled();

    response.emit("drain");
    expect(writer.isClosed).toBe(false);
    expect(writer.bufferedFrames).toBe(0);
    expect(response.writes.slice(1)).toEqual([
      frame.bytes,
      frame.bytes,
      frame.bytes,
      frame.bytes,
    ]);
    expect(slow).not.toHaveBeenCalled();
  });

  it.each([10, 100])(
    "drains a healthy %i x 64 KiB batch burst without dropping it",
    (count) => {
      const store = new SseFrameStore();
      const response = new FakeResponse();
      const slow = jest.fn();
      const writer = connection(response, {
        frames: store,
        maxBufferBytes: 128 * 1024,
        onSlowConsumer: slow,
      });
      writer.open();
      response.accept(false);
      const events = Array.from({ length: count }, (_, index) => ({
        seq: index + 1,
        description: "x".repeat(64 * 1024),
      }));
      for (const event of events) writer.write(event);

      // Far above the 128 KiB soft bound, far below the 16 MiB hard guard.
      expect(writer.isClosed).toBe(false);
      expect(writer.bufferedFrames).toBe(count - 1);
      expect(slow).not.toHaveBeenCalled();

      response.emit("drain");
      expect(writer.isClosed).toBe(false);
      expect(writer.bufferedFrames).toBe(0);
      expect(response.writes).toHaveLength(count + 1); // newline + frames
      expect(slow).not.toHaveBeenCalled();
    },
  );

  it("closes a slow reader after a 100 x 64 KiB burst when the grace expires", () => {
    jest.useFakeTimers();
    try {
      const store = new SseFrameStore();
      const response = new FakeResponse();
      const slow = jest.fn();
      const writer = connection(response, {
        frames: store,
        maxBufferBytes: 128 * 1024,
        onSlowConsumer: slow,
      });
      writer.open();
      response.accept(false);
      for (let index = 0; index < 100; index += 1) {
        writer.write({
          seq: index + 1,
          description: "x".repeat(64 * 1024),
        });
      }
      expect(writer.isClosed).toBe(false);

      jest.advanceTimersByTime(SSE_BURST_GRACE_MS);
      expect(writer.isClosed).toBe(true);
      expect(response.destroyed).toBe(true);
      expect(slow).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "buffer",
          queuedFrames: 99,
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("arms the grace after the publish turn so a blocking fan-out can drain", async () => {
    const store = new SseFrameStore();
    const response = new FakeResponse();
    const event = { seq: 1 };
    const frame = store.frame(event);
    const writer = connection(response, {
      frames: store,
      maxBufferBytes: frame.bytes.length * 2,
      // Short enough for a unit test; the controller uses the 5 s default.
      burstGraceMs: 20,
    });
    writer.open();
    response.accept(false);
    writer.write(event);
    writer.write(event);
    writer.write(event); // over the soft bound, inside the hard guard

    // A synchronous publish blocks longer than the grace. The old code had
    // already armed a timer; this implementation arms it only in the check
    // phase, after the timer/poll phases got their turn.
    const until = Date.now() + 40;
    while (Date.now() < until) {
      // deliberately block the event loop
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writer.isClosed).toBe(false);

    response.emit("drain");
    expect(writer.isClosed).toBe(false);
    expect(writer.bufferedFrames).toBe(0);
  });

  it("closes a burst past the 16 MiB hard referenced-byte guard", () => {
    const store = new SseFrameStore();
    const response = new FakeResponse();
    const slow = jest.fn();
    const closed = jest.fn();
    const writer = connection(response, {
      frames: store,
      maxBufferBytes: 128 * 1024,
      onSlowConsumer: slow,
      onClose: closed,
    });
    writer.open();
    response.accept(false);
    // 17 × 1 MiB is past the hard guard, so the heap safety valve fires
    // immediately even though the burst would otherwise get the grace.
    let last: { seq: number; text: string } | undefined;
    for (let index = 0; index < 17; index += 1) {
      last = { seq: index + 1, text: "x".repeat(1024 * 1024) };
      writer.write(last);
    }
    expect(writer.isClosed).toBe(true);
    expect(writer.bufferedFrames).toBe(0);
    expect(slow).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "buffer",
        queuedFrames: 16,
      }),
    );
    expect(closed).toHaveBeenCalledTimes(1);
    expect(response.destroyed).toBe(true);
    expect(response.writes).toHaveLength(2);

    // Late emissions after a slow disconnect are ignored, not queued.
    writer.write(last ?? { seq: 99 });
    expect(response.writes).toHaveLength(2);
  });

  it("drops an over-bound queue when the burst grace expires without drain", () => {
    jest.useFakeTimers();
    try {
      const store = new SseFrameStore();
      const response = new FakeResponse();
      const slow = jest.fn();
      const event = { seq: 1 };
      const frame = store.frame(event);
      const writer = connection(response, {
        frames: store,
        maxBufferBytes: frame.bytes.length * 2,
        onSlowConsumer: slow,
      });
      writer.open();
      response.accept(false);
      writer.write(event); // blocked frame
      writer.write(event);
      writer.write(event);
      writer.write(event); // 3 queued frames > the soft bound of 2
      expect(writer.isClosed).toBe(false);

      jest.advanceTimersByTime(SSE_BURST_GRACE_MS - 1);
      expect(writer.isClosed).toBe(false);
      jest.advanceTimersByTime(1);
      expect(writer.isClosed).toBe(true);
      expect(slow).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "buffer", queuedFrames: 3 }),
      );
      expect(response.destroyed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("treats SSE_MAX_BUFFER_BYTES=0 as no queue after backpressure", () => {
    const store = new SseFrameStore();
    const response = new FakeResponse();
    const slow = jest.fn();
    const event = { seq: 1 };
    const writer = connection(response, {
      frames: store,
      maxBufferBytes: 0,
      onSlowConsumer: slow,
    });
    writer.open();
    response.accept(false);
    writer.write(event); // the accepted in-flight frame
    expect(writer.isClosed).toBe(false);
    writer.write(event); // first frame that has to be queued
    expect(writer.isClosed).toBe(true);
    expect(slow).toHaveBeenCalledWith({
      reason: "buffer",
      queuedBytes: store.frame(event).bytes.length,
      queuedFrames: 1,
    });
  });

  it("closes a socket that stays blocked past the timeout even under the bound", () => {
    jest.useFakeTimers();
    try {
      const response = new FakeResponse();
      const slow = jest.fn();
      const writer = connection(response, {
        maxBufferBytes: 1_000_000,
        slowCloseMs: 5_000,
        onSlowConsumer: slow,
      });
      writer.open();
      response.accept(false);
      writer.write({ seq: 1 });
      expect(writer.isClosed).toBe(false);

      jest.advanceTimersByTime(4_999);
      expect(writer.isClosed).toBe(false);
      jest.advanceTimersByTime(1);
      expect(writer.isClosed).toBe(true);
      expect(slow).toHaveBeenCalledWith({
        reason: "timeout",
        queuedBytes: 0,
        queuedFrames: 0,
      });
      expect(response.destroyed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("clears the slow timer when the socket drains normally", () => {
    jest.useFakeTimers();
    try {
      const response = new FakeResponse();
      const slow = jest.fn();
      const writer = connection(response, {
        maxBufferBytes: 1_000_000,
        slowCloseMs: 5_000,
        onSlowConsumer: slow,
      });
      writer.open();
      response.accept(false);
      writer.write({ seq: 1 });
      response.emit("drain");
      jest.advanceTimersByTime(10_000);
      expect(writer.isClosed).toBe(false);
      expect(slow).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops writing when the peer disconnects and calls onClose once", () => {
    const response = new FakeResponse();
    const closed = jest.fn();
    const writer = connection(response, { onClose: closed });
    writer.open();
    response.emit("close");

    expect(writer.isClosed).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    writer.write({ seq: 1 });
    writer.dispose();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(response.writes).toHaveLength(1);
  });
});
