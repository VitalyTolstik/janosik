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
export const SSE_BURST_GRACE_MS = 5_000;

/**
 * Hard referenced-byte cap while a burst is queued. A legitimate command
 * batch carries at most 10 MiB of JSON; 100 × 64 KiB frames are ~6.4 MiB, so
 * 16 MiB leaves room for framing and multiple shared events. This is a bound
 * on Buffer **references** per subscriber, not on unique heap: the frames
 * themselves are shared by every subscriber (see `SlowSseConsumer`).
 * A configured soft cap larger than half of this raises the hard cap to
 * 2 × the soft cap, so the hard guard can never sit below the soft one.
 */
export const SSE_BURST_HARD_BYTES = 16 * 1024 * 1024;

/** Effective hard guard: 16 MiB, or 2 × a soft bound above 8 MiB. */
export function sseHardLimitBytes(maxBufferBytes: number): number {
  return Math.max(SSE_BURST_HARD_BYTES, maxBufferBytes * 2);
}

/**
 * Bounded process-wide cache for immutable command-log frames. A reconnect
 * replays the same `(boardId, seq)` rows into fresh objects; without this
 * cache each subscriber would build its own 64 KiB Buffer. 32 MiB covers
 * several 100 × 64 KiB catch-ups; the LRU drops the oldest frames beyond it.
 */
export const SSE_COMMAND_FRAME_CACHE_BYTES = 32 * 1024 * 1024;

/** The globally unique command sequence, when `data` is a command frame. */
function commandSeq(data: object): number | null {
  const event = data as { type?: unknown; seq?: unknown };
  return event.type === "command" &&
    typeof event.seq === "number" &&
    Number.isSafeInteger(event.seq)
    ? event.seq
    : null;
}

export class SseFrameStore {
  private readonly cache = new WeakMap<object, SseFrame>();
  /** Immutable command frames, keyed by the globally unique `Command.seq`. */
  private readonly commandCache = new Map<number, SseFrame>();
  private commandCacheBytes = 0;
  private nextId = 1;
  private builds = 0;

  /**
   * The complete SSE frame for `data`, building it at most once per object.
   * Command frames are additionally keyed by `seq`, because catch-up replay
   * creates a fresh object for every subscriber while the log row is
   * immutable — those subscribers share one Buffer too.
   * Strings are not cached by identity (they have no stable identity worth a
   * map); the board stream only sends objects, but a raw `ping` stays legal.
   */
  frame(data: unknown): SseFrame {
    if (typeof data === "object" && data !== null) {
      const cached = this.cache.get(data);
      if (cached !== undefined) return cached;
      const seq = commandSeq(data);
      if (seq !== null) {
        const commandCached = this.commandFrame(seq);
        if (commandCached !== undefined) {
          this.cache.set(data, commandCached);
          return commandCached;
        }
      }
      const frame = this.build(data);
      this.cache.set(data, frame);
      if (seq !== null) this.rememberCommand(seq, frame);
      return frame;
    }
    return this.build(data);
  }

  /** Bytes held by the bounded command-frame cache (tests/observability). */
  get cachedCommandBytes(): number {
    return this.commandCacheBytes;
  }

  get cachedCommandFrames(): number {
    return this.commandCache.size;
  }

  /**
   * Frames built so far — a fan-out test hook and an observability metric.
   * With N subscribers it grows by one per published event, not by N.
   */
  get builtCount(): number {
    return this.builds;
  }

  /** LRU read: a hit moves the frame to the newest position. */
  private commandFrame(seq: number): SseFrame | undefined {
    const cached = this.commandCache.get(seq);
    if (cached === undefined) return undefined;
    this.commandCache.delete(seq);
    this.commandCache.set(seq, cached);
    return cached;
  }

  private rememberCommand(seq: number, frame: SseFrame): void {
    if (frame.bytes.length > SSE_COMMAND_FRAME_CACHE_BYTES) return;
    while (
      this.commandCacheBytes + frame.bytes.length >
      SSE_COMMAND_FRAME_CACHE_BYTES
    ) {
      const oldest = this.commandCache.keys().next().value;
      if (oldest === undefined) break;
      const removed = this.commandCache.get(oldest);
      this.commandCache.delete(oldest);
      if (removed !== undefined) {
        this.commandCacheBytes -= removed.bytes.length;
      }
    }
    this.commandCache.set(seq, frame);
    this.commandCacheBytes += frame.bytes.length;
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

/**
 * Why a subscriber was dropped — fed to the metric/log in RealtimeService.
 * `queuedBytes` counts referenced frame sizes, not allocated copies: one
 * Buffer is shared by every subscriber, so N slow subscribers do not make N
 * copies of a 64 KiB description.
 */
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
   * synchronous burst may exceed the soft bound for `SSE_BURST_GRACE_MS`,
   * up to `SSE_BURST_HARD_BYTES` (or 2 × this bound, if larger), while
   * `drain` is pending. 0 means "no queued frames": the first frame after
   * backpressure is dropped.
   */
  maxBufferBytes: number;
  /**
   * How long `write()` may keep returning `false` before the connection is
   * presumed dead. 0 disables the timer and relies on the buffer bound.
   */
  slowCloseMs: number;
  /** Test/ops override for the overflow grace; defaults to 5 s. */
  burstGraceMs?: number;
  onSlowConsumer?: (info: SlowSseConsumer) => void;
  /** The peer went away, or the connection was closed as slow/dead. */
  onClose?: () => void;
}

/**
 * One SSE response with bounded backpressure.
 *
 * Node reports a full socket buffer by returning `false` from `write()`;
 * `drain` means it can take more. Frames emitted in between are queued (with
 * their shared Buffers, no copies) until the bound is hit. Unique memory is
 * the number of distinct Buffers a published event creates — one per event,
 * shared by every subscriber; a per-subscriber queue only adds references to
 * those Buffers. A synchronous batch burst gets a grace window plus a 16 MiB
 * referenced-byte guard, so a legitimate 10–100-frame command batch drains;
 * only a subscriber that stays blocked loses its connection, and its client
 * reconnects with its last applied `?since=` — the normal replay/resync path.
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
  /** Armed on the next turn so a blocking publish can reach its `drain`. */
  private burstArmPending = false;
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
    if (this.res.headersSent) {
      // Another layer already committed the response (or a retried open);
      // never call `setHeader` after that. Keep the SSE body writable.
      this.headersCommitted = true;
      if (!this.res.write("\n")) this.block();
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
   * short grace window to reach `drain`; past the 16 MiB hard guard, or
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
    if (this.queuedBytes > sseHardLimitBytes(max)) {
      this.closeSlow("buffer", this.queuedBytes, this.queue.length);
      return;
    }
    if (this.overflowed || this.burstArmPending || this.burstTimer !== null) {
      return;
    }
    this.overflowed = true;
    // A publish loop can stay synchronous for seconds. Arm the grace only in
    // the check phase, after I/O (including `drain`) got a chance to run.
    this.burstArmPending = true;
    const arm = setImmediate(() => {
      this.burstArmPending = false;
      if (
        this.closed ||
        !this.blocked ||
        !this.overflowed ||
        this.burstTimer !== null
      ) {
        return;
      }
      this.burstTimer = setTimeout(() => {
        this.burstTimer = null;
        if (this.closed || !this.blocked) return;
        this.closeSlow("buffer", this.queuedBytes, this.queue.length);
      }, this.options.burstGraceMs ?? SSE_BURST_GRACE_MS);
      this.burstTimer.unref?.();
    });
    arm.unref?.();
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
    this.burstArmPending = false;
    if (this.burstTimer === null) return;
    clearTimeout(this.burstTimer);
    this.burstTimer = null;
  }

  private detach(): void {
    this.res.removeListener("drain", this.onDrain);
    this.res.removeListener("close", this.onPeerClose);
  }
}
