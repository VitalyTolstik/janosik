import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
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
  type UpdateCardAction,
} from "@/store/board-reducer";
import { useUndoHistory } from "@/store/use-undo-history";
import type { Board, CardCover, Label } from "@/types/kanban";
import { migrateStorageKey, quarantineValue, readRaw } from "@/utils/storage";
import { BOARD_STORAGE_KEY } from "@/utils/storage-keys";
import { normalizeBoards } from "@/store/migrate";
import { createBackup } from "@/utils/backup";
import { createId } from "@/utils/id";
import {
  createDebouncedLocalStoragePersistence,
  QUOTA_WARNING_BYTES,
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
 * - Data-safety: a failing write (quota, private mode) and unparsable
 *   stored data both raise a `dataIssue` the UI turns into a banner —
 *   losing data silently must not be possible (TASK-21.2).
 */

const STORAGE_KEY = BOARD_STORAGE_KEY;
const SAVE_DEBOUNCE_MS = 400;
const BACKUP_THROTTLE_MS = 60_000;

/**
 * A data problem the user has to know about.
 *
 * - `save-blocked` — the last write failed, so nothing is being persisted
 *   any more. Not dismissible: the banner stays until a write succeeds.
 * - `quota-warning` — a write succeeded, but the serialized data is past
 *   80% of the assumed localStorage quota. The next failed write is only a
 *   matter of time; dismissible, and it goes away on its own once the data
 *   shrinks back under the threshold (TASK-21.5).
 * - `corrupt-load` — the stored data did not parse. `sourceKey` is where
 *   the raw text can still be read from (the quarantine copy, or the
 *   original key when the copy failed and writes are held back).
 */
export type DataIssue =
  | { kind: "save-blocked" }
  | { kind: "quota-warning"; bytes: number }
  | { kind: "corrupt-load"; sourceKey: string; quarantined: boolean };

interface BootState {
  state: BoardState;
  issue: DataIssue | null;
}

function loadInitialState(
  persistence: DebouncedPersistence<BoardState>,
): BootState {
  // One-time brand migration (Vortex → Janosik) — read before the new key.
  migrateStorageKey("vortex-boards", STORAGE_KEY);
  const stored = persistence.load();
  if (stored.status === "ok" && Array.isArray(stored.value)) {
    // An empty array is a legitimate "no boards yet" — nothing to lose.
    return stored.value.length > 0
      ? { state: normalizeBoards(stored.value), issue: null }
      : { state: initialBoardState(), issue: null };
  }
  if (stored.status === "ok") {
    // Valid JSON of the wrong shape (not a board array) would be replaced
    // by the seed just as silently as unparsable text — quarantine it too.
    const raw = readRaw(STORAGE_KEY);
    return damagedData(
      persistence,
      raw === null ? null : quarantineValue(STORAGE_KEY, raw),
    );
  }
  if (stored.status === "corrupt") {
    return damagedData(persistence, stored.quarantineKey);
  }
  return { state: initialBoardState(), issue: null };
}

/**
 * Start from the seed board while keeping the damaged data reachable: it is
 * either copied aside under the quarantine key, or — when even that copy
 * failed (quota) — left in place, with writes held back so the seed cannot
 * erase it until the user has acknowledged the banner.
 */
function damagedData(
  persistence: DebouncedPersistence<BoardState>,
  quarantineKey: string | null,
): BootState {
  if (quarantineKey === null) persistence.setWritesEnabled(false);
  return {
    state: initialBoardState(),
    issue: {
      kind: "corrupt-load",
      sourceKey: quarantineKey ?? STORAGE_KEY,
      quarantined: quarantineKey !== null,
    },
  };
}

type CardPatch = Pick<UpdateCardAction, "title" | "description">;

/**
 * Everything that changes when the data changes. Read it through
 * `useBoardState()` (or `useBoard()`): consumers re-render on every edit.
 */
interface BoardStateValue {
  /** The board selected by the URL (falls back to the first one). */
  board: Board | undefined;
  /** Every board in storage (export/import target). */
  boards: Board[];
  /** Non-null while the data is at risk — rendered as a banner. */
  dataIssue: DataIssue | null;
}

/**
 * The active board's identity — a narrow slice on its own context so the
 * header's title is not re-rendered by every card edit (TASK-21.4.1).
 * `id` is undefined when the URL points at no board (the empty state).
 */
interface BoardIdentityValue {
  id: string | undefined;
  title: string;
}

/**
 * Undo availability for the active board — a narrow slice on its own
 * context so the header does not re-render with every card edit.
 */
interface BoardHistoryValue {
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Every way to change the data. The object is built once and never
 * replaced, so `useBoardActions()` consumers never re-render because of it
 * and its members are safe `useCallback`/`useMemo` dependencies.
 */
interface BoardActionsValue {
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
  updateCard: (
    cardId: string,
    patch: CardPatch,
    opts?: { quiet?: boolean },
  ) => void;
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
  addChecklistItem: (cardId: string, checklistId: string, text: string) => void;
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
  addBoard: (title: string, fallbackTitle?: string) => string;
  /** Removes a board; the caller must navigate away from it first/after. */
  removeBoard: (boardId: string) => void;
  /** Archives a board (data kept; hidden from the normal switcher list). */
  archiveBoard: (boardId: string) => void;
  /** Brings an archived board back to the active list. */
  unarchiveBoard: (boardId: string) => void;
  /* Undo / redo (scoped to the active board) */
  undo: () => void;
  redo: () => void;
  /* Import replaces the whole data set (and resets history). */
  importBoards: (boards: BoardState) => void;
  /* Data safety (TASK-21.2) */
  /** Acknowledges a `corrupt-load` notice (releases held-back writes). */
  dismissDataIssue: () => void;
}

/** The full surface, as `useBoard()` hands it out. */
type BoardContextValue = BoardStateValue &
  BoardHistoryValue &
  BoardActionsValue;

const BoardStateContext = createContext<BoardStateValue | null>(null);
const BoardIdentityContext = createContext<BoardIdentityValue | null>(null);
const BoardHistoryContext = createContext<BoardHistoryValue | null>(null);
const BoardActionsContext = createContext<BoardActionsValue | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  /* eslint-disable react-hooks/refs -- deliberate once-per-provider lazy
     init. A `useState` initializer would be the lint-clean spelling, but
     StrictMode double-invokes those in development, and booting twice means
     two debounce timers and a second quarantine copy of damaged data; a ref
     is shared across the double render, so this runs exactly once. */

  // One persistence instance per provider lifetime (the deferred creation
  // keeps the closure's debounce timer intact across re-renders).
  const persistenceRef = useRef<DebouncedPersistence<BoardState> | null>(null);
  if (persistenceRef.current === null) {
    persistenceRef.current = createDebouncedLocalStoragePersistence<BoardState>(
      STORAGE_KEY,
      SAVE_DEBOUNCE_MS,
    );
  }
  const persistence = persistenceRef.current;

  // Bootstrap runs exactly once: it both seeds the reducer and reports what
  // was wrong with the stored data (corrupt / quarantined).
  const bootRef = useRef<BootState | null>(null);
  if (bootRef.current === null) {
    bootRef.current = loadInitialState(persistence);
  }
  const boot = bootRef.current;

  const [state, dispatchRaw] = useReducer(boardReducer, boot.state);
  const [dataIssue, setDataIssue] = useState<DataIssue | null>(boot.issue);

  /* eslint-enable react-hooks/refs */

  // Once dismissed, the quota-warning stays quiet until the data actually
  // drops under the threshold — otherwise the banner re-appears on every
  // debounced write and nothing but deleting boards silences it.
  const quotaDismissedRef = useRef(false);

  // A failed write means nothing is being persisted any more: raise a
  // banner (not a toast that disappears) until a write succeeds again.
  // A successful write past the quota threshold raises the milder
  // quota-warning instead — saving still works, but the next write is
  // likely to be refused, so the user gets ahead of it (TASK-21.5). The
  // warning never masks a more severe issue, and it clears by itself once
  // the data shrinks back under the threshold.
  useEffect(() => {
    persistence.setWriteListener((ok, _error, bytes) => {
      setDataIssue((prev) => {
        if (!ok) {
          return prev?.kind === "save-blocked"
            ? prev
            : { kind: "save-blocked" };
        }
        const overQuota = bytes !== undefined && bytes > QUOTA_WARNING_BYTES;
        if (overQuota) {
          if (quotaDismissedRef.current) return prev;
          return prev === null || prev.kind === "save-blocked"
            ? { kind: "quota-warning", bytes }
            : prev;
        }
        if (bytes !== undefined) quotaDismissedRef.current = false;
        if (prev?.kind === "save-blocked" || prev?.kind === "quota-warning") {
          return null;
        }
        // A corrupt-load notice outlives successful writes — only the user
        // dismisses it.
        return prev;
      });
    });
    return () => persistence.setWriteListener(null);
  }, [persistence]);

  // Tell the user once that the damaged data was set aside (or kept in
  // place); the banner carries the actions from there on.
  const corruptNoticeShownRef = useRef(false);
  useEffect(() => {
    if (corruptNoticeShownRef.current) return;
    if (dataIssue?.kind !== "corrupt-load") return;
    corruptNoticeShownRef.current = true;
    if (dataIssue.quarantined) {
      toast.info(t("data.corruptQuarantined"));
    } else {
      toast.error(t("data.corruptKept"));
    }
  }, [dataIssue, toast, t]);

  const dismissDataIssue = useCallback(() => {
    if (dataIssue?.kind === "quota-warning") {
      quotaDismissedRef.current = true;
    }
    // Acknowledging the notice releases writes held back to protect the
    // unparsable text (a copy has been quarantined or offered by then).
    persistence.setWritesEnabled(true);
    setDataIssue((prev) =>
      prev?.kind === "corrupt-load" || prev?.kind === "quota-warning"
        ? null
        : prev,
    );
  }, [persistence, dataIssue]);

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

  // Readers the history hook calls when a command runs — refs, so they are
  // stable and always see the state the last dispatch produced.
  const getBoardById = useCallback(
    (boardId: string) => stateRef.current.find((b) => b.id === boardId),
    [],
  );
  const getActiveBoardId = useCallback(() => activeIdRef.current, []);
  const getActiveBoard = useCallback(() => {
    const boardId = activeIdRef.current;
    return boardId ? getBoardById(boardId) : undefined;
  }, [getBoardById]);

  // Undo/redo lives in its own hook (TASK-21.7d): one command stack per
  // board, the two availability flags, and the keyboard shortcuts.
  // Destructured on purpose: every function below is a stable callback,
  // while the object itself is rebuilt each render — depending on the
  // object would give `dispatch` (and with it the whole actions context) a
  // new identity on every state change and undo the render isolation of
  // TASK-21.4.
  const {
    canUndo,
    canRedo,
    undo,
    redo,
    record: recordStep,
    drop: dropHistory,
    clear: clearHistory,
    sync: syncHistory,
  } = useUndoHistory({
    getBoard: getBoardById,
    getActiveBoardId,
    apply,
  });

  const history = useMemo<BoardHistoryValue>(
    () => ({ canUndo, canRedo }),
    [canUndo, canRedo],
  );

  // Switching boards swaps in that board's stack — and its own undo state.
  useEffect(() => {
    activeIdRef.current = board?.id;
    syncHistory();
  }, [board?.id, syncHistory]);

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
    if (routed?.archivedAt && cardParam !== null && cardParam in routed.cards)
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

  // Leading + trailing throttle: the first change is snapshotted at once,
  // later ones coalesce into a single backup at the end of the window.
  // Without the trailing call, everything edited inside the last 60 s
  // before the tab closes never reaches a backup at all.
  const lastBackupRef = useRef(0);
  const pendingBackupRef = useRef<BoardState | null>(null);
  const backupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBackup = useCallback(() => {
    const snapshot = pendingBackupRef.current;
    pendingBackupRef.current = null;
    if (backupTimerRef.current !== null) {
      clearTimeout(backupTimerRef.current);
      backupTimerRef.current = null;
    }
    if (snapshot === null || snapshot.length === 0) return;
    lastBackupRef.current = Date.now();
    void createBackup(snapshot).catch(() => {
      /* IndexedDB unavailable (private mode / tests) — storage still works. */
    });
  }, []);

  useEffect(() => {
    if (state.length === 0) return;
    pendingBackupRef.current = state;
    const elapsed = Date.now() - lastBackupRef.current;
    if (elapsed >= BACKUP_THROTTLE_MS) {
      flushBackup();
    } else if (backupTimerRef.current === null) {
      backupTimerRef.current = setTimeout(
        flushBackup,
        BACKUP_THROTTLE_MS - elapsed,
      );
    }
  }, [state, flushBackup]);

  // Unmount must not drop a snapshot the throttle was still holding, so it
  // takes it now (best effort — an IndexedDB write started on unload may
  // not land; the localStorage flush below is the actual guarantee). The
  // effect above re-runs on every change, so the cleanup lives here, where
  // it cannot cancel the window it is waiting out.
  useEffect(() => () => flushBackup(), [flushBackup]);

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

  // Wrapper dispatch: apply the command, then record the undo step for the
  // board it targeted. Board-scoped actions get the active board id
  // injected when absent, and every command gets an idempotency key.
  // Board-level actions (import / add / remove / archive / unarchive) do not
  // go through here — their public methods call `apply` directly, which is
  // the single path for them.
  const dispatch = useCallback(
    (action: BoardAction) => {
      const boardId =
        (action as { boardId?: string }).boardId ?? activeIdRef.current;
      if (!boardId) return;
      const scoped = {
        ...action,
        boardId,
        commandId: (action as { commandId?: string }).commandId ?? createId(),
      } as BoardAction;
      const before = stateRef.current.find((b) => b.id === boardId);
      apply(scoped);
      // A command the reducer turned into a no-op (a guard, a limit, an
      // edit that changed nothing) is not a step: it would cost the user an
      // undo press that does nothing visible.
      const after = stateRef.current.find((b) => b.id === boardId);
      if (before !== undefined && after !== before) {
        recordStep(boardId, before, scoped);
      }
    },
    [apply, recordStep],
  );

  const importBoards = useCallback(
    (boards: BoardState) => {
      // A new data set invalidates any previous history.
      clearHistory();
      apply({ type: "IMPORT_BOARDS", boards: normalizeBoards(boards) });
    },
    [apply, clearHistory],
  );

  const addBoard = useCallback(
    (title: string, fallbackTitle = "Untitled"): string => {
      const id = createId();
      const now = Date.now();
      apply({
        type: "ADD_BOARD",
        board: {
          id,
          title: title.trim() || fallbackTitle,
          columns: [],
          cards: {},
          labels: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      return id;
    },
    [apply],
  );

  const removeBoard = useCallback(
    (boardId: string) => {
      const existed = stateRef.current.some((b) => b.id === boardId);
      apply({ type: "REMOVE_BOARD", boardId });
      // Only forget the history when the board is actually gone: the
      // reducer refuses to remove the last board, and losing its undo
      // history for a refused command would be silent data loss.
      if (existed && !stateRef.current.some((b) => b.id === boardId)) {
        dropHistory(boardId);
      }
    },
    [apply, dropHistory],
  );

  const archiveBoard = useCallback(
    (boardId: string) => {
      apply({ type: "ARCHIVE_BOARD", boardId, at: Date.now() });
    },
    [apply],
  );

  const unarchiveBoard = useCallback(
    (boardId: string) => {
      apply({ type: "UNARCHIVE_BOARD", boardId, at: Date.now() });
    },
    [apply],
  );

  // Assembled once: every member is a `useCallback` with stable
  // dependencies, so this object outlives every state change and its
  // consumers (the header, the card dialog's editors) never re-render
  // because of the store.
  const actions = useMemo<BoardActionsValue>(
    () => ({
      dispatch,
      // `dispatch` is a stable callback that reads refs when *called*; here
      // it is only stored in closures, never invoked during render.
      // eslint-disable-next-line react-hooks/refs
      ...createBoardActions(dispatch, getActiveBoard),
      addBoard,
      removeBoard,
      archiveBoard,
      unarchiveBoard,
      undo,
      redo,
      importBoards,
      dismissDataIssue,
    }),
    [
      dispatch,
      getActiveBoard,
      addBoard,
      removeBoard,
      archiveBoard,
      unarchiveBoard,
      undo,
      redo,
      importBoards,
      dismissDataIssue,
    ],
  );

  const stateValue = useMemo<BoardStateValue>(
    () => ({ board, boards: state, dataIssue }),
    [board, state, dataIssue],
  );

  const identity = useMemo<BoardIdentityValue>(
    () => ({ id: board?.id, title: board?.title ?? "" }),
    [board?.id, board?.title],
  );

  return (
    <BoardActionsContext.Provider value={actions}>
      <BoardHistoryContext.Provider value={history}>
        <BoardIdentityContext.Provider value={identity}>
          <BoardStateContext.Provider value={stateValue}>
            {children}
          </BoardStateContext.Provider>
        </BoardIdentityContext.Provider>
      </BoardHistoryContext.Provider>
    </BoardActionsContext.Provider>
  );
}

/**
 * Map raw dispatches to naming, typed convenience actions.
 *
 * This is where a command becomes deterministic (TASK-21.7a): the caller
 * mints the ids of everything the command creates, reads the clock once and
 * resolves relative intent ("toggle this label") into the absolute value the
 * reducer applies. `getBoard` reads the *current* active board at call time
 * (the provider keeps it in a ref), so two dispatches in one event handler
 * still each see the state the previous one produced.
 */
function createBoardActions(
  dispatch: (action: BoardAction) => void,
  getBoard: () => Board | undefined,
): Pick<
  BoardActionsValue,
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
  /** `n` fresh ids, for the activity events (or copies) a command produces. */
  const ids = (n: number): string[] =>
    Array.from({ length: n }, () => createId());

  return {
    addColumn: (title: string) =>
      dispatch({
        type: "ADD_COLUMN",
        newColumnId: createId(),
        title,
        at: Date.now(),
      }),
    renameBoard: (title: string) =>
      dispatch({ type: "RENAME_BOARD", title, at: Date.now() }),
    renameColumn: (columnId: string, title: string) =>
      dispatch({ type: "RENAME_COLUMN", columnId, title, at: Date.now() }),
    deleteColumn: (columnId: string) =>
      dispatch({ type: "DELETE_COLUMN", columnId, at: Date.now() }),
    addCard: (
      columnId: string,
      title: string,
      labelIds?: string[],
      atIndex?: number,
    ) =>
      dispatch({
        type: "ADD_CARD",
        newCardId: createId(),
        columnId,
        title,
        labelIds,
        atIndex,
        activityIds: ids(1),
        at: Date.now(),
      }),
    updateCard: (
      cardId: string,
      patch: CardPatch,
      opts?: { quiet?: boolean },
    ) =>
      dispatch({
        type: "UPDATE_CARD",
        cardId,
        ...patch,
        quiet: opts?.quiet,
        // Two slots: a title change and a description change can both land.
        activityIds: ids(2),
        at: Date.now(),
      }),
    touchCard: (cardId: string) =>
      dispatch({ type: "TOUCH_CARD", cardId, at: Date.now() }),
    deleteCard: (cardId: string) =>
      dispatch({ type: "DELETE_CARD", cardId, at: Date.now() }),
    archiveCard: (cardId: string) =>
      dispatch({
        type: "ARCHIVE_CARD",
        cardId,
        activityIds: ids(1),
        at: Date.now(),
      }),
    unarchiveCard: (cardId: string, columnId?: string) =>
      dispatch({
        type: "UNARCHIVE_CARD",
        cardId,
        columnId,
        activityIds: ids(1),
        at: Date.now(),
      }),
    archiveColumnCards: (columnId: string) => {
      const column = getBoard()?.columns.find((c) => c.id === columnId);
      dispatch({
        type: "ARCHIVE_COLUMN_CARDS",
        columnId,
        // One "archived" event per card in the column.
        activityIds: ids(column?.cardIds.length ?? 0),
        at: Date.now(),
      });
    },
    toggleCardLabel: (cardId: string, labelId: string) => {
      const card = getBoard()?.cards[cardId];
      if (!card) return;
      dispatch({
        type: "SET_CARD_LABEL",
        cardId,
        labelId,
        // Relative intent resolved here; the command carries the result.
        on: !card.labelIds.includes(labelId),
        activityIds: ids(1),
        at: Date.now(),
      });
    },
    addLabel: (label: Label) =>
      dispatch({ type: "ADD_LABEL", label, at: Date.now() }),
    renameLabel: (labelId: string, name: string) =>
      dispatch({ type: "RENAME_LABEL", labelId, name, at: Date.now() }),
    setLabelColor: (labelId: string, color: Label["color"]) =>
      dispatch({ type: "SET_LABEL_COLOR", labelId, color, at: Date.now() }),
    deleteLabel: (labelId: string) =>
      dispatch({ type: "DELETE_LABEL", labelId, at: Date.now() }),
    addChecklist: (cardId: string, title: string) =>
      dispatch({
        type: "ADD_CHECKLIST",
        cardId,
        newChecklistId: createId(),
        title,
        at: Date.now(),
      }),
    renameChecklist: (cardId: string, checklistId: string, title: string) =>
      dispatch({
        type: "RENAME_CHECKLIST",
        cardId,
        checklistId,
        title,
        at: Date.now(),
      }),
    deleteChecklist: (cardId: string, checklistId: string) =>
      dispatch({
        type: "DELETE_CHECKLIST",
        cardId,
        checklistId,
        at: Date.now(),
      }),
    addChecklistItem: (cardId: string, checklistId: string, text: string) =>
      dispatch({
        type: "ADD_CHECKLIST_ITEM",
        cardId,
        checklistId,
        newItemId: createId(),
        text,
        at: Date.now(),
      }),
    toggleChecklistItem: (
      cardId: string,
      checklistId: string,
      itemId: string,
    ) => {
      const item = getBoard()
        ?.cards[cardId]?.checklists?.find((c) => c.id === checklistId)
        ?.items.find((i) => i.id === itemId);
      if (!item) return;
      dispatch({
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId,
        checklistId,
        itemId,
        done: !item.done,
        at: Date.now(),
      });
    },
    renameChecklistItem: (
      cardId: string,
      checklistId: string,
      itemId: string,
      text: string,
    ) =>
      dispatch({
        type: "RENAME_CHECKLIST_ITEM",
        cardId,
        checklistId,
        itemId,
        text,
        at: Date.now(),
      }),
    deleteChecklistItem: (
      cardId: string,
      checklistId: string,
      itemId: string,
    ) =>
      dispatch({
        type: "DELETE_CHECKLIST_ITEM",
        cardId,
        checklistId,
        itemId,
        at: Date.now(),
      }),
    setCardDueDate: (cardId: string, dueDate?: number) =>
      dispatch({
        type: "SET_CARD_DUE_DATE",
        cardId,
        dueDate,
        activityIds: ids(1),
        at: Date.now(),
      }),
    setCardCover: (cardId: string, cover?: CardCover) =>
      dispatch({ type: "SET_CARD_COVER", cardId, cover, at: Date.now() }),
    duplicateCard: (cardId: string, title?: string) =>
      dispatch({
        type: "DUPLICATE_CARD",
        cardId,
        newCardId: createId(),
        title,
        activityIds: ids(1),
        at: Date.now(),
      }),
    duplicateColumn: (columnId: string, title?: string) => {
      const column = getBoard()?.columns.find((c) => c.id === columnId);
      const count = column?.cardIds.length ?? 0;
      dispatch({
        type: "DUPLICATE_COLUMN",
        columnId,
        newColumnId: createId(),
        // One id per source card, positionally matched by the reducer.
        newCardIds: ids(count),
        title,
        activityIds: ids(count),
        at: Date.now(),
      });
    },
    moveCard: (
      cardId: string,
      fromColumnId: string,
      toColumnId: string,
      toIndex: number,
    ) => {
      const from = getBoard()?.columns.find((c) => c.id === fromColumnId);
      dispatch({
        type: "MOVE_CARD",
        cardId,
        fromColumnId,
        // Recorded so the inverse move needs nothing but the command.
        fromIndex: Math.max(0, from?.cardIds.indexOf(cardId) ?? 0),
        toColumnId,
        toIndex,
        activityIds: ids(1),
        at: Date.now(),
      });
    },
    moveColumn: (columnId: string, fromIndex: number, toIndex: number) =>
      dispatch({
        type: "MOVE_COLUMN",
        columnId,
        fromIndex,
        toIndex,
        at: Date.now(),
      }),
    setColumnWipLimit: (columnId: string, wipLimit?: number) =>
      dispatch({
        type: "SET_COLUMN_WIP_LIMIT",
        columnId,
        wipLimit,
        at: Date.now(),
      }),
    sortColumn: (columnId: string, sortBy: ColumnSortBy) =>
      dispatch({ type: "SORT_COLUMN", columnId, sortBy, at: Date.now() }),
  };
}

function required<T>(value: T | null, hook: string): T {
  if (value === null) {
    throw new Error(`${hook} must be used within a BoardProvider`);
  }
  return value;
}

/** The board data. Re-renders the consumer on every edit, anywhere. */
export function useBoardState(): BoardStateValue {
  return required(useContext(BoardStateContext), "useBoardState");
}

/**
 * The active board's id and title. Changes only when one of them does, so
 * the header's title sits out every card edit — reach for it instead of
 * `useBoardState()` whenever the board's name is all a component needs.
 */
export function useBoardIdentity(): BoardIdentityValue {
  return required(useContext(BoardIdentityContext), "useBoardIdentity");
}

/** Undo availability for the active board — changes only when it flips. */
export function useBoardHistory(): BoardHistoryValue {
  return required(useContext(BoardHistoryContext), "useBoardHistory");
}

/**
 * The actions. Never changes, so a component that only writes (the header,
 * pickers, composers) is not re-rendered by other people's edits — prefer
 * it over `useBoard()` whenever the board data itself is not rendered.
 */
export function useBoardActions(): BoardActionsValue {
  return required(useContext(BoardActionsContext), "useBoardActions");
}

/**
 * Data + actions + undo availability in one object, for components that
 * render the board anyway. It subscribes to all three contexts; reach for
 * `useBoardActions()` / `useBoardHistory()` when only those are needed.
 */
export function useBoard(): BoardContextValue {
  return {
    ...useBoardState(),
    ...useBoardHistory(),
    ...useBoardActions(),
  };
}
