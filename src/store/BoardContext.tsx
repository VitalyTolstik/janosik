import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import {
  boardReducer,
  initialBoardState,
  type BoardAction,
  type BoardState,
} from "@/store/board-reducer";
import { BoardHistory } from "@/store/history";
import type { Board, Label } from "@/types/kanban";
import { migrateStorageKey } from "@/utils/storage";
import { normalizeBoards } from "@/store/migrate";
import { createBackup } from "@/utils/backup";
import {
  createDebouncedLocalStoragePersistence,
  type DebouncedPersistence,
} from "@/utils/persistence";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";

/**
 * Board state provider.
 *
 * - Initializes from localStorage when present (falls back to the seed board).
 * - Persists changes via a debounced adapter (400 ms) with an immediate
 *   flush on `beforeunload`/unmount, so closing the tab never loses the
 *   last change.
 * - Records a 50-step undo/redo history on top of the pure reducer
 *   (consecutive title edits coalesce into one step) and exposes hotkeys
 *   Ctrl/⌘+Z, Ctrl/⌘+Shift+Z and Ctrl+Y.
 * - Export/import operate on the full `boards` array (multi-board ready).
 * - Auto-backups snapshots to IndexedDB after ~60 s of activity.
 */

const STORAGE_KEY = "janosik-boards";
const SAVE_DEBOUNCE_MS = 400;
const BACKUP_THROTTLE_MS = 60_000;

function loadInitialState(persistence: DebouncedPersistence<BoardState>): BoardState {
  // One-time brand migration (Vortex → Janosik) — read before the new key.
  migrateStorageKey("vortex-boards", STORAGE_KEY);
  const stored = persistence.load();
  if (Array.isArray(stored) && stored.length > 0) {
    return normalizeBoards(stored);
  }
  return initialBoardState();
}

type CardPatch = { title?: string; description?: string };

interface BoardContextValue {
  /** The active (first) board. */
  board: Board | undefined;
  /** Every board in storage (export/import target). */
  boards: Board[];
  dispatch: (action: BoardAction) => void;
  /* Convenience actions */
  addColumn: (title: string) => void;
  renameColumn: (columnId: string, title: string) => void;
  deleteColumn: (columnId: string) => void;
  addCard: (columnId: string, title: string) => void;
  updateCard: (cardId: string, patch: CardPatch) => void;
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
  /* Undo / redo */
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /* Import replaces the whole data set (and resets history). */
  importBoards: (boards: BoardState) => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();

  // One persistence instance per provider lifetime (deferred creation keeps
  // the closure's debounce timer intact across re-renders).
  const persistenceRef = useRef<DebouncedPersistence<BoardState> | null>(null);
  if (persistenceRef.current === null) {
    persistenceRef.current = createDebouncedLocalStoragePersistence<BoardState>(
      STORAGE_KEY,
      SAVE_DEBOUNCE_MS,
    );
  }
  const persistence = persistenceRef.current;

  // Surface storage failures (quota, private mode) instead of failing silently.
  useEffect(() => {
    persistence.setErrorHandler(() => toast.error(t("toast.saveError")));
    return () => persistence.setErrorHandler(null);
  }, [persistence, toast, t]);

  const historyRef = useRef<BoardHistory | null>(null);
  if (historyRef.current === null) {
    historyRef.current = new BoardHistory();
  }

  const [state, dispatchRaw] = useReducer(
    boardReducer,
    undefined,
    () => loadInitialState(persistence),
  );

  // Latest committed state, readable from stable callbacks.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Debounced persistence + throttled auto-backup after every change.
  useEffect(() => {
    persistence.queueSave(state);
  }, [persistence, state]);

  const lastBackupRef = useRef(0);
  useEffect(() => {
    if (state.length === 0) return;
    const now = Date.now();
    if (now - lastBackupRef.current >= BACKUP_THROTTLE_MS) {
      lastBackupRef.current = now;
      void createBackup(state).catch(() => {
        /* IndexedDB unavailable (private mode / tests) — storage still works. */
      });
    }
  }, [state]);

  // Flush pending writes when the tab is closed or the provider unmounts.
  useEffect(() => {
    const flush = () => persistence.flush();
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      persistence.flush();
    };
  }, [persistence]);

  // Wrapper dispatch: record history, then apply (except internal restores).
  const dispatch = useCallback(
    (action: BoardAction) => {
      if (action.type !== "RESTORE_BOARD") {
        historyRef.current?.push(stateRef.current, action);
      }
      dispatchRaw(action);
    },
    [],
  );

  const undo = useCallback(() => {
    const history = historyRef.current;
    const previous = history?.undo(stateRef.current);
    if (previous) {
      dispatchRaw({ type: "RESTORE_BOARD", board: previous[0] });
    }
  }, []);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const next = history?.redo(stateRef.current);
    if (next) {
      dispatchRaw({ type: "RESTORE_BOARD", board: next[0] });
    }
  }, []);

  const importBoards = useCallback((boards: BoardState) => {
    // A new data set invalidates any previous history.
    historyRef.current?.reset();
    dispatchRaw({ type: "IMPORT_BOARDS", boards: normalizeBoards(boards) });
  }, []);

  // Hotkeys: Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl+Y redo. Skip while the
  // user is typing inside an editable field (native text undo takes over).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const value = useMemo<BoardContextValue>(
    () => ({
      board: state[0],
      boards: state,
      dispatch,
      ...createBoardActions(dispatch),
      undo,
      redo,
      canUndo: historyRef.current?.canUndo() ?? false,
      canRedo: historyRef.current?.canRedo() ?? false,
      importBoards,
    }),
    [state, dispatch, undo, redo, importBoards],
  );

  return (
    <BoardContext.Provider value={value}>{children}</BoardContext.Provider>
  );
}

/** Map raw dispatches to naming, typed convenience actions. */
function createBoardActions(
  dispatch: (action: BoardAction) => void,
): Pick<
  BoardContextValue,
  | "addColumn"
  | "renameColumn"
  | "deleteColumn"
  | "addCard"
  | "updateCard"
  | "deleteCard"
  | "toggleCardLabel"
  | "addLabel"
  | "renameLabel"
  | "setLabelColor"
  | "deleteLabel"
  | "moveCard"
  | "moveColumn"
> {
  return {
    addColumn: (title: string) => dispatch({ type: "ADD_COLUMN", title }),
    renameColumn: (columnId: string, title: string) =>
      dispatch({ type: "RENAME_COLUMN", columnId, title }),
    deleteColumn: (columnId: string) =>
      dispatch({ type: "DELETE_COLUMN", columnId }),
    addCard: (columnId: string, title: string) =>
      dispatch({ type: "ADD_CARD", columnId, title }),
    updateCard: (cardId: string, patch: CardPatch) =>
      dispatch({ type: "UPDATE_CARD", cardId, ...patch }),
    deleteCard: (cardId: string) => dispatch({ type: "DELETE_CARD", cardId }),
    toggleCardLabel: (cardId: string, labelId: string) =>
      dispatch({ type: "TOGGLE_CARD_LABEL", cardId, labelId }),
    addLabel: (label: Label) => dispatch({ type: "ADD_LABEL", label }),
    renameLabel: (labelId: string, name: string) =>
      dispatch({ type: "RENAME_LABEL", labelId, name }),
    setLabelColor: (labelId: string, color: Label["color"]) =>
      dispatch({ type: "SET_LABEL_COLOR", labelId, color }),
    deleteLabel: (labelId: string) =>
      dispatch({ type: "DELETE_LABEL", labelId }),
    moveCard: (
      cardId: string,
      fromColumnId: string,
      toColumnId: string,
      toIndex: number,
    ) => dispatch({ type: "MOVE_CARD", cardId, fromColumnId, toColumnId, toIndex }),
    moveColumn: (columnId: string, fromIndex: number, toIndex: number) =>
      dispatch({ type: "MOVE_COLUMN", columnId, fromIndex, toIndex }),
  };
}

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) {
    throw new Error("useBoard must be used within a BoardProvider");
  }
  return ctx;
}