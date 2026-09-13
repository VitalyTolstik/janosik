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
  useLocation,
  useNavigate,
  useSearchParams,
  matchPath,
} from "react-router-dom";

import {
  boardReducer,
  initialBoardState,
  type BoardAction,
  type BoardState,
  type ColumnSortBy,
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
  addCard: (
    columnId: string,
    title: string,
    labelIds?: string[],
    atIndex?: number,
  ) => void;
  updateCard: (cardId: string, patch: CardPatch, opts?: { quiet?: boolean }) => void;
  /** Stamps the card's `updatedAt` after a burst of quiet live edits. */
  touchCard: (cardId: string) => void;
  deleteCard: (cardId: string) => void;
  /** Archives a card (off the board, kept for search/restore). */
  archiveCard: (cardId: string) => void;
  /** Puts an archived card back at the end of `columnId` (first column if omitted). */
  unarchiveCard: (cardId: string, columnId?: string) => void;
  /** Archives every card of the column in one undoable step. */
  archiveColumnCards: (columnId: string) => void;
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
  /** Sets (or clears, `wipLimit === undefined`) a column's WIP limit. */
  setColumnWipLimit: (columnId: string, wipLimit?: number) => void;
  /** Sorts a column's cards (createdAt / dueDate / title). */
  sortColumn: (columnId: string, sortBy: ColumnSortBy) => void;
  /* Board management (multi-board) */
  /** Creates an empty board and returns its id (for navigation). */
  addBoard: (title: string) => string;
  /** Removes a board; the caller must navigate away from it first/after. */
  removeBoard: (boardId: string) => void;
  /** Archives a board (data kept; hidden from the normal switcher list). */
  archiveBoard: (boardId: string) => void;
  /** Brings an archived board back to the active list. */
  unarchiveBoard: (boardId: string) => void;
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

  // The URL decides which board is active; archived boards are not active
  // (the redirect above sends the user to the first active one or `/`).
  // Exception: an explicit `?card=` deep-link onto an archived board (a
  // global-search hit) is a legitimate "view this archived card" request —
  // closing the dialog drops the param and the redirect takes over again.
  const [searchParams] = useSearchParams();
  const cardParam = searchParams.get("card");
  const routeBoardId =
    matchPath(routes.boardPattern, location.pathname)?.params.boardId ?? null;
  const board = routeBoardId
    ? state.find(
        (b) =>
          b.id === routeBoardId &&
          (!b.archivedAt || (cardParam !== null && cardParam in b.cards)),
      )
    : undefined;

  // Latest committed state, readable from stable callbacks. `apply` below
  // keeps it in sync *synchronously*, so this effect is only a safety net.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Single funnel for every state transition: advance `stateRef` with the
  // pure reducer *before* handing the action to React. Two dispatches in
  // one event handler (e.g. create label + attach it) would otherwise both
  // read the same stale "before" snapshot into undo history, producing a
  // phantom no-op undo step. The reducer is pure, so the ref value always
  // matches what React commits. (TASK-33)
  const apply = useCallback((action: BoardAction) => {
    stateRef.current = boardReducer(stateRef.current, action);
    dispatchRaw(action);
  }, []);

  // Latest active board id, readable from stable callbacks.
  const activeIdRef = useRef(board?.id);
  useEffect(() => {
    activeIdRef.current = board?.id;
  }, [board?.id]);

  // Redirect `/`, unknown paths, dead board ids and archived boards to a
  // real active board (replace, so dead URLs never land in history). With
  // zero active boards, land on `/` — the empty-state screen (Trello's
  // home with "create new board"): the user is never left *on* an
  // archived board, and restoration stays one click away in the switcher.
  useEffect(() => {
    const routed = routeBoardId
      ? state.find((b) => b.id === routeBoardId)
      : undefined;
    if (routed && !routed.archivedAt) return;
    // Viewing an archived board is allowed only via an explicit ?card=
    // deep-link onto one of its cards (global search).
    if (
      routed?.archivedAt &&
      cardParam !== null &&
      cardParam in routed.cards
    )
      return;
    const firstActive = state.find((b) => !b.archivedAt);
    const target = firstActive ? routes.board(firstActive.id) : routes.home;
    if (location.pathname !== target) {
      navigate(target, { replace: true });
    }
  }, [routeBoardId, state, location.pathname, navigate, cardParam]);

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
      apply(action);
      return;
    }
    if (action.type === "ADD_BOARD") {
      apply(action);
      return;
    }
    if (action.type === "REMOVE_BOARD") {
      historiesRef.current.delete(action.boardId);
      apply(action);
      return;
    }
    if (
      action.type === "ARCHIVE_BOARD" ||
      action.type === "UNARCHIVE_BOARD"
    ) {
      // Organizational actions, not content edits — no undo entry.
      apply(action);
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
    apply(scoped);
  }, []);

  const undo = useCallback(() => {
    const boardId = activeIdRef.current;
    if (!boardId) return;
    const history = historiesRef.current.get(boardId);
    const current = stateRef.current.find((b) => b.id === boardId);
    const previous = history && current ? history.undo(current) : null;
    if (previous) {
      apply({ type: "RESTORE_BOARD", boardId, board: previous });
    }
  }, []);

  const redo = useCallback(() => {
    const boardId = activeIdRef.current;
    if (!boardId) return;
    const history = historiesRef.current.get(boardId);
    const current = stateRef.current.find((b) => b.id === boardId);
    const next = history && current ? history.redo(current) : null;
    if (next) {
      apply({ type: "RESTORE_BOARD", boardId, board: next });
    }
  }, []);

  const importBoards = useCallback((boards: BoardState) => {
    // A new data set invalidates any previous history.
    historiesRef.current.clear();
    apply({ type: "IMPORT_BOARDS", boards: normalizeBoards(boards) });
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
    apply({
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
    apply({ type: "REMOVE_BOARD", boardId });
  }, []);

  const archiveBoard = useCallback((boardId: string) => {
    apply({ type: "ARCHIVE_BOARD", boardId });
  }, []);

  const unarchiveBoard = useCallback((boardId: string) => {
    apply({ type: "UNARCHIVE_BOARD", boardId });
  }, []);

  const value = useMemo<BoardContextValue>(
    () => ({
      board,
      boards: state,
      dispatch,
      ...createBoardActions(dispatch),
      addBoard,
      removeBoard,
      archiveBoard,
      unarchiveBoard,
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
    [state, board, dispatch, addBoard, removeBoard, archiveBoard, unarchiveBoard, undo, redo, importBoards],
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
  | "touchCard"
  | "deleteCard"
  | "archiveCard"
  | "unarchiveCard"
  | "archiveColumnCards"
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
  | "setColumnWipLimit"
  | "sortColumn"
> {
  return {
    addColumn: (title: string) => dispatch({ type: "ADD_COLUMN", title }),
    renameBoard: (title: string) => dispatch({ type: "RENAME_BOARD", title }),
    renameColumn: (columnId: string, title: string) =>
      dispatch({ type: "RENAME_COLUMN", columnId, title }),
    deleteColumn: (columnId: string) =>
      dispatch({ type: "DELETE_COLUMN", columnId }),
    addCard: (columnId: string, title: string, labelIds?: string[], atIndex?: number) =>
      dispatch({ type: "ADD_CARD", columnId, title, labelIds, atIndex }),
    updateCard: (cardId: string, patch: CardPatch, opts?: { quiet?: boolean }) =>
      dispatch({ type: "UPDATE_CARD", cardId, ...patch, quiet: opts?.quiet }),
    touchCard: (cardId: string) => dispatch({ type: "TOUCH_CARD", cardId }),
    deleteCard: (cardId: string) => dispatch({ type: "DELETE_CARD", cardId }),
    archiveCard: (cardId: string) => dispatch({ type: "ARCHIVE_CARD", cardId }),
    unarchiveCard: (cardId: string, columnId?: string) =>
      dispatch({ type: "UNARCHIVE_CARD", cardId, columnId }),
    archiveColumnCards: (columnId: string) =>
      dispatch({ type: "ARCHIVE_COLUMN_CARDS", columnId }),
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
    setColumnWipLimit: (columnId: string, wipLimit?: number) =>
      dispatch({ type: "SET_COLUMN_WIP_LIMIT", columnId, wipLimit }),
    sortColumn: (columnId: string, sortBy: ColumnSortBy) =>
      dispatch({ type: "SORT_COLUMN", columnId, sortBy }),
  };
}

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) {
    throw new Error("useBoard must be used within a BoardProvider");
  }
  return ctx;
}
