import { useEffect, useRef, useState } from "react";
import type { RunSummaryDto } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";

export type RunConflictCounts = ReadonlyMap<string, number>;

const NO_COUNTS: RunConflictCounts = new Map();

/**
 * Rollback blockers must be visible in the list, not only after opening a run
 * (TASK-179 pixel parity). The run summary API has no conflict count, so the
 * client dry-runs the read-only preview for the visible, rollback-eligible
 * rows. Each run is attempted once; a failure is retried only when the list
 * changes, never on every render. A selected detail preview still wins through
 * the caller's own map.
 */
export function useRunConflictPreviews(
  rows: readonly Pick<RunSummaryDto, "id" | "boardId" | "status" | "kind">[],
  enabled = true,
): RunConflictCounts {
  const [counts, setCounts] = useState<RunConflictCounts>(() => new Map());
  const attempted = useRef(new Set<string>());
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !isApiEnabled()) return;
    for (const row of rows) {
      if (
        row.status !== "applied" ||
        row.kind === "revert" ||
        attempted.current.has(row.id)
      ) {
        continue;
      }
      attempted.current.add(row.id);
      void api
        .previewRunRevert(row.boardId, row.id)
        .then((result) => {
          if (disposed.current) return;
          setCounts((current) => {
            const next = new Map(current);
            next.set(row.id, result.conflicts.length);
            return next;
          });
        })
        .catch(() => {
          // Offline/retention/role failures stay unknown; allow a later list
          // change to try again instead of caching a false zero.
          attempted.current.delete(row.id);
        });
    }
  }, [enabled, rows]);

  return enabled ? counts : NO_COUNTS;
}
