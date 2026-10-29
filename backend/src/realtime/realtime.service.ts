import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable, Subject } from "rxjs";
import Redis from "ioredis";
import type { BoardSseEvent, CommandSseEvent } from "@janosik/shared";
import { env } from "@/config/env";

/**
 * A command frame as it travels on the internal bus (B-4): the wire event
 * plus `prevSeq`, the board's seq right before this command. Streams use it
 * to prove contiguity — a frame whose `prevSeq` is not the last seq they
 * delivered means something was lost or reordered in between (a second node,
 * a failed Redis publish), and they re-read the log instead of guessing.
 * Never sent to clients: the stream strips it.
 */
export type InternalCommandEvent = CommandSseEvent & { prevSeq?: number };

/** Outcome of the SSE admission check (TASK-146). */
export type SubscriberAdmission =
  | { ok: true; release: () => void }
  | { ok: false; reason: "instance" | "user" | "board"; limit: number };

/** Redis publish retries before the frame is given up on (B-4). */
const PUBLISH_ATTEMPTS = 3;
const PUBLISH_RETRY_MS = 250;

/**
 * Board event fan-out (§7.0, TASK-30).
 *
 * The MVP ran a single node, so a lazily-created rxjs `Subject` per board was
 * the whole bus. TASK-74 keeps that local bus but, when `REDIS_URL` is set,
 * also publishes each committed event on a Redis channel per board and
 * subscribes to it, so a second node's subscribers see this node's events —
 * multi-node SSE without any module knowing how fan-out works. Single-node
 * (no Redis) behaviour is unchanged; presence stays per-node.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly channels = new Map<string, Subject<BoardSseEvent>>();
  private readonly subscribed = new Set<string>();
  /** Live subscriber count per board (TASK-102): at zero the channel and its
   *  Redis subscription are torn down, so neither leaks with board count. */
  private readonly refCounts = new Map<string, number>();
  /** Admission counters for the SSE caps (TASK-146). */
  private readonly limitByUser = new Map<string, number>();
  private readonly limitByBoard = new Map<string, number>();
  private subscribers = 0;
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  /** This node's id — so it ignores the echo of its own published frames. */
  private readonly nodeId = randomUUID();

  onModuleInit(): void {
    if (env.REDIS_URL.trim().length === 0) return;
    try {
      this.publisher = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
      });
      this.subscriber = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
      });
      this.subscriber.on("message", (channel: string, payload: string) => {
        const boardId = channel.replace(CHANNEL_PREFIX, "");
        try {
          const envelope = JSON.parse(payload) as {
            origin: string;
            event: BoardSseEvent;
          };
          // Skip our own echo: `publish` already delivered it locally.
          if (envelope.origin === this.nodeId) return;
          this.channels.get(boardId)?.next(envelope.event);
        } catch {
          /* ignore malformed frames */
        }
      });
      this.logger.log("Realtime fan-out via Redis pub/sub");
    } catch (error) {
      this.logger.warn(
        `Redis realtime fan-out unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.publisher = null;
      this.subscriber = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.publisher?.quit().catch(() => undefined);
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Push one committed event to every subscriber of the board (all nodes). */
  publish(boardId: string, event: BoardSseEvent): void {
    // Local first (this node's subscribers), then Redis for the others.
    this.publishLocal(boardId, event);
    if (this.publisher !== null) {
      void this.publishRemote(
        boardId,
        JSON.stringify({ origin: this.nodeId, event }),
        1,
      );
    }
  }

  /**
   * Deliver an event to this node's subscribers only, never to Redis
   * (TASK-145). Presence uses this: its registry is in-process, so a roster
   * delta computed here is only valid for streams on this node — fanning it
   * out would make other nodes publish `leave` for users they cannot see.
   * Multi-node presence needs a shared store (tracked in the roadmap).
   */
  publishLocal(boardId: string, event: BoardSseEvent): void {
    // `get` (not `channel`) — publishing to a board nobody listens to must
    // not resurrect a channel that was just released (TASK-102).
    this.channels.get(boardId)?.next(event);
  }

  /**
   * Cross-node fan-out with a short retry (B-4). A frame that still cannot
   * be published is logged, not silently dropped — and it is not lost for
   * good either: every stream proves contiguity through `prevSeq` and
   * re-checks the log on its keep-alive tick, so the remote subscribers
   * re-read the gap from the database.
   */
  private async publishRemote(
    boardId: string,
    payload: string,
    attempt: number,
  ): Promise<void> {
    if (this.publisher === null) return;
    try {
      await this.publisher.publish(CHANNEL_PREFIX + boardId, payload);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (attempt >= PUBLISH_ATTEMPTS) {
        this.logger.error(
          `Redis publish for board ${boardId} failed after ${attempt} attempts: ${reason} — remote streams will catch up from the log`,
        );
        return;
      }
      this.logger.warn(
        `Redis publish for board ${boardId} failed (attempt ${attempt}/${PUBLISH_ATTEMPTS}): ${reason}`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, PUBLISH_RETRY_MS * attempt),
      );
      await this.publishRemote(boardId, payload, attempt + 1);
    }
  }

  /**
   * Events committed from now on; catch-up from the log is the caller's.
   *
   * Ref-counted (TASK-102): the Subject and the Redis subscription live only
   * while at least one subscriber holds the returned Observable, so a
   * long-lived process does not accumulate one channel per board ever seen.
   */
  watch(boardId: string): Observable<BoardSseEvent> {
    return new Observable<BoardSseEvent>((subscriber) => {
      this.ensureSubscribed(boardId);
      const channel = this.channel(boardId);
      this.refCounts.set(boardId, (this.refCounts.get(boardId) ?? 0) + 1);
      const inner = channel.subscribe(subscriber);
      return () => {
        inner.unsubscribe();
        const remaining = (this.refCounts.get(boardId) ?? 1) - 1;
        if (remaining > 0) {
          this.refCounts.set(boardId, remaining);
          return;
        }
        this.refCounts.delete(boardId);
        this.releaseChannel(boardId);
      };
    });
  }

  /** Drop a board's Subject + Redis subscription once nobody watches it. */
  private releaseChannel(boardId: string): void {
    const channel = this.channels.get(boardId);
    if (channel) {
      channel.complete();
      this.channels.delete(boardId);
    }
    if (this.subscribed.has(boardId) && this.subscriber !== null) {
      this.subscribed.delete(boardId);
      void this.subscriber
        .unsubscribe(CHANNEL_PREFIX + boardId)
        .catch(() => undefined);
    }
  }

  /** Boards with a live channel (TASK-64 observability). */
  get activeBoards(): number {
    return this.channels.size;
  }

  /** Live SSE subscriber count (TASK-64 observability). */
  get subscriberCount(): number {
    return this.subscribers;
  }

  /** True when multi-node fan-out is active. */
  get usingRedis(): boolean {
    return this.publisher !== null;
  }

  /** Registers/unregisters an SSE consumer for the counters above. */
  trackSubscription(): () => void {
    this.subscribers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.subscribers = Math.max(0, this.subscribers - 1);
    };
  }

  /**
   * Reserve an SSE slot for `userId` on `boardId`, or report which cap was
   * hit (TASK-146). The caller refuses the stream with `503` + `Retry-After`
   * and must call `release` when the stream tears down. Counters are
   * per-process, so a multi-node deployment allows each cap per node.
   */
  reserveSubscriber(boardId: string, userId: string): SubscriberAdmission {
    const userCount = this.limitByUser.get(userId) ?? 0;
    if (
      env.SSE_MAX_CONNECTIONS > 0 &&
      this.subscribers >= env.SSE_MAX_CONNECTIONS
    ) {
      return { ok: false, reason: "instance", limit: env.SSE_MAX_CONNECTIONS };
    }
    if (env.SSE_MAX_PER_USER > 0 && userCount >= env.SSE_MAX_PER_USER) {
      return { ok: false, reason: "user", limit: env.SSE_MAX_PER_USER };
    }
    const boardCount = this.limitByBoard.get(boardId) ?? 0;
    if (env.SSE_MAX_PER_BOARD > 0 && boardCount >= env.SSE_MAX_PER_BOARD) {
      return { ok: false, reason: "board", limit: env.SSE_MAX_PER_BOARD };
    }
    this.subscribers += 1;
    this.limitByUser.set(userId, userCount + 1);
    this.limitByBoard.set(boardId, boardCount + 1);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.subscribers = Math.max(0, this.subscribers - 1);
        this.decrement(this.limitByUser, userId);
        this.decrement(this.limitByBoard, boardId);
      },
    };
  }

  private decrement(map: Map<string, number>, key: string): void {
    const next = (map.get(key) ?? 1) - 1;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }

  private ensureSubscribed(boardId: string): void {
    if (this.subscriber === null || this.subscribed.has(boardId)) return;
    this.subscribed.add(boardId);
    void this.subscriber
      .subscribe(CHANNEL_PREFIX + boardId)
      .catch(() => this.subscribed.delete(boardId));
  }

  private channel(boardId: string): Subject<BoardSseEvent> {
    let channel = this.channels.get(boardId);
    if (channel === undefined) {
      channel = new Subject<BoardSseEvent>();
      this.channels.set(boardId, channel);
    }
    return channel;
  }
}

const CHANNEL_PREFIX = "janosik:board:";
