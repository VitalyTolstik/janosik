import { Injectable } from "@nestjs/common";
import { Subject, type Observable } from "rxjs";
import type { BoardSseEvent } from "@janosik/shared";

/**
 * In-process fan-out of board events (§7.0, TASK-30).
 *
 * The MVP runs a single node, so a lazily-created rxjs `Subject` per board
 * is the whole bus: committed commands are pushed after their transaction
 * landed, every `GET /boards/:id/events` subscriber gets them in order.
 * Redis pub/sub is the documented extension point for a second node — this
 * service is that seam, so no other module knows how fan-out works.
 */
@Injectable()
export class RealtimeService {
  private readonly channels = new Map<string, Subject<BoardSseEvent>>();

  /** Push one committed event to every subscriber of the board. */
  publish(boardId: string, event: BoardSseEvent): void {
    this.channels.get(boardId)?.next(event);
  }

  /** Events committed from now on; catch-up from the log is the caller's. */
  watch(boardId: string): Observable<BoardSseEvent> {
    return this.channel(boardId).asObservable();
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
