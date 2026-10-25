import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { PresenceUser, UserAvatarColor } from "@janosik/shared";
import { RealtimeService } from "./realtime.service";

/** How often the roster is re-broadcast, so clients can reconcile. */
export const PRESENCE_HEARTBEAT_MS = 30_000;

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
}

/**
 * Who is connected to a board right now (TASK-36).
 *
 * The registry is in-memory like the fan-out itself: one SSE session per
 * `clientId` (stable per browser tab, reused across reconnects so a network
 * blip never flickers an avatar), deduplicated by user for the roster.
 * Changes and a 30-second heartbeat are published as `presence` events on
 * the board channel; a sweep drops sessions the client stopped refreshing.
 *
 * `presence` events deliberately carry no `seq`: they are ephemeral state,
 * not part of the command log, so they bypass the delta/dedupe machinery.
 */
@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly boards = new Map<string, Map<string, PresenceSession>>();
  private nextOrder = 1;
  private sweepTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;

  constructor(private readonly realtime: RealtimeService) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => this.sweep(), PRESENCE_SWEEP_MS);
    this.heartbeatTimer = setInterval(
      () => this.heartbeat(),
      PRESENCE_HEARTBEAT_MS,
    );
    this.sweepTimer.unref?.();
    this.heartbeatTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.boards.clear();
  }

  /** Total live presence sessions across every board (TASK-64). */
  totalSessions(): number {
    let total = 0;
    for (const sessions of this.boards.values()) total += sessions.size;
    return total;
  }

  /** Register a connection and broadcast the roster. Always published, so
   * the fresh connection receives the current roster as its first frame —
   * duplicate roster frames are cheap, a missing one is a bug. */
  join(boardId: string, clientId: string, user: PresenceIdentity): void {
    const sessions = this.sessions(boardId);
    const previous = sessions.get(clientId);
    const at = Date.now();
    sessions.set(clientId, {
      ...user,
      order: previous?.order ?? this.nextOrder++,
      seenAt: at,
    });
    this.broadcast(boardId);
  }

  /** Drop a connection; the roster is re-broadcast when a user left it. */
  leave(boardId: string, clientId: string): void {
    const sessions = this.boards.get(boardId);
    if (!sessions) return;
    const before = this.userIds(sessions);
    if (!sessions.delete(clientId)) return;
    if (!sameUsers(before, this.userIds(sessions))) this.broadcast(boardId);
    if (sessions.size === 0) this.boards.delete(boardId);
  }

  /**
   * Rewrite the public identity of every live session of one user and
   * re-broadcast each board that actually changed (TASK-36.1). Sessions are
   * captured at join, so without this a rename or a new avatar color would
   * stay invisible to everyone — including the users' own other tabs — until
   * they reconnect.
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
      for (const session of sessions.values()) {
        if (session.id !== userId) continue;
        if (
          (patch.displayName !== undefined &&
            session.displayName !== patch.displayName) ||
          (patch.email !== undefined && session.email !== patch.email) ||
          (patch.avatarColor !== undefined &&
            session.avatarColor !== patch.avatarColor)
        ) {
          changed = true;
        }
        if (patch.displayName !== undefined)
          session.displayName = patch.displayName;
        if (patch.email !== undefined) session.email = patch.email;
        if (patch.avatarColor !== undefined)
          session.avatarColor = patch.avatarColor;
      }
      if (changed) this.broadcast(boardId);
    }
  }

  /** Refresh a session's TTL. Returns whether it is still connected. */
  touch(boardId: string, clientId: string): boolean {
    const session = this.boards.get(boardId)?.get(clientId);
    if (!session) return false;
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
      .map((session) => ({
        id: session.id,
        displayName: session.displayName?.trim() || session.email,
        avatarColor: session.avatarColor,
        avatarPath: session.avatarPath,
      }));
  }

  /** Publish the current roster of one board. */
  broadcast(boardId: string): void {
    this.realtime.publish(boardId, {
      type: "presence",
      users: this.roster(boardId),
    });
  }

  /** Re-broadcast every board that has connections (the 30 s heartbeat). */
  heartbeat(now = Date.now()): void {
    for (const boardId of this.boards.keys()) {
      if (this.hasFresh(boardId, now)) this.broadcast(boardId);
    }
  }

  /** Drop sessions that stopped heartbeating and broadcast affected boards. */
  sweep(now = Date.now()): void {
    for (const [boardId, sessions] of this.boards) {
      const before = this.userIds(sessions);
      let dropped = false;
      for (const [clientId, session] of sessions) {
        if (now - session.seenAt > PRESENCE_TTL_MS) {
          sessions.delete(clientId);
          dropped = true;
        }
      }
      if (dropped && !sameUsers(before, this.userIds(sessions))) {
        this.broadcast(boardId);
      }
      if (sessions.size === 0) this.boards.delete(boardId);
    }
  }

  private sessions(boardId: string): Map<string, PresenceSession> {
    let sessions = this.boards.get(boardId);
    if (!sessions) {
      sessions = new Map();
      this.boards.set(boardId, sessions);
    }
    return sessions;
  }

  private userIds(sessions: Map<string, PresenceSession>): string[] {
    return [...new Set([...sessions.values()].map((s) => s.id))].sort();
  }

  private hasFresh(boardId: string, now: number): boolean {
    const sessions = this.boards.get(boardId);
    if (!sessions) return false;
    for (const session of sessions.values()) {
      if (now - session.seenAt <= PRESENCE_TTL_MS) return true;
    }
    return false;
  }
}

/** Set equality over the two sorted user-id lists. */
function sameUsers(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
