import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable, Subject } from "rxjs";
import Redis from "ioredis";
import type { BoardSseEvent } from "@janosik/shared";
import { env } from "@/config/env";

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
    // `get` (not `channel`) — publishing to a board nobody listens to must
    // not resurrect a channel that was just released (TASK-102).
    this.channels.get(boardId)?.next(event);
    this.publisher
      ?.publish(
        CHANNEL_PREFIX + boardId,
        JSON.stringify({ origin: this.nodeId, event }),
      )
      .catch(() => undefined);
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
