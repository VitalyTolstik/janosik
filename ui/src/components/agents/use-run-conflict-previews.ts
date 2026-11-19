import { useEffect, useState } from "react";
import type { RunSummaryDto } from "@janosik/shared";
import { api, isApiEnabled } from "@/api/client";

export type RunConflictCounts = ReadonlyMap<string, number>;

const NO_COUNTS: RunConflictCounts = new Map();
const PREVIEW_TTL_MS = 30_000;

/** Read-only rollback previews, refreshed on a run revision or TTL tick. */
export function useRunConflictPreviews(
  rows: readonly Pick<RunSummaryDto, "id" | "boardId" | "status" | "kind">[],
  enabled = true,
  revision: number | string = 0,
): RunConflictCounts {
  const [tick, setTick] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    counts: RunConflictCounts;
  }>();
  const targets = JSON.stringify(
    rows
      .filter((row) => row.status === "applied" && row.kind !== "revert")
      .map(({ boardId, id }) => [boardId, id]),
  );
  const key = JSON.stringify([targets, revision, tick]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setTick((value) => value + 1);
    }, PREVIEW_TTL_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isApiEnabled()) return;
    let alive = true;
    for (const [boardId, id] of JSON.parse(targets) as [string, string][]) {
      void api.previewRunRevert(boardId, id).then(
        (result) => {
          if (!alive) return;
          setSnapshot((current) => {
            const counts = new Map(current?.key === key ? current.counts : []);
            counts.set(id, result.conflicts.length);
            return { key, counts };
          });
        },
        () => {
          // A failed preview has no count in this revision.
        },
      );
    }
    return () => {
      alive = false;
    };
  }, [enabled, key, targets]);

  return enabled && snapshot?.key === key ? snapshot.counts : NO_COUNTS;
}
