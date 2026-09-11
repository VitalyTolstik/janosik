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
import { useLocation, useNavigate, matchPath } from "react-router-dom";

import {
  boardReducer,
  initialBoardState,
  type BoardAction,
  type BoardState,
} from "@/store/board-reducer";
import { BoardHistory } from "@/store/history";
import type { Board, CardCover, Label } from "@/types/kanban";
import { migrateStorageKey } from "@/utils/storage";
import { normalizeBoards } from "@/store/migrate";
import { createBackup } from "@/utils/backup";
import { createId } from "@/utils/id";
import {
  createDebouncedLocalStoragePersistence,
  type DebouncedPersistence,
} from "@/utils/persistence";
import { routes } from "@/routes";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";

/**
 * Board state provider.
 *
 * - Multi-board: the whole `Board[]` is persisted; the active board comes
 *   from the URL (`/board/:boardId` — the source of truth). Unknown or
 *   missing ids redirect to the first board.
 * - Initializes from localStorage when present (falls back to the seed board).
 * - Persists changes via a debounced adapter (400 ms) with an immediate
 *   flush on `beforeunload`/unmount, so closing the tab never loses the
 *   last change.
 * - Records a 50-step undo/redo history **per board** (consecutive title
 *   edits coalesce into one step) and exposes hotkeys Ctrl/⌘+Z,
 *   Ctrl/⌘+Shift+Z and Ctrl+Y — always scoped to the active board.
 * - Export/import operate on the full `boards` array.
 * - Auto-backups snapshots to IndexedDB after ~60 s of activity.
 */

const STORAGE_KEY = "janosik-boards";
const SAVE_DEBOUNCE_MS = 400;
const BACKUP_THROTTLE_MS = 60_000;

function loadInitialState(
  persistence: DebouncedPersistence<BoardState>,
): BoardState {
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
  /** The board selected by the URL (falls back to the first one). */
  board: Board | undefined;
  /** Every board in storage (export/import target). */
  boards: Board[];
  dispatch: (action: BoardAction) => void;
  /* Convenience actions */
  addColumn: (title: string) => void;
  renameBoard: (title: string) => void;
  renameColumn: (columnId: string, title: string) => void;
  deleteColumn: (columnId: string) => void;
  addCard: (columnId: string, title: string, labelIds?: string[]) => void;
  updateCard: (cardId: string, patch: CardPatch) => void;
  deleteCard: (cardId: string) => void;
  toggleCardLabel: (cardId: string, labelId: string) => void;
  addLabel: (label: Label) => void;
  renameLabel: (labelId: string, name: string) => void;
  setLabelColor: (labelId: string, color: Label["color"]) => void;
  deleteLabel: (labelId: string) => void;
  addChecklist: (cardId: string, title: string) => void;
  renameChecklist: (cardId: string, checklistId: string, title: string) => void;
  deleteChecklist: (cardId: string, checklistId: string) => void;
  addChecklistItem: (
    cardId: string,
    checklistId: string,
    text: string,
  ) => void;
  toggleChecklistItem: (
    cardId: string,
    checklistId: string,
    itemId: string,
  ) => void;
  renameChecklistItem: (
    cardId: string,
    checklistId: string,
    itemId: string,
    text: string,
  ) => void;
  deleteChecklistItem: (
    cardId: string,
    checklistId: string,
    itemId: string,
  ) => void;
  setCardDueDate: (cardId: string, dueDate?: number) => void;
  setCardCover: (cardId: string, cover?: CardCover) => void;
  duplicateCard: (cardId: string, title?: string) => void;
  duplicateColumn: (columnId: string, title?: string) => void;
  moveCard: (
    cardId: string,
    fromColumnId: string,
    toColumnId: string,
    toIndex: number,
  ) => void;
  moveColumn: (columnId: string, fromIndex: number, toIndex: number) => void;
  /* Board management (multi-board) */
  /** Creates an empty board and returns its id (for navigation). */
  addBoard: (title: string) => string;
  /** Removes a board; the caller must navigate away from it first/after. */
  removeBoard: (boardId: string) => void;
  /* Undo / redo (scoped to the active board) */
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
  const location = useLocation();
  const navigate = useNavigate();

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

  // One undo/redo stack per board; created lazily, dropped on remove/import.
  const historiesRef = useRef(new Map<string, BoardHistory>());

  const [state, dispatchRaw] = useReducer(boardReducer, undefined, () =>
    loadInitialState(persistence),
  );

  // The URL decides which board is active; fall back to the first board.
  const routeBoardId =
    matchPath(routes.boardPattern, location.pathname)?.params.boardId ?? null;
  const board =
    (routeBoardId ? state.find((b) => b.id === routeBoardId) : undefined) ??
    state[0];

  // Latest committed state, readable from stable callbacks.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Latest active board id, readable from stable callbacks.
  const activeIdRef = useRef(board?.id);
  useEffect(() => {
    activeIdRef.current = board?.id;
  }, [board?.id]);

  // Redirect `/`, unknown paths and dead board ids to a real board
  // (replace, so dead URLs never land in history).
  useEffect(() => {
    if (routeBoardId && state.some((b) => b.id === routeBoardId)) return;
    const first = state[0];
    if (first) navigate(routes.board(first.id), { replace: true });
  }, [routeBoardId, state, navigate]);

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

  // Wrapper dispatch: record history for the targeted board, then apply.
  // Board-scoped actions get the active board id injected when absent.
  const dispatch = useCallback((action: BoardAction) => {
    if (action.type === "IMPORT_BOARDS") {
      // A new data set invalidates every history.
      historiesRef.current.clear();
      dispatchRaw(action);
      return;
    }
    if (action.type === "ADD_BOARD") {
      dispatchRaw(action);
      return;
    }
    if (action.type === "REMOVE_BOARD") {
      historiesRef.current.delete(action.boardId);
      dispatchRaw(action);
      return;
    }
    const boardId = action.type === "RESTORE_BOARD"
      ? (action.boardId ?? activeIdRef.current)
      : ((action as { boardId?: string }).boardId ?? activeIdRef.current);
    if (!boardId) return;
    const scoped = { ...action, boardId } as BoardAction;
    if (scoped.type !== "RESTORE_BOARD") {
      const current = stateRef.current.find((b) => b.id === boardId);
      if (current) {
        let history = historiesRef.current.get(boardId);
        if (!history) {
          history = new BoardHistory();
          historiesRef.current.set(boardId, history);
        }
        history.push(current, scoped);
      }
    }
    dispatchRaw(scoped);
  }, []);

  const undo = useCallback(() => {
    const boardId = activeIdRef.current;
    if (!boardId) return;
    const history = historiesRef.current.get(boardId);
    const current = stateRef.current.find((b) => b.id === boardId);
    const previous = history && current ? history.undo(current) : null;
    if (previous) {
      dispatchRaw({ type: "RESTORE_BOARD", boardId, board: previous });
    }
  }, []);

  const redo = useCallback(() => {
    const boardId = activeIdRef.current;
    if (!boardId) return;
    const history = historiesRef.current.get(boardId);
    const current = stateRef.current.find((b) => b.id === boardId);
    const next = history && current ? history.redo(current) : null;
    if (next) {
      dispatchRaw({ type: "RESTORE_BOARD", boardId, board: next });
    }
  }, []);

  const importBoards = useCallback((boards: BoardState) => {
    // A new data set invalidates any previous history.
    historiesRef.current.clear();
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

  const addBoard = useCallback((title: string): string => {
    const id = createId();
    const now = Date.now();
    dispatchRaw({
      type: "ADD_BOARD",
      board: {
        id,
        title: title.trim() || "Untitled",
        columns: [],
        cards: {},
        labels: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }, []);

  const removeBoard = useCallback((boardId: string) => {
    historiesRef.current.delete(boardId);
    dispatchRaw({ type: "REMOVE_BOARD", boardId });
  }, []);

  const value = useMemo<BoardContextValue>(
    () => ({
      board,
      boards: state,
      dispatch,
      ...createBoardActions(dispatch),
      addBoard,
      removeBoard,
      undo,
      redo,
      canUndo: board
        ? (historiesRef.current.get(board.id)?.canUndo() ?? false)
        : false,
      canRedo: board
        ? (historiesRef.current.get(board.id)?.canRedo() ?? false)
        : false,
      importBoards,
    }),
    [state, board, dispatch, addBoard, removeBoard, undo, redo, importBoards],
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
  | "renameBoard"
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
  | "addChecklist"
  | "renameChecklist"
  | "deleteChecklist"
  | "addChecklistItem"
  | "toggleChecklistItem"
  | "renameChecklistItem"
  | "deleteChecklistItem"
  | "setCardDueDate"
  | "setCardCover"
  | "duplicateCard"
  | "duplicateColumn"
  | "moveCard"
  | "moveColumn"
> {
  return {
    addColumn: (title: string) => dispatch({ type: "ADD_COLUMN", title }),
    renameBoard: (title: string) => dispatch({ type: "RENAME_BOARD", title }),
    renameColumn: (columnId: string, title: string) =>
      dispatch({ type: "RENAME_COLUMN", columnId, title }),
    deleteColumn: (columnId: string) =>
      dispatch({ type: "DELETE_COLUMN", columnId }),
    addCard: (columnId: string, title: string, labelIds?: string[]) =>
      dispatch({ type: "ADD_CARD", columnId, title, labelIds }),
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
    addChecklist: (cardId: string, title: string) =>
      dispatch({ type: "ADD_CHECKLIST", cardId, title }),
    renameChecklist: (cardId: string, checklistId: string, title: string) =>
      dispatch({ type: "RENAME_CHECKLIST", cardId, checklistId, title }),
    deleteChecklist: (cardId: string, checklistId: string) =>
      dispatch({ type: "DELETE_CHECKLIST", cardId, checklistId }),
    addChecklistItem: (cardId: string, checklistId: string, text: string) =>
      dispatch({ type: "ADD_CHECKLIST_ITEM", cardId, checklistId, text }),
    toggleChecklistItem: (
      cardId: string,
      checklistId: string,
      itemId: string,
    ) => dispatch({ type: "TOGGLE_CHECKLIST_ITEM", cardId, checklistId, itemId }),
    renameChecklistItem: (
      cardId: string,
      checklistId: string,
      itemId: string,
      text: string,
    ) =>
      dispatch({ type: "RENAME_CHECKLIST_ITEM", cardId, checklistId, itemId, text }),
    deleteChecklistItem: (
      cardId: string,
      checklistId: string,
      itemId: string,
    ) =>
      dispatch({ type: "DELETE_CHECKLIST_ITEM", cardId, checklistId, itemId }),
    setCardDueDate: (cardId: string, dueDate?: number) =>
      dispatch({ type: "SET_CARD_DUE_DATE", cardId, dueDate }),
    setCardCover: (cardId: string, cover?: CardCover) =>
      dispatch({ type: "SET_CARD_COVER", cardId, cover }),
    duplicateCard: (cardId: string, title?: string) =>
      dispatch({ type: "DUPLICATE_CARD", cardId, title }),
    duplicateColumn: (columnId: string, title?: string) =>
      dispatch({ type: "DUPLICATE_COLUMN", columnId, title }),
    moveCard: (
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
      }),
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
