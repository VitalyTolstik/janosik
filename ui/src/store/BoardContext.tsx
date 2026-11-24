import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
  BOARD_CARD_DETAIL_BATCH_MAX,
  BOARD_CARD_PAGE_LIMIT_MAX,
  boardReducer,
  boardStarterPlan,
  boardTemplatePlan,
  LIMITS,
  serializeExport,
  type BoardAction,
  type BoardStarterLocale,
  type BoardState,
  type BoardTemplateSelection,
  type ColumnSortBy,
  type UpdateCardAction,
} from "@janosik/shared";
import { api, ApiError, isApiEnabled } from "@/api/client";
import { BoardViewProvider } from "@/components/board/BoardViewProvider";
import {
  BoardLiveProvider,
  cardIdsTouchedBy,
  createBoardLive,
  type BoardLive,
} from "@/store/board-live";
import type { RealtimeBridge, RefetchResult } from "@/store/realtime";
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
  BoardWorkflow,
  Card,
  CardCover,
  CardLinkType,
  CardPriority,
  ColumnAccentStyle,
  Label,
  MembershipChange,
} from "@janosik/shared";
import { normalizeBoards } from "@janosik/shared";
import { DEFAULT_COLUMN_ACCENT_STYLE } from "@janosik/shared";
import { changedEntityIds } from "@/store/board-diff";
import {
  boardFromSummary,
  cardById,
  cardFromDetail,
  cardFromSummary,
  hasCardDetail,
} from "@/store/read-model";
import { hasCard } from "@/utils/card-nav";
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
import { conditionLabel } from "@/utils/workflow";
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

/**
 * TASK-200.9 initial page per visible column. The summary already carries
 * every column's ordered ids, so this is a render budget, not a functional
 * cap: the rest of the summaries stream in through the page endpoint.
 */
const READ_MODEL_FIRST_PAGE = 50;

/** Upper bound for one background page request. */
const READ_MODEL_PAGE = BOARD_CARD_PAGE_LIMIT_MAX;

type CardPatch = Pick<UpdateCardAction, "title" | "description">;

/**
 * Cards whose full detail must be in the store before a command is applied
 * (TASK-200.9): the command's local inverse carries a whole card/checklist,
 * or the optimistic reducer needs fields the summary does not have. Loading
 * a preimage is a no-op for boards hydrated from the full aggregate.
 */
function preimageCardIds(
  action: BoardAction,
  board: Board | undefined,
): string[] {
  if (board === undefined) return [];
  switch (action.type) {
    case "DELETE_CARD":
    case "DUPLICATE_CARD":
    case "DELETE_CHECKLIST":
    case "DELETE_CHECKLIST_ITEM":
    case "ADD_CARD_LINK":
    case "REMOVE_CARD_LINK":
    case "SET_CARD_TASK_SPEC":
      return [action.cardId];
    case "ARCHIVE_CARD":
    case "UNARCHIVE_CARD":
      // Rows are needed to update the targets' blocked facts; a card with
      // zero links has nothing to update and does not pay a detail request.
      return (board.cards[action.cardId]?.readModel?.linkCount ?? 0) > 0
        ? [action.cardId]
        : [];
    case "DUPLICATE_COLUMN":
    case "DELETE_COLUMN":
    case "ARCHIVE_COLUMN_CARDS": {
      const column = board.columns.find(
        (entry) => entry.id === action.columnId,
      );
      return column === undefined ? [] : [...column.cardIds];
    }
    default:
      return [];
  }
}

interface ArchiveBatch {
  boardId: string;
  cardIds: string[];
  done: number;
  total: number;
}

/**
 * Everything that changes when the data changes. Read it through
 * `useBoardState()` (or `useBoard()`): consumers re-render on every edit.
 */
interface BoardStateValue {
  archiveBatch: ArchiveBatch | null;
  /** The board selected by the URL (falls back to the first one). */
  board: Board | undefined;
  /** Every board in storage (export/import target). */
  boards: Board[];
  /**
   * Boards that are still streaming in after the shell became ready (U-9).
   * The switcher renders pending rows while this is positive; zero once the
   * background hydration finished (or gave up).
   */
  pendingBoardCount: number;
  /**
   * The active board's read-model pages are not fully loaded (a page request
   * failed after retries). Counts still come from the summary; the views are
   * incomplete until the next retry.
   */
  readModelPartial: boolean;
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
  /**
   * True while the active board sits in the archive. The header treats it
   * exactly like a VIEWER: the title is a readout and no write affordances
   * are offered (the command path refuses them too).
   */
  archived: boolean;
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
 * The caller's role on the active board — its own narrow context so the
 * header can hide mutating affordances for a VIEWER without subscribing to
 * every board edit. `undefined` while the role is unknown or there is no
 * active board.
 */
interface BoardAccessValue {
  role: BoardRole | undefined;
}

/** TASK-177.16 first-run choice: empty board, the legacy starter or a template. */
export interface AddBoardOptions {
  template?: BoardTemplateSelection;
  templateLocale?: BoardStarterLocale;
  /** The client's local creation date, used for deterministic due offsets. */
  templateDate?: string;
  /** The client's UTC offset (`-getTimezoneOffset()`) at creation. */
  templateUtcOffsetMinutes?: number;
}

/**
 * Every way to change the data. The object is built once and never
 * replaced, so `useBoardActions()` consumers never re-render because of it
 * and its members are safe `useCallback`/`useMemo` dependencies.
 */
interface BoardActionsValue {
  dispatch: (action: BoardAction) => void | Promise<boolean>;
  /**
   * TASK-200.9: load one card's full detail (description/checklists/links)
   * on demand. Resolves `null` for a card that no longer exists.
   */
  loadCardDetail: (boardId: string, cardId: string) => Promise<Card | null>;
  /** Load full preimages for a bounded set (chunks of 50). */
  loadCardDetails: (
    boardId: string,
    ids: readonly string[],
  ) => Promise<boolean>;
  /** TASK-200.9: retry the read-model page stream after a partial load. */
  retryReadModel: () => void;
  startArchiveBatch: (boardId: string, actions: BoardAction[]) => boolean;
  /**
   * The caller's role on a board, when the server said so — `ADMIN` for
   * every board in local mode. Drives the ADMIN-only switcher actions
   * (archive/delete), which the server would refuse anyway (TASK-29).
   */
  roleOf: (boardId: string) => BoardRole | undefined;
  /* Convenience actions */
  addColumn: (title: string) => string;
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
  /**
   * TASK-177.9: same optimistic `UPDATE_CARD`, but resolves with the server's
   * answer (`true` in local mode). Callers that must not show success before
   * the save lands use this instead of the fire-and-forget action.
   */
  updateCardAndWait: (
    cardId: string,
    patch: CardPatch,
    opts?: { quiet?: boolean },
  ) => Promise<boolean>;
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
  /**
   * Replaces the card's machine-readable task contract (TASK-177.4): each
   * list is independent, an empty list clears it, and an omitted list stays
   * unchanged. The command is attributed like every other card edit.
   */
  setCardTaskSpec: (
    cardId: string,
    spec: { acceptanceCriteria?: string[]; definitionOfDone?: string[] },
  ) => void;
  /**
   * Releases the card's agent claim without ending the agent session
   * (TASK-177.4). The server still enforces holder/ADMIN rules.
   */
  releaseCardClaim: (cardId: string) => void;
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
  /** Sets (or clears, `accent === undefined`) a column's accent. */
  setColumnAccent: (columnId: string, accent?: CardCover) => void;
  /** Sets the board-wide column accent shape (`undefined` = signature). */
  setBoardColumnStyle: (columnStyle?: ColumnAccentStyle) => void;
  /**
   * Replaces (or clears, `undefined`) the board's card workflow. In server
   * mode resolves `false` when the server refused the command (the failure
   * toast is already shown), so the settings dialog can stay open.
   */
  setBoardWorkflow: (
    workflow: BoardWorkflow | undefined,
    boardId: string,
  ) => void | boolean | Promise<boolean>;
  /** Sorts a column's cards (createdAt / dueDate / title). */
  sortColumn: (columnId: string, sortBy: ColumnSortBy) => void;
  /* Board management (multi-board) */
  /**
   * Creates a named board (an optional starter) and resolves with its id for
   * navigation, or `null` when the create was refused (a toast was shown).
   * A blank title is never replaced by a default name. Local mode resolves
   * synchronously — `await` works for both.
   */
  addBoard: (
    title: string,
    options?: AddBoardOptions,
    /** Called instead of the generic toast for a template contract 400. */
    onTemplateContractError?: (error: unknown) => void,
  ) => string | null | Promise<string | null>;
  /** Removes a board; the caller must navigate away from it first/after. */
  removeBoard: (boardId: string) => void | Promise<void>;
  /**
   * Leave a board as the caller (TASK-177.2). Server mode only: removes the
   * membership, forgets the board locally (switcher + role + undo history)
   * and navigates away. Resolves `false` when the server refused or the app
   * is in local mode (the error toast is already shown).
   */
  leaveBoard: (boardId: string) => Promise<boolean>;
  /** Archives a board (data kept; hidden from the normal switcher list). */
  archiveBoard: (boardId: string) => void;
  /** Brings an archived board back to the active list. */
  unarchiveBoard: (boardId: string) => void;
  /* Undo / redo (scoped to the active board) */
  undo: () => void;
  redo: () => void;
  /**
   * Import replaces the whole data set locally and appends the boards on the
   * server. Server mode resolves `false` when the request was refused (the
   * error toast is already shown), so the caller can skip its success toast.
   */
  importBoards: (boards: BoardState) => void | Promise<boolean>;
  /** Read every board for export, refusing incomplete or stale snapshots. */
  exportBoards: () => Promise<BoardState>;
  /**
   * TASK-177.7: one board as an importable JSON envelope, after drafts are
   * flushed and pending commands drain — the same barrier as `exportBoards`
   * without reading every other board.
   */
  exportBoard: (boardId: string) => Promise<string>;
  /**
   * Re-runs server hydration (`GET /boards` + aggregates) — used after
   * accepting an invitation so the fresh board shows up without a reload.
   * No-op in local mode.
   */
  refreshBoards: () => Promise<void>;
  /* Data safety (TASK-21.2) */
  /** Acknowledges a `corrupt-load` notice (releases held-back writes). */
  dismissDataIssue: () => void;
  /**
   * Register a staged-edit flusher (the card dialog's description draft):
   * it runs before the page is hidden or unloaded and before logout, so
   * text that only lives in an editor reaches the store and the command
   * queue (U-3). Returns the unregister function.
   */
  registerDraftFlush: (flush: () => void) => () => void;
  /**
   * Keep the home route on screen after the first board appears. The
   * first-run picker needs one moment to show its success panel before the
   * provider's usual "home → first board" redirect takes over.
   */
  setHomeRedirectPaused: (paused: boolean) => void;
}

/** The full surface, as `useBoard()` hands it out. */
type BoardContextValue = BoardStateValue &
  BoardHistoryValue &
  BoardActionsValue;

const BoardStateContext = createContext<BoardStateValue | null>(null);
const BoardIdentityContext = createContext<BoardIdentityValue | null>(null);
const BoardHistoryContext = createContext<BoardHistoryValue | null>(null);
const BoardAccessContext = createContext<BoardAccessValue | null>(null);
const BoardActionsContext = createContext<BoardActionsValue | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const { user, registerBeforeLogout } = useAuth();
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
  const [pendingBoardCount, setPendingBoardCount] = useState(0);
  const [homeRedirectPaused, setHomeRedirectPaused] = useState(false);
  const [readModelPartialBoards, setReadModelPartialBoards] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [roles, setRoles] = useState<Record<string, BoardRole>>({});

  /* eslint-enable react-hooks/refs */

  const boardMutationsRef = useRef({ pending: 0, epoch: 0 });
  const trackBoardMutation = useCallback(<T,>(task: () => Promise<T>) => {
    boardMutationsRef.current.pending += 1;
    boardMutationsRef.current.epoch += 1;
    return Promise.resolve()
      .then(task)
      .finally(() => {
        boardMutationsRef.current.pending -= 1;
        boardMutationsRef.current.epoch += 1;
      });
  }, []);

  // Per-board entity versions seen in command responses — the basis for the
  // undo preconditions that stop a stale undo from clobbering foreign text.
  const versionsRef = useRef(new Map<string, Record<string, number>>());

  // TASK-30 realtime bookkeeping. `seqsRef` is the command seq the local
  // state reflects per board; the bridge in the lazy realtime chunk owns
  // everything else (dedupe, deferred events, reconnects) and reads the
  // current user id through `userIdRef` for the own-echo filter.
  const seqsRef = useRef(new Map<string, number>());
  // When each board was last known to match the server (a snapshot, or a
  // live stream up to its disconnect) — the realtime bridge re-reads a board
  // idle for long as one snapshot instead of replaying its backlog (U-9).
  const syncedAtRef = useRef(new Map<string, number>());
  // Bumped whenever a local command for the board is queued: a snapshot
  // requested before a bump may not contain that command and must not
  // replace the optimistic state (U-2).
  const epochsRef = useRef(new Map<string, number>());
  const bumpEpoch = useCallback((boardId: string) => {
    epochsRef.current.set(boardId, (epochsRef.current.get(boardId) ?? 0) + 1);
  }, []);
  // The rollback refetch drain (declared further down, next to the refetch
  // itself) — read from command callbacks that are created before it.
  const refetchWantedRef = useRef(new Set<string>());
  const drainRefetchRef = useRef<(boardId: string) => void>(() => undefined);
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

  /**
   * Outcomes already handled by a dispatch handler. A coalesced quiet send
   * resolves every folded waiter with the same outcome object; the failure
   * side effects (one toast, one rollback) must run once, not once per
   * waiter (TASK-147 follow-up). `ServerSync` resolves the newest waiter
   * first, so it is the one that acts — and its command id is the one that
   * was actually sent (so its history step reverts the whole coalesced run).
   */
  const handledOutcomesRef = useRef(new WeakSet<object>());

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
  // Read by hydration (which board to load first) and by the realtime
  // handlers, which outlive the render they were created in (U-5).
  const routeBoardIdRef = useRef(routeBoardId);
  useEffect(() => {
    routeBoardIdRef.current = routeBoardId;
  }, [routeBoardId]);
  const board = routeBoardId
    ? state.find(
        (b) =>
          b.id === routeBoardId && (!b.archivedAt || hasCard(b, cardParam)),
      )
    : undefined;

  // Latest state, readable from stable callbacks. `apply` below is the only
  // writer — and the only caller of `dispatchRaw` — so the ref is always the
  // reducer applied to every action React has been handed, i.e. equal to or
  // ahead of the committed `state`. (A former "safety net" effect copied
  // `state` back into the ref after each commit; when an action was applied
  // between a commit and its passive effect, that copy moved the ref
  // *backwards* and the next command recorded a stale "before".)
  const stateRef = useRef(state);

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

  // TASK-200.9: read-model hydration. A summary is applied as soon as its
  // first pages are in; remaining summaries stream in per column/archive.
  // The generation prevents a refetch's pages from being applied after a
  // newer snapshot replaced the board.
  const readModelGenerationRef = useRef(new Map<string, number>());
  const readModelBaselineRef = useRef(
    new Map<string, { seq: number; revision: number }>(),
  );
  const readModelCompleteRef = useRef(new Map<string, boolean>());
  const readModelWarnedRef = useRef(new Set<string>());
  const nextReadModelGeneration = useCallback((boardId: string) => {
    const next = (readModelGenerationRef.current.get(boardId) ?? 0) + 1;
    readModelGenerationRef.current.set(boardId, next);
    return next;
  }, []);

  const markReadModelPartial = useCallback(
    (boardId: string, partial: boolean) => {
      setReadModelPartialBoards((current) => {
        if (current.has(boardId) === partial) return current;
        const next = new Set(current);
        if (partial) next.add(boardId);
        else next.delete(boardId);
        return next;
      });
    },
    [],
  );

  /** Is this id still in the board's current column/archive scope? */
  const isCardInScope = useCallback(
    (boardId: string, cardId: string, columnId?: string): boolean => {
      const board = stateRef.current.find((entry) => entry.id === boardId);
      if (board === undefined) return false;
      if (columnId !== undefined) {
        return (
          board.columns
            .find((column) => column.id === columnId)
            ?.cardIds.includes(cardId) === true
        );
      }
      return (
        board.archivedCardIds?.includes(cardId) === true ||
        board.columns.some((column) => column.cardIds.includes(cardId)) ||
        board.cards[cardId]?.archivedAt !== undefined
      );
    },
    [],
  );

  const delay = useCallback(
    (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    [],
  );

  const hydrateRemainingPages = useCallback(
    async (
      boardId: string,
      summary: Awaited<ReturnType<typeof api.getBoardSummary>>,
      generation: number,
    ): Promise<void> => {
      const alive = () =>
        aliveRef.current &&
        readModelGenerationRef.current.get(boardId) === generation;
      const baseline = {
        seq: summary.atSeq,
        revision: summary.aggregateRevision,
      };
      let failed = false;
      const fetchPage = async (request: {
        columnId?: string;
        archived?: boolean;
        cursor: string;
      }): Promise<Awaited<ReturnType<typeof api.listBoardCards>>> => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) await delay(200 * 2 ** (attempt - 1));
          try {
            return await api.listBoardCards(boardId, {
              ...request,
              limit: READ_MODEL_PAGE,
            });
          } catch (error) {
            lastError = error;
            const retryable =
              !(error instanceof ApiError) ||
              error.status === 0 ||
              error.status === 408 ||
              error.status === 429 ||
              error.status >= 500;
            if (!retryable) throw error;
          }
        }
        throw lastError;
      };
      const nextPage = async (
        cursor: string,
        request: { columnId?: string; archived?: boolean },
      ): Promise<void> => {
        let next: string | null = cursor;
        while (next !== null && alive()) {
          const page = await fetchPage({ ...request, cursor: next });
          if (!alive()) return;
          // A page from before the summary (or from an older content
          // revision) must not resurrect deleted cards or hide newer ones.
          if (
            page.atSeq < baseline.seq ||
            page.aggregateRevision < baseline.revision
          ) {
            failed = true;
            return;
          }
          if (page.cards.length > 0) {
            const scoped = page.cards
              .filter((card) =>
                isCardInScope(boardId, card.id, request.columnId),
              )
              .map(cardFromSummary);
            if (scoped.length > 0) {
              apply({
                type: "HYDRATE_CARDS",
                boardId,
                cards: scoped,
                atSeq: page.atSeq,
              });
            }
          }
          next = page.nextCursor;
        }
      };
      await Promise.all(
        summary.columns.flatMap((column) =>
          column.nextCursor === null
            ? []
            : [
                nextPage(column.nextCursor, { columnId: column.id }).catch(
                  () => {
                    failed = true;
                  },
                ),
              ],
        ),
      );
      if (summary.archivedNextCursor !== null) {
        await nextPage(summary.archivedNextCursor, { archived: true }).catch(
          () => {
            failed = true;
          },
        );
      }
      if (!alive()) return;
      if (failed) {
        readModelCompleteRef.current.set(boardId, false);
        markReadModelPartial(boardId, true);
        if (!readModelWarnedRef.current.has(boardId)) {
          readModelWarnedRef.current.add(boardId);
          toast.error(t("sync.loadFailed"));
        }
        return;
      }
      readModelCompleteRef.current.set(boardId, true);
      readModelWarnedRef.current.delete(boardId);
      markReadModelPartial(boardId, false);
    },
    [apply, delay, isCardInScope, markReadModelPartial, t, toast],
  );

  /**
   * Fetch a board through the read model, falling back to the legacy full
   * aggregate when the server predates `/summary` (404/405) or the route is
   * disabled. Only the fallback path pays for descriptions/checklists.
   */
  const fetchBoardForHydration = useCallback(
    async (
      boardId: string,
    ): Promise<{
      board: Board;
      seq: number;
      summary: Awaited<ReturnType<typeof api.getBoardSummary>> | null;
    }> => {
      try {
        const summary = await api.getBoardSummary(boardId, {
          limit: READ_MODEL_FIRST_PAGE,
        });
        const previous = stateRef.current.find((board) => board.id === boardId);
        return {
          board: boardFromSummary(summary, previous),
          seq: summary.seq,
          summary,
        };
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 400 ||
            error.status === 404 ||
            error.status === 405 ||
            error.status === 501)
        ) {
          const snapshot = await api.getBoardSnapshot(boardId);
          return { ...snapshot, summary: null };
        }
        throw error;
      }
    },
    [],
  );

  const startReadModelHydration = useCallback(
    (
      boardId: string,
      summary: Awaited<ReturnType<typeof api.getBoardSummary>> | null,
    ): void => {
      if (summary === null) {
        readModelBaselineRef.current.delete(boardId);
        readModelCompleteRef.current.delete(boardId);
        markReadModelPartial(boardId, false);
        return;
      }
      const previousBaseline = readModelBaselineRef.current.get(boardId);
      const generation = nextReadModelGeneration(boardId);
      const advanced =
        previousBaseline !== undefined &&
        (summary.atSeq > previousBaseline.seq ||
          summary.aggregateRevision > previousBaseline.revision);
      readModelBaselineRef.current.set(boardId, {
        seq: summary.atSeq,
        revision: summary.aggregateRevision,
      });
      const allIds = [
        ...summary.columns.flatMap((column) => column.cardIds),
        ...summary.archivedCardIds,
      ];
      const board = stateRef.current.find((entry) => entry.id === boardId);
      const missing = allIds.some((id) => board?.cards[id] === undefined);
      // A completed board with every summary id present needs no page
      // re-download on every focus; SSE already keeps the loaded cards
      // current. But a newer summary seq/revision means a page card may have
      // changed while its page was not open, so page 2+ must be re-read.
      if (
        readModelCompleteRef.current.get(boardId) === true &&
        !missing &&
        !advanced
      ) {
        return;
      }
      readModelCompleteRef.current.set(boardId, false);
      void hydrateRemainingPages(boardId, summary, generation);
    },
    [hydrateRemainingPages, markReadModelPartial, nextReadModelGeneration],
  );

  // One in-flight full-detail request per board:card. The dialog and a
  // context menu can ask for the same card in the same tick.
  const detailRequestsRef = useRef(new Map<string, Promise<Card | null>>());

  /** Load a card's full detail (description/checklists/links) on demand. */
  const loadCardDetail = useCallback(
    (boardId: string, cardId: string): Promise<Card | null> => {
      const existing = cardById(
        stateRef.current.find((board) => board.id === boardId)?.cards,
        cardId,
      );
      const staleReverse = existing?.readModel?.reverseLinksStale === true;
      if (!serverMode || (hasCardDetail(existing) && !staleReverse)) {
        return Promise.resolve(existing ?? null);
      }
      const key = `${boardId}:${cardId}`;
      const running = detailRequestsRef.current.get(key);
      if (running !== undefined) return running;
      const request = (async (): Promise<Card | null> => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (attempt > 0) await delay(250);
          try {
            const detail = await api.getBoardCardDetail(boardId, cardId);
            if (!aliveRef.current) return null;
            // A card moved out of the board, archived by another client or
            // deleted must not be resurrected by a late detail response.
            if (!isCardInScope(boardId, cardId)) return null;
            const baseline = readModelBaselineRef.current.get(boardId);
            if (
              attempt === 0 &&
              baseline !== undefined &&
              (detail.atSeq < baseline.seq ||
                detail.aggregateRevision < baseline.revision)
            ) {
              // One retry for a detail that predates the summary; the second
              // response is still protected by the reducer's updatedAt guard.
              continue;
            }
            const card = cardFromDetail(detail);
            apply({ type: "HYDRATE_CARDS", boardId, cards: [card] });
            return card;
          } catch (error) {
            // A card deleted by someone else is a miss, not a crash: the
            // caller (a deep link) reports it like any unknown card.
            if (error instanceof ApiError && error.status === 404) return null;
            lastError = error;
            const retryable =
              !(error instanceof ApiError) ||
              error.status === 0 ||
              error.status === 408 ||
              error.status === 429 ||
              error.status >= 500;
            if (!retryable) throw error;
          }
        }
        throw lastError;
      })().finally(() => {
        if (detailRequestsRef.current.get(key) === request) {
          detailRequestsRef.current.delete(key);
        }
      });
      detailRequestsRef.current.set(key, request);
      return request;
    },
    [apply, delay, isCardInScope, serverMode],
  );

  /**
   * Ensure full preimages for a bounded id set. Destructive commands whose
   * local inverse carries a whole card (delete/column archive/checklist
   * removal) call this first so undo never writes a summary back as a card.
   * Chunks stay under the server's batch cap.
   */
  const loadCardDetails = useCallback(
    async (boardId: string, ids: readonly string[]): Promise<boolean> => {
      const cardMap = stateRef.current.find(
        (board) => board.id === boardId,
      )?.cards;
      const missing = [...new Set(ids)].filter(
        (id) => !hasCardDetail(cardById(cardMap, id)),
      );
      for (
        let index = 0;
        index < missing.length;
        index += BOARD_CARD_DETAIL_BATCH_MAX
      ) {
        const chunk = missing.slice(index, index + BOARD_CARD_DETAIL_BATCH_MAX);
        const result = await api.getBoardCardDetails(boardId, chunk);
        if (!aliveRef.current) return false;
        const cards = result.cards
          .filter((detail) => isCardInScope(boardId, detail.card.id))
          .map(cardFromDetail);
        if (cards.length > 0) {
          apply({ type: "HYDRATE_CARDS", boardId, cards });
        }
      }
      return true;
    },
    [apply, isCardInScope],
  );

  /** Toast for a command the server refused or the network dropped. */
  const showFailure = useCallback(
    (failure: SendFailure) => {
      switch (failure.kind) {
        case "offline":
          toast.error(t("sync.offline"));
          break;
        case "wip": {
          const board = getActiveBoard();
          const column =
            failure.columnId === undefined
              ? undefined
              : board?.columns.find((entry) => entry.id === failure.columnId);
          if (column === undefined) {
            toast.error(t("sync.rejected"));
            break;
          }
          toast.error(
            t("toast.wipLimitBlocked", {
              title: column.title,
              limit: column.wipLimit ?? LIMITS.cardsPerColumn,
            }),
          );
          break;
        }
        case "version":
          toast.error(t("sync.foreignEdit"));
          break;
        case "workflow": {
          const board = getActiveBoard();
          const details = failure.details;
          const titleOf = (id: string | null) =>
            board?.columns.find((column) => column.id === id)?.title ??
            id ??
            "—";
          if (details.code === "condition_failed") {
            toast.error(
              t("workflow.blocked.conditionToast", {
                conditions: (details.failedConditions ?? [])
                  .map((condition) => conditionLabel(condition, t))
                  .join(t("workflow.conditionSeparator")),
              }),
            );
          } else if (details.code === "role_not_allowed") {
            toast.error(
              t("workflow.blocked.role", {
                from: titleOf(details.fromColumnId),
                to: titleOf(details.toColumnId),
                roles:
                  details.requiredRoles?.join(" / ") ??
                  t("workflow.roleFallback"),
              }),
            );
          } else {
            const allowed = details.allowedToColumnIds
              .map((id) => titleOf(id))
              .join(t("workflow.listSeparator"));
            toast.error(
              t(
                allowed === ""
                  ? "workflow.blocked.transition"
                  : "workflow.blocked.transitionAllowed",
                {
                  from: titleOf(details.fromColumnId),
                  to: titleOf(details.toColumnId),
                  columns: allowed,
                },
              ),
            );
          }
          break;
        }
        case "busy":
          toast.error(t("sync.busy"));
          break;
        default:
          toast.error(t("sync.rejected"));
      }
    },
    [toast, t, getActiveBoard],
  );

  const reconcileUncertainCommand = useCallback(
    (boardId: string, commandId: string, reverted = true): void => {
      // A reverted command needs its own echo replayed. If newer local
      // edits prevented rollback, the snapshot reorders them safely.
      if (reverted) sync.forgetOwnCommand(boardId, commandId);
      toast.error(t("sync.uncertain"));
      realtimeRef.current?.settled(boardId);
      refetchWantedRef.current.add(boardId);
      drainRefetchRef.current(boardId);
    },
    [sync, toast, t],
  );

  /**
   * Undo/redo transport (TASK-29): the inverse command rides the same queue
   * as ordinary commands, with version preconditions for text so a stale
   * undo is refused instead of overwriting someone else's edit. Responses
   * feed the version map for the next precondition.
   */
  const sendUndoRedo = useCallback(
    async (boardId: string, action: BoardAction): Promise<SendOutcome> => {
      bumpEpoch(boardId);
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
      } else if (outcome.uncertainCommandId === undefined) {
        realtimeRef.current?.settled(boardId);
      }
      if (outcome.ok || outcome.uncertainCommandId === undefined) {
        drainRefetchRef.current(boardId);
      }
      return outcome;
    },
    [sync, preconditionsFor, mergeVersions, live, bumpEpoch],
  );

  // Undo/redo lives in its own hook (TASK-21.7d): one command stack per
  // board, the two availability flags, and the keyboard shortcuts.
  // Destructured on purpose: every function below is a stable callback,
  // while the object itself is rebuilt each render — depending on the
  // object would give `dispatch` (and with it the whole actions context) a
  // new identity on every state change and undo the render isolation of
  // TASK-21.4.
  const labelPreimageGatesRef = useRef(new Map<string, Promise<boolean>>());
  /**
   * TASK-200.9: hold undo/redo presses until every in-flight DELETE_LABEL
   * has answered and amended its inverse. A gate chains on the board's
   * previous one, so two fast deletes still release in command order; a
   * failed delete resolves the chain `false` and the queued press is dropped
   * instead of undoing an unrelated older step.
   */
  const beginLabelPreimageGate = useCallback((boardId: string) => {
    let release!: (ok: boolean) => void;
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const previous =
      labelPreimageGatesRef.current.get(boardId) ?? Promise.resolve(true);
    const chained = previous.then((ok) => gate.then((mine) => ok && mine));
    labelPreimageGatesRef.current.set(boardId, chained);
    return (ok: boolean) => {
      release(ok);
      void chained.finally(() => {
        if (labelPreimageGatesRef.current.get(boardId) === chained) {
          labelPreimageGatesRef.current.delete(boardId);
        }
      });
    };
  }, []);
  const waitForLabelPreimage = useCallback(
    (boardId: string) => labelPreimageGatesRef.current.get(boardId),
    [],
  );

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
    amendLabelPreimage,
  } = useUndoHistory({
    getBoard: getBoardById,
    getActiveBoardId,
    hotkeysEnabled: board !== undefined && roles[board.id] !== "VIEWER",
    apply,
    waitForPreimage: waitForLabelPreimage,
    ...(serverMode
      ? {
          send: sendUndoRedo,
          onSendFailed: showFailure,
          onUncertain: reconcileUncertainCommand,
          onForeignSkipped,
        }
      : {}),
  });

  const history = useMemo<BoardHistoryValue>(
    () => ({ canUndo, canRedo }),
    [canUndo, canRedo],
  );

  // Any path that leaves the caller as a VIEWER — a live membership event, a
  // focus refetch, a fresh load — drops the local undo stack. Hiding the
  // buttons alone would still leave Ctrl+Z able to send refused commands.
  useEffect(() => {
    const activeId = board?.id;
    if (activeId !== undefined && roles[activeId] === "VIEWER") {
      dropHistory(activeId);
    }
  }, [board?.id, roles, dropHistory]);

  // Switching boards swaps in that board's stack — and its own undo state.
  // The active-board reader the stable callbacks use. A layout effect, not a
  // passive one: hydration commits the board (and "ready") first, and a click
  // can land before passive effects flush. `dispatch` would then fall back to
  // an unset ref and drop the command.
  useLayoutEffect(() => {
    activeIdRef.current = board?.id;
    syncHistory();
  }, [board?.id, syncHistory]);

  // Redirect the home route and archived boards to a real active board
  // (replace, so dead URLs never land in history). With zero active boards
  // the home route lands on `/` — the empty-state screen (Trello's home with
  // "create new board"). Unknown paths and unknown board ids are deliberately
  // left alone: they fall through to the 404 route instead of being silently
  // swallowed by a redirect to some other board (which hid typos and stale
  // links).
  useEffect(() => {
    // A cold boot still has an empty `state` while the boards are on their
    // way: redirecting then would drop a `?card=` deep link (the URL is
    // replaced before the board it points at has loaded).
    if (syncStatus !== "ready") return;
    // The first-run picker holds the home route while it shows the created
    // board's success panel; closing it resumes the redirect.
    if (homeRedirectPaused && location.pathname === routes.home) return;
    const routed = routeBoardId
      ? state.find((b) => b.id === routeBoardId)
      : undefined;
    if (routed && !routed.archivedAt) return;
    // Viewing an archived board is allowed only via an explicit ?card=
    // deep-link onto one of its cards (global search).
    if (routed?.archivedAt && hasCard(routed, cardParam)) return;
    // Only the home route and archived boards redirect; anything else — an
    // unknown path, or a board id that is not ours — is a 404.
    const isHome = location.pathname === routes.home;
    if (!isHome && !routed?.archivedAt) return;
    // A dead `?card=` on an archived board is not a silent redirect: explain
    // that the card could not be opened before replacing the dead URL.
    if (routed?.archivedAt && cardParam && !hasCard(routed, cardParam)) {
      toast.error(t("card.notFound"));
    }
    const firstActive = state.find((b) => !b.archivedAt);
    const target = firstActive ? routes.board(firstActive.id) : routes.home;
    if (location.pathname !== target) {
      navigate(target, { replace: true });
    }
  }, [
    routeBoardId,
    state,
    location.pathname,
    navigate,
    cardParam,
    syncStatus,
    homeRedirectPaused,
    toast,
    t,
  ]);

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

  // Staged edits that live only in an editor so far (the card dialog's
  // description draft): flushed into the store before anything that would
  // lose them — the tab hiding or unloading, logout (U-3).
  const draftFlushersRef = useRef(new Set<() => void>());
  const registerDraftFlush = useCallback((flush: () => void) => {
    const flushers = draftFlushersRef.current;
    flushers.add(flush);
    return () => {
      flushers.delete(flush);
    };
  }, []);
  const flushDrafts = useCallback(() => {
    let ok = true;
    for (const flush of [...draftFlushersRef.current]) {
      try {
        flush();
      } catch {
        ok = false;
        /* one broken editor must not keep the others from saving */
      }
    }
    return ok;
  }, []);

  // Flush pending writes when the tab is hidden, closed or the provider
  // unmounts: staged drafts first, then the debounced local save (from the
  // ref — the state effect has not run for what the drafts just applied)
  // and the server queue's coalesced edits, which go out as `keepalive`
  // requests that survive the unload (U-3). A hidden tab is flushed too: on
  // mobile it is often the last event a page ever gets.
  useEffect(() => {
    const flush = () => {
      flushDrafts();
      if (!serverMode) persistenceRef.current?.queueSave(stateRef.current);
      persistenceRef.current?.flush();
      syncRef.current?.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      persistenceRef.current?.flush();
    };
  }, [flushDrafts, serverMode]);

  // Logout revokes the session: everything still queued must reach the
  // server before that, or `dispose()` drops it with the provider (U-3).
  useEffect(() => {
    if (!serverMode || registerBeforeLogout === undefined) return;
    return registerBeforeLogout(async () => {
      flushDrafts();
      await syncRef.current?.drain();
    });
  }, [serverMode, registerBeforeLogout, flushDrafts]);

  /**
   * Server hydration (TASK-29): list the boards, then load every aggregate
   * into the local model (server mode has no 10-board product limit — the
   * operator cap is enforced by the API; the multi-board UI, global search
   * and export keep working on the same shape). An account with zero boards
   * inherits the pre-server localStorage data through `POST /boards/import`
   * once, archived cards included; the local key is dropped afterwards so
   * the same data cannot be imported twice.
   */
  /**
   * Second hydration phase (U-9): the boards that are not on screen. They
   * merge into whatever the state is by then — the active board may have
   * been edited meanwhile, so it is never replaced — in the server's list
   * order. A failed aggregate is retried with a backoff rather than dropped:
   * a board silently missing from the switcher would look deleted.
   */
  // Bumped by every hydration: a background phase of an older one (a
  // re-hydration after accepting an invitation started meanwhile) must not
  // merge its outdated list into the newer state.
  const hydrationGenRef = useRef(0);
  const loadRemainingBoards = useCallback(
    async (ids: string[], order: string[], gen: number): Promise<void> => {
      const loaded = new Map<
        string,
        {
          board: Board;
          seq: number;
          summary: Awaited<ReturnType<typeof api.getBoardSummary>> | null;
        }
      >();
      try {
        let missing = ids;
        for (let attempt = 0; missing.length > 0 && attempt < 4; attempt += 1) {
          if (attempt > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, 1_000 * 2 ** (attempt - 1)),
            );
          }
          if (!aliveRef.current || hydrationGenRef.current !== gen) return;
          const results = await Promise.allSettled(
            missing.map((id) => fetchBoardForHydration(id)),
          );
          missing = missing.filter((id, index) => {
            const result = results[index];
            if (result.status !== "fulfilled") return true;
            loaded.set(id, result.value);
            return false;
          });
        }
        if (
          missing.length > 0 &&
          aliveRef.current &&
          hydrationGenRef.current === gen
        ) {
          toast.error(t("sync.loadFailed"));
        }
        if (
          !aliveRef.current ||
          hydrationGenRef.current !== gen ||
          loaded.size === 0
        ) {
          return;
        }
        const current = stateRef.current;
        const byId = new Map(current.map((board) => [board.id, board]));
        const merged: Board[] = [];
        const now = Date.now();
        for (const id of order) {
          const existing = byId.get(id);
          if (existing !== undefined) {
            merged.push(existing);
            byId.delete(id);
            continue;
          }
          const fresh = loaded.get(id);
          if (fresh === undefined) continue;
          merged.push(fresh.board);
          live.attribution.seed(fresh.board);
          seqsRef.current.set(
            id,
            Math.max(seqsRef.current.get(id) ?? 0, fresh.seq),
          );
          syncedAtRef.current.set(id, now);
        }
        // Boards created while the list was loading.
        for (const board of byId.values()) merged.push(board);
        apply({ type: "IMPORT_BOARDS", boards: merged });
        for (const [id, fresh] of loaded) {
          startReadModelHydration(id, fresh.summary);
        }
      } finally {
        // Pending rows must clear even when a board was dropped after the
        // retry budget; a newer hydration owns the counter otherwise.
        if (aliveRef.current && hydrationGenRef.current === gen) {
          setPendingBoardCount((count) => Math.max(0, count - ids.length));
        }
      }
    },
    [apply, fetchBoardForHydration, live, startReadModelHydration, t, toast],
  );

  const runHydration = useCallback(async (): Promise<void> => {
    const gen = ++hydrationGenRef.current;
    const beforeList = new Set(stateRef.current.map((board) => board.id));
    // A failed re-hydration must not leave the previous generation's pending
    // rows counting forever; this generation owns the counter from here.
    setPendingBoardCount(0);
    const summaries = await api.listBoards();
    const nextRoles: Record<string, BoardRole> = {};
    for (const summary of summaries) nextRoles[summary.id] = summary.role;

    // A refresh must not replace live optimistic state or its history with
    // a snapshot taken before an in-flight command. Keep already loaded
    // boards and fetch only newly discovered ones.
    if (beforeList.size > 0) {
      if (!aliveRef.current || hydrationGenRef.current !== gen) return;
      const ids = summaries.map((summary) => summary.id);
      const known = new Set(ids);
      const current = stateRef.current;
      const byId = new Map(current.map((board) => [board.id, board]));
      const retained = ids.flatMap((id) => {
        const board = byId.get(id);
        return board ? [board] : [];
      });
      for (const board of current) {
        if (!known.has(board.id) && !beforeList.has(board.id))
          retained.push(board);
        else if (!known.has(board.id)) {
          dropHistory(board.id);
          seqsRef.current.delete(board.id);
          syncedAtRef.current.delete(board.id);
        }
      }
      const loaded = new Set(retained.map((board) => board.id));
      const missing = ids.filter((id) => !loaded.has(id));
      setRoles(nextRoles);
      setPendingBoardCount(missing.length);
      apply({ type: "IMPORT_BOARDS", boards: retained });
      if (missing.length > 0) void loadRemainingBoards(missing, ids, gen);
      return;
    }

    let boards: Board[] = [];
    const nextSeqs = new Map<string, number>();
    let rest: string[] = [];
    let firstSummary: Awaited<ReturnType<typeof api.getBoardSummary>> | null =
      null;
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
      // The board on screen first (U-9): the routed one, or the one the home
      // route will redirect to. The shell renders as soon as it is in; every
      // other aggregate follows in the background.
      const routed = routeBoardIdRef.current;
      const first =
        summaries.find((summary) => summary.id === routed) ??
        summaries.find((summary) => !summary.archivedAt) ??
        summaries[0];
      const snapshot = await fetchBoardForHydration(first.id);
      boards = [snapshot.board];
      firstSummary = snapshot.summary;
      nextSeqs.set(snapshot.board.id, snapshot.seq);
      rest = summaries
        .map((summary) => summary.id)
        .filter((id) => id !== first.id);
    }

    if (!aliveRef.current || hydrationGenRef.current !== gen) return;
    const now = Date.now();
    const nextSynced = new Map<string, number>();
    for (const board of boards) {
      live.attribution.seed(board);
      nextSynced.set(board.id, now);
    }
    setRoles(nextRoles);
    // The switcher shows pending rows until the background phase settles.
    setPendingBoardCount(rest.length);
    // The hydrated state is exactly what the aggregates showed: replacing
    // the seq map keeps the realtime resume point in sync with it.
    seqsRef.current = nextSeqs;
    syncedAtRef.current = nextSynced;
    // A fresh hydration replaces everything: history from a previous data
    // set would describe entities that no longer exist.
    clearHistory();
    apply({ type: "IMPORT_BOARDS", boards });
    if (boards.length > 0) {
      startReadModelHydration(boards[0].id, firstSummary);
    }
    if (rest.length > 0) {
      const order = summaries.map((summary) => summary.id);
      void loadRemainingBoards(rest, order, gen);
    }
  }, [
    apply,
    clearHistory,
    dropHistory,
    fetchBoardForHydration,
    live,
    loadRemainingBoards,
    startReadModelHydration,
  ]);

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

  /**
   * The caller's own role is not part of the board aggregate (`roleOf` comes
   * from `GET /boards`). A live role/expiry change would otherwise leave the
   * old permission UI in place — composers for a demoted VIEWER, a read-only
   * member list for a promoted ADMIN — until the next reload. Refresh only
   * the role map, never the board snapshots: an in-progress optimistic edit
   * must survive the event.
   */
  const refreshRoles = useCallback(async (): Promise<void> => {
    try {
      const summaries = await api.listBoards();
      if (!aliveRef.current) return;
      const nextRoles: Record<string, BoardRole> = {};
      for (const summary of summaries) nextRoles[summary.id] = summary.role;
      setRoles(nextRoles);
    } catch {
      // Best-effort: a transient failure keeps the previous role and the
      // next focus/refetch cycle has another chance.
    }
  }, []);

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

  const exportBoards = useCallback(async (): Promise<BoardState> => {
    if (!flushDrafts()) throw new Error("An editor could not save its draft");
    if (!serverMode) return stateRef.current;
    const boardEpoch = boardMutationsRef.current.epoch;
    if (boardMutationsRef.current.pending > 0) {
      throw new Error("Board changes are still being saved");
    }
    const failures = sync.failureCount;
    await sync.drain();
    if (sync.failureCount !== failures) {
      throw new Error("A board change could not be saved");
    }
    const summaries = await api.listBoards();
    const ids = summaries.map((summary) => summary.id);
    if (ids.some((id) => sync.isBusy(id))) {
      throw new Error("Board changes are still being saved");
    }
    const epochs = new Map(
      ids.map((id) => [id, epochsRef.current.get(id) ?? 0]),
    );
    const snapshots = await Promise.all(
      ids.map((id) => api.getBoardSnapshot(id)),
    );
    const latestIds = new Set((await api.listBoards()).map(({ id }) => id));
    if (
      latestIds.size !== ids.length ||
      ids.some((id) => !latestIds.has(id)) ||
      boardMutationsRef.current.pending > 0 ||
      boardMutationsRef.current.epoch !== boardEpoch ||
      sync.failureCount !== failures ||
      snapshots.some(
        ({ board, seq }) =>
          sync.isBusy(board.id) ||
          (epochsRef.current.get(board.id) ?? 0) !== epochs.get(board.id) ||
          seq < (seqsRef.current.get(board.id) ?? 0),
      )
    ) {
      throw new Error("Boards changed while preparing the export");
    }
    return snapshots.map(({ board }) => board);
  }, [flushDrafts, serverMode, sync]);

  const exportBoard = useCallback(
    async (boardId: string): Promise<string> => {
      if (!flushDrafts()) throw new Error("An editor could not save its draft");
      if (!serverMode) {
        const target = stateRef.current.find((board) => board.id === boardId);
        if (!target) throw new Error("Board not found");
        return serializeExport([target]);
      }
      const boardEpoch = boardMutationsRef.current.epoch;
      const failures = sync.failureCount;
      // Wait for the queue instead of refusing an export started right after
      // an edit; the post-drain checks below still require a stable board.
      await sync.drain();
      if (boardMutationsRef.current.pending > 0) {
        throw new Error("Board changes are still being saved");
      }
      if (sync.failureCount !== failures) {
        throw new Error("A board change could not be saved");
      }
      if (sync.isBusy(boardId)) {
        throw new Error("Board changes are still being saved");
      }
      const seq = seqsRef.current.get(boardId) ?? 0;
      const raw = await api.exportBoard(boardId);
      if (
        boardMutationsRef.current.pending > 0 ||
        boardMutationsRef.current.epoch !== boardEpoch ||
        sync.failureCount !== failures ||
        sync.isBusy(boardId) ||
        (seqsRef.current.get(boardId) ?? 0) !== seq
      ) {
        throw new Error("Board changed while preparing the export");
      }
      return raw;
    },
    [flushDrafts, serverMode, sync],
  );

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
   * Snapshot refetch (TASK-29 fallback; the SSE stream is the live path in
   * TASK-30): pulls one board's aggregate — unless commands are in flight,
   * whose optimistic state must not be overwritten. Entities the server has
   * moved on from are marked foreign in the history first, so undo skips
   * them with a toast instead of clobbering another member's edit (§7.0).
   * The snapshot's seq becomes the stream baseline.
   *
   * U-2: everything is re-checked *after* the request — a command queued
   * while it was in flight (the epoch moved) or still in flight means the
   * snapshot may predate it and is discarded (`busy`); a snapshot older than
   * the events already applied (`stale`) would roll them back.
   */
  const runRefetch = useCallback(
    async (boardId: string): Promise<RefetchResult> => {
      if (!serverMode) return "skipped";
      if (sync.isBusy(boardId)) return "busy";
      const epoch = epochsRef.current.get(boardId) ?? 0;
      let snapshot: Awaited<ReturnType<typeof fetchBoardForHydration>>;
      try {
        snapshot = await fetchBoardForHydration(boardId);
      } catch {
        /* offline / server down — the next focus tries again */
        return "failed";
      }
      if (!aliveRef.current) return "skipped";
      if (
        sync.isBusy(boardId) ||
        (epochsRef.current.get(boardId) ?? 0) !== epoch
      ) {
        return "busy";
      }
      const local = stateRef.current.find((b) => b.id === boardId);
      if (local === undefined) return "skipped";
      const { board: fresh, seq } = snapshot;
      if (seq < (seqsRef.current.get(boardId) ?? 0)) return "stale";
      const foreignIds = changedEntityIds(local, fresh);
      if (foreignIds.length > 0) markForeign(boardId, foreignIds);
      seqsRef.current.set(boardId, seq);
      syncedAtRef.current.set(boardId, Date.now());
      live.attribution.seed(fresh);
      apply({ type: "RESTORE_BOARD", boardId, board: fresh });
      startReadModelHydration(boardId, snapshot.summary);
      return "applied";
    },
    [
      serverMode,
      sync,
      markForeign,
      apply,
      live,
      fetchBoardForHydration,
      startReadModelHydration,
    ],
  );

  /**
   * Single-flight per board (U-2): `focus` and `visibilitychange` fire
   * together on return to the tab and share one request. A caller that
   * needs a snapshot taken *after* its own moment (`fresh` — a rollback, a
   * realtime resync) waits for the running one and then starts one more.
   */
  const refetchSlotsRef = useRef(
    new Map<
      string,
      {
        running: Promise<RefetchResult>;
        trailing: Promise<RefetchResult> | null;
      }
    >(),
  );
  const refetchBoard = useCallback(
    (boardId: string, fresh = false): Promise<RefetchResult> => {
      const slots = refetchSlotsRef.current;
      const start = (): Promise<RefetchResult> => {
        const entry = {
          running: Promise.resolve<RefetchResult>("skipped"),
          trailing: null as Promise<RefetchResult> | null,
        };
        entry.running = runRefetch(boardId).finally(() => {
          if (slots.get(boardId) === entry) slots.delete(boardId);
        });
        slots.set(boardId, entry);
        return entry.running;
      };
      const slot = slots.get(boardId);
      if (slot === undefined) return start();
      if (!fresh) return slot.running;
      slot.trailing ??= slot.running.then(
        () => slots.get(boardId)?.running ?? start(),
      );
      return slot.trailing;
    },
    [runRefetch],
  );

  const refetchActiveBoard = useCallback(async (): Promise<void> => {
    const boardId = activeIdRef.current;
    if (!serverMode || boardId === undefined) return;
    await refetchBoard(boardId);
  }, [serverMode, refetchBoard]);

  // The partial banner's action: a summary refetch finds the missing page
  // ids and re-runs the page stream.
  const retryReadModel = useCallback(() => {
    void refetchActiveBoard();
  }, [refetchActiveBoard]);

  /**
   * Reconcile an uncertain command or a rollback that needs a snapshot
   * (U-4) once the board's queue is idle and the browser is online.
   */
  const drainRefetch = useCallback(
    (boardId: string): void => {
      const wanted = refetchWantedRef.current;
      if (!wanted.has(boardId) || sync.isBusy(boardId) || !navigator.onLine) {
        return;
      }
      wanted.delete(boardId);
      void refetchBoard(boardId, true).then((result) => {
        if (result !== "busy" && result !== "failed") return;
        wanted.add(boardId);
        // Commands that ran meanwhile may all be answered already.
        if (result === "busy" && !sync.isBusy(boardId)) {
          drainRefetchRef.current(boardId);
        }
      });
    },
    [sync, refetchBoard],
  );
  useEffect(() => {
    drainRefetchRef.current = drainRefetch;
  }, [drainRefetch]);
  const scheduleRefetch = useCallback(
    (boardId: string) => {
      refetchWantedRef.current.add(boardId);
      drainRefetch(boardId);
    },
    [drainRefetch],
  );

  /**
   * A foreign destructive command can leave summary link facts stale when the
   * source card's rows are not loaded: the reducer cannot know which targets
   * it pointed at. Schedule a snapshot instead of under-reporting forever;
   * the normal focus/refetch path then re-reads the pages too (TASK-200.9).
   */
  const invalidateForeignFacts = useCallback(
    (boardId: string, action: BoardAction) => {
      const board = stateRef.current.find((entry) => entry.id === boardId);
      if (board === undefined) return;
      const unknown = (cardId: string): boolean => {
        const card = board.cards[cardId];
        // Absent = a later page; present but summary = no link rows.
        if (card === undefined) return true;
        return (
          card.readModel !== undefined &&
          !card.readModel.detailLoaded &&
          card.readModel.linkCount > 0
        );
      };
      let stale = false;
      switch (action.type) {
        case "DELETE_CARD":
        case "ARCHIVE_CARD":
        case "UNARCHIVE_CARD":
          stale = unknown(action.cardId);
          break;
        case "DELETE_COLUMN":
        case "ARCHIVE_COLUMN_CARDS": {
          const column = board.columns.find(
            (entry) => entry.id === action.columnId,
          );
          stale = column === undefined || column.cardIds.some(unknown);
          break;
        }
        // A summary card has no checklist rows, so a foreign checklist
        // command often cannot apply its delta. Re-read rather than leave
        // the face's counters frozen (TASK-200.9 recheck).
        case "ADD_CHECKLIST":
        case "RENAME_CHECKLIST":
        case "DELETE_CHECKLIST":
        case "ADD_CHECKLIST_ITEM":
        case "SET_CHECKLIST_ITEM_DONE":
        case "RENAME_CHECKLIST_ITEM":
        case "DELETE_CHECKLIST_ITEM": {
          const card = board.cards[action.cardId];
          stale = card?.readModel !== undefined && !card.readModel.detailLoaded;
          break;
        }
      }
      if (stale) scheduleRefetch(boardId);
    },
    [scheduleRefetch],
  );

  /**
   * The account's membership was revoked (TASK-36): the server sent the
   * `membership` frame on our stream, or the stream itself answered 403 on
   * reconnect. Forget the board right away — its roster, role and resume
   * point go with it — and let the routing effect move the user to another
   * board or the empty state. The reducer keeps the last board by design,
   * so a revoked *only* board is replaced explicitly.
   */
  const revokeBoard = useCallback(
    (
      boardId: string,
      reason: "access" | "deleted" | "left" = "access",
    ): boolean => {
      // The SSE frame and the DELETE response race. Whichever lands second
      // must be a no-op instead of a duplicate toast/navigation.
      if (!stateRef.current.some((board) => board.id === boardId)) {
        return false;
      }
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
      if (reason === "left") {
        toast.success(t("board.members.leftToast"));
      } else {
        toast.error(
          t(reason === "deleted" ? "board.deleted" : "board.accessRevoked"),
        );
      }
      // If the caller was viewing the board that just vanished, move them to
      // another active board (or the empty state) instead of leaving them on
      // a dead URL — the 404 route is only for genuinely unknown ids.
      if (routeBoardIdRef.current === boardId) {
        const next = stateRef.current.find((board) => !board.archivedAt);
        navigate(next ? routes.board(next.id) : routes.home, { replace: true });
      }
      return true;
    },
    [apply, dropHistory, toast, t, navigate],
  );

  /**
   * Boards the caller is leaving right now. The SSE frame normally arrives
   * before the DELETE response is parsed; the reason tells that path to show
   * the success toast instead of "access revoked". Cleared when an
   * `accepted` frame proves the caller is a member again.
   */
  const leavingBoardsRef = useRef(new Set<string>());

  /**
   * `DELETE /boards/:id/members/me` (TASK-177.2): leave the board and drop
   * every local trace of it. The membership SSE does the same work when it
   * wins the race; `revokeBoard` is idempotent, so exactly one success toast
   * and one navigation happen.
   */
  const leaveBoard = useCallback(
    async (boardId: string): Promise<boolean> => {
      if (!serverMode) return false;
      leavingBoardsRef.current.add(boardId);
      try {
        await api.leaveBoard(boardId);
      } catch (error) {
        // The DELETE may have committed while its response was lost. Give the
        // already-published membership frame one turn to land, then treat a
        // board that is gone as a successful leave instead of toasting an
        // error after the success toast.
        if (error instanceof ApiError && error.offline) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        if (!stateRef.current.some((board) => board.id === boardId)) {
          leavingBoardsRef.current.delete(boardId);
          return true;
        }
        leavingBoardsRef.current.delete(boardId);
        const code = error instanceof ApiError ? error.code : undefined;
        toast.error(
          t(
            code === "last_admin"
              ? "board.members.errors.lastAdmin"
              : error instanceof ApiError && error.offline
                ? "board.members.errors.offline"
                : "board.members.errors.generic",
          ),
        );
        return false;
      }
      revokeBoard(boardId, "left");
      return true;
    },
    [revokeBoard, serverMode, t, toast],
  );

  /**
   * One membership change on the active board (TASK-36): a removed *caller*
   * drops the board; every other change — someone accepted an invitation,
   * a role or an expiry moved, someone else left — rewrites the member
   * directory, so open member lists and attribution names update live.
   */
  const onMembershipChange = useCallback(
    (boardId: string, userId: string, change: MembershipChange) => {
      if (
        (change === "removed" || change === "left") &&
        userId === userIdRef.current
      ) {
        // A voluntary leave is `left`; `removed` stays the admin-removal
        // wording. The client-side marker covers an older server that still
        // sends `removed` for a self-leave.
        revokeBoard(
          boardId,
          change === "left" || leavingBoardsRef.current.has(boardId)
            ? "left"
            : "access",
        );
        return;
      }
      // Re-added later in the same session: the next removal is an ordinary
      // revocation again, not a repeat of the old self-leave.
      if (change === "accepted" && userId === userIdRef.current) {
        leavingBoardsRef.current.delete(boardId);
      }
      // A role or expiry move of the caller changes what the UI may offer.
      if (change === "updated" && userId === userIdRef.current) {
        void refreshRoles();
      }
      void loadMembers(boardId);
    },
    [revokeBoard, loadMembers, refreshRoles],
  );

  const onAccessRevoked = useCallback(
    (boardId: string) => revokeBoard(boardId),
    [revokeBoard],
  );

  /**
   * The stream answered 404/410: re-read the board first (TASK-156). A
   * transient proxy 404 must not wipe a healthy local board; only a
   * confirmed absence drops it. When the re-read succeeds the board is
   * alive, so the bridge is re-attached (TASK-156 review): the fatal
   * answer already ended its stream loop, and nothing else re-watches
   * the same board id — presence and foreign commands would otherwise
   * stop until a board switch or reload. `watch` is a no-op while a
   * connection for the board is healthy, so a race with a reconnect
   * cannot double-subscribe.
   */
  const onBoardGone = useCallback(
    (boardId: string) => {
      // A fatal stream answer is an existence check, not a content refresh:
      // keep the legacy full read here so a board that only lost `/summary`
      // support is not mistaken for a deleted one, and so the 404 is final.
      void api
        .getBoardSnapshot(boardId)
        .then(() => refetchBoard(boardId, true))
        .then(() => {
          // The board was switched away from (or the provider unmounted)
          // while the snapshot was in flight: the watch effect owns the
          // new board; re-watching the old one would steal its stream.
          if (
            !aliveRef.current ||
            routeBoardIdRef.current !== boardId ||
            activeIdRef.current !== boardId
          ) {
            return;
          }
          realtimeRef.current?.watch(boardId);
        })
        .catch((error: unknown) => {
          if (
            error instanceof ApiError &&
            (error.status === 404 || error.status === 410)
          ) {
            revokeBoard(boardId, "deleted");
          }
        });
    },
    [refetchBoard, revokeBoard],
  );

  // The realtime bridge is created once and outlives many renders: it calls
  // these through a ref, so a language switch or a navigation is seen by
  // the next frame instead of the closure of the first render (U-5).
  const realtimeHandlersRef = useRef({
    onMembershipChange,
    onAccessRevoked,
    onBoardGone,
  });
  useEffect(() => {
    realtimeHandlersRef.current = {
      onMembershipChange,
      onAccessRevoked,
      onBoardGone,
    };
  }, [onMembershipChange, onAccessRevoked, onBoardGone]);

  useEffect(() => {
    if (!serverMode) return;
    const onFocus = () => {
      const boardId = activeIdRef.current;
      if (boardId !== undefined && refetchWantedRef.current.has(boardId)) {
        drainRefetch(boardId);
      } else {
        void refetchActiveBoard();
      }
    };
    const onOnline = () => {
      for (const boardId of refetchWantedRef.current) drainRefetch(boardId);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [serverMode, refetchActiveBoard, drainRefetch]);

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
        onForeignAction: invalidateForeignFacts,
        markForeign,
        applyPresence: (id, event) => live.presence.apply(id, event),
        flagForeign: (id, actorId, ids) => {
          // Only someone else's change earns the ring; another tab of mine
          // is the same author and the card face stays anonymous.
          if (actorId !== userIdRef.current) {
            live.attribution.stamp(id, actorId, ids, { highlight: true });
          }
        },
        isBusy: (id) => sync.isBusy(id),
        getUserId: () => userIdRef.current,
        isOwnCommand: (id, commandId) => sync.wasSent(id, commandId),
        refetch: (id) => refetchBoard(id, true),
        getSyncedAt: (id) => syncedAtRef.current.get(id),
        markSynced: (id) => syncedAtRef.current.set(id, Date.now()),
        onMembershipChange: (id, userId, change) =>
          realtimeHandlersRef.current.onMembershipChange(id, userId, change),
        onAccessRevoked: (id) =>
          realtimeHandlersRef.current.onAccessRevoked(id),
        onBoardGone: (id) => realtimeHandlersRef.current.onBoardGone(id),
        onActivity: (event) => {
          live.activity.publish(event);
          // A comment is a change of the card face as well: the commenter
          // becomes the card's last actor (the server records the same
          // thing in `Card.lastActorId`, so a reload seeds the identical
          // value). Someone else's comment earns the 2 s ring, exactly
          // like a foreign command; my own stays anonymous to me.
          if (
            event.kind === "comment_added" &&
            event.cardId !== undefined &&
            event.actorId !== undefined
          ) {
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
        onApproval: (_id, event) => live.agentControl.publishApproval(event),
        onAgent: (id, event) => live.agentControl.publishAgent(id, event),
        onRun: (_id, event) => live.agentControl.publishRun(event),
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
    invalidateForeignFacts,
    markForeign,
    sync,
    live,
    refetchBoard,
  ]);

  // Wrapper dispatch: apply the command, then record the undo step for the
  // board it targeted. Board-scoped actions get the active board id
  // injected when absent, and every command gets an idempotency key.
  // Board-level actions: create/delete/import are aggregate REST calls
  // (their public methods below) — rename/archive/unarchive are commands and
  // travel through here like any other. In server mode the command reaches
  // the API afterwards; a refusal rolls the optimistic state back and shows
  // a toast (TASK-29).
  const runDispatch = useCallback(
    (
      action: BoardAction,
      opts?: { silentFailure?: boolean },
      releasePreimageGate?: (ok: boolean) => void,
    ): void | Promise<boolean> => {
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
      // undo press that does nothing visible. Claim changes are deliberately
      // never undoable (TASK-177.4): `invert(CLAIM_CARD)` restores the holder
      // as the local user, not the agent/token identity that held the lease,
      // so an undo would steal the claim instead of restoring it.
      const undoable = scoped.type !== "CLAIM_CARD";
      const after = stateRef.current.find((b) => b.id === boardId);
      if (undoable && before !== undefined && after !== before) {
        recordStep(boardId, before, scoped);
      }
      if (!serverMode) return;
      bumpEpoch(boardId);
      const sent = sync.enqueue(boardId, scoped).then(async (outcome) => {
        // One coalesced send → one set of side effects (see the ref's note).
        if (handledOutcomesRef.current.has(outcome)) {
          drainRefetch(boardId);
          return outcome.ok;
        }
        handledOutcomesRef.current.add(outcome);
        if (outcome.ok) {
          mergeVersions(boardId, outcome.versions);
          // TASK-200.9: the lock-consistent DELETE_LABEL snapshot from the
          // command response replaces the optimistic (loaded-cards-only)
          // inverse assignments, so undo restores unloaded cards too. An
          // older server that lacks it cannot recover the pre-delete set
          // after the fact; it is a documented deploy-together requirement.
          if (
            scoped.type === "DELETE_LABEL" &&
            outcome.preimage !== undefined
          ) {
            amendLabelPreimage(
              boardId,
              String(scoped.commandId),
              outcome.preimage.labelAssignments,
            );
          }
          // The command is on the server now — the open card's history can
          // refetch without the one-behind the optimistic bump has.
          live.commits.publish(boardId, touchedIds);
          realtimeRef.current?.settled(boardId, outcome.seq);
          drainRefetch(boardId);
          return true;
        }
        let reverted = true;
        if (before !== undefined) {
          const rollback = rollbackStep(boardId, scoped);
          const current = stateRef.current.find((b) => b.id === boardId);
          if (rollback.kind === "reverted") {
            apply(rollback.undo);
          } else if (rollback.kind === "none" && current === after) {
            // Nothing was recorded (board-level command) and nothing has
            // touched the board since the optimistic apply: the pre-command
            // snapshot is exactly right.
            apply({ type: "RESTORE_BOARD", boardId, board: before });
          } else if (current !== before) {
            // U-4 — "dead" (newer commands sit on top of the step) or "none"
            // with later changes on the board: restoring `before` would erase
            // those, and leaving the optimistic state would keep a change the
            // server refused. Only the server knows the truth: re-read it as
            // soon as the queue is idle.
            reverted = false;
            if (outcome.uncertainCommandId === undefined)
              scheduleRefetch(boardId);
          }
        }
        if (outcome.uncertainCommandId !== undefined) {
          reconcileUncertainCommand(
            boardId,
            outcome.uncertainCommandId,
            reverted,
          );
        } else {
          // TASK-177.9: a caller with domain-specific copy suppresses the
          // generic sync toast so one failure never shows two messages.
          if (opts?.silentFailure !== true) showFailure(outcome.failure);
          realtimeRef.current?.settled(boardId);
          drainRefetch(boardId);
        }
        return false;
      });
      return releasePreimageGate === undefined
        ? sent
        : sent.then(
            (ok) => {
              releasePreimageGate(ok);
              return ok;
            },
            (error: unknown) => {
              releasePreimageGate(false);
              throw error;
            },
          );
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
      bumpEpoch,
      drainRefetch,
      scheduleRefetch,
      reconcileUncertainCommand,
      amendLabelPreimage,
    ],
  );

  /**
   * Public dispatch. Commands whose local inverse carries a full card (or
   * whose optimistic reducer needs one) first load the bounded detail
   * preimages from the read model. Local mode and full-aggregate boards have
   * every field already, so the check is a cheap no-op there.
   */
  const dispatch = useCallback(
    (
      action: BoardAction,
      opts?: { silentFailure?: boolean },
    ): void | Promise<boolean> => {
      const boardId =
        (action as { boardId?: string }).boardId ?? activeIdRef.current;
      if (!boardId) return;
      const fail = (error: unknown): false => {
        if (opts?.silentFailure !== true) {
          showFailure(
            error instanceof ApiError && error.offline
              ? { kind: "offline" }
              : {
                  kind: "rejected",
                  status: error instanceof ApiError ? error.status : 0,
                },
          );
        }
        return false;
      };
      const finish = async (next: BoardAction): Promise<boolean> => {
        const result = runDispatch(next, opts);
        return result === undefined ? true : result;
      };
      // Rolling-deploy fallback: an older server has no response preimage,
      // so snapshot the deprecated read just before sending. On a new server
      // the locked response snapshot overwrites this seed. The undo gate is
      // created *before* this read, so a Ctrl+Z during the preflight waits
      // for the label step instead of popping an unrelated older one.
      if (serverMode && action.type === "DELETE_LABEL") {
        const release = beginLabelPreimageGate(boardId);
        const commandId = createId();
        return api.getLabelAssignments(boardId, action.labelId).then(
          (assignments) => {
            const result = runDispatch(
              { ...action, commandId } as BoardAction,
              opts,
              release,
            );
            amendLabelPreimage(boardId, commandId, assignments);
            return result === undefined ? true : result;
          },
          () => {
            const result = runDispatch(action, opts, release);
            return result === undefined ? true : result;
          },
        );
      }
      const board = stateRef.current.find((entry) => entry.id === boardId);
      const needed = preimageCardIds(action, board).filter(
        (id) => !hasCardDetail(cardById(board?.cards, id)),
      );
      if (!serverMode || needed.length === 0) {
        // Local dispatch must stay synchronous: callers/tests rely on the
        // optimistic state being visible when the handler returns.
        return runDispatch(action, opts);
      }
      return loadCardDetails(boardId, needed)
        .then((ok) => (ok ? finish(action) : false))
        .catch(fail);
    },
    [
      serverMode,
      loadCardDetails,
      runDispatch,
      showFailure,
      amendLabelPreimage,
      beginLabelPreimageGate,
    ],
  );

  // The archive dialog may close while work is being sent. Keep the queue
  // with the board provider, hide its planned cards until the outcome is
  // known, and stop on the first failure so untouched cards reappear.
  const [archiveBatch, setArchiveBatch] = useState<ArchiveBatch | null>(null);
  const archiveBatchRunning = useRef(false);
  const startArchiveBatch = useCallback(
    (boardId: string, batch: BoardAction[]): boolean => {
      if (archiveBatchRunning.current || batch.length === 0) return false;
      const cardIds = batch.map(
        (action) => (action as { cardId?: string }).cardId,
      );
      if (cardIds.some((id) => id === undefined)) return false;
      // Restores are individual commands (one WIP check and one undo step
      // per card). Say so instead of implying a single bulk undo (QA-07).
      const restoring = batch.every(
        (action) => action.type === "UNARCHIVE_CARD",
      );
      archiveBatchRunning.current = true;
      setArchiveBatch({
        boardId,
        cardIds: cardIds as string[],
        done: 0,
        total: batch.length,
      });
      toast.info(t("archive.backgroundStarted"));
      void (async () => {
        let done = 0;
        let failed = false;
        try {
          for (const action of batch) {
            if (!aliveRef.current || (await dispatch(action)) === false) {
              failed = true;
              break;
            }
            done++;
            if (aliveRef.current)
              setArchiveBatch((current) =>
                current ? { ...current, done } : current,
              );
          }
        } catch {
          failed = true;
        } finally {
          archiveBatchRunning.current = false;
          if (aliveRef.current) {
            setArchiveBatch(null);
            if (failed)
              toast.error(
                t("archive.backgroundFailed", { count: batch.length - done }),
              );
            else if (restoring)
              toast.success(t("archive.backgroundRestored", { count: done }));
            else toast.success(t("archive.backgroundDone", { count: done }));
          }
        }
      })();
      return true;
    },
    [dispatch, t, toast],
  );

  const importBoards = useCallback(
    (boards: BoardState): void | Promise<boolean> => {
      if (serverMode) {
        // The server keeps the existing boards and adds the imported ones;
        // re-hydrating shows the whole set (import resets history, exactly
        // as it always did locally). Nothing local changed yet, so a failure
        // needs no rollback — it is a toast. `false` tells the caller not to
        // announce success on top of that refusal.
        return trackBoardMutation(() =>
          api.importBoards(toEnvelope(normalizeBoards(boards))),
        )
          .then(() => hydrateBoards())
          .then(() => true)
          .catch((error: unknown) => {
            // TASK-166: an operator cap is a limit, not a generic sync
            // failure — say how many boards are allowed.
            const limit =
              error instanceof ApiError && error.code === "limit_exceeded"
                ? (error.body as { limit?: unknown } | null)?.limit
                : undefined;
            toast.error(
              typeof limit === "number"
                ? t("limits.maxBoards", { limit })
                : t("data.importError"),
            );
            return false;
          });
      }
      // A new data set invalidates any previous history.
      clearHistory();
      apply({ type: "IMPORT_BOARDS", boards: normalizeBoards(boards) });
    },
    [
      apply,
      clearHistory,
      serverMode,
      hydrateBoards,
      toast,
      t,
      trackBoardMutation,
    ],
  );

  const addBoard = useCallback(
    (
      title: string,
      options?: AddBoardOptions,
      onTemplateContractError?: (error: unknown) => void,
    ): string | null | Promise<string | null> => {
      const resolved = title.trim();
      if (resolved.length === 0) return null;
      if (serverMode) {
        return trackBoardMutation(async () => {
          try {
            const created = await api.createBoard(resolved, options);
            if (!aliveRef.current) return null;
            apply({ type: "ADD_BOARD", board: created, remote: true });
            setRoles((prev) => ({ ...prev, [created.id]: "ADMIN" }));
            return created.id;
          } catch (error) {
            // New UI against an older server (or an unknown template ID):
            // keep the generic sync toast out of the way and let the picker
            // offer the empty-board fallback.
            if (
              onTemplateContractError &&
              options?.template !== undefined &&
              error instanceof ApiError &&
              error.status === 400
            ) {
              onTemplateContractError(error);
              return null;
            }
            // The starter board exists but its response was ambiguous. Open
            // that board instead of leaving the form to mint a second one.
            if (error instanceof ApiError) {
              const body = error.body as {
                code?: unknown;
                boardId?: unknown;
                details?: { boardId?: unknown } | null;
              } | null;
              const code = body?.code;
              const boardId = body?.details?.boardId ?? body?.boardId;
              if (
                (code === "starter_cleanup_failed" ||
                  code === "starter_read_failed" ||
                  code === "board_read_failed") &&
                typeof boardId === "string"
              ) {
                let existing: Board | null = null;
                for (
                  let attempt = 1;
                  attempt <= 3 && existing === null;
                  attempt += 1
                ) {
                  try {
                    existing = await api.getBoard(boardId);
                  } catch {
                    if (attempt === 3) break;
                    await new Promise((resolve) =>
                      setTimeout(resolve, 50 * attempt),
                    );
                  }
                }
                if (!aliveRef.current) return null;
                if (existing !== null) {
                  apply({ type: "ADD_BOARD", board: existing, remote: true });
                  setRoles((prev) => ({ ...prev, [existing!.id]: "ADMIN" }));
                  if (code === "starter_cleanup_failed") {
                    toast.error(t("board.starterIncomplete"));
                  } else if (
                    code === "board_read_failed" &&
                    options?.template === "starter"
                  ) {
                    toast.error(t("board.starterIncomplete"));
                  }
                  // A plain board_read_failed that recovered has nothing to
                  // report: the GET succeeded and the board is open.
                  return existing.id;
                }
                // The server created the board but the aggregate cannot be
                // read right now. Keep the known id in the list so the form
                // cannot invite a second create; a reload fills the content.
                apply({
                  type: "ADD_BOARD",
                  board: {
                    id: boardId,
                    title: resolved,
                    columns: [],
                    cards: {},
                    labels: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  },
                  remote: true,
                });
                setRoles((prev) => ({ ...prev, [boardId]: "ADMIN" }));
                toast.error(t("board.createIncomplete"));
                return boardId;
              }
            }
            const limit =
              error instanceof ApiError && error.code === "limit_exceeded"
                ? (error.body as { limit?: unknown } | null)?.limit
                : undefined;
            toast.error(
              typeof limit === "number"
                ? t("limits.maxBoards", { limit })
                : t("sync.rejected"),
            );
            return null;
          }
        });
      }
      if (stateRef.current.length >= LIMITS.boardsCount) {
        toast.error(t("limits.maxBoards", { limit: LIMITS.boardsCount }));
        return null;
      }
      const id = createId();
      const now = Date.now();
      let columns: Board["columns"] = [];
      let cards: Board["cards"] = {};
      let labels: Board["labels"] = [];
      if (options?.template === "starter") {
        const plan = boardStarterPlan(options.templateLocale ?? "en", createId);
        columns = plan.columns.map((column, index) => ({
          ...column,
          cardIds: index === 0 ? [plan.card.id] : [],
          createdAt: now,
        }));
        cards = {
          [plan.card.id]: {
            id: plan.card.id,
            title: plan.card.title,
            labelIds: [],
            checklists: [
              {
                id: plan.checklist.id,
                title: plan.checklist.title,
                items: plan.checklist.items.map((item) => ({
                  ...item,
                  done: false,
                })),
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        };
      } else if (options?.template !== undefined) {
        // The same shared plan the server turns into commands, so offline
        // examples have the same columns, labels, cards and checklists.
        const plan = boardTemplatePlan(
          options.template,
          options.templateLocale ?? "en",
          createId,
          now,
          options.templateDate,
          options.templateUtcOffsetMinutes ?? 0,
        );
        columns = plan.columns.map((column) => ({
          id: column.id,
          title: column.title,
          cardIds: column.cardIds,
          createdAt: now,
        }));
        labels = plan.labels;
        cards = Object.fromEntries(
          plan.cards.map((card) => [
            card.id,
            {
              id: card.id,
              title: card.title,
              ...(card.description ? { description: card.description } : {}),
              ...(card.dueDate ? { dueDate: card.dueDate } : {}),
              labelIds: card.labelIds,
              checklists: card.checklists.map((checklist) => ({
                id: checklist.id,
                title: checklist.title,
                items: checklist.items.map((item) => ({
                  id: item.id,
                  text: item.text,
                  done: false,
                })),
              })),
              createdAt: now,
              updatedAt: now,
            },
          ]),
        );
      }
      apply({
        type: "ADD_BOARD",
        board: {
          id,
          title: resolved,
          columns,
          cards,
          labels,
          createdAt: now,
          updatedAt: now,
        },
      });
      return id;
    },
    [apply, serverMode, toast, t, trackBoardMutation],
  );

  const removeBoard = useCallback(
    (boardId: string): void | Promise<void> => {
      if (serverMode) {
        return trackBoardMutation(() => api.deleteBoard(boardId))
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
    [apply, dropHistory, serverMode, toast, t, trackBoardMutation],
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
      loadCardDetail,
      loadCardDetails,
      retryReadModel,
      startArchiveBatch,
      roleOf,
      // `dispatch` is a stable callback that reads refs when *called*; here
      // it is only stored in closures, never invoked during render.
      // eslint-disable-next-line react-hooks/refs
      ...createBoardActions(dispatch, getActiveBoard),
      addBoard,
      removeBoard,
      leaveBoard,
      archiveBoard,
      unarchiveBoard,
      undo,
      redo,
      importBoards,
      exportBoards,
      exportBoard,
      refreshBoards: hydrateBoards,
      dismissDataIssue,
      registerDraftFlush,
      setHomeRedirectPaused,
    }),
    [
      dispatch,
      loadCardDetail,
      loadCardDetails,
      retryReadModel,
      startArchiveBatch,
      roleOf,
      getActiveBoard,
      addBoard,
      removeBoard,
      leaveBoard,
      archiveBoard,
      unarchiveBoard,
      undo,
      redo,
      importBoards,
      exportBoards,
      exportBoard,
      hydrateBoards,
      dismissDataIssue,
      registerDraftFlush,
      setHomeRedirectPaused,
    ],
  );

  const stateValue = useMemo<BoardStateValue>(
    () => ({
      board,
      archiveBatch,
      boards: state,
      pendingBoardCount,
      readModelPartial:
        board?.id !== undefined && readModelPartialBoards.has(board.id),
      dataIssue,
      syncStatus,
    }),
    [
      board,
      state,
      pendingBoardCount,
      readModelPartialBoards,
      dataIssue,
      syncStatus,
      archiveBatch,
    ],
  );

  const identity = useMemo<BoardIdentityValue>(
    () => ({
      id: board?.id,
      title: board?.title ?? "",
      archived: board?.archivedAt !== undefined,
    }),
    [board?.id, board?.title, board?.archivedAt],
  );

  // A narrow role slice: the header hides Undo/Redo for a VIEWER, and the
  // role changes only on membership events — not on every card edit.
  const activeBoardId = board?.id;
  const access = useMemo<BoardAccessValue>(
    () => ({
      role:
        activeBoardId === undefined
          ? undefined
          : (roles[activeBoardId] ?? (serverMode ? undefined : "ADMIN")),
    }),
    [activeBoardId, roles, serverMode],
  );

  return (
    <BoardLiveProvider live={live}>
      <BoardActionsContext.Provider value={actions}>
        <BoardHistoryContext.Provider value={history}>
          <BoardAccessContext.Provider value={access}>
            <BoardIdentityContext.Provider value={identity}>
              <BoardStateContext.Provider value={stateValue}>
                <BoardViewProvider>{children}</BoardViewProvider>
              </BoardStateContext.Provider>
            </BoardIdentityContext.Provider>
          </BoardAccessContext.Provider>
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
  dispatch: (
    action: BoardAction,
    opts?: { silentFailure?: boolean },
  ) => void | Promise<boolean>,
  getBoard: () => Board | undefined,
): Pick<
  BoardActionsValue,
  | "addColumn"
  | "renameBoard"
  | "renameColumn"
  | "deleteColumn"
  | "addCard"
  | "updateCard"
  | "updateCardAndWait"
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
  | "setCardTaskSpec"
  | "releaseCardClaim"
  | "addCardLink"
  | "removeCardLink"
  | "setCardCover"
  | "duplicateCard"
  | "duplicateColumn"
  | "moveCard"
  | "moveColumn"
  | "setColumnWipLimit"
  | "setColumnAccent"
  | "setBoardColumnStyle"
  | "setBoardWorkflow"
  | "sortColumn"
> {
  /** `n` fresh ids, for the activity events (or copies) a command produces. */
  const ids = (n: number): string[] =>
    Array.from({ length: n }, () => createId());

  return {
    addColumn: (title: string) => {
      const newColumnId = createId();
      dispatch({
        type: "ADD_COLUMN",
        newColumnId,
        title,
        at: Date.now(),
      });
      return newColumnId;
    },
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
    updateCardAndWait: async (
      cardId: string,
      patch: CardPatch,
      opts?: { quiet?: boolean },
    ) => {
      const result = dispatch(
        {
          type: "UPDATE_CARD",
          cardId,
          ...patch,
          quiet: opts?.quiet,
          activityIds: ids(2),
          at: Date.now(),
        },
        // The restore UI shows its own specific failure copy.
        { silentFailure: true },
      );
      // Local mode has no server round-trip: the reducer already applied it.
      return result === undefined ? true : await result;
    },
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
    setCardTaskSpec: (
      cardId: string,
      spec: { acceptanceCriteria?: string[]; definitionOfDone?: string[] },
    ) =>
      dispatch({
        type: "SET_CARD_TASK_SPEC",
        cardId,
        ...(spec.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: spec.acceptanceCriteria }
          : {}),
        ...(spec.definitionOfDone !== undefined
          ? { definitionOfDone: spec.definitionOfDone }
          : {}),
        activityIds: ids(1),
        at: Date.now(),
      }),
    releaseCardClaim: (cardId: string) =>
      dispatch({
        type: "CLAIM_CARD",
        cardId,
        claimedBy: null,
        leaseUntil: null,
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
    setColumnAccent: (columnId: string, accent?: CardCover) => {
      const current = getBoard()?.columns.find(
        (c) => c.id === columnId,
      )?.accent;
      const same =
        current === undefined
          ? accent === undefined
          : accent !== undefined &&
            current.type === accent.type &&
            current.value === accent.value;
      if (same) return;
      dispatch({
        type: "SET_COLUMN_ACCENT",
        columnId,
        accent,
        at: Date.now(),
      });
    },
    setBoardColumnStyle: (columnStyle?: ColumnAccentStyle) => {
      // Selecting the implicit default again is not an edit: avoid a
      // command/activity entry that reads signature -> signature.
      const current = getBoard()?.columnStyle ?? DEFAULT_COLUMN_ACCENT_STYLE;
      const next = columnStyle ?? DEFAULT_COLUMN_ACCENT_STYLE;
      if (current === next) return;
      dispatch({
        type: "SET_BOARD_COLUMN_STYLE",
        columnStyle,
        at: Date.now(),
      });
    },
    setBoardWorkflow: (workflow, boardId) => {
      const board = getBoard();
      if (board?.id !== boardId) return false;
      // Saving an unchanged config is not a step (and must not cost undo).
      if (
        JSON.stringify(workflow ?? null) ===
        JSON.stringify(board.workflow ?? null)
      ) {
        return;
      }
      return dispatch({
        type: "SET_BOARD_WORKFLOW",
        boardId,
        workflow,
        at: Date.now(),
      });
    },
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

/** The caller's role on the active board — a narrow header-only slice. */
export function useBoardAccess(): BoardAccessValue {
  return required(useContext(BoardAccessContext), "useBoardAccess");
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
    loadCardDetail: () => Promise.resolve(null),
    loadCardDetails: () => Promise.resolve(true),
    retryReadModel: noop,
    startArchiveBatch: () => false,
    roleOf: () => "VIEWER",
    addColumn: () => "",
    renameBoard: noop,
    renameColumn: noop,
    deleteColumn: noop,
    addCard: noop,
    updateCard: noop,
    updateCardAndWait: () => Promise.resolve(false),
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
    setCardTaskSpec: noop,
    releaseCardClaim: noop,
    addCardLink: noop,
    removeCardLink: noop,
    setCardCover: noop,
    duplicateCard: noop,
    duplicateColumn: noop,
    moveCard: noop,
    moveColumn: noop,
    setColumnWipLimit: noop,
    setColumnAccent: noop,
    setBoardColumnStyle: noop,
    setBoardWorkflow: noop,
    sortColumn: noop,
    addBoard: () => "",
    removeBoard: noop,
    leaveBoard: () => Promise.resolve(false),
    archiveBoard: noop,
    unarchiveBoard: noop,
    undo: noop,
    redo: noop,
    importBoards: noop,
    exportBoards: () => Promise.resolve([]),
    exportBoard: () => Promise.resolve(""),
    refreshBoards: () => Promise.resolve(),
    dismissDataIssue: noop,
    registerDraftFlush: () => noop,
    setHomeRedirectPaused: noop,
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
  const access = useMemo<BoardAccessValue>(() => ({ role: "VIEWER" }), []);
  const identity = useMemo<BoardIdentityValue>(
    () => ({
      id: board.id,
      title: board.title,
      archived: board.archivedAt !== undefined,
    }),
    [board.id, board.title, board.archivedAt],
  );
  const stateValue = useMemo<BoardStateValue>(
    () => ({
      board,
      archiveBatch: null,
      boards: [board],
      pendingBoardCount: 0,
      readModelPartial: false,
      dataIssue: null,
      syncStatus: "ready",
    }),
    [board],
  );

  return (
    <BoardLiveProvider live={live}>
      <BoardActionsContext.Provider value={actions}>
        <BoardHistoryContext.Provider value={history}>
          <BoardAccessContext.Provider value={access}>
            <BoardIdentityContext.Provider value={identity}>
              <BoardStateContext.Provider value={stateValue}>
                {children}
              </BoardStateContext.Provider>
            </BoardIdentityContext.Provider>
          </BoardAccessContext.Provider>
        </BoardHistoryContext.Provider>
      </BoardActionsContext.Provider>
    </BoardLiveProvider>
  );
}
