import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardSummary, RunSummaryDto } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";

const LIMIT = 100;

export interface AgentRunRow extends RunSummaryDto {
  boardTitle: string;
}

export interface AgentRunsState {
  rows: AgentRunRow[];
  loading: boolean;
  error: boolean;
  reload: () => void;
}

/**
 * Cross-board run summaries for the /agents Runs shell. The server exposes
 * runs per board only; this fans out with a small concurrency bound and keeps
 * the last successful rows when one board fails. Detail, filters and rollback
 * stay in TASK-179.5; this hook is the read-only list source.
 */
export function useAgentRuns(
  boards: readonly BoardSummary[],
  enabled: boolean,
): AgentRunsState {
  const [rows, setRows] = useState<AgentRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (!enabled || !isApiEnabled() || boards.length === 0) {
      setLoading(false);
      return;
    }
    const request = ++generation.current;
    setLoading(true);
    setError(false);
    const results: (AgentRunRow[] | null)[] = new Array(boards.length);
    let index = 0;
    async function worker(): Promise<void> {
      while (index < boards.length) {
        const current = index++;
        const board = boards[current];
        try {
          const list = await api.listRuns(board.id, { limit: LIMIT });
          results[current] = list.map((run) => ({
            ...run,
            boardTitle: board.title,
          }));
        } catch {
          results[current] = null;
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(2, boards.length) }, () => worker()),
    );
    if (request !== generation.current) return;
    const merged: AgentRunRow[] = [];
    let failed = false;
    for (const result of results) {
      if (result === null) failed = true;
      else merged.push(...result);
    }
    merged.sort((a, b) => b.createdAt - a.createdAt);
    setRows(merged);
    setError(failed);
    setLoading(false);
  }, [boards, enabled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first answer lands in the async load, not synchronously
    void load();
  }, [load]);

  return { rows, loading, error, reload: load };
}
