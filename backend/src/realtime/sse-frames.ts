import type { Response } from "express";

/**
 * Pre-serialized SSE frames (TASK-200.13).
 *
 * Nest's `@Sse` route serializes every event separately for every subscriber
 * (`SseStream.writeMessage` → `JSON.stringify`), so one 64 KB command frame
 * becomes N strings and N buffers at N connections. A board event, however,
 * is identical for every subscriber: this store turns it into one wire frame
 * the first time and hands the **same Buffer** to all of them.
 *
 * The cache is keyed by object identity in a `WeakMap`: the frame lives as
 * long as the published event object (one fan-out), then both are collected.
 * Nothing is keyed by board or sequence, so a cached frame can never be
 * served for a different event.
 */
export interface SseFrame {
  /** SSE `id:` line. Monotonic per process; resume still uses `?since=`. */
  id: number;
  /** Complete `id:`/`data:` block, including the trailing blank line. */
  bytes: Buffer;
}

export class SseFrameStore {
  private readonly cache = new WeakMap<object, SseFrame>();
  private nextId = 1;
  private builds = 0;

  /**
   * The complete SSE frame for `data`, building it at most once per object.
   * Strings are not cached by identity (they have no stable identity worth a
   * map); the board stream only sends objects, but a raw `ping` stays legal.
   */
  frame(data: unknown): SseFrame {
    if (typeof data === "object" && data !== null) {
      const cached = this.cache.get(data);
      if (cached !== undefined) return cached;
      const frame = this.build(data);
      this.cache.set(data, frame);
      return frame;
    }
    return this.build(data);
  }

  /**
   * Frames built so far — a fan-out test hook and an observability metric.
   * With N subscribers it grows by one per published event, not by N.
   */
  get builtCount(): number {
    return this.builds;
  }

  private build(data: unknown): SseFrame {
    const id = this.nextId;
    this.nextId += 1;
    const text =
      typeof data === "string" ? data : (JSON.stringify(data) ?? "null");
    // Same framing as Nest's SseStream: each logical line gets `data: ` and
    // the block ends with an empty line. JSON.stringify escapes raw newlines,
    // but a plain string frame may contain one, so split like Nest does.
    let payload = "";
    for (const line of text.split(/\r\n|\r|\n/)) payload += `data: ${line}\n`;
    const bytes = Buffer.from(`id: ${id}\n${payload}\n`, "utf8");
    this.builds += 1;
    return { id, bytes };
  }
}

export type SlowSseCloseReason = "buffer" | "timeout";

/** Why a subscriber was dropped — fed to the metric/log in RealtimeService. */
export interface SlowSseConsumer {
  reason: SlowSseCloseReason;
  queuedBytes: number;
  queuedFrames: number;
}

export interface SseConnectionOptions {
  frames: SseFrameStore;
  /**
   * Bytes a blocked subscriber may hold before it is disconnected. A healthy
   * socket drains on the next tick; only a reader that stopped reading
   * accumulates a queue. 0 disconnects on the first blocked frame.
   */
  maxBufferBytes: number;
  /**
   * How long `write()` may keep returning `false` before the connection is
   * presumed dead. 0 disables the timer and relies on the buffer bound.
   */
  slowCloseMs: number;
  onSlowConsumer?: (info: SlowSseConsumer) => void;
  /** The peer went away, or the connection was closed as slow/dead. */
  onClose?: () => void;
}

/**
 * One SSE response with bounded backpressure.
 *
 * Node reports a full socket buffer by returning `false` from `write()`;
 * `drain` means it can take more. Frames emitted in between are queued (with
 * their shared Buffers, no copies) until the bound is hit, at which point the
 * connection is destroyed instead of growing the heap without limit. No
 * healthy subscriber loses a frame: only a subscriber that already exceeded
 * the bound is dropped, and its client reconnects with its last applied
 * `?since=` — the normal replay/resync path.
 */
export class SseConnection {
  private headersCommitted = false;
  private closed = false;
  private blocked = false;
  /** The source finished; flush what is queued, then end (no new frames). */
  private ending = false;
  private readonly queue: SseFrame[] = [];
  private queuedBytes = 0;
  private slowTimer: NodeJS.Timeout | null = null;

  private readonly onDrain = (): void => this.drain();
  private readonly onPeerClose = (): void => this.peerClosed();

  constructor(
    private readonly res: Response,
    private readonly options: SseConnectionOptions,
  ) {
    // `drain` may fire once per blocked cycle, so it cannot be `once`.
    this.res.on("drain", this.onDrain);
    this.res.once("close", this.onPeerClose);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Frames still waiting for `drain` (tests/diagnostics). */
  get bufferedFrames(): number {
    return this.queue.length;
  }

  get bufferedBytes(): number {
    return this.queuedBytes;
  }

  /**
   * Send the stream headers and the leading newline Nest's SseStream writes.
   * Kept separate from the first `write()` so a client's `fetch` resolves as
   * soon as the route is admitted, exactly like `@Sse`.
   */
  open(): void {
    if (this.closed || this.headersCommitted) return;
    if (this.res.writableEnded || this.res.destroyed) {
      this.peerClosed();
      return;
    }
    this.headersCommitted = true;
    const socket = this.res.socket;
    socket?.setKeepAlive(true);
    socket?.setNoDelay(true);
    socket?.setTimeout(0);
    this.res.statusCode = 200;
    this.res.setHeader("Content-Type", "text/event-stream");
    this.res.setHeader("Connection", "keep-alive");
    this.res.setHeader(
      "Cache-Control",
      "private, no-cache, no-store, must-revalidate, max-age=0, no-transform",
    );
    this.res.setHeader("Pragma", "no-cache");
    this.res.setHeader("Expire", "0");
    // TASK-38a: nginx must not buffer the stream.
    this.res.setHeader("X-Accel-Buffering", "no");
    this.res.flushHeaders?.();
    if (!this.res.write("\n")) this.block();
  }

  /** Serialize/build (once per event) and write one frame to this client. */
  write(data: unknown): void {
    if (this.closed || this.ending) return;
    if (!this.headersCommitted) this.open();
    if (this.closed) return;
    const frame = this.options.frames.frame(data);
    if (this.blocked) {
      this.enqueue(frame);
      return;
    }
    this.writeFrame(frame);
  }

  /**
   * End a stream that finished/errored on the server (not a slow client).
   * A frame already accepted by the socket is flushed by `end()`; a frame
   * still in our bounded queue is written on `drain` first, so a momentarily
   * busy but healthy subscriber keeps the final event.
   */
  end(): void {
    if (this.closed || this.ending) return;
    if (this.blocked) {
      this.ending = true;
      return;
    }
    this.finish();
  }

  /** Release a client that is already gone; never writes or ends twice. */
  dispose(): void {
    if (this.closed) {
      this.detach();
      return;
    }
    this.closed = true;
    this.discardQueue();
    this.detach();
  }

  private writeFrame(frame: SseFrame): void {
    let accepted: boolean;
    try {
      accepted = this.res.write(frame.bytes);
    } catch {
      this.peerClosed();
      return;
    }
    if (!accepted) this.block();
  }

  private enqueue(frame: SseFrame): void {
    const queuedFrames = this.queue.length + 1;
    const queuedBytes = this.queuedBytes + frame.bytes.length;
    if (queuedBytes > this.options.maxBufferBytes) {
      this.closeSlow("buffer", queuedBytes, queuedFrames);
      return;
    }
    this.queue.push(frame);
    this.queuedBytes = queuedBytes;
  }

  private drain(): void {
    if (this.closed || !this.blocked) return;
    this.blocked = false;
    this.clearSlowTimer();
    while (this.queue.length > 0) {
      const frame = this.queue.shift();
      if (frame === undefined) break;
      this.queuedBytes -= frame.bytes.length;
      let accepted: boolean;
      try {
        accepted = this.res.write(frame.bytes);
      } catch {
        this.peerClosed();
        return;
      }
      if (!accepted) {
        this.block();
        return;
      }
    }
    this.queuedBytes = 0;
    if (this.ending) this.finish();
  }

  /** Close the response after the last queued frame was handed to Node. */
  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.ending = false;
    this.discardQueue();
    this.detach();
    try {
      if (!this.res.writableEnded) this.res.end();
    } catch {
      /* the peer may already be gone */
    }
    this.options.onClose?.();
  }

  private block(): void {
    this.blocked = true;
    if (this.options.slowCloseMs <= 0 || this.slowTimer !== null) return;
    this.slowTimer = setTimeout(() => {
      this.slowTimer = null;
      if (this.closed || !this.blocked) return;
      this.closeSlow("timeout", this.queuedBytes, this.queue.length);
    }, this.options.slowCloseMs);
    this.slowTimer.unref?.();
  }

  /**
   * The subscriber stopped reading: drop the queued frames and the socket.
   * Its client reconnects from `?since=` and the command log repairs the gap;
   * keeping the connection alive would trade a visible reconnect for
   * unbounded memory.
   */
  private closeSlow(
    reason: SlowSseCloseReason,
    queuedBytes: number,
    queuedFrames: number,
  ): void {
    if (this.closed) return;
    this.closed = true;
    this.discardQueue();
    this.detach();
    this.options.onSlowConsumer?.({ reason, queuedBytes, queuedFrames });
    try {
      this.res.destroy();
    } catch {
      /* already destroyed */
    }
    this.options.onClose?.();
  }

  private peerClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.discardQueue();
    this.detach();
    this.options.onClose?.();
  }

  private discardQueue(): void {
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.blocked = false;
    this.clearSlowTimer();
  }

  private clearSlowTimer(): void {
    if (this.slowTimer === null) return;
    clearTimeout(this.slowTimer);
    this.slowTimer = null;
  }

  private detach(): void {
    this.res.removeListener("drain", this.onDrain);
    this.res.removeListener("close", this.onPeerClose);
  }
}
