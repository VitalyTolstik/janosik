import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ActivityFeedPage, ActivitySseEvent } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { useBoardLive } from "@/store/board-live";
import {
  isStaleDeletedCommentEntry,
  reconcileRestoredComments,
} from "@/utils/activity";

export const ACTIVITY_PAGE_SIZE = 50;
const POLL_MS = 3000;
const REFRESH_COALESCE_MS = 1000;
const IDLE_SCOPES = 8;

type BoardLive = ReturnType<typeof useBoardLive>;
type Listener = () => void;
type FeedPage = ActivityFeedPage & { generation: number };
type Snapshot = {
  page: FeedPage | null;
  size: number;
  error: boolean;
  deleted: ReadonlyMap<string, number>;
};
const INITIAL: Snapshot = {
  page: null,
  size: ACTIVITY_PAGE_SIZE,
  error: false,
  deleted: new Map(),
};

class ActivityFeed {
  private snapshot = INITIAL;
  private readonly listeners = new Map<
    Listener,
    { active: boolean; size?: number }
  >();
  private pollTimer: number | undefined;
  private refreshTimer: number | undefined;
  private disconnect: (() => void) | undefined;
  private inFlight = false;
  private dirty = false;
  private fetchedAt = -Infinity;
  private generation = 0;
  private readonly deleted = new Map<string, number>();

  constructor(
    private readonly live: BoardLive,
    private readonly boardId: string,
    private readonly cardId: string | undefined,
  ) {}

  get idle() {
    return this.listeners.size === 0;
  }

  private get active() {
    return [...this.listeners.values()].some((listener) => listener.active);
  }

  private get size() {
    for (const listener of this.listeners.values()) {
      if (listener.active && listener.size !== undefined) return listener.size;
    }
    return this.snapshot.size;
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: Listener, active: boolean, size?: number) => {
    this.listeners.set(listener, { active, size });
    if (this.listeners.size === 1) {
      const offActivity = this.live.activity.subscribe(this.onActivity);
      const offCommits = this.live.commits.subscribe((id, cardIds) => {
        if (
          id === this.boardId &&
          (!this.cardId || cardIds.includes(this.cardId))
        ) {
          this.scheduleRefresh();
        }
      });
      document.addEventListener("visibilitychange", this.onVisibility);
      this.disconnect = () => {
        offActivity();
        offCommits();
        document.removeEventListener("visibilitychange", this.onVisibility);
      };
    }
    this.syncTimer();
    return () => {
      this.listeners.delete(listener);
      this.syncTimer();
      if (this.idle) {
        this.disconnect?.();
        this.disconnect = undefined;
      }
    };
  };

  private publish(snapshot: Snapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners.keys()) listener();
  }

  private onVisibility = () => this.syncTimer(!document.hidden);

  private syncTimer(refreshOnReveal = false) {
    if (!this.active || document.hidden) {
      window.clearInterval(this.pollTimer);
      window.clearTimeout(this.refreshTimer);
      this.pollTimer = undefined;
      this.refreshTimer = undefined;
      return;
    }
    const wasPaused = this.pollTimer === undefined;
    this.pollTimer ??= window.setInterval(this.refresh, POLL_MS);
    if (
      this.size !== this.snapshot.size ||
      (wasPaused &&
        (refreshOnReveal ||
          this.dirty ||
          Date.now() - this.fetchedAt >= POLL_MS))
    ) {
      this.refresh();
    }
  }

  private onActivity = (event: ActivitySseEvent) => {
    if (
      event.boardId !== this.boardId ||
      (this.cardId && event.cardId !== this.cardId)
    ) {
      return;
    }
    const deletedId = event.commentId ?? event.detail;
    if (event.kind === "comment_deleted" && deletedId) {
      this.deleted.set(deletedId, ++this.generation);
      const page = this.snapshot.page;
      this.publish({
        ...this.snapshot,
        deleted: new Map(this.deleted),
        page: page && {
          ...page,
          items: page.items.filter(
            (entry) => (entry.commentId ?? entry.detail) !== deletedId,
          ),
        },
      });
    }
    this.scheduleRefresh();
  };

  private scheduleRefresh() {
    this.dirty = true;
    if (!this.active || document.hidden || this.refreshTimer !== undefined) {
      return;
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, REFRESH_COALESCE_MS);
  }

  private requestPage(cursor: string | undefined, size: number) {
    return this.cardId
      ? api.cardActivity(this.cardId, cursor, size)
      : api.boardActivity(this.boardId, cursor, size);
  }

  private reconcilePage(
    result: ActivityFeedPage,
    generation: number,
  ): FeedPage {
    reconcileRestoredComments(
      result.items,
      this.deleted,
      generation,
      (entry) => entry.commentId ?? entry.detail,
    );
    return {
      ...result,
      generation,
      items: result.items.filter(
        (entry) => !isStaleDeletedCommentEntry(entry, this.deleted, generation),
      ),
    };
  }

  loadPage = async (cursor: string, size: number): Promise<FeedPage> => {
    const generation = this.generation;
    return this.reconcilePage(await this.requestPage(cursor, size), generation);
  };

  refresh = () => {
    if (this.inFlight || !this.active || document.hidden) return;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.inFlight = true;
    this.dirty = false;
    this.fetchedAt = Date.now();
    const size = this.size;
    const generation = this.generation;
    void this.requestPage(undefined, size)
      .then((result) => {
        const page = this.reconcilePage(result, generation);
        this.publish({ ...this.snapshot, page, size, error: false });
      })
      .catch(() => this.publish({ ...this.snapshot, size, error: true }))
      .finally(() => {
        this.inFlight = false;
        if (this.size !== size) this.refresh();
        else if (this.dirty) this.scheduleRefresh();
      });
  };
}

// BoardLive is owned by BoardProvider. Keep a small cache of idle scopes
// so returning to a tab does not re-fetch a page that is still fresh.
const feeds = new WeakMap<BoardLive, Map<string, ActivityFeed>>();

function getFeed(live: BoardLive, boardId: string, cardId?: string) {
  const scopes = feeds.get(live) ?? new Map<string, ActivityFeed>();
  feeds.set(live, scopes);
  const key = JSON.stringify([boardId, cardId]);
  const feed = scopes.get(key) ?? new ActivityFeed(live, boardId, cardId);
  scopes.delete(key);
  scopes.set(key, feed);
  const idle = [...scopes].filter(([id, scope]) => id !== key && scope.idle);
  for (const [id] of idle.slice(0, Math.max(0, idle.length - IDLE_SCOPES))) {
    scopes.delete(id);
  }
  return feed;
}

export function useBoardActivityFeed(
  boardId: string,
  {
    cardId,
    active = true,
    size,
  }: {
    cardId?: string;
    active?: boolean;
    size?: number;
  } = {},
) {
  const live = useBoardLive();
  const serverMode = isApiEnabled();
  const feed = useMemo(
    () => getFeed(live, boardId, cardId),
    [live, boardId, cardId],
  );
  const subscribe = useCallback(
    (listener: Listener) =>
      serverMode ? feed.subscribe(listener, active, size) : () => undefined,
    [feed, serverMode, active, size],
  );
  const snapshot = useSyncExternalStore(subscribe, feed.getSnapshot);
  return {
    ...snapshot,
    serverMode,
    refresh: feed.refresh,
    loadPage: feed.loadPage,
  };
}
