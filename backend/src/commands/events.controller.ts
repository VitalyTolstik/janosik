import {
  Controller,
  MessageEvent,
  Param,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { interval, Observable } from "rxjs";
import type { CommandSseEvent } from "@janosik/shared";
import { MembershipGuard } from "@/common/membership.guard";
import { RealtimeService } from "@/realtime/realtime.service";
import { CommandsService } from "./commands.service";
import { parseSince } from "./parse-since";

/** Keep-alive comment cadence for proxies and idle connections. */
const KEEP_ALIVE_MS = 25_000;

/**
 * `GET /boards/:id/events` — the SSE stream of §7.4 (TASK-30).
 *
 * The stream is auth'd like every other board route (Bearer token; any role
 * including VIEWER). To be race-free the connection buffers live events
 * first, replays the command-log delta `?since=` (the client's last applied
 * `seq`), then drains the buffer deduplicating by `seq` — a command
 * committed between the delta query and the subscription can appear in both,
 * never twice and never out of order.
 */
@Controller("boards/:id/events")
export class EventsController {
  constructor(
    private readonly commands: CommandsService,
    private readonly realtime: RealtimeService,
  ) {}

  @UseGuards(MembershipGuard)
  @Sse()
  events(
    @Param("id") id: string,
    @Query("since") since?: string,
  ): Observable<MessageEvent> {
    return this.stream(id, parseSince(since));
  }

  private stream(boardId: string, since: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let ready = false;
      let lastSeq = since;
      const buffered: CommandSseEvent[] = [];

      const push = (event: CommandSseEvent): void => {
        if (event.seq <= lastSeq) return;
        lastSeq = event.seq;
        subscriber.next({ data: event as unknown as object } as MessageEvent);
      };

      const live = this.realtime.watch(boardId).subscribe((event) => {
        if (event.type !== "command") return;
        if (ready) push(event);
        else buffered.push(event);
      });

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
      };
    });
  }
}
