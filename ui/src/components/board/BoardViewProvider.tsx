import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import type { BoardView } from "@/components/board/ViewSwitcher";
import {
  useBoardDensity,
  type BoardDensityControls,
} from "@/hooks/use-board-density";

const VIEW_STORAGE_KEY = "janosik-board-view";

function readStoredView(): BoardView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "calendar" || stored === "table" || stored === "watch") {
      return stored;
    }
  } catch {
    /* storage unavailable — the default view applies */
  }
  return "board";
}

const BoardViewContext = createContext<
  | (BoardDensityControls & {
      view: BoardView;
      setView: (view: BoardView) => void;
      openFiltersRef: RefObject<() => void>;
    })
  | null
>(null);

export function BoardViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<BoardView>(readStoredView);
  const { density, setDensity, toggleDensity } = useBoardDensity();
  const openFiltersRef = useRef<() => void>(null);
  const controls = useMemo(
    () => ({
      view,
      setView,
      density,
      setDensity,
      toggleDensity,
      openFiltersRef,
    }),
    [view, density, setDensity, toggleDensity],
  );

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* storage unavailable — the choice only lasts the session */
    }
  }, [view]);

  return (
    <BoardViewContext.Provider value={controls}>
      {children}
    </BoardViewContext.Provider>
  );
}

export function useBoardView() {
  const controls = useContext(BoardViewContext);
  if (controls === null) throw new Error("Missing BoardViewProvider");
  return controls;
}
