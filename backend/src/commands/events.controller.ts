import {
  Controller,
  Logger,
  MessageEvent,
  Param,
  Query,
  Res,
  ServiceUnavailableException,
  Sse,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { CurrentPrincipal } from "@/auth/auth-principal";
import type { AuthUser } from "@/auth/auth.types";
import { CurrentUser } from "@/auth/current-user.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { PresenceService } from "@/realtime/presence.service";
import type { PresenceJoinResult } from "@/realtime/presence.service";
import {
  type InternalCommandEvent,
  RealtimeService,
} from "@/realtime/realtime.service";
import { sseTiming } from "@/realtime/sse-timing";
import { CommandStreamSequencer } from "./command-stream";
import { CommandsService } from "./commands.service";
import { parseSince } from "./parse-since";
import { StreamAccessService } from "./stream-access.service";

/** Tab-scoped id the client sends to be recognized across reconnects. */
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * `GET /boards/:id/events` — the SSE stream of §7.4 (TASK-30).
 *
 * The stream is auth'd like every other board route (Bearer token; any role
 * including VIEWER). Command frames go through `CommandStreamSequencer`:
 * the `?since=` delta first, live frames buffered meanwhile and deduplicated
 * by `seq`, a `{type:"resync"}` frame when the gap cannot be replayed (B-3),
 * and a log re-read when a live frame proves something was lost on the way
 * (B-4). Every command frame carries the issuing `commandId`.
 *
 * Since TASK-36 the stream also carries `presence` (who is connected, see
 * `PresenceService`) and `activity` (TASK-37) events. Presence has no `seq`
 * and no log to catch up from, so it passes straight through in both
 * directions; only commands are sequenced.
 *
 * B-6: the keep-alive tick also re-validates the caller (account, board,
 * membership/expiry, PAT) and closes the stream when access is gone.
 */
@Controller("boards/:id/events")
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    private readonly commands: CommandsService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
    private readonly access: StreamAccessService,
  ) {}

  @UseGuards(MembershipGuard)
  @Sse()
  events(
    @Param("id") id: string,
    @Query("since") since?: string,
    @Query("client") client?: string,
    @Query("presence") presence?: string,
    @CurrentUser() user?: AuthUser,
    @CurrentPrincipal() principal?: AuthPrincipal,
    @Res({ passthrough: true }) res?: Response,
  ): Observable<MessageEvent> {
    const clientId =
      client !== undefined && CLIENT_ID.test(client) ? client : randomUUID();
    // `?presence=0` opts a stream out of presence entirely (agent/CI viewers):
    // it neither joins the roster nor receives presence frames.
    const presenceEnabled = presence !== "0" && presence !== "false";
    if (presenceEnabled && user !== undefined) {
      // A `clientId` held by another user is refused *before* the stream
      // opens, so the answer is a clean 403 rather than an error thrown
      // mid-subscribe (which would leak the subscription tracking, A9).
      this.presence.assertClientAvailable(id, clientId, user.id);
    }
    // Admit the stream or refuse it politely (TASK-146): a per-instance,
    // per-user and per-board ceiling instead of an unbounded memory draw.
    const admission = this.realtime.reserveSubscriber(
      id,
      user?.id ?? "anonymous",
    );
    if (!admission.ok) {
      res?.setHeader("Retry-After", "5");
      throw new ServiceUnavailableException({
        message: `Too many live streams (${admission.reason} limit ${admission.limit})`,
      });
    }
    return this.stream(
      id,
      parseSince(since),
      clientId,
      presenceEnabled,
      admission.release,
      user,
      principal,
    );
  }

  private stream(
    boardId: string,
    since: number,
    clientId: string,
    presenceEnabled: boolean,
    releaseTracking: () => void,
    user?: AuthUser,
    principal?: AuthPrincipal,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const send = (data: object | string): void => {
        if (!subscriber.closed) {
          subscriber.next({ data } as MessageEvent);
        }
      };
      const sequencer = new CommandStreamSequencer(
        this.commands,
        boardId,
        since,
        (event) => send(event as unknown as object),
        (error) => subscriber.error(error),
      );

      // Register presence *before* subscribing: the `join` delta goes to the
      // other live streams, while this one receives a full `sync` below. So a
      // reconnect never misses anyone, and K joins cost K small frames instead
      // of K full-roster copies to everyone (the O(N²) memory blow-up).
      let presenceToken: PresenceJoinResult | null = null;
      if (presenceEnabled && user) {
        try {
          presenceToken = this.presence.join(boardId, clientId, {
            id: user.id,
            displayName: user.displayName,
            email: user.email,
            avatarColor: user.avatarColor,
            avatarPath: user.avatarPath,
          });
        } catch (error) {
          // Lost a race for `clientId` after the pre-check in `events()`:
          // release the tracking we took and end with the real error instead
          // of leaking it (A9).
          releaseTracking();
          subscriber.error(error);
          return;
        }
      }

      const live = this.realtime.watch(boardId).subscribe((event) => {
        if (event.type === "presence") {
          if (presenceEnabled) send(event as unknown as object);
          return;
        }
        // A membership change (TASK-36): every subscriber refreshes its
        // member directory; the removed user gets the frame as the last one
        // on their stream and the server then closes it. Other members'
        // streams keep following the board.
        if (event.type === "membership") {
          send(event as unknown as object);
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
          send(event as unknown as object);
          return;
        }
        if (event.type !== "command") return;
        sequencer.offer(event as InternalCommandEvent);
      });

      // This stream's one-time full roster: "you are here, with N others".
      // Reuse the roster `join` just built instead of scanning again (A5).
      if (presenceToken !== null) {
        send({
          type: "presence",
          op: "sync",
          users: presenceToken.roster,
          epoch: this.presence.epochOf(boardId),
        });
      }

      sequencer.start();

      const keepAlive = setInterval(() => {
        // The frame's presence epoch lets a client that missed a delta
        // notice it and reconnect for a fresh `sync` (TASK-145).
        send(
          presenceToken !== null
            ? {
                type: "keepalive",
                presenceEpoch: this.presence.epochOf(boardId),
              }
            : { type: "keepalive" },
        );
        void this.tick(boardId, user, principal, sequencer).then((allowed) => {
          if (!allowed && !subscriber.closed) subscriber.complete();
        });
      }, sseTiming.keepAliveMs);

      return () => {
        sequencer.close();
        live.unsubscribe();
        clearInterval(keepAlive);
        releaseTracking();
        if (presenceToken !== null) {
          this.presence.leave(boardId, clientId, presenceToken.token);
        }
      };
    });
  }

  /**
   * Keep-alive work (B-4/B-6): is the caller still allowed in, and is the
   * stream caught up with the log? A transient database error keeps the
   * stream open — the next tick tries again.
   */
  private async tick(
    boardId: string,
    user: AuthUser | undefined,
    principal: AuthPrincipal | undefined,
    sequencer: CommandStreamSequencer,
  ): Promise<boolean> {
    try {
      if (
        user !== undefined &&
        !(await this.access.memberStreamAllowed(boardId, user.id, principal))
      ) {
        return false;
      }
      await sequencer.verifyCaughtUp();
    } catch (error) {
      this.logger.warn(
        `Stream check for board ${boardId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return true;
  }
}
