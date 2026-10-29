import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  ActivitySseEvent,
  Board,
  BoardAction,
  BoardMemberDto,
  PresenceSseEvent,
  PresenceUser,
} from "@janosik/shared";

import { CommitStore } from "@/store/commit-store";

/**
 * Live collaboration state (TASK-36): who is connected, who changed what,
 * and the board's member directory.
 *
 * Three tiny state stores instead of one more React state tree, for one
 * reason: render isolation. An avatar appearing in the header or a foreign
 * highlight ring fading on one card must not re-render the board — every
 * consumer subscribes narrowly (one board roster, one entity, one member row)
 * through `useSyncExternalStore`, and the stores notify only the keys that
 * actually changed. `BoardProvider` owns one instance per lifetime and hands
 * it out through this context, so nothing lives past a logout. A fourth
 * member, `ActivityStore` (TASK-37), carries no state at all — it fans
 * comment frames out to the open card and forgets them.
 */

/** How long a foreign change keeps its highlight ring on screen. */
export const FOREIGN_HIGHLIGHT_MS = 2_000;

const EMPTY_USERS: PresenceUser[] = [];

function samePresence(a: PresenceUser[], b: readonly PresenceUser[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (user, i) =>
        user.id === b[i].id &&
        user.displayName === b[i].displayName &&
        user.avatarColor === b[i].avatarColor &&
        // A changed avatar image is a visible change too (A6): without this
        // an `update` that only swaps `avatarPath` is dropped as "identical".
        user.avatarPath === b[i].avatarPath,
    )
  );
}

/** Who is on a board right now, per board (TASK-36 presence SSE). */
export class PresenceStore {
  private readonly byBoard = new Map<string, PresenceUser[]>();
  private readonly listeners = new Set<() => void>();

  set(boardId: string, users: readonly PresenceUser[]): void {
    const previous = this.byBoard.get(boardId);
    if (previous && samePresence(previous, users)) return;
    this.byBoard.set(boardId, [...users]);
    this.emit();
  }

  /**
   * Apply a presence event (TASK-36): `sync` replaces the roster, while
   * `join`/`leave`/`update` mutate it in place. Deltas keep the per-event
   * cost O(1) instead of re-shipping the whole roster to every client.
   */
  apply(boardId: string, event: PresenceSseEvent): void {
    if (event.op === "sync") {
      this.set(boardId, event.users);
      return;
    }
    const current = this.byBoard.get(boardId) ?? [];
    let next: PresenceUser[];
    if (event.op === "leave") {
      next = current.filter((user) => user.id !== event.userId);
    } else {
      const index = current.findIndex((user) => user.id === event.user.id);
      next =
        index === -1
          ? [...current, event.user]
          : current.map((user) =>
              user.id === event.user.id ? event.user : user,
            );
    }
    if (samePresence(current, next)) return;
    this.byBoard.set(boardId, next);
    this.emit();
  }

  get(boardId: string | undefined): PresenceUser[] {
    if (boardId === undefined) return EMPTY_USERS;
    return this.byBoard.get(boardId) ?? EMPTY_USERS;
  }

  clear(): void {
    if (this.byBoard.size === 0) return;
    this.byBoard.clear();
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** The last known author of an entity's change, and its transient ring. */
export interface EntityAttribution {
  boardId: string;
  userId: string;
  /** When the change happened (ms) — the relative time next to the avatar. */
  at: number;
  /** True while the entity wears the foreign-change highlight. */
  highlight: boolean;
}

/**
 * Who last changed an entity (TASK-36 attribution).
 *
 * Three feeds write here: server aggregates seed it (`Card.lastActorId`),
 * local dispatches stamp the current user, and foreign SSE commands stamp
 * the command's `actorId` while raising the 2 s highlight. The highlight
 * clears itself on a timer; the attribution stays for the session, so a
 * card keeps its author's face until the tab is closed or a reload seeds
 * the same value from the database.
 */
export class AttributionStore {
  private readonly map = new Map<string, EntityAttribution>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Map<string, Set<() => void>>();

  /** Record `userId` as the author of every entity id. */
  stamp(
    boardId: string,
    userId: string,
    ids: readonly string[],
    options: { at?: number; highlight?: boolean } = {},
  ): void {
    const at = options.at ?? Date.now();
    const highlight = options.highlight === true;
    for (const id of ids) {
      this.write(id, { boardId, userId, at, highlight });
    }
  }

  /** Seed from a server aggregate — no highlight, `updatedAt` as the time. */
  seed(board: Board): void {
    for (const card of Object.values(board.cards)) {
      if (!card.lastActorId) continue;
      this.write(card.id, {
        boardId: board.id,
        userId: card.lastActorId,
        at: card.updatedAt,
        highlight: false,
      });
    }
  }

  get(entityId: string): EntityAttribution | undefined {
    return this.map.get(entityId);
  }

  subscribe(entityId: string, listener: () => void): () => void {
    let listeners = this.listeners.get(entityId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(entityId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(entityId);
    };
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const keys = [...this.map.keys()];
    this.map.clear();
    for (const key of keys) this.notify(key);
  }

  private write(entityId: string, next: EntityAttribution): void {
    const pending = this.timers.get(entityId);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.timers.delete(entityId);
    }
    const previous = this.map.get(entityId);
    if (
      previous &&
      previous.userId === next.userId &&
      previous.at === next.at &&
      previous.highlight === next.highlight
    ) {
      return;
    }
    this.map.set(entityId, next);
    this.notify(entityId);
    if (next.highlight) {
      this.timers.set(
        entityId,
        setTimeout(() => {
          this.timers.delete(entityId);
          const current = this.map.get(entityId);
          if (!current || !current.highlight) return;
          this.map.set(entityId, { ...current, highlight: false });
          this.notify(entityId);
        }, FOREIGN_HIGHLIGHT_MS),
      );
    }
  }

  private notify(entityId: string): void {
    for (const listener of [...(this.listeners.get(entityId) ?? [])])
      listener();
  }
}

/** Board member directory: `userId → profile` for names and avatars. */
export class MembersStore {
  private readonly byBoard = new Map<string, Map<string, BoardMemberDto>>();
  private version = 0;
  private readonly listeners = new Set<() => void>();

  set(boardId: string, members: readonly BoardMemberDto[]): void {
    const byUser = new Map<string, BoardMemberDto>();
    for (const member of members) byUser.set(member.userId, member);
    this.byBoard.set(boardId, byUser);
    this.version += 1;
    this.emit();
  }

  get(boardId: string | undefined, userId: string | null | undefined) {
    if (boardId === undefined || !userId) return undefined;
    return this.byBoard.get(boardId)?.get(userId);
  }

  /** Every accepted member of the board (row order as loaded). */
  list(boardId: string | undefined): BoardMemberDto[] {
    if (boardId === undefined) return [];
    const map = this.byBoard.get(boardId);
    return map ? [...map.values()] : [];
  }

  clear(): void {
    if (this.byBoard.size === 0) return;
    this.byBoard.clear();
    this.version += 1;
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Snapshot for `useSyncExternalStore`: a counter, not the map itself. */
  getVersion = (): number => this.version;

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * Fan-out of `type: "activity"` SSE frames (TASK-37): comments arriving on
 * an open board. Unlike the other stores this one keeps no state — every
 * frame is handed to the mounted listeners (an open card dialog) and
 * forgotten, their views refetch what they need through the REST API.
 */
export class ActivityStore {
  private readonly listeners = new Set<(event: ActivitySseEvent) => void>();

  publish(event: ActivitySseEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe = (listener: (event: ActivitySseEvent) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  clear(): void {
    this.listeners.clear();
  }
}

/** The stores, created together and disposed together. */
export interface BoardLive {
  presence: PresenceStore;
  attribution: AttributionStore;
  members: MembersStore;
  activity: ActivityStore;
  commits: CommitStore;
  dispose: () => void;
}

export function createBoardLive(): BoardLive {
  const presence = new PresenceStore();
  const attribution = new AttributionStore();
  const members = new MembersStore();
  const activity = new ActivityStore();
  const commits = new CommitStore();
  return {
    presence,
    attribution,
    members,
    activity,
    commits,
    dispose: () => {
      presence.clear();
      attribution.clear();
      members.clear();
      activity.clear();
      commits.clear();
    },
  };
}

const BoardLiveContext = createContext<BoardLive | null>(null);

export function BoardLiveProvider({
  live,
  children,
}: {
  live: BoardLive;
  children: ReactNode;
}) {
  return (
    <BoardLiveContext.Provider value={live}>
      {children}
    </BoardLiveContext.Provider>
  );
}

/**
 * An empty store set for component tests that render a card or a table row
 * without the board provider — the same tolerance `useAuth` has, and the
 * reason isolated render tests do not need another wrapper. Nothing writes
 * into it: only `BoardProvider` stamps presence/attribution.
 */
const FALLBACK_LIVE = createBoardLive();

/**
 * The stores of the current board provider, or an empty set outside one.
 */
export function useBoardLive(): BoardLive {
  return useContext(BoardLiveContext) ?? FALLBACK_LIVE;
}

/** The connected users of one board (empty before the first roster). */
export function useBoardPresence(boardId: string | undefined): PresenceUser[] {
  const { presence } = useBoardLive();
  const get = useCallback(() => presence.get(boardId), [presence, boardId]);
  return useSyncExternalStore(presence.subscribe, get);
}

/** Who last changed one entity, if anyone ever did in this session. */
export function useEntityAttribution(
  entityId: string,
): EntityAttribution | undefined {
  const { attribution } = useBoardLive();
  const subscribe = useCallback(
    (listener: () => void) => attribution.subscribe(entityId, listener),
    [attribution, entityId],
  );
  const get = useCallback(
    () => attribution.get(entityId),
    [attribution, entityId],
  );
  return useSyncExternalStore(subscribe, get);
}

/** The board profile of one user, once the directory has loaded. */
export function useBoardMember(
  boardId: string | undefined,
  userId: string | null | undefined,
): BoardMemberDto | undefined {
  const { members } = useBoardLive();
  useSyncExternalStore(members.subscribe, members.getVersion);
  return members.get(boardId, userId);
}

/**
 * The whole roster of a board (TASK-49): the assignee picker's suggestion
 * pool, the table view's assignee column and the filter facet all enumerate
 * the member directory instead of probing one id at a time. Re-renders on
 * the same version bump as `useMembersVersion`.
 */
export function useBoardMembersList(
  boardId: string | undefined,
): BoardMemberDto[] {
  const { members } = useBoardLive();
  useSyncExternalStore(members.subscribe, members.getVersion);
  return members.list(boardId);
}

/**
 * Bumps whenever the member directory is rewritten — the mount load or a
 * realtime membership event. Views that keep their own roster (the members
 * dialog) reload on it, so accepting an invitation shows up live.
 */
export function useMembersVersion(): number {
  const { members } = useBoardLive();
  return useSyncExternalStore(members.subscribe, members.getVersion);
}

/**
 * Card ids a command changes, for local attribution (TASK-36).
 *
 * Writers stamp `lastActorId` on exactly the cards a command rewrites;
 * this mirrors that set on the client so the author appears immediately,
 * without waiting for a refetch. Pure reorders (`SORT_COLUMN`,
 * `SET_COLUMN_CARD_ORDER`) deliberately return nothing — positions are
 * bookkeeping and the server does not stamp them either.
 */
export function cardIdsTouchedBy(action: BoardAction): string[] {
  if (action.type === "DUPLICATE_CARD") return [action.newCardId];
  if (action.type === "RESTORE_CARD") return [action.card.id];
  if (
    action.type === "RESTORE_COLUMN" ||
    action.type === "RESTORE_COLUMN_CARDS"
  ) {
    return action.cards.map((card) => card.id);
  }
  const record = action as unknown as Record<string, unknown>;
  return typeof record.cardId === "string" ? [record.cardId] : [];
}
