import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  AgentsOverviewApprovalItem,
  AgentsOverviewResponse,
  BoardRole,
} from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";

const POLL_MS = 30_000;
/** One exact count plus the first page of rows; the server owns the totals. */
const ROW_LIMIT = 100;

/** The minimal board summary needed to gate the request client-side. */
export interface PendingApprovalsBoard {
  id: string;
  role: BoardRole | undefined;
  archivedAt?: number;
}

export interface PendingApprovalsOptions {
  /** `null`/omitted means All boards. */
  boardId?: string | null;
  /**
   * The caller's board summaries. They gate the request before it is sent:
   * MEMBER/VIEWER scopes never touch the approvals aggregation at all.
   */
  boards?: readonly PendingApprovalsBoard[];
  enabled?: boolean;
  /**
   * Explicit role gate for surfaces that already know the board role and do
   * not keep the full board list (the board header trigger).
   */
  canViewApprovals?: boolean;
}

export interface PendingApprovalsSnapshot {
  /** Effective-status approval rows for the current scope. */
  rows: readonly AgentsOverviewApprovalItem[];
  /** Board id → exact pending count, or `null` when the caller is not ADMIN. */
  counts: Readonly<Record<string, number | null>>;
  /** Exact pending count for the current scope; `null` means unknown. */
  pendingCount: number | null;
  /** Exact pending count across every ADMIN board, for the All-boards row. */
  totalCount: number | null;
  loading: boolean;
  refreshing: boolean;
  /** A network/server failure. Last-known data stays visible as stale. */
  error: boolean;
  /** Confirmed 403/404: the scope is not readable, so no Retry trap. */
  forbidden: boolean;
  stale: boolean;
  refreshedAt: number | null;
  /** The server total exceeds the first page of rows. */
  truncated: boolean;
}

export interface PendingApprovalsState extends PendingApprovalsSnapshot {
  reload: () => void;
}

const NO_ROWS: readonly AgentsOverviewApprovalItem[] = Object.freeze([]);
const NO_COUNTS: Readonly<Record<string, number | null>> = Object.freeze({});

const EMPTY_SNAPSHOT: PendingApprovalsSnapshot = Object.freeze({
  rows: NO_ROWS,
  counts: NO_COUNTS,
  pendingCount: null,
  totalCount: null,
  loading: false,
  refreshing: false,
  error: false,
  forbidden: false,
  stale: false,
  refreshedAt: null,
  truncated: false,
});

interface Entry {
  snapshot: PendingApprovalsSnapshot;
  listeners: Set<() => void>;
  timer: number | null;
  onVisible: (() => void) | null;
  generation: number;
  inFlight: boolean;
}

/**
 * One shared store per scope. The global header and the `/agents` page both
 * mount the hook for the same `?board=` scope; they must share one request and
 * one poll instead of doubling the traffic (TASK-179.8).
 */
const entries = new Map<string, Entry>();

function getEntry(key: string): Entry {
  const existing = entries.get(key);
  if (existing !== undefined) return existing;
  const created: Entry = {
    snapshot: { ...EMPTY_SNAPSHOT, loading: true },
    listeners: new Set(),
    timer: null,
    onVisible: null,
    generation: 0,
    inFlight: false,
  };
  entries.set(key, created);
  return created;
}

function notify(entry: Entry): void {
  for (const listener of [...entry.listeners]) listener();
}

function statusOf(error: unknown): number {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return 0;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : 0;
}

function snapshotFromResponse(
  response: AgentsOverviewResponse,
): PendingApprovalsSnapshot {
  const counts: Record<string, number | null> = {};
  let totalCount = 0;
  let hasAdminBoard = false;
  for (const board of response.counts.boards) {
    counts[board.id] = board.pendingApprovals;
    if (board.role === "ADMIN") {
      hasAdminBoard = true;
      totalCount += board.pendingApprovals ?? 0;
    }
  }
  const approvals = response.section === "approvals" ? response : null;
  return {
    rows: approvals?.items ?? NO_ROWS,
    counts,
    pendingCount: response.scope.canViewApprovals
      ? response.counts.approvals.pending
      : null,
    totalCount: hasAdminBoard ? totalCount : null,
    loading: false,
    refreshing: false,
    error: false,
    forbidden: false,
    stale: false,
    refreshedAt: response.refreshedAt,
    truncated: approvals !== null && response.total > approvals.items.length,
  };
}

async function load(key: string): Promise<void> {
  const entry = getEntry(key);
  if (entry.inFlight || entry.snapshot.forbidden) return;
  entry.inFlight = true;
  const generation = ++entry.generation;
  entry.snapshot = {
    ...entry.snapshot,
    loading: entry.snapshot.refreshedAt === null,
    refreshing: entry.snapshot.refreshedAt !== null,
  };
  notify(entry);
  try {
    const response = await api.agentsOverview({
      section: "approvals",
      ...(key === "all" ? {} : { boardId: key }),
      limit: ROW_LIMIT,
    });
    if (generation !== entry.generation) return;
    entry.snapshot = snapshotFromResponse(response);
  } catch (error) {
    if (generation !== entry.generation) return;
    const status = statusOf(error);
    if (status === 403 || status === 404) {
      // A revoked role or a deleted board is confirmed, not transient. Drop
      // the rows, stop polling and do not offer Retry: that would be the
      // 403 + Retry trap.
      stopPolling(entry);
      entry.snapshot = {
        ...EMPTY_SNAPSHOT,
        forbidden: true,
      };
    } else {
      // A network failure keeps the last known data, visibly stale.
      entry.snapshot = {
        ...entry.snapshot,
        loading: false,
        refreshing: false,
        error: true,
        stale: entry.snapshot.refreshedAt !== null,
      };
    }
  } finally {
    if (generation === entry.generation) entry.inFlight = false;
    notify(entry);
  }
}

function startPolling(key: string, entry: Entry): void {
  if (entry.timer !== null) return;
  entry.timer = window.setInterval(() => {
    if (!document.hidden) void load(key);
  }, POLL_MS);
  const onVisible = (): void => {
    if (!document.hidden) void load(key);
  };
  entry.onVisible = onVisible;
  document.addEventListener("visibilitychange", onVisible);
}

function stopPolling(entry: Entry): void {
  if (entry.timer !== null) {
    window.clearInterval(entry.timer);
    entry.timer = null;
  }
  if (entry.onVisible !== null) {
    document.removeEventListener("visibilitychange", entry.onVisible);
    entry.onVisible = null;
  }
}

function subscribeEntry(key: string, listener: () => void): () => void {
  const entry = getEntry(key);
  entry.listeners.add(listener);
  if (entry.listeners.size === 1) {
    startPolling(key, entry);
    void load(key);
  }
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      stopPolling(entry);
      entries.delete(key);
    }
  };
}

function canReadApprovals(options: PendingApprovalsOptions): boolean {
  if (options.canViewApprovals !== undefined) return options.canViewApprovals;
  const boards = options.boards;
  // No board list means the caller already asserted the role (a direct
  // board-scoped surface). The request still goes through SessionOnlyGuard.
  if (boards === undefined) return true;
  const boardId = options.boardId ?? null;
  if (boardId !== null) {
    const board = boards.find((row) => row.id === boardId);
    return board?.role === "ADMIN" && board.archivedAt === undefined;
  }
  return boards.some(
    (board) => board.role === "ADMIN" && board.archivedAt === undefined,
  );
}

/**
 * Scope-correct pending approvals and rows (TASK-179.3/179.8).
 *
 * The single `GET /agents/overview` call replaces the old per-board fan-out:
 * it is read-only (no lazy `expireOverdue`), returns exact scope counts and
 * computes the effective approval status in one server time slice. A MEMBER
 * or VIEWER scope never calls it for approvals; an unknown/error count is
 * `null`, never a fabricated zero.
 */
export function usePendingApprovals(
  options: PendingApprovalsOptions = {},
): PendingApprovalsState {
  const { boardId = null, enabled = true } = options;
  const key = boardId ?? "all";
  const active = enabled && isApiEnabled() && canReadApprovals(options);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      active ? subscribeEntry(key, onStoreChange) : () => {},
    [active, key],
  );
  const getSnapshot = useCallback(
    () => (active ? getEntry(key).snapshot : EMPTY_SNAPSHOT),
    [active, key],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_SNAPSHOT,
  );
  const reload = useCallback(() => {
    if (active) void load(key);
  }, [active, key]);

  return useMemo(() => ({ ...snapshot, reload }), [snapshot, reload]);
}
