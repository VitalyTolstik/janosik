import {
  Controller,
  MessageEvent,
  Param,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { interval, Observable } from "rxjs";
import type { CommandSseEvent } from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import { CurrentUser } from "@/auth/current-user.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { PresenceService } from "@/realtime/presence.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { CommandsService } from "./commands.service";
import { parseSince } from "./parse-since";

/** Keep-alive comment cadence for proxies and idle connections. */
const KEEP_ALIVE_MS = 25_000;

/** Tab-scoped id the client sends to be recognized across reconnects. */
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * `GET /boards/:id/events` — the SSE stream of §7.4 (TASK-30).
 *
 * The stream is auth'd like every other board route (Bearer token; any role
 * including VIEWER). To be race-free the connection buffers live events
 * first, replays the command-log delta `?since=` (the client's last applied
 * `seq`), then drains the buffer deduplicating by `seq` — a command
 * committed between the delta query and the subscription can appear in both,
 * never twice and never out of order.
 *
 * Since TASK-36 the stream also carries `presence` (who is connected, see
 * `PresenceService`) and `activity` (TASK-37) events. Presence has no `seq`
 * and no log to catch up from, so it passes straight through in both
 * directions; only commands are buffered and deduplicated.
 */
@Controller("boards/:id/events")
export class EventsController {
  constructor(
    private readonly commands: CommandsService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
  ) {}

  @UseGuards(MembershipGuard)
  @Sse()
  events(
    @Param("id") id: string,
    @Query("since") since?: string,
    @Query("client") client?: string,
    @CurrentUser() user?: AuthUser,
  ): Observable<MessageEvent> {
    const clientId =
      client !== undefined && CLIENT_ID.test(client) ? client : randomUUID();
    return this.stream(id, parseSince(since), clientId, user);
  }

  private stream(
    boardId: string,
    since: number,
    clientId: string,
    user?: AuthUser,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let ready = false;
      let lastSeq = since;
      const buffered: CommandSseEvent[] = [];
      const releaseTracking = this.realtime.trackSubscription();

      const push = (event: CommandSseEvent): void => {
        if (event.seq <= lastSeq) return;
        lastSeq = event.seq;
        subscriber.next({ data: event as unknown as object } as MessageEvent);
      };

      const live = this.realtime.watch(boardId).subscribe((event) => {
        if (event.type === "presence") {
          subscriber.next({ data: event as unknown as object } as MessageEvent);
          return;
        }
        // A membership change (TASK-36): every subscriber refreshes its
        // member directory; the removed user gets the frame as the last one
        // on their stream and the server then closes it. Other members'
        // streams keep following the board.
        if (event.type === "membership") {
          subscriber.next({ data: event as unknown as object } as MessageEvent);
          if (
            event.change === "removed" &&
            user !== undefined &&
            event.userId === user.id
          ) {
            subscriber.complete();
          }
          return;
        }
        // An activity frame (TASK-37: a new or deleted comment) is not a
        // command: no seq, no log — pass it straight through like presence.
        if (event.type === "activity") {
          subscriber.next({ data: event as unknown as object } as MessageEvent);
          return;
        }
        if (event.type !== "command") return;
        if (ready) push(event);
        else buffered.push(event);
      });

      // Join after subscribing so this connection sees its own roster: the
      // first presence frame of a stream is "you are here, with N others".
      if (user) {
        this.presence.join(boardId, clientId, {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          avatarColor: user.avatarColor,
          avatarPath: user.avatarPath,
        });
      }

      void this.commands
        .listSince(boardId, since)
        .then((delta) => {
          if (subscriber.closed) return;
          for (const entry of delta) {
            push({
              type: "command",
              seq: entry.seq,
              action: entry.action,
              actorId: entry.actorId,
              touches: entry.touches,
            });
          }
          ready = true;
          for (const event of buffered) push(event);
          buffered.length = 0;
        })
        .catch((error: unknown) => subscriber.error(error));

      const keepAlive = interval(KEEP_ALIVE_MS).subscribe(() => {
        subscriber.next({ data: "ping" } as MessageEvent);
      });

      return () => {
        live.unsubscribe();
        keepAlive.unsubscribe();
        releaseTracking();
        if (user) this.presence.leave(boardId, clientId);
      };
    });
  }
}
