import {
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  BoardSseEvent,
  PresenceSseEvent,
  PresenceUser,
  UserAvatarColor,
} from "@janosik/shared";
import { RealtimeService } from "./realtime.service";

/**
 * A connection counts as gone after this long without a touch (TASK-36).
 * Closing a tab drops the SSE request and the session goes away at once;
 * the TTL covers half-open sockets no FIN ever reaches — the honest bound
 * the roadmap promises ("отвалившийся клиент исчезает за ≤60 с").
 */
export const PRESENCE_TTL_MS = 60_000;

/** Cadence of the stale-session sweep. */
export const PRESENCE_SWEEP_MS = 15_000;

/** Identity the auth layer knows about a connection. */
export interface PresenceIdentity {
  id: string;
  displayName: string | null;
  email: string;
  avatarColor: UserAvatarColor | null;
  avatarPath: string | null;
}

interface PresenceSession extends PresenceIdentity {
  /** Monotonic join counter — keeps the roster order stable per session. */
  order: number;
  /** Last heartbeat (join or ping) — what the TTL sweeps on. */
  seenAt: number;
  /**
   * Per-connection token (TASK-102). A stream teardown only removes the
   * session it opened, so a reconnect that already replaced the row is not
   * dropped by the old stream's late `leave`.
   */
  token: string;
}

/** What `join` hands the stream: its teardown token and the full roster. */
export interface PresenceJoinResult {
  token: string;
  roster: PresenceUser[];
}

/**
 * Who is connected to a board right now (TASK-36).
 *
 * The registry is in-memory like the fan-out itself: one SSE session per
 * `clientId` (stable per browser tab, reused across reconnects so a network
 * blip never flickers an avatar), deduplicated by user for the roster.
 *
 * Presence is published as **deltas**, not as a repeated full roster: `join`
 * when a user's first session appears, `leave` when their last one goes, and
 * `update` when their public identity changes. The full roster is sent once,
 * to the stream that just connected (`sync`) — the same shape every mature
 * presence system uses (Yjs awareness, Ably, Pusher, Supabase). Broadcasting
 * the whole roster to everyone on every change is O(N²) (O(N³) during a mass
 * join) and was the source of the realtime memory blow-up.
 *
 * `presence` events deliberately carry no `seq`: they are ephemeral state,
 * not part of the command log, so they bypass the delta/dedupe machinery.
 */
@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly boards = new Map<string, Map<string, PresenceSession>>();
  private nextOrder = 1;
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(private readonly realtime: RealtimeService) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => this.sweep(), PRESENCE_SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.boards.clear();
  }

  /** Total live presence sessions across every board (TASK-64). */
  totalSessions(): number {
    let total = 0;
    for (const sessions of this.boards.values()) total += sessions.size;
    return total;
  }

  /**
   * Register a connection. Returns the teardown token and the roster the
   * caller sends to this stream as its one-time `sync`.
   *
   * A `clientId` already held by *another* user is refused (TASK-102): the
   * id comes from the query string, so without this check anyone could claim
   * (and evict) someone else's presence slot.
   *
   * `join` is published only when this is the user's **first** live session:
   * a second tab of the same person does not re-announce them.
   */
  join(
    boardId: string,
    clientId: string,
    user: PresenceIdentity,
  ): PresenceJoinResult {
    const sessions = this.sessions(boardId);
    const previous = sessions.get(clientId);
    if (previous && previous.id !== user.id) {
      throw new ForbiddenException("clientId belongs to another session");
    }
    const wasPresent = this.hasUser(sessions, user.id);
    const token = randomUUID();
    sessions.set(clientId, {
      ...user,
      order: previous?.order ?? this.nextOrder++,
      seenAt: Date.now(),
      token,
    });
    if (!wasPresent) {
      const session = sessions.get(clientId);
      if (session) {
        this.publish(boardId, {
          type: "presence",
          op: "join",
          user: toPresenceUser(session),
        });
      }
    }
    return { token, roster: this.roster(boardId) };
  }

  /**
   * Drop a connection. The `token` guards the reconnect race (TASK-102): a
   * stale teardown whose token no longer matches the live session is ignored.
   * `leave` is published only when the user has no other live session.
   */
  leave(boardId: string, clientId: string, token?: string): void {
    const sessions = this.boards.get(boardId);
    if (!sessions) return;
    const current = sessions.get(clientId);
    if (!current) return;
    if (token !== undefined && current.token !== token) return;
    sessions.delete(clientId);
    if (!this.hasUser(sessions, current.id)) {
      this.publish(boardId, {
        type: "presence",
        op: "leave",
        userId: current.id,
      });
    }
    if (sessions.size === 0) this.boards.delete(boardId);
  }

  /**
   * Rewrite the public identity of every live session of one user and
   * publish one `update` per board that actually changed (TASK-36.1).
   * Sessions are captured at join, so without this a rename or a new avatar
   * would stay invisible to everyone — including the user's own other tabs —
   * until they reconnect.
   */
  updateUser(
    userId: string,
    patch: Partial<
      Pick<
        PresenceIdentity,
        "displayName" | "email" | "avatarColor" | "avatarPath"
      >
    >,
  ): void {
    for (const [boardId, sessions] of this.boards) {
      let changed = false;
      let representative: PresenceSession | undefined;
      for (const session of sessions.values()) {
        if (session.id !== userId) continue;
        representative = session;
        if (
          (patch.displayName !== undefined &&
            session.displayName !== patch.displayName) ||
          (patch.email !== undefined && session.email !== patch.email) ||
          (patch.avatarColor !== undefined &&
            session.avatarColor !== patch.avatarColor) ||
          (patch.avatarPath !== undefined &&
            session.avatarPath !== patch.avatarPath)
        ) {
          changed = true;
        }
        if (patch.displayName !== undefined)
          session.displayName = patch.displayName;
        if (patch.email !== undefined) session.email = patch.email;
        if (patch.avatarColor !== undefined)
          session.avatarColor = patch.avatarColor;
        if (patch.avatarPath !== undefined)
          session.avatarPath = patch.avatarPath;
      }
      if (changed && representative) {
        this.publish(boardId, {
          type: "presence",
          op: "update",
          user: toPresenceUser(representative),
        });
      }
    }
  }

  /** Refresh a session's TTL. Returns whether it is still connected. A ping
   *  whose `userId` does not own the session is ignored (TASK-102). */
  touch(boardId: string, clientId: string, userId?: string): boolean {
    const session = this.boards.get(boardId)?.get(clientId);
    if (!session) return false;
    if (userId !== undefined && session.id !== userId) return false;
    session.seenAt = Date.now();
    return true;
  }

  /** Connected users of a board, deduplicated, in join order. */
  roster(boardId: string): PresenceUser[] {
    const sessions = this.boards.get(boardId);
    if (!sessions) return [];
    const byUser = new Map<string, PresenceSession>();
    for (const session of sessions.values()) {
      const known = byUser.get(session.id);
      if (!known || session.order < known.order)
        byUser.set(session.id, session);
    }
    return [...byUser.values()]
      .sort((a, b) => a.order - b.order)
      .map(toPresenceUser);
  }

  /** Drop sessions that stopped heartbeating and publish one `leave` per user
   *  that fully disappeared. Boards nobody is on release their map. */
  sweep(now = Date.now()): void {
    for (const [boardId, sessions] of this.boards) {
      const gone = new Set<string>();
      for (const [clientId, session] of sessions) {
        if (now - session.seenAt > PRESENCE_TTL_MS) {
          sessions.delete(clientId);
          gone.add(session.id);
        }
      }
      for (const userId of gone) {
        if (!this.hasUser(sessions, userId)) {
          this.publish(boardId, {
            type: "presence",
            op: "leave",
            userId,
          });
        }
      }
      if (sessions.size === 0) this.boards.delete(boardId);
    }
  }

  private publish(boardId: string, event: PresenceSseEvent): void {
    this.realtime.publish(boardId, event as BoardSseEvent);
  }

  private hasUser(
    sessions: Map<string, PresenceSession>,
    userId: string,
  ): boolean {
    for (const session of sessions.values()) {
      if (session.id === userId) return true;
    }
    return false;
  }

  private sessions(boardId: string): Map<string, PresenceSession> {
    let sessions = this.boards.get(boardId);
    if (!sessions) {
      sessions = new Map();
      this.boards.set(boardId, sessions);
    }
    return sessions;
  }
}

/** The wire identity of a presence session (email stays server-side). */
function toPresenceUser(session: PresenceIdentity): PresenceUser {
  return {
    id: session.id,
    displayName: session.displayName?.trim() || session.email,
    avatarColor: session.avatarColor,
    avatarPath: session.avatarPath,
  };
}
