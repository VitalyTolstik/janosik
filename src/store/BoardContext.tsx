import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import {
  boardReducer,
  initialBoardState,
  type BoardAction,
  type BoardState,
} from "@/store/board-reducer";
import type { Board, Label } from "@/types/kanban";
import { loadJSON, migrateStorageKey, saveJSON } from "@/utils/storage";
import { normalizeBoards } from "@/store/migrate";

/**
 * Board state provider.
 *
 * - Initializes from localStorage when present (falls back to the seed board).
 * - Persists every change back to localStorage.
 * - Exposes the active board plus convenience wrappers for dispatch.
 */

const STORAGE_KEY = "janosik-boards";

function loadInitialState(): BoardState {
  // One-time brand migration (Vortex → Janosik) — read before the new key.
  migrateStorageKey("vortex-boards", STORAGE_KEY);
  const stored = loadJSON<BoardState>(STORAGE_KEY);
  if (Array.isArray(stored) && stored.length > 0) {
    return normalizeBoards(stored);
  }
  return initialBoardState();
}

interface BoardContextValue {
  board: Board | undefined;
  dispatch: (action: BoardAction) => void;
  /* Convenience actions */
  addColumn: (title: string) => void;
  renameColumn: (columnId: string, title: string) => void;
  deleteColumn: (columnId: string) => void;
  addCard: (columnId: string, title: string) => void;
  updateCard: (cardId: string, title: string) => void;
  deleteCard: (cardId: string) => void;
  toggleCardLabel: (cardId: string, labelId: string) => void;
  addLabel: (label: Label) => void;
  renameLabel: (labelId: string, name: string) => void;
  setLabelColor: (labelId: string, color: Label["color"]) => void;
  deleteLabel: (labelId: string) => void;
  moveCard: (
    cardId: string,
    fromColumnId: string,
    toColumnId: string,
    toIndex: number,
  ) => void;
  moveColumn: (columnId: string, fromIndex: number, toIndex: number) => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    boardReducer,
    undefined,
    loadInitialState,
  );

  // Persist after every change.
  useEffect(() => {
    saveJSON(STORAGE_KEY, state);
  }, [state]);

  const value = useMemo<BoardContextValue>(() => {
    const addColumn = (title: string) =>
      dispatch({ type: "ADD_COLUMN", title });
    const renameColumn = (columnId: string, title: string) =>
      dispatch({ type: "RENAME_COLUMN", columnId, title });
    const deleteColumn = (columnId: string) =>
      dispatch({ type: "DELETE_COLUMN", columnId });
    const addCard = (columnId: string, title: string) =>
      dispatch({ type: "ADD_CARD", columnId, title });
    const updateCard = (cardId: string, title: string) =>
      dispatch({ type: "UPDATE_CARD", cardId, title });
    const deleteCard = (cardId: string) =>
      dispatch({ type: "DELETE_CARD", cardId });
    const toggleCardLabel = (cardId: string, labelId: string) =>
      dispatch({ type: "TOGGLE_CARD_LABEL", cardId, labelId });
    const addLabel = (label: Label) => dispatch({ type: "ADD_LABEL", label });
    const renameLabel = (labelId: string, name: string) =>
      dispatch({ type: "RENAME_LABEL", labelId, name });
    const setLabelColor = (labelId: string, color: Label["color"]) =>
      dispatch({ type: "SET_LABEL_COLOR", labelId, color });
    const deleteLabel = (labelId: string) =>
      dispatch({ type: "DELETE_LABEL", labelId });
    const moveCard = (
      cardId: string,
      fromColumnId: string,
      toColumnId: string,
      toIndex: number,
    ) =>
      dispatch({
        type: "MOVE_CARD",
        cardId,
        fromColumnId,
        toColumnId,
        toIndex,
      });
    const moveColumn = (columnId: string, fromIndex: number, toIndex: number) =>
      dispatch({ type: "MOVE_COLUMN", columnId, fromIndex, toIndex });

    return {
      board: state[0],
      dispatch,
      addColumn,
      renameColumn,
      deleteColumn,
      addCard,
      updateCard,
      deleteCard,
      toggleCardLabel,
      addLabel,
      renameLabel,
      setLabelColor,
      deleteLabel,
      moveCard,
      moveColumn,
    };
  }, [state]);

  return (
    <BoardContext.Provider value={value}>{children}</BoardContext.Provider>
  );
}

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) {
    throw new Error("useBoard must be used within a BoardProvider");
  }
  return ctx;
}
