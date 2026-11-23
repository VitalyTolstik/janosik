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
  /**
   * SSE `id:` line. This is a **process frame id**, not a per-connection
   * cursor: every subscriber of one event gets the same id, and a reconnect
   * resumes from `?since=<board seq>` (Last-Event-ID is not read by the API).
   */
  id: number;
  /** Complete `id:`/`data:` block, including the trailing blank line. */
  bytes: Buffer;
}

/**
 * A synchronous burst (one command batch publishes N frames in one turn)
 * cannot see `drain` until the JavaScript stack unwinds. Let such a burst
 * exceed the soft queue bound for this long before the subscriber is treated
 * as slow; a real reader drains well inside the window.
 */
export const SSE_BURST_GRACE_MS = 500;

/**
 * Hard heap guard while the grace window is open: the queue may grow to
 * this multiple of the soft bound, no further. A burst still larger is
 * dropped immediately.
 */
export const SSE_BURST_EMERGENCY_FACTOR = 4;

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
   * Soft byte bound on queued frames. The frame whose `write()` returned
   * `false` was already accepted by Node and is not counted here, so the
   * effective worst case is this bound plus that one in-flight frame. A
   * synchronous burst may exceed the soft bound for `SSE_BURST_GRACE_MS`
   * (up to `SSE_BURST_EMERGENCY_FACTOR` ×) while `drain` is pending. 0 means
   * "no queued frames": the first frame after backpressure is dropped.
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
  /** The soft bound was crossed; a burst is waiting for `drain`. */
  private overflowed = false;
  private burstTimer: NodeJS.Timeout | null = null;

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

  /** Have the SSE response headers been sent? */
  get responseStarted(): boolean {
    return this.headersCommitted;
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
    try {
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
    } catch (error) {
      // Nothing was committed if a header setter failed; let the caller turn
      // the error into a normal HTTP response instead of an empty 200 stream.
      this.headersCommitted = false;
      throw error;
    }
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
    this.queue.push(frame);
    this.queuedBytes += frame.bytes.length;
    this.noteOverflow();
  }

  private drain(): void {
    if (this.closed || !this.blocked) return;
    this.blocked = false;
    this.clearSlowTimer();
    this.clearBurstGrace();
    let index = 0;
    while (index < this.queue.length) {
      const frame = this.queue[index];
      index += 1;
      this.queuedBytes -= frame.bytes.length;
      let accepted: boolean;
      try {
        accepted = this.res.write(frame.bytes);
      } catch {
        this.peerClosed();
        return;
      }
      if (!accepted) {
        // Drop the written head in one splice, not one shift per frame.
        if (index > 0) this.queue.splice(0, index);
        this.block();
        return;
      }
    }
    this.queue.length = 0;
    this.queuedBytes = 0;
    if (this.ending) this.finish();
  }

  /**
   * The soft bound was crossed while blocked. A synchronous burst gets a
   * short grace window to reach `drain`; past the emergency multiple, or
   * after the window without drain, the subscriber is slow and dropped.
   */
  private noteOverflow(): void {
    if (this.closed || !this.blocked) return;
    const max = this.options.maxBufferBytes;
    if (max <= 0) {
      if (this.queuedBytes > 0) {
        this.closeSlow("buffer", this.queuedBytes, this.queue.length);
      }
      return;
    }
    if (this.queuedBytes <= max) return;
    if (this.queuedBytes > max * SSE_BURST_EMERGENCY_FACTOR) {
      this.closeSlow("buffer", this.queuedBytes, this.queue.length);
      return;
    }
    if (this.overflowed || this.burstTimer !== null) return;
    this.overflowed = true;
    this.burstTimer = setTimeout(() => {
      this.burstTimer = null;
      if (this.closed || !this.blocked) return;
      this.closeSlow("buffer", this.queuedBytes, this.queue.length);
    }, SSE_BURST_GRACE_MS);
    this.burstTimer.unref?.();
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
    if (this.closed) return;
    this.blocked = true;
    if (this.options.slowCloseMs > 0 && this.slowTimer === null) {
      this.slowTimer = setTimeout(() => {
        this.slowTimer = null;
        if (this.closed || !this.blocked) return;
        this.closeSlow("timeout", this.queuedBytes, this.queue.length);
      }, this.options.slowCloseMs);
      this.slowTimer.unref?.();
    }
    // A drain flush may block with frames still queued.
    this.noteOverflow();
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
    this.clearBurstGrace();
  }

  private clearSlowTimer(): void {
    if (this.slowTimer === null) return;
    clearTimeout(this.slowTimer);
    this.slowTimer = null;
  }

  private clearBurstGrace(): void {
    this.overflowed = false;
    if (this.burstTimer === null) return;
    clearTimeout(this.burstTimer);
    this.burstTimer = null;
  }

  private detach(): void {
    this.res.removeListener("drain", this.onDrain);
    this.res.removeListener("close", this.onPeerClose);
  }
}
