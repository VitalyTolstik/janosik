import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_BOARD_BACKGROUND,
  isBoardBackgroundId,
  type BoardBackgroundId,
} from "@/types/board-background";
import { migrateStorageKey } from "@/utils/storage";

/**
 * Board background management: the chosen preset (flat / paper / dots /
 * grid) is persisted to localStorage under `janosik-board-bg` and applied as
 * a CSS class on the board <main> (see BoardSection). No preflight needed —
 * the value only affects the board area, so there's no theme-flash concern.
 */

const STORAGE_KEY = "janosik-board-bg";

function readStoredBackground(): BoardBackgroundId | null {
  try {
    // One-time brand migration (Vortex → Janosik) — read before the new key.
    migrateStorageKey("vortex-board-bg", STORAGE_KEY);
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && isBoardBackgroundId(stored) ? stored : null;
  } catch {
    return null;
  }
}

interface BoardBackgroundContextValue {
  background: BoardBackgroundId;
  setBackground: (background: BoardBackgroundId) => void;
}

const BoardBackgroundContext =
  createContext<BoardBackgroundContextValue | null>(null);

export function BoardBackgroundProvider({ children }: { children: ReactNode }) {
  const [background, setBackgroundState] = useState<BoardBackgroundId>(
    () => readStoredBackground() ?? DEFAULT_BOARD_BACKGROUND,
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, background);
    } catch {
      /* storage unavailable — background still works for the session */
    }
  }, [background]);

  const setBackground = useCallback(
    (next: BoardBackgroundId) => setBackgroundState(next),
    [],
  );

  const value = useMemo(
    () => ({ background, setBackground }),
    [background, setBackground],
  );

  return (
    <BoardBackgroundContext.Provider value={value}>
      {children}
    </BoardBackgroundContext.Provider>
  );
}

export function useBoardBackground(): BoardBackgroundContextValue {
  const ctx = useContext(BoardBackgroundContext);
  if (!ctx) {
    throw new Error(
      "useBoardBackground must be used within a BoardBackgroundProvider",
    );
  }
  return ctx;
}
