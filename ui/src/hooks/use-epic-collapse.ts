import { useCallback, useMemo, useState } from "react";
import { LIMITS, type Epic } from "@janosik/shared";

import type { EpicCollapseState } from "@/utils/backlog-rows";
import { readJSON, saveJSON } from "@/utils/storage";

const EMPTY: EpicCollapseState = { expanded: new Set(), completedOpen: false };

export function epicCollapseKey(userId: string, boardId: string): string {
  return `janosik-epic-collapse:v1:${encodeURIComponent(userId)}:${encodeURIComponent(boardId)}`;
}

export function readEpicCollapse(key: string): {
  value: EpicCollapseState;
  writable: boolean;
} {
  const result = readJSON<{
    version?: unknown;
    expanded?: unknown;
    completedOpen?: unknown;
  }>(key);
  if (
    result.status !== "ok" ||
    result.value?.version !== 1 ||
    !Array.isArray(result.value.expanded)
  ) {
    return {
      value: EMPTY,
      writable:
        result.status !== "unavailable" &&
        !(result.status === "corrupt" && result.quarantineKey === null),
    };
  }
  const expanded = new Set<string>(
    result.value.expanded
      .slice(0, LIMITS.epicsPerBoard)
      .filter(
        (id): id is string =>
          typeof id === "string" && id.length <= 128 && id.trim() !== "",
      ),
  );
  return {
    value: { expanded, completedOpen: result.value.completedOpen === true },
    writable: true,
  };
}

export interface EpicCollapse extends EpicCollapseState {
  toggleEpic: (id: string) => void;
  toggleCompleted: () => void;
}

export function useEpicCollapse(
  boardId: string | undefined,
  userId: string,
  epics: Epic[] | undefined,
): EpicCollapse {
  const key =
    boardId === undefined ? undefined : epicCollapseKey(userId, boardId);
  // Keep changes for the lifetime of this surface when storage is unavailable.
  const [session, setSession] = useState<Record<string, EpicCollapseState>>({});
  const hasEpics = Boolean(epics?.length);
  const stored = useMemo(
    () => (key === undefined || !hasEpics ? undefined : readEpicCollapse(key)),
    [key, hasEpics],
  );
  const current =
    (key === undefined ? undefined : session[key]) ?? stored?.value ?? EMPTY;
  const expanded = useMemo(
    () =>
      new Set(
        epics?.filter(({ id }) => current.expanded.has(id)).map(({ id }) => id),
      ),
    [current, epics],
  );
  const { completedOpen } = current;
  const update = useCallback(
    (next: EpicCollapseState) => {
      if (key === undefined) return;
      setSession((previous) => ({ ...previous, [key]: next }));
      if (stored?.writable) {
        saveJSON(key, {
          version: 1,
          expanded: [...next.expanded],
          completedOpen: next.completedOpen,
        });
      }
    },
    [key, stored],
  );
  return useMemo(
    () => ({
      expanded,
      completedOpen,
      toggleEpic(id: string) {
        const next = new Set(expanded);
        if (!next.delete(id)) next.add(id);
        update({ expanded: next, completedOpen });
      },
      toggleCompleted() {
        update({ expanded, completedOpen: !completedOpen });
      },
    }),
    [expanded, completedOpen, update],
  );
}
