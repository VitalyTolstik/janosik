import {
  Controller,
  Get,
  Logger,
  MessageEvent,
  Param,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { Observable, type Subscription } from "rxjs";
import type { AgentPauseStamp } from "@/auth/agent-pause";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { CurrentPrincipal } from "@/auth/auth-principal";
import type { AuthUser } from "@/auth/auth.types";
import { CurrentUser } from "@/auth/current-user.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { FeatureFlagsService } from "@/ops/feature-flags.service";
import { PresenceService } from "@/realtime/presence.service";
import type { PresenceJoinResult } from "@/realtime/presence.service";
import {
  type InternalCommandEvent,
  RealtimeService,
} from "@/realtime/realtime.service";
import { RealtimeFlagGuard } from "@/realtime/realtime-flag.guard";
import { KeepAliveScheduler } from "@/realtime/keep-alive";
import { SseConnection, SseFrameStore } from "@/realtime/sse-frames";
import { keepAliveProfile } from "@/realtime/sse-timing";
import { env } from "@/config/env";
import { CommandStreamSequencer } from "./command-stream";
import { CommandsService } from "./commands.service";
import { parseSince } from "./parse-since";
import { StreamAccessService } from "./stream-access.service";

/** Tab-scoped id the client sends to be recognized across reconnects. */
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** `?presence=` explicitly on/off; `undefined` means "use the peer default". */
export function parsePresence(value: string | undefined): boolean | undefined {
  if (value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  return undefined;
}

/**
 * TASK-200.5: a PAT is an agent credential, so its stream defaults to
 * presence off; a browser JWT keeps the old presence-on default. An explicit
 * `?presence=0/1` wins for either.
 */
export function presenceEnabledFor(
  value: string | undefined,
  via: AuthPrincipal["via"] | undefined,
): boolean {
  return parsePresence(value) ?? via !== "pat";
}

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
export class EventsController implements OnModuleDestroy {
  private readonly logger = new Logger(EventsController.name);
  /** One live scheduler per open stream; drained on app shutdown. */
  private readonly keepAlives = new Set<KeepAliveScheduler>();
  /** Aggregated overlap counter (one warn per minute, not per stream). */
  private skippedKeepAlives = 0;
  private lastSkipLogAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly commands: CommandsService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
    private readonly access: StreamAccessService,
    private readonly flags: FeatureFlagsService,
    /**
     * TASK-200.13: one frame store per process. A published event object is
     * shared by every subscriber, so the first write serializes it and the
     * rest reuse the same Buffer. Injectable so e2e can assert the build
     * count; the default keeps direct unit construction working.
     */
    private readonly frames: SseFrameStore = new SseFrameStore(),
  ) {}

  /** TASK-200.5: stop every stream timer before Nest closes the sockets. */
  onModuleDestroy(): void {
    for (const keepAlive of this.keepAlives) keepAlive.stop();
    this.keepAlives.clear();
  }

  /**
   * TASK-200.5 review: an overlap is a warning signal, but one line per stream
   * per skipped tick is a log storm at 3 000 connections. Aggregate to one
   * line per minute with the count.
   */
  private noteKeepAliveSkip(): void {
    this.skippedKeepAlives += 1;
    const now = Date.now();
    if (now - this.lastSkipLogAt < 60_000) return;
    this.logger.warn(
      `SSE keep-alive overlap: ${this.skippedKeepAlives} skipped tick(s) in the last minute`,
    );
    this.lastSkipLogAt = now;
    this.skippedKeepAlives = 0;
  }

  /**
   * TASK-200.13: a raw `@Res` instead of Nest's `@Sse`.
   *
   * `@Sse` pipes every subscriber through its own `SseStream`, which
   * JSON-stringifies the same event once per connection and queues emitted
   * messages in an unbounded `concatMap` while a slow socket is blocked.
   * Here the route keeps the same admission, resume and keep-alive logic but
   * writes pre-serialized frames through `SseConnection`, which bounds the
   * per-subscriber queue and disconnects a reader that stopped draining.
   */
  @UseGuards(MembershipGuard, RealtimeFlagGuard)
  @Get()
  events(
    @Param("id") id: string,
    @Res() res: Response,
    @Query("since") since?: string,
    @Query("client") client?: string,
    @Query("presence") presence?: string,
    @Query("session") session?: string,
    @CurrentUser() user?: AuthUser,
    @CurrentPrincipal() principal?: AuthPrincipal,
  ): void {
    const clientId =
      client !== undefined && CLIENT_ID.test(client) ? client : randomUUID();
    // `?presence=0` opts a stream out of presence entirely (agent/CI viewers):
    // it neither joins the roster nor receives presence frames. TASK-200.5:
    // a PAT is an agent credential, so its stream defaults to presence off
    // even without the query parameter; a browser JWT keeps the old default.
    // `?presence=1` opts a PAT back in for debugging/oversight.
    const presenceEnabled = presenceEnabledFor(presence, principal?.via);
    if (presenceEnabled && user !== undefined) {
      // A `clientId` held by another user is refused *before* the stream
      // opens, so the answer is a clean 403 rather than an error thrown
      // mid-subscribe (which would leak the subscription tracking, A9).
      this.presence.assertClientAvailable(id, clientId, user.id);
    }
    // Parse the resume point *before* reserving a slot: `parseSince` can throw
    // a 400, and a throw after the reservation would leak the slot forever
    // (the teardown that releases it only exists inside the Observable,
    // TASK-147 follow-up).
    const sinceSeq = parseSince(since);
    // Admit the stream or refuse it politely (TASK-146): a per-instance,
    // per-user and per-board ceiling instead of an unbounded memory draw.
    const admission = this.realtime.reserveSubscriber(id, user?.id ?? null);
    if (!admission.ok) {
      res.setHeader("Retry-After", "5");
      throw new ServiceUnavailableException({
        message: `Too many live streams (${admission.reason} limit ${admission.limit})`,
      });
    }
    this.serve(
      id,
      sinceSeq,
      clientId,
      presenceEnabled,
      admission.release,
      res,
      user,
      principal,
      session,
    );
  }

  /** Start one admitted stream and own its response/lifecycle wiring. */
  private serve(
    boardId: string,
    since: number,
    clientId: string,
    presenceEnabled: boolean,
    releaseTracking: () => void,
    res: Response,
    user?: AuthUser,
    principal?: AuthPrincipal,
    sessionId?: string,
  ): void {
    // A holder rather than a `let`: the close listener is attached before
    // `subscribe()` returns, and a synchronous source can close the writer in
    // the same tick.
    const owner: { subscription?: Subscription } = {};
    const connection = new SseConnection(res, {
      frames: this.frames,
      maxBufferBytes: env.SSE_MAX_BUFFER_BYTES,
      slowCloseMs: env.SSE_SLOW_CLOSE_MS,
      onSlowConsumer: (info) => this.realtime.noteSlowSubscriber(boardId, info),
      onClose: () => owner.subscription?.unsubscribe(),
    });
    // `stream()` calls `onOpen` only after its synchronous setup (presence
    // join, live watch) succeeded. A setup error therefore still becomes the
    // proper HTTP status (a 409 client-id race included), never an empty 200
    // SSE response. The writer opens lazily on the first frame too.
    let subscribing = true;
    let hasSyncError = false;
    let syncError: unknown;
    try {
      owner.subscription = this.stream(
        boardId,
        since,
        clientId,
        presenceEnabled,
        releaseTracking,
        user,
        principal,
        sessionId,
        () => connection.open(),
      ).subscribe({
        next: (message) => connection.write(message.data),
        error: (error: unknown) => {
          if (subscribing && !connection.responseStarted) {
            hasSyncError = true;
            syncError = error;
            return;
          }
          this.logger.warn(
            `Stream for board ${boardId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          connection.end();
        },
        complete: () => connection.end(),
      });
    } catch (error) {
      subscribing = false;
      if (connection.responseStarted) {
        this.logger.warn(
          `Stream setup for board ${boardId} failed after headers: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        connection.end();
        releaseTracking();
        return;
      }
      connection.dispose();
      releaseTracking();
      throw error;
    }
    subscribing = false;
    if (hasSyncError) {
      connection.dispose();
      releaseTracking();
      throw syncError;
    }
    // A synchronous source can hit the bound before `subscribe` returns, when
    // `onClose` had no subscription to cancel yet.
    if (connection.isClosed) owner.subscription.unsubscribe();
  }

  private stream(
    boardId: string,
    since: number,
    clientId: string,
    presenceEnabled: boolean,
    releaseTracking: () => void,
    user?: AuthUser,
    principal?: AuthPrincipal,
    sessionId?: string,
    onOpen?: () => void,
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
            (event.change === "removed" || event.change === "left") &&
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
        // TASK-166: agent-session lifecycle frames are control-plane only.
        if (event.type === "agent") {
          send(event as unknown as object);
          return;
        }
        // TASK-166.5/166.7: approval and run lifecycle frames are control
        // plane, not commands — no seq, no log; pass them straight through.
        if (event.type === "approval" || event.type === "run") {
          send(event as unknown as object);
          return;
        }
        if (event.type !== "command") return;
        sequencer.offer(event as InternalCommandEvent);
      });

      // Everything that can reject synchronously (presence join, watch) has
      // succeeded: commit the 200 now, just before the first possible frame.
      if (onOpen !== undefined) {
        try {
          onOpen();
        } catch (error) {
          live.unsubscribe();
          releaseTracking();
          if (presenceToken !== null) {
            this.presence.leave(boardId, clientId, presenceToken.token);
          }
          subscriber.error(error);
          return;
        }
      }

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

      // TASK-200.5: one self-rescheduling timer per stream. PAT streams tick
      // every 60 s, human streams every 25 s, both with jitter; a tick that
      // is still running makes the next beat skip instead of piling a second
      // validation query set onto a saturated pool.
      const keepAlive = new KeepAliveScheduler({
        ...keepAliveProfile(principal?.via === "pat"),
        onSkip: () => this.noteKeepAliveSkip(),
        task: async () => {
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
          const outcome = await this.tick(
            boardId,
            user,
            principal,
            sequencer,
            sessionId,
          );
          if (subscriber.closed) return;
          if (outcome.pause !== null) {
            // TASK-166.3: announce the pause on the keep-alive tick, then
            // close. Token/board pause closes every PAT stream; session
            // pause only a stream opened with `?session=<id>`.
            send({
              type: "agent",
              op: "paused",
              scope: outcome.pause.scope,
              at: outcome.pause.at ?? Date.now(),
            });
            subscriber.complete();
            return;
          }
          if (!outcome.allowed) subscriber.complete();
        },
      });
      this.keepAlives.add(keepAlive);
      keepAlive.start();

      return () => {
        keepAlive.stop();
        this.keepAlives.delete(keepAlive);
        sequencer.close();
        live.unsubscribe();
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
    sessionId: string | undefined,
  ): Promise<{ allowed: boolean; pause: AgentPauseStamp | null }> {
    try {
      // M5: flipping the flag off must also close streams that were already
      // open when the operator changed it.
      if (!(await this.flags.isEnabled("realtime_sse", user?.id ?? null))) {
        return { allowed: false, pause: null };
      }
      if (
        user !== undefined &&
        !(await this.access.memberStreamAllowed(boardId, user.id, principal))
      ) {
        return { allowed: false, pause: null };
      }
      if (user !== undefined) {
        const pause = await this.access.streamPause(
          boardId,
          user.id,
          principal,
          sessionId,
        );
        if (pause !== null) return { allowed: true, pause };
      }
      await sequencer.verifyCaughtUp();
    } catch (error) {
      this.logger.warn(
        `Stream check for board ${boardId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return { allowed: true, pause: null };
  }
}
