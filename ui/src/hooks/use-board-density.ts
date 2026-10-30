import { useCallback, useEffect, useState } from "react";

/**
 * Card density (TASK-142) — the user-facing "simplify design" switch.
 *
 * The full face is the default and keeps every badge, hover action and the
 * label chips. `compact` renders a single-line card: title, labels as dots,
 * blocked marker, checklist progress, priority and the assignee. Details move
 * behind the click/dialog — the wall stays readable while a swarm is writing.
 *
 * Stored next to the other view preferences (`janosik-board-density`) so the
 * choice survives reloads and board switches, like the board/calendar/table
 * view. Kept out of the board state: it is a per-browser display preference,
 * not shared data.
 */

export type BoardDensity = "full" | "compact";

export const BOARD_DENSITY_STORAGE_KEY = "janosik-board-density";
export const DEFAULT_BOARD_DENSITY: BoardDensity = "full";

export function readStoredBoardDensity(): BoardDensity {
  try {
    const stored = localStorage.getItem(BOARD_DENSITY_STORAGE_KEY);
    if (stored === "compact" || stored === "full") return stored;
  } catch {
    /* storage unavailable — the default density applies */
  }
  return DEFAULT_BOARD_DENSITY;
}

export interface BoardDensityControls {
  density: BoardDensity;
  setDensity: (density: BoardDensity) => void;
  toggleDensity: () => void;
}

export function useBoardDensity(): BoardDensityControls {
  const [density, setDensityState] = useState<BoardDensity>(
    readStoredBoardDensity,
  );

  useEffect(() => {
    try {
      localStorage.setItem(BOARD_DENSITY_STORAGE_KEY, density);
    } catch {
      /* storage unavailable — the choice only lasts the session */
    }
    // Exposed for CSS hooks and for the Playwright measurement harness.
    document.documentElement.dataset.density = density;
  }, [density]);

  const setDensity = useCallback(
    (next: BoardDensity) => setDensityState(next),
    [],
  );
  const toggleDensity = useCallback(
    () =>
      setDensityState((current) => (current === "full" ? "compact" : "full")),
    [],
  );

  return { density, setDensity, toggleDensity };
}
