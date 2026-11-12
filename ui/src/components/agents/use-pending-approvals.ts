import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalRequestDto, BoardSummary } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { effectiveApprovalStatus } from "@/utils/approval";

const POLL_MS = 30_000;

export interface ApprovalRow extends ApprovalRequestDto {
  boardTitle: string;
}

/** In-flight requests are shared by the header and the page; no stale cache. */
const rowsInFlight = new Map<string, Promise<ApprovalRequestDto[]>>();

async function fetchApprovals(boardId: string): Promise<ApprovalRequestDto[]> {
  const running = rowsInFlight.get(boardId);
  if (running !== undefined) return running;
  const request = api
    .listApprovals(boardId, { limit: 100 })
    .then((rows) => {
      rowsInFlight.delete(boardId);
      return rows;
    })
    .catch((error: unknown) => {
      rowsInFlight.delete(boardId);
      throw error;
    });
  rowsInFlight.set(boardId, request);
  return request;
}

export interface PendingApprovalsState {
  /** All approvals from boards where the caller is ADMIN. */
  rows: readonly ApprovalRow[];
  /** Board id → effective pending approvals on that board. */
  counts: Readonly<Record<string, number>>;
  loading: boolean;
  /** At least one board could not be counted; never render that as zero. */
  error: boolean;
  reload: () => void;
}

/**
 * Cross-board approvals and scope-correct pending counts (TASK-179.3/179.8).
 *
 * The API is board-scoped, so this fans out over boards where the caller is
 * ADMIN. In-flight requests are shared, so the header and the page can both
 * use the hook without doubling the calls. Effective expiry is computed for
 * counts; the detail UI recomputes it against its own ticking clock.
 *
 * Reads intentionally use the existing board approval endpoints, which keep
 * the lazy `ApprovalsService.expireOverdue` path. The UI never writes just to
 * render; 179.10's aggregation endpoint will make the read path fully
 * side-effect free.
 */
export function usePendingApprovals(
  boards?: readonly BoardSummary[],
  enabled = true,
): PendingApprovalsState {
  const adminBoards = useMemo(
    () =>
      boards === undefined
        ? undefined
        : boards.filter(
            (board) => board.role === "ADMIN" && board.archivedAt === undefined,
          ),
    [boards],
  );
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (!enabled || !isApiEnabled()) {
      setRows([]);
      setCounts({});
      setLoading(false);
      setError(false);
      return;
    }
    const request = ++generation.current;
    setLoading(true);
    let scope: readonly BoardSummary[];
    try {
      scope =
        adminBoards ??
        (await api.listBoards()).filter(
          (board) => board.role === "ADMIN" && board.archivedAt === undefined,
        );
    } catch {
      if (request === generation.current) {
        setLoading(false);
        setError(true);
      }
      return;
    }
    if (scope.length === 0) {
      if (request === generation.current) {
        setRows([]);
        setCounts({});
        setLoading(false);
        setError(false);
      }
      return;
    }
    // Keep the fan-out bounded: a user with dozens of boards must not open
    // dozens of approval requests at once.
    const results: ({
      board: BoardSummary;
      rows: ApprovalRequestDto[];
    } | null)[] = new Array(scope.length);
    let index = 0;
    async function worker(): Promise<void> {
      while (index < scope.length) {
        const current = index++;
        const board = scope[current];
        try {
          results[current] = {
            board,
            rows: await fetchApprovals(board.id),
          };
        } catch {
          results[current] = null;
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(3, scope.length) }, () => worker()),
    );
    if (request !== generation.current) return;
    const nextRows: ApprovalRow[] = [];
    const nextCounts: Record<string, number> = {};
    let failed = false;
    const now = Date.now();
    for (const result of results) {
      if (result === null) {
        failed = true;
        continue;
      }
      const boardRows = result.rows.map((row) => ({
        ...row,
        boardTitle: result.board.title,
      }));
      nextRows.push(...boardRows);
      nextCounts[result.board.id] = boardRows.filter(
        (row) =>
          effectiveApprovalStatus(row.status, row.expiresAt, now) === "pending",
      ).length;
    }
    setRows(nextRows);
    setCounts(nextCounts);
    setLoading(false);
    setError(failed);
  }, [adminBoards, enabled]);

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
    rows,
    counts,
    loading,
    error,
    reload,
  };
}
