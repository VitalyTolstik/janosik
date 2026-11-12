import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardSummary } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";

const POLL_MS = 30_000;

/** In-flight requests are shared by the header and the page; no stale cache. */
const countInFlight = new Map<string, Promise<number>>();

async function fetchPendingCount(boardId: string): Promise<number> {
  const running = countInFlight.get(boardId);
  if (running !== undefined) return running;
  const request = api
    .listApprovals(boardId, { status: "pending", limit: 100 })
    .then((rows) => {
      countInFlight.delete(boardId);
      return rows.length;
    })
    .catch((error: unknown) => {
      countInFlight.delete(boardId);
      throw error;
    });
  countInFlight.set(boardId, request);
  return request;
}

export interface PendingApprovalsState {
  /** Board id → pending approvals on that board. Failed boards are absent. */
  counts: Readonly<Record<string, number>>;
  loading: boolean;
  /** At least one board could not be counted; never render that as zero. */
  error: boolean;
  reload: () => void;
}

/**
 * Scope-correct pending approval counts (TASK-179.8 primitive).
 *
 * The API is board-scoped, so this fans out over boards where the caller is
 * ADMIN. Board lists and individual counts are cached briefly and in-flight
 * requests are shared, so the header and the page can both use the hook
 * without doubling the requests.
 */
export function usePendingApprovals(
  boards?: readonly BoardSummary[],
  enabled = true,
): PendingApprovalsState {
  const adminIds = useMemo(
    () =>
      (boards ?? [])
        .filter(
          (board) => board.role === "ADMIN" && board.archivedAt === undefined,
        )
        .map((board) => board.id)
        .sort(),
    [boards],
  );
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (!enabled || !isApiEnabled()) {
      setCounts({});
      setLoading(false);
      setError(false);
      return;
    }
    const request = ++generation.current;
    setLoading(true);
    let ids: string[];
    try {
      ids =
        boards === undefined
          ? (await api.listBoards())
              .filter(
                (board) =>
                  board.role === "ADMIN" && board.archivedAt === undefined,
              )
              .map((board) => board.id)
          : adminIds;
    } catch {
      if (request === generation.current) {
        setLoading(false);
        setError(true);
      }
      return;
    }
    if (ids.length === 0) {
      if (request === generation.current) {
        setCounts({});
        setLoading(false);
        setError(false);
      }
      return;
    }
    // Keep the fan-out bounded: a user with dozens of boards must not open
    // dozens of approval requests at once.
    const results: ({ id: string; count: number } | null)[] = new Array(
      ids.length,
    );
    let index = 0;
    async function worker(): Promise<void> {
      while (index < ids.length) {
        const current = index++;
        const id = ids[current];
        try {
          results[current] = { id, count: await fetchPendingCount(id) };
        } catch {
          results[current] = null;
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(3, ids.length) }, () => worker()),
    );
    if (request !== generation.current) return;
    const next: Record<string, number> = {};
    let failed = false;
    for (const result of results) {
      if (result === null) failed = true;
      else next[result.id] = result.count;
    }
    setCounts(next);
    setLoading(false);
    setError(failed);
  }, [adminIds, boards, enabled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first answer lands in the async load, not synchronously
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const onVisible = (): void => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return {
    counts,
    loading,
    error,
    reload,
  };
}
