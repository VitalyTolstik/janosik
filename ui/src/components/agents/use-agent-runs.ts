import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardRole, RunSummaryDto } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { useBoardLive } from "@/store/board-live";
import {
  RUN_PAGE_SIZE,
  runFrom,
  runTime,
  type AgentRunFilter,
  type RunBoardScope,
} from "./run-model";

export interface AgentRunRow extends RunSummaryDto {
  boardTitle: string;
  boardRole: BoardRole;
}

interface BoardPage {
  rows: AgentRunRow[];
  cursor: string | null;
}

interface RunsSnapshot {
  key: string;
  rows: AgentRunRow[];
  hasMore: boolean;
  error: boolean;
  errorBoardIds: string[];
  revokedBoardIds: string[];
  lastLoadedAt: number | null;
}

export interface AgentRunsState {
  rows: AgentRunRow[];
  /** True while the current filter has no answer yet. */
  loading: boolean;
  loadingMore: boolean;
  /** At least one board failed; the last known rows stay (stale marker). */
  error: boolean;
  errorBoardIds: string[];
  /** Boards that answered 403/404: their rows are gone, not stale. */
  revokedBoardIds: string[];
  staleBoardIds: string[];
  hasMore: boolean;
  /** Rows currently known for this filter (a loaded count, not a server total). */
  total: number;
  lastLoadedAt: number | null;
  reload: () => void;
  loadMore: () => Promise<void>;
}

/**
 * TASK-179.5 cross-board run history. The server exposes runs per board only,
 * so this fans out with a small concurrency bound, keeps a cursor per board
 * and merges the pages newest-first. A network failure keeps the last known
 * rows and reports the affected boards; a 403/404 drops them because access
 * (not freshness) changed. A committed rollback arrives as `run.reverted` and
 * refreshes the loaded pages without a reload.
 */
export function useAgentRuns(
  boards: readonly RunBoardScope[],
  options: { enabled: boolean; filter: AgentRunFilter },
): AgentRunsState {
  const { enabled, filter } = options;
  const live = useBoardLive();
  const [snapshot, setSnapshot] = useState<RunsSnapshot | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);
  const pagesRef = useRef<{ key: string; pages: Map<string, BoardPage> }>({
    key: "",
    pages: new Map<string, BoardPage>(),
  });

  const filterKey = `${filter.board}|${filter.status}|${filter.kind}|${filter.token}|${filter.session}|${filter.time}`;
  const boardsKey = boards.map((board) => board.id).join("|");
  const scopedBoards = useMemo(
    () =>
      filter.board === "all"
        ? boards
        : boards.filter((board) => board.id === filter.board),
    [boards, filter.board],
  );
  const scopedKey = scopedBoards.map((board) => board.id).join("|");

  const queryFor = useCallback(
    (cursor?: string) => {
      const from = runFrom(filter.time);
      return {
        ...(filter.status === "all" ? {} : { status: filter.status }),
        ...(filter.kind === "all" ? {} : { kind: filter.kind }),
        ...(filter.token === "all" ? {} : { apiTokenId: filter.token }),
        ...(filter.session === "all" ? {} : { agentSessionId: filter.session }),
        ...(from === undefined ? {} : { from }),
        limit: RUN_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      };
    },
    [filter.kind, filter.session, filter.status, filter.time, filter.token],
  );

  const load = useCallback(async (): Promise<void> => {
    if (!enabled || !isApiEnabled()) return;
    const request = ++generation.current;
    const previous =
      pagesRef.current.key === filterKey
        ? pagesRef.current.pages
        : new Map<string, BoardPage>();
    const pages = new Map<string, BoardPage>();
    const results: Array<{
      board: RunBoardScope;
      page: BoardPage | null;
      failure: "stale" | "revoked" | null;
    }> = new Array(scopedBoards.length);
    let index = 0;
    async function worker(): Promise<void> {
      while (index < scopedBoards.length) {
        const current = index++;
        const board = scopedBoards[current];
        try {
          const rows = await api.listRuns(board.id, queryFor());
          results[current] = {
            board,
            page: {
              rows: rows.map((run) => decorate(run, board)),
              cursor:
                rows.length === RUN_PAGE_SIZE
                  ? (rows[rows.length - 1]?.id ?? null)
                  : null,
            },
            failure: null,
          };
        } catch (error) {
          results[current] = {
            board,
            page: previous.get(board.id) ?? null,
            failure: revokedStatus(error) ? "revoked" : "stale",
          };
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(2, scopedBoards.length) }, () => worker()),
    );
    if (request !== generation.current) return;
    const rowsById = new Map<string, AgentRunRow>();
    const errorBoardIds: string[] = [];
    const revokedBoardIds: string[] = [];
    for (const result of results) {
      if (result === undefined) continue;
      if (result.failure === "revoked") {
        revokedBoardIds.push(result.board.id);
        continue;
      }
      if (result.failure === "stale") errorBoardIds.push(result.board.id);
      if (result.page === null) continue;
      pages.set(result.board.id, result.page);
      for (const row of result.page.rows) rowsById.set(row.id, row);
    }
    const rows = sortRows([...rowsById.values()]);
    const hasMore = [...pages.values()].some((page) => page.cursor !== null);
    pagesRef.current = { key: filterKey, pages };
    setSnapshot({
      key: filterKey,
      rows,
      hasMore,
      error: errorBoardIds.length > 0,
      errorBoardIds,
      revokedBoardIds,
      lastLoadedAt: errorBoardIds.length === 0 ? Date.now() : null,
    });
  }, [enabled, filterKey, queryFor, scopedBoards]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, filterKey, scopedKey, boardsKey, load]);

  useEffect(() => {
    if (!enabled) return;
    return live.agentControl.subscribeRun(() => void load());
  }, [enabled, live, load]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (
      !enabled ||
      loadingMore ||
      pagesRef.current.key !== filterKey ||
      scopedBoards.length === 0
    ) {
      return;
    }
    const pages = new Map(pagesRef.current.pages);
    const pending = [...pages.entries()].filter(
      ([, page]) => page.cursor !== null,
    );
    if (pending.length === 0) return;
    setLoadingMore(true);
    const request = generation.current;
    try {
      const results: Array<{
        boardId: string;
        rows: AgentRunRow[];
        cursor: string | null;
      } | null> = new Array(pending.length);
      let index = 0;
      async function worker(): Promise<void> {
        while (index < pending.length) {
          const current = index++;
          const [boardId, page] = pending[current];
          const board = scopedBoards.find((entry) => entry.id === boardId);
          if (board === undefined) {
            results[current] = null;
            continue;
          }
          try {
            const rows = await api.listRuns(
              boardId,
              queryFor(page.cursor ?? undefined),
            );
            results[current] = {
              boardId,
              rows: rows.map((run) => decorate(run, board)),
              cursor:
                rows.length === RUN_PAGE_SIZE
                  ? (rows[rows.length - 1]?.id ?? null)
                  : null,
            };
          } catch {
            results[current] = null;
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(2, pending.length) }, () => worker()),
      );
      if (request !== generation.current) return;
      const rowsById = new Map<string, AgentRunRow>(
        [...pages.values()].flatMap((page) =>
          page.rows.map((row) => [row.id, row] as const),
        ),
      );
      let failed = false;
      for (const result of results) {
        if (result === null) {
          failed = true;
          continue;
        }
        const existing = pages.get(result.boardId);
        if (existing === undefined) continue;
        const mergedRows = [...existing.rows, ...result.rows];
        pages.set(result.boardId, {
          rows: mergedRows,
          cursor: result.cursor,
        });
        for (const row of result.rows) rowsById.set(row.id, row);
      }
      const rows = sortRows([...rowsById.values()]);
      pagesRef.current = { key: filterKey, pages };
      setSnapshot((current) => ({
        key: filterKey,
        rows,
        hasMore: [...pages.values()].some((page) => page.cursor !== null),
        error: failed || (current?.error ?? false),
        errorBoardIds: current?.errorBoardIds ?? [],
        revokedBoardIds: current?.revokedBoardIds ?? [],
        lastLoadedAt: current?.lastLoadedAt ?? null,
      }));
    } finally {
      // A reload/SSE may bump the generation while this request is in flight.
      // The stale rows are ignored, but the control must never stay disabled.
      setLoadingMore(false);
    }
  }, [enabled, filterKey, loadingMore, queryFor, scopedBoards]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  const current = snapshot?.key === filterKey ? snapshot : null;
  return {
    rows: current?.rows ?? [],
    loading: enabled && current === null,
    loadingMore,
    error: current?.error ?? false,
    errorBoardIds: current?.errorBoardIds ?? [],
    revokedBoardIds: current?.revokedBoardIds ?? [],
    staleBoardIds: current?.errorBoardIds ?? [],
    hasMore: current?.hasMore ?? false,
    total: current?.rows.length ?? 0,
    lastLoadedAt: current?.lastLoadedAt ?? null,
    reload,
    loadMore,
  };
}

function decorate(run: RunSummaryDto, board: RunBoardScope): AgentRunRow {
  return { ...run, boardTitle: board.title, boardRole: board.role };
}

function sortRows(rows: AgentRunRow[]): AgentRunRow[] {
  return rows.sort(
    (a, b) => runTime(b) - runTime(a) || b.id.localeCompare(a.id),
  );
}

function revokedStatus(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  const status = (error as { status?: unknown }).status;
  return status === 403 || status === 404;
}
