import { useEffect, useRef, useState } from "react";
import type { RunSummaryDto } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";

export type RunConflictCounts = ReadonlyMap<string, number>;

const NO_COUNTS: RunConflictCounts = new Map();

/**
 * A conflict preview is a point-in-time dry run. An external fix (another
 * user edits the pre-image target) must not leave a cached blocker forever,
 * so entries expire; a caller can also pass a `revision` (a reload/SSE tick)
 * to invalidate immediately.
 */
const PREVIEW_TTL_MS = 30_000;

interface CachedPreview {
  count: number;
  checkedAt: number;
}

/**
 * Rollback blockers must be visible in the list, not only after opening a run
 * (TASK-179 pixel parity). The run summary API has no conflict count, so the
 * client dry-runs the read-only preview for the visible, rollback-eligible
 * rows. Each run is attempted once per revision/TTL window; a failure is
 * retried when the list changes or the window expires, never on every render.
 * A selected detail preview still wins through the caller's own map.
 */
export function useRunConflictPreviews(
  rows: readonly Pick<RunSummaryDto, "id" | "boardId" | "status" | "kind">[],
  enabled = true,
  revision: number | string = 0,
): RunConflictCounts {
  const [counts, setCounts] = useState<RunConflictCounts>(() => new Map());
  const [tick, setTick] = useState(0);
  const cache = useRef(new Map<string, CachedPreview>());
  const inFlight = useRef(new Set<string>());
  const disposed = useRef(false);
  const lastRevision = useRef(revision);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);

  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    cache.current.clear();
  }, [revision]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setTick((value) => value + 1),
      PREVIEW_TTL_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!enabled || !isApiEnabled()) return;
    const now = Date.now();
    for (const row of rows) {
      if (
        row.status !== "applied" ||
        row.kind === "revert" ||
        inFlight.current.has(row.id)
      ) {
        continue;
      }
      const cached = cache.current.get(row.id);
      if (cached !== undefined && now - cached.checkedAt < PREVIEW_TTL_MS) {
        continue;
      }
      inFlight.current.add(row.id);
      void api
        .previewRunRevert(row.boardId, row.id)
        .then((result) => {
          if (disposed.current) return;
          cache.current.set(row.id, {
            count: result.conflicts.length,
            checkedAt: Date.now(),
          });
          setCounts((current) => {
            const next = new Map(current);
            next.set(row.id, result.conflicts.length);
            return next;
          });
        })
        .catch(() => {
          // Offline/retention/role failures stay unknown; allow a later list
          // change or the TTL window to try again instead of caching a false
          // zero.
          cache.current.delete(row.id);
        })
        .finally(() => {
          inFlight.current.delete(row.id);
        });
    }
  }, [enabled, rows, revision, tick]);

  return enabled ? counts : NO_COUNTS;
}
