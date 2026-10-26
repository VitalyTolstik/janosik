import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Subject, type Observable } from "rxjs";
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
          this.channel(boardId).next(envelope.event);
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
    this.channel(boardId).next(event);
    this.publisher
      ?.publish(
        CHANNEL_PREFIX + boardId,
        JSON.stringify({ origin: this.nodeId, event }),
      )
      .catch(() => undefined);
  }

  /** Events committed from now on; catch-up from the log is the caller's. */
  watch(boardId: string): Observable<BoardSseEvent> {
    this.ensureSubscribed(boardId);
    return this.channel(boardId).asObservable();
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
