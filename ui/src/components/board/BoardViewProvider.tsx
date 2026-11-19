import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { BoardView } from "@/components/board/ViewSwitcher";

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

const BoardViewContext = createContext<{
  view: BoardView;
  setView: (view: BoardView) => void;
} | null>(null);

export function BoardViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<BoardView>(readStoredView);
  const controls = useMemo(() => ({ view, setView }), [view]);

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
