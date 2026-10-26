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
  type BoardAction,
  type BoardState,
  type ColumnSortBy,
  type UpdateCardAction,
} from "@janosik/shared";
import { api, isApiEnabled } from "@/api/client";
import {
  BoardLiveProvider,
  cardIdsTouchedBy,
  createBoardLive,
  type BoardLive,
} from "@/store/board-live";
import type { RealtimeBridge } from "@/store/realtime";
import { useAuth } from "@/auth/AuthContext";
import { useUndoHistory } from "@/store/use-undo-history";
import { SAVE_DEBOUNCE_MS } from "@/store/constants";
import {
  clearLegacyBoards,
  loadInitialState,
  readLegacyBoards,
  STORAGE_KEY,
  toEnvelope,
  type BootState,
  type DataIssue,
} from "@/store/board-persistence";
import type {
  Board,
  BoardMemberDto,
  BoardRole,
  CardCover,
  CardLinkType,
  CardPriority,
  Label,
  MembershipChange,
} from "@janosik/shared";
import { normalizeBoards } from "@janosik/shared";
import { changedEntityIds } from "@/store/board-diff";
import {
  ServerSync,
  textEntityKey,
  type SendFailure,
  type SendOutcome,
} from "@/store/server-sync";
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
 * - **Server mode (TASK-29):** with a backend configured every board is
 *   hydrated from `GET /boards`, every command travels through
 *   `POST /boards/:id/commands` (optimistic apply first, rollback + toast
 *   when the server refuses), undo/redo send their inverse commands, and
 *   window focus refetches the active aggregate. Board create/delete/import
 *   are aggregate REST calls. The local schema and components stay exactly
 *   as they were — the server speaks the same model.
 */

const BACKUP_THROTTLE_MS = 60_000;

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
  /**
   * Server-mode load status: `loading` while the boards are being fetched
   * (the shell shows a splash), `error` when they could not be fetched at
   * all (offline boot, server down) — always `ready` in local mode.
   */
  syncStatus: "loading" | "ready" | "error";
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
  /**
   * The caller's role on a board, when the server said so — `ADMIN` for
   * every board in local mode. Drives the ADMIN-only switcher actions
   * (archive/delete), which the server would refuse anyway (TASK-29).
   */
  roleOf: (boardId: string) => BoardRole | undefined;
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
  setCardPriority: (cardId: string, priority: CardPriority) => void;
  setCardAssign: (cardId: string, assigneeId: string | null) => void;
  /** Links `cardId` to `targetCardId` (TASK-46); the row lands on `cardId`. */
  addCardLink: (
    cardId: string,
    targetCardId: string,
    linkType: CardLinkType,
  ) => void;
  /** Removes one link row; the payload rides along for the inverse. */
  removeCardLink: (
    cardId: string,
    linkId: string,
    targetCardId: string,
    linkType: CardLinkType,
  ) => void;
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
  /**
   * Creates an empty board and resolves with its id (for navigation), or
   * `null` when the server refused the create (a toast was shown). Local
   * mode resolves synchronously — `await` works for both.
   */
  addBoard: (
    title: string,
    fallbackTitle?: string,
  ) => string | Promise<string | null>;
  /** Removes a board; the caller must navigate away from it first/after. */
  removeBoard: (boardId: string) => void | Promise<void>;
  /** Archives a board (data kept; hidden from the normal switcher list). */
  archiveBoard: (boardId: string) => void;
  /** Brings an archived board back to the active list. */
  unarchiveBoard: (boardId: string) => void;
  /* Undo / redo (scoped to the active board) */
  undo: () => void;
  redo: () => void;
  /* Import replaces the whole data set (and resets history). */
  importBoards: (boards: BoardState) => void | Promise<void>;
  /**
   * Re-runs server hydration (`GET /boards` + aggregates) — used after
   * accepting an invitation so the fresh board shows up without a reload.
   * No-op in local mode.
   */
  refreshBoards: () => Promise<void>;
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
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Server mode is a build property, not a prop: dev/production builds talk
  // to the API, unit tests stay local unless they stub `VITE_API_URL`.
  const serverMode = isApiEnabled();

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
  // was wrong with the stored data (corrupt / quarantined). In server mode
  // the boards arrive from the API instead — the local key is only migration
  // input, read after the first login (never a board source of truth).
  const bootRef = useRef<BootState | null>(null);
  if (bootRef.current === null) {
    bootRef.current = serverMode
      ? { state: [], issue: null }
      : loadInitialState(persistence);
  }
  const boot = bootRef.current;

  const [state, dispatchRaw] = useReducer(boardReducer, boot.state);
  const [dataIssue, setDataIssue] = useState<DataIssue | null>(boot.issue);
  const [syncStatus, setSyncStatus] = useState<BoardStateValue["syncStatus"]>(
    serverMode ? "loading" : "ready",
  );
  const [roles, setRoles] = useState<Record<string, BoardRole>>({});

  /* eslint-enable react-hooks/refs */

  // Per-board entity versions seen in command responses — the basis for the
  // undo preconditions that stop a stale undo from clobbering foreign text.
  const versionsRef = useRef(new Map<string, Record<string, number>>());

  // TASK-30 realtime bookkeeping. `seqsRef` is the command seq the local
  // state reflects per board; the bridge in the lazy realtime chunk owns
  // everything else (dedupe, deferred events, reconnects) and reads the
  // current user id through `userIdRef` for the own-echo filter.
  const seqsRef = useRef(new Map<string, number>());
  const userIdRef = useRef(user?.id);
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  // TASK-36 live collaboration state (presence roster, attribution, member
  // directory). Separate external stores so an avatar or a highlight ring
  // re-renders exactly the components that show it, never the board. A
  // `useState` initializer (not a ref): the stores are pure containers with
  // no timers until something is stamped, so a StrictMode double-init costs
  // one discarded object and keeps the value out of ref-during-render rules.
  const [live] = useState<BoardLive>(() => createBoardLive());

  // Created from the lazily imported chunk — the module stays off the
  // critical path, only its (erased) type is visible here.
  const realtimeRef = useRef<RealtimeBridge | null>(null);

  // One outgoing queue for the account; disposed with the provider (logout
  // unmounts it, so no command survives the session).
  /* eslint-disable react-hooks/refs -- deliberate once-per-provider lazy init
     (same reason as the persistence/boot refs above): a `useState`
     initializer would build a second queue under StrictMode. */
  const syncRef = useRef<ServerSync | null>(null);
  if (syncRef.current === null) {
    syncRef.current = new ServerSync({
      send: (boardId, request) => api.sendCommand(boardId, request),
    });
  }
  const sync = syncRef.current;
  /* eslint-enable react-hooks/refs */

  // Stops async hydration/refetch from applying after unmount (logout).
  // StrictMode runs setup → cleanup → setup on mount: `aliveRef` must be
  // re-armed and the queue revived, or the second mount would stay stuck on
  // "loading" and every command would answer as offline.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    sync.revive();
    return () => {
      aliveRef.current = false;
      sync.dispose();
      realtimeRef.current?.dispose();
      live.dispose();
    };
  }, [sync, live]);

  const mergeVersions = useCallback(
    (boardId: string, versions: Record<string, number>) => {
      if (Object.keys(versions).length === 0) return;
      const current = versionsRef.current.get(boardId) ?? {};
      Object.assign(current, versions);
      versionsRef.current.set(boardId, current);
    },
    [],
  );

  /** Toast for a command the server refused or the network dropped. */
  const showFailure = useCallback(
    (failure: SendFailure) => {
      switch (failure.kind) {
        case "offline":
          toast.error(t("sync.offline"));
          break;
        case "wip":
          toast.error(t("toast.wipLimitBlocked"));
          break;
        case "version":
          toast.error(t("sync.foreignEdit"));
          break;
        default:
          toast.error(t("sync.rejected"));
      }
    },
    [toast, t],
  );

  const onForeignSkipped = useCallback(
    () => toast.info(t("sync.foreignEdit")),
    [toast, t],
  );

  /**
   * Version preconditions for an undo/redo command: only text edits carry
   * them (§7.0). Unknown versions are simply omitted — a fresh session that
   * has not seen the entity since login plays last-write-wins.
   */
  const preconditionsFor = useCallback(
    (
      boardId: string,
      action: BoardAction,
    ): Record<string, number> | undefined => {
      const key = textEntityKey(boardId, action);
      if (key === null) return undefined;
      const version = versionsRef.current.get(boardId)?.[key];
      return version === undefined ? undefined : { [key]: version };
    },
    [],
  );

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
    // Stamp the author (TASK-36): local dispatches carry the current user,
    // foreign realtime commands arrive with the server's actor already
    // attached. The feed shows it; the attribution overlay reads it.
    const stamped =
      (action as { actorId?: string | null }).actorId === undefined
        ? ({ ...action, actorId: userIdRef.current ?? null } as BoardAction)
        : action;
    stateRef.current = boardReducer(stateRef.current, stamped);
    dispatchRaw(stamped);
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

  /**
   * Undo/redo transport (TASK-29): the inverse command rides the same queue
   * as ordinary commands, with version preconditions for text so a stale
   * undo is refused instead of overwriting someone else's edit. Responses
   * feed the version map for the next precondition.
   */
  const sendUndoRedo = useCallback(
    async (boardId: string, action: BoardAction): Promise<SendOutcome> => {
      const outcome = await sync.enqueue(
        boardId,
        action,
        preconditionsFor(boardId, action),
      );
      if (outcome.ok) {
        mergeVersions(boardId, outcome.versions);
        // Same post-commit signal as dispatch: undo/redo writes history rows.
        live.commits.publish(boardId, cardIdsTouchedBy(action));
        realtimeRef.current?.settled(boardId, outcome.seq);
      } else {
        realtimeRef.current?.settled(boardId);
      }
      return outcome;
    },
    [sync, preconditionsFor, mergeVersions, live],
  );

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
    rollback: rollbackStep,
    markForeign,
  } = useUndoHistory({
    getBoard: getBoardById,
    getActiveBoardId,
    apply,
    ...(serverMode
      ? {
          send: sendUndoRedo,
          onSendFailed: showFailure,
          onForeignSkipped,
        }
      : {}),
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
    // A cold boot still has an empty `state` while the boards are on their
    // way: redirecting then would drop a `?card=` deep link (the URL is
    // replaced before the board it points at has loaded).
    if (syncStatus !== "ready") return;
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
  }, [routeBoardId, state, location.pathname, navigate, cardParam, syncStatus]);

  // Debounced persistence + throttled auto-backup after every change. Both
  // are local-mode only: with a server the boards live in the database, and
  // mirroring them into localStorage would leak one account's data into the
  // next session on the same browser (TASK-29).
  useEffect(() => {
    if (serverMode) return;
    persistence.queueSave(state);
  }, [persistence, state, serverMode]);

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
    if (serverMode || state.length === 0) return;
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
  }, [state, flushBackup, serverMode]);

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

  /**
   * Server hydration (TASK-29): list the boards, then load every aggregate
   * into the local model (≤ LIMITS.boardsCount boards — the multi-board UI,
   * global search and export keep working on the same shape). An account
   * with zero boards inherits the pre-server localStorage data through
   * `POST /boards/import` once, archived cards included; the local key is
   * dropped afterwards so the same data cannot be imported twice.
   */
  const runHydration = useCallback(async (): Promise<void> => {
    const summaries = await api.listBoards();
    const nextRoles: Record<string, BoardRole> = {};
    for (const summary of summaries) nextRoles[summary.id] = summary.role;

    let boards: Board[] = [];
    const nextSeqs = new Map<string, number>();
    if (summaries.length === 0) {
      const legacy = readLegacyBoards();
      if (legacy !== null) {
        const imported = await api.importBoards(toEnvelope(legacy));
        clearLegacyBoards();
        for (const board of imported) {
          nextRoles[board.id] = "ADMIN";
          // Importing writes aggregate-level, not through the command log:
          // there is no seq to resume from.
          nextSeqs.set(board.id, 0);
        }
        boards = imported;
      }
    } else {
      const snapshots = await Promise.all(
        summaries.map((summary) => api.getBoardSnapshot(summary.id)),
      );
      boards = snapshots.map((snapshot) => snapshot.board);
      for (const snapshot of snapshots) {
        nextSeqs.set(snapshot.board.id, snapshot.seq);
      }
    }

    if (!aliveRef.current) return;
    for (const board of boards) live.attribution.seed(board);
    setRoles(nextRoles);
    // The hydrated state is exactly what the aggregates showed: replacing
    // the seq map keeps the realtime resume point in sync with it.
    seqsRef.current = nextSeqs;
    // A fresh hydration replaces everything: history from a previous data
    // set would describe entities that no longer exist.
    clearHistory();
    apply({ type: "IMPORT_BOARDS", boards });
  }, [apply, clearHistory, live]);

  /**
   * The member directory powers names and avatars for attribution (TASK-36):
   * who last changed a card may not be online right now, so the roster alone
   * is not enough. Loaded per active board on mount and again whenever a
   * membership event arrives, best-effort.
   */
  const loadMembers = useCallback(
    (boardId: string): Promise<void> =>
      api
        .listMembers(boardId)
        .then((members) => {
          if (aliveRef.current) live.members.set(boardId, members);
        })
        .catch(() => undefined),
    [live],
  );

  useEffect(() => {
    if (!serverMode || board?.id === undefined) return;
    void loadMembers(board.id);
  }, [serverMode, board?.id, loadMembers]);

  // StrictMode mounts the provider twice (setup → cleanup → setup); sharing
  // the in-flight hydration keeps the one-shot legacy import from running —
  // and importing the same localStorage data — twice.
  const hydrationRef = useRef<Promise<void> | null>(null);
  const hydrateBoards = useCallback((): Promise<void> => {
    if (hydrationRef.current === null) {
      hydrationRef.current = runHydration().finally(() => {
        hydrationRef.current = null;
      });
    }
    return hydrationRef.current;
  }, [runHydration]);

  useEffect(() => {
    if (!serverMode) return;
    let cancelled = false;
    // The initial state is already "loading" in server mode; the effect only
    // reports how hydration ended.
    void hydrateBoards()
      .then(() => {
        if (!cancelled && aliveRef.current) setSyncStatus("ready");
      })
      .catch(() => {
        if (!cancelled && aliveRef.current) setSyncStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [serverMode, hydrateBoards]);

  /**
   * Focus refetch (TASK-29 fallback; the SSE stream is the live path in
   * TASK-30): coming back to the tab pulls the active aggregate — unless
   * commands are in flight, whose optimistic state must not be overwritten.
   * Entities the server has moved on from are marked foreign in the history
   * first, so undo skips them with a toast instead of clobbering another
   * member's edit (§7.0). The snapshot's seq refreshes the stream baseline.
   */
  const refetchActiveBoard = useCallback(async (): Promise<void> => {
    const boardId = activeIdRef.current;
    if (!serverMode || boardId === undefined) return;
    if (sync.isBusy(boardId)) return;
    try {
      const { board: fresh, seq } = await api.getBoardSnapshot(boardId);
      if (!aliveRef.current || activeIdRef.current !== boardId) return;
      const local = stateRef.current.find((b) => b.id === boardId);
      if (local === undefined) return;
      const foreignIds = changedEntityIds(local, fresh);
      if (foreignIds.length > 0) markForeign(boardId, foreignIds);
      seqsRef.current.set(
        boardId,
        Math.max(seqsRef.current.get(boardId) ?? 0, seq),
      );
      live.attribution.seed(fresh);
      apply({ type: "RESTORE_BOARD", boardId, board: fresh });
    } catch {
      /* offline / server down — the next focus tries again */
    }
  }, [serverMode, sync, markForeign, apply, live]);

  /**
   * The account's membership was revoked (TASK-36): the server sent the
   * `membership` frame on our stream, or the stream itself answered 403 on
   * reconnect. Forget the board right away — its roster, role and resume
   * point go with it — and let the routing effect move the user to another
   * board or the empty state. The reducer keeps the last board by design,
   * so a revoked *only* board is replaced explicitly.
   */
  const revokeBoard = useCallback(
    (boardId: string) => {
      apply({ type: "REMOVE_BOARD", boardId });
      if (stateRef.current.some((board) => board.id === boardId)) {
        apply({
          type: "IMPORT_BOARDS",
          boards: stateRef.current.filter((board) => board.id !== boardId),
        });
      }
      dropHistory(boardId);
      seqsRef.current.delete(boardId);
      setRoles((prev) => {
        if (!(boardId in prev)) return prev;
        const { [boardId]: _removed, ...rest } = prev;
        return rest;
      });
      toast.error(t("board.accessRevoked"));
    },
    [apply, dropHistory, toast, t],
  );

  /**
   * One membership change on the active board (TASK-36): a removed *caller*
   * drops the board; every other change — someone accepted an invitation,
   * a role or an expiry moved, someone else left — rewrites the member
   * directory, so open member lists and attribution names update live.
   */
  const onMembershipChange = useCallback(
    (boardId: string, userId: string, change: MembershipChange) => {
      if (change === "removed" && userId === userIdRef.current) {
        revokeBoard(boardId);
        return;
      }
      void loadMembers(boardId);
    },
    [revokeBoard, loadMembers],
  );

  const onAccessRevoked = useCallback(
    (boardId: string) => revokeBoard(boardId),
    [revokeBoard],
  );

  useEffect(() => {
    if (!serverMode) return;
    const onFocus = () => void refetchActiveBoard();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refetchActiveBoard();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [serverMode, refetchActiveBoard]);

  // The realtime connection (TASK-30) lives in a lazily imported chunk: it
  // is needed only once a board is on screen, and its reconnect/dedupe logic
  // must stay off the critical path. The bridge reads boards, history and
  // the command queue through the callbacks below.
  useEffect(() => {
    if (!serverMode) return;
    const boardId = board?.id;
    if (boardId === undefined) {
      realtimeRef.current?.stop();
      return;
    }
    let cancelled = false;
    void import("@/store/realtime").then(({ createRealtimeBridge }) => {
      if (cancelled || !aliveRef.current) return;
      realtimeRef.current ??= createRealtimeBridge({
        getActiveBoardId: () => activeIdRef.current,
        getBaseline: (id) => seqsRef.current.get(id) ?? 0,
        setBaseline: (id, seq) =>
          seqsRef.current.set(id, Math.max(seqsRef.current.get(id) ?? 0, seq)),
        apply,
        markForeign,
        setPresence: (id, users) => live.presence.set(id, users),
        flagForeign: (id, actorId, ids) => {
          // Only someone else's change earns the ring; another tab of mine
          // is the same author and the card face stays anonymous.
          if (actorId !== userIdRef.current) {
            live.attribution.stamp(id, actorId, ids, { highlight: true });
          }
        },
        isBusy: (id) => sync.isBusy(id),
        getUserId: () => userIdRef.current,
        onMembershipChange,
        onAccessRevoked,
        onActivity: (event) => {
          live.activity.publish(event);
          // A comment is a change of the card face as well: the commenter
          // becomes the card's last actor (the server records the same
          // thing in `Card.lastActorId`, so a reload seeds the identical
          // value). Someone else's comment earns the 2 s ring, exactly
          // like a foreign command; my own stays anonymous to me.
          if (event.kind === "comment_added" && event.cardId !== undefined) {
            live.attribution.stamp(
              event.boardId,
              event.actorId,
              [event.cardId],
              {
                at: event.at,
                highlight: event.actorId !== userIdRef.current,
              },
            );
          }
        },
      });
      realtimeRef.current.watch(boardId);
    });
    return () => {
      cancelled = true;
    };
    // The handlers are stable and read refs on purpose (same as `apply`
    // above): they run from the stream, never during render.
    // eslint-disable-next-line react-hooks/refs
  }, [
    serverMode,
    board?.id,
    apply,
    markForeign,
    sync,
    live,
    onMembershipChange,
    onAccessRevoked,
  ]);

  // Wrapper dispatch: apply the command, then record the undo step for the
  // board it targeted. Board-scoped actions get the active board id
  // injected when absent, and every command gets an idempotency key.
  // Board-level actions: create/delete/import are aggregate REST calls
  // (their public methods below) — rename/archive/unarchive are commands and
  // travel through here like any other. In server mode the command reaches
  // the API afterwards; a refusal rolls the optimistic state back and shows
  // a toast (TASK-29).
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
      const touchedIds = cardIdsTouchedBy(scoped);
      const author = userIdRef.current;
      if (author !== undefined && touchedIds.length > 0) {
        live.attribution.stamp(boardId, author, touchedIds, {
          at: (scoped as { at?: number }).at,
        });
      }
      // A command the reducer turned into a no-op (a guard, a limit, an
      // edit that changed nothing) is not a step: it would cost the user an
      // undo press that does nothing visible.
      const after = stateRef.current.find((b) => b.id === boardId);
      if (before !== undefined && after !== before) {
        recordStep(boardId, before, scoped);
      }
      if (!serverMode) return;
      void sync.enqueue(boardId, scoped).then((outcome) => {
        if (outcome.ok) {
          mergeVersions(boardId, outcome.versions);
          // The command is on the server now — the open card's history can
          // refetch without the one-behind the optimistic bump has.
          live.commits.publish(boardId, touchedIds);
          realtimeRef.current?.settled(boardId, outcome.seq);
          return;
        }
        realtimeRef.current?.settled(boardId);
        showFailure(outcome.failure);
        if (before === undefined) return;
        const rollback = rollbackStep(boardId, scoped);
        if (rollback.kind === "reverted") {
          apply(rollback.undo);
        } else if (rollback.kind === "none") {
          // Nothing was recorded (board-level command) — restore the exact
          // pre-command snapshot instead.
          apply({ type: "RESTORE_BOARD", boardId, board: before });
        }
        // "dead": newer commands sit on top; the optimistic state stays and
        // reconciles with the next focus refetch.
      });
    },
    [
      apply,
      recordStep,
      serverMode,
      sync,
      mergeVersions,
      showFailure,
      rollbackStep,
      live,
    ],
  );

  const importBoards = useCallback(
    (boards: BoardState): void | Promise<void> => {
      if (serverMode) {
        // The server keeps the existing boards and adds the imported ones;
        // re-hydrating shows the whole set (import resets history, exactly
        // as it always did locally). Nothing local changed yet, so a failure
        // needs no rollback — it is a toast.
        return api
          .importBoards(toEnvelope(normalizeBoards(boards)))
          .then(() => hydrateBoards())
          .catch(() => {
            toast.error(t("data.importError"));
          });
      }
      // A new data set invalidates any previous history.
      clearHistory();
      apply({ type: "IMPORT_BOARDS", boards: normalizeBoards(boards) });
    },
    [apply, clearHistory, serverMode, hydrateBoards, toast, t],
  );

  const addBoard = useCallback(
    (
      title: string,
      fallbackTitle = "Untitled",
    ): string | Promise<string | null> => {
      const resolved = title.trim() || fallbackTitle;
      if (serverMode) {
        return api
          .createBoard(resolved)
          .then((created) => {
            if (!aliveRef.current) return null;
            apply({ type: "ADD_BOARD", board: created });
            setRoles((prev) => ({ ...prev, [created.id]: "ADMIN" }));
            return created.id;
          })
          .catch(() => {
            toast.error(t("sync.rejected"));
            return null;
          });
      }
      const id = createId();
      const now = Date.now();
      apply({
        type: "ADD_BOARD",
        board: {
          id,
          title: resolved,
          columns: [],
          cards: {},
          labels: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      return id;
    },
    [apply, serverMode, toast, t],
  );

  const removeBoard = useCallback(
    (boardId: string): void | Promise<void> => {
      if (serverMode) {
        return api
          .deleteBoard(boardId)
          .then(() => {
            if (!aliveRef.current) return;
            apply({ type: "REMOVE_BOARD", boardId });
            dropHistory(boardId);
            setRoles((prev) => {
              const { [boardId]: _removed, ...rest } = prev;
              return rest;
            });
          })
          .catch(() => {
            toast.error(t("sync.rejected"));
          });
      }
      const existed = stateRef.current.some((b) => b.id === boardId);
      apply({ type: "REMOVE_BOARD", boardId });
      // Only forget the history when the board is actually gone: the
      // reducer refuses to remove the last board, and losing its undo
      // history for a refused command would be silent data loss.
      if (existed && !stateRef.current.some((b) => b.id === boardId)) {
        dropHistory(boardId);
      }
    },
    [apply, dropHistory, serverMode, toast, t],
  );

  const archiveBoard = useCallback(
    (boardId: string) => {
      // Server mode: a board-level command (ADMIN-only, checked server-side);
      // the generic failure path restores the snapshot when it is refused.
      if (serverMode) {
        dispatch({ type: "ARCHIVE_BOARD", boardId, at: Date.now() });
        return;
      }
      apply({ type: "ARCHIVE_BOARD", boardId, at: Date.now() });
    },
    [apply, dispatch, serverMode],
  );

  const unarchiveBoard = useCallback(
    (boardId: string) => {
      if (serverMode) {
        dispatch({ type: "UNARCHIVE_BOARD", boardId, at: Date.now() });
        return;
      }
      apply({ type: "UNARCHIVE_BOARD", boardId, at: Date.now() });
    },
    [apply, dispatch, serverMode],
  );

  /** The caller's role: from `GET /boards` in server mode, ADMIN locally. */
  const roleOf = useCallback(
    (boardId: string): BoardRole | undefined =>
      serverMode ? roles[boardId] : "ADMIN",
    [serverMode, roles],
  );

  // Assembled once: every member is a `useCallback` with stable
  // dependencies, so this object outlives every state change and its
  // consumers (the header, the card dialog's editors) never re-render
  // because of the store.
  const actions = useMemo<BoardActionsValue>(
    () => ({
      dispatch,
      roleOf,
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
      refreshBoards: hydrateBoards,
      dismissDataIssue,
    }),
    [
      dispatch,
      roleOf,
      getActiveBoard,
      addBoard,
      removeBoard,
      archiveBoard,
      unarchiveBoard,
      undo,
      redo,
      importBoards,
      hydrateBoards,
      dismissDataIssue,
    ],
  );

  const stateValue = useMemo<BoardStateValue>(
    () => ({ board, boards: state, dataIssue, syncStatus }),
    [board, state, dataIssue, syncStatus],
  );

  const identity = useMemo<BoardIdentityValue>(
    () => ({ id: board?.id, title: board?.title ?? "" }),
    [board?.id, board?.title],
  );

  return (
    <BoardLiveProvider live={live}>
      <BoardActionsContext.Provider value={actions}>
        <BoardHistoryContext.Provider value={history}>
          <BoardIdentityContext.Provider value={identity}>
            <BoardStateContext.Provider value={stateValue}>
              {children}
            </BoardStateContext.Provider>
          </BoardIdentityContext.Provider>
        </BoardHistoryContext.Provider>
      </BoardActionsContext.Provider>
    </BoardLiveProvider>
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
  | "setCardPriority"
  | "setCardAssign"
  | "addCardLink"
  | "removeCardLink"
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
        activityIds: ids(1),
        at: Date.now(),
      }),
    renameChecklist: (cardId: string, checklistId: string, title: string) =>
      dispatch({
        type: "RENAME_CHECKLIST",
        cardId,
        checklistId,
        title,
        activityIds: ids(1),
        at: Date.now(),
      }),
    deleteChecklist: (cardId: string, checklistId: string) =>
      dispatch({
        type: "DELETE_CHECKLIST",
        cardId,
        checklistId,
        activityIds: ids(1),
        at: Date.now(),
      }),
    addChecklistItem: (cardId: string, checklistId: string, text: string) =>
      dispatch({
        type: "ADD_CHECKLIST_ITEM",
        cardId,
        checklistId,
        newItemId: createId(),
        text,
        activityIds: ids(1),
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
        activityIds: ids(1),
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
        activityIds: ids(1),
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
        activityIds: ids(1),
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
    setCardPriority: (cardId: string, priority: CardPriority) =>
      dispatch({
        type: "SET_CARD_PRIORITY",
        cardId,
        priority,
        activityIds: ids(1),
        at: Date.now(),
      }),
    setCardAssign: (cardId: string, assigneeId: string | null) =>
      dispatch({
        type: "SET_CARD_ASSIGN",
        cardId,
        assigneeId,
        activityIds: ids(1),
        at: Date.now(),
      }),
    addCardLink: (
      cardId: string,
      targetCardId: string,
      linkType: CardLinkType,
    ) =>
      dispatch({
        type: "ADD_CARD_LINK",
        cardId,
        targetCardId,
        linkId: createId(),
        linkType,
        activityIds: ids(1),
        at: Date.now(),
      }),
    removeCardLink: (
      cardId: string,
      linkId: string,
      targetCardId: string,
      linkType: CardLinkType,
    ) =>
      dispatch({
        type: "REMOVE_CARD_LINK",
        cardId,
        linkId,
        targetCardId,
        linkType,
        activityIds: ids(1),
        at: Date.now(),
      }),
    setCardCover: (cardId: string, cover?: CardCover) =>
      dispatch({
        type: "SET_CARD_COVER",
        cardId,
        cover,
        activityIds: ids(1),
        at: Date.now(),
      }),
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

// ---------------------------------------------------------------------------
// Public read-only sharing (TASK-58, §7.9). A public `/s/:token` page mounts
// the very same board components in `readOnly` mode, so it needs the same four
// contexts — but with a fixed board, no persistence, no server sync and only
// no-op actions. `ShareBoardProvider` supplies exactly that; every action it
// hands out is inert (the public contour has no write route at all).
// ---------------------------------------------------------------------------

/** A board actions object whose every member is a no-op (read-only mount). */
function createReadOnlyBoardActions(): BoardActionsValue {
  const noop = (): void => undefined;
  return {
    dispatch: noop,
    roleOf: () => "VIEWER",
    addColumn: noop,
    renameBoard: noop,
    renameColumn: noop,
    deleteColumn: noop,
    addCard: noop,
    updateCard: noop,
    touchCard: noop,
    deleteCard: noop,
    archiveCard: noop,
    unarchiveCard: noop,
    archiveColumnCards: noop,
    toggleCardLabel: noop,
    addLabel: noop,
    renameLabel: noop,
    setLabelColor: noop,
    deleteLabel: noop,
    addChecklist: noop,
    renameChecklist: noop,
    deleteChecklist: noop,
    addChecklistItem: noop,
    toggleChecklistItem: noop,
    renameChecklistItem: noop,
    deleteChecklistItem: noop,
    setCardDueDate: noop,
    setCardPriority: noop,
    setCardAssign: noop,
    addCardLink: noop,
    removeCardLink: noop,
    setCardCover: noop,
    duplicateCard: noop,
    duplicateColumn: noop,
    moveCard: noop,
    moveColumn: noop,
    setColumnWipLimit: noop,
    sortColumn: noop,
    addBoard: () => "",
    removeBoard: noop,
    archiveBoard: noop,
    unarchiveBoard: noop,
    undo: noop,
    redo: noop,
    importBoards: noop,
    refreshBoards: () => Promise.resolve(),
    dismissDataIssue: noop,
  };
}

/**
 * Read-only board contexts for the public share page. `board` is the rendered
 * board (a live aggregate that updates over SSE, or a frozen snapshot);
 * `members` is the sanitized roster so assignee faces resolve. Everything the
 * writing components would call is inert, and history is permanently empty.
 */
export function ShareBoardProvider({
  board,
  members,
  children,
}: {
  board: Board;
  members: BoardMemberDto[];
  children: ReactNode;
}) {
  const [live] = useState(createBoardLive);

  useEffect(() => {
    live.members.set(board.id, members);
  }, [live, board.id, members]);

  useEffect(() => {
    live.attribution.seed(board);
  }, [live, board]);

  useEffect(() => {
    return () => live.dispose();
  }, [live]);

  const actions = useMemo<BoardActionsValue>(
    () => createReadOnlyBoardActions(),
    [],
  );
  const history = useMemo<BoardHistoryValue>(
    () => ({ canUndo: false, canRedo: false }),
    [],
  );
  const identity = useMemo<BoardIdentityValue>(
    () => ({ id: board.id, title: board.title }),
    [board.id, board.title],
  );
  const stateValue = useMemo<BoardStateValue>(
    () => ({ board, boards: [board], dataIssue: null, syncStatus: "ready" }),
    [board],
  );

  return (
    <BoardLiveProvider live={live}>
      <BoardActionsContext.Provider value={actions}>
        <BoardHistoryContext.Provider value={history}>
          <BoardIdentityContext.Provider value={identity}>
            <BoardStateContext.Provider value={stateValue}>
              {children}
            </BoardStateContext.Provider>
          </BoardIdentityContext.Provider>
        </BoardHistoryContext.Provider>
      </BoardActionsContext.Provider>
    </BoardLiveProvider>
  );
}
