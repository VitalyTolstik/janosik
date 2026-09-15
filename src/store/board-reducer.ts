import type {
  Board,
  Card,
  CardActivityEvent,
  CardActivityType,
  CardCover,
  Checklist,
  ChecklistItem,
  Column,
  Label,
} from "@/types/kanban";
import { LIMITS, MAX_CARD_ACTIVITY } from "@/types/kanban";
import { COVER_COLORS, COVER_GRADIENTS } from "@/types/kanban";

export type { Board } from "@/types/kanban";
import { createSeedBoard } from "@/store/seed-data";

/** Insert a value at `index`, returning a new array (no in-place mutation). */
function insertAt<T>(array: T[], index: number, value: T): T[] {
  return [...array.slice(0, index), value, ...array.slice(index)];
}

/** Do two column lists hold the same cards in the same order? */
function sameCardOrder(before: Column[], after: Column[]): boolean {
  return after.every((col, i) => {
    const previous = before[i].cardIds;
    return (
      col.cardIds.length === previous.length &&
      col.cardIds.every((id, j) => id === previous[j])
    );
  });
}

/**
 * Clamp a text field to its `LIMITS` bound. The UI enforces the same limit
 * via `maxLength`; this is the second line of defense for callers that
 * bypass the inputs (imported JSON, console dispatches).
 */
function clampText(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

/**
 * Types whose rapid repeats (per-keystroke edits) collapse into the last
 * event instead of spamming the feed. `moved`/label events are discrete
 * user actions and always append.
 */
const COALESCED_ACTIVITY_TYPES: readonly CardActivityType[] = [
  "renamed",
  "description-changed",
];

/** Window (ms) inside which same-type repeats replace the previous event. */
const ACTIVITY_COALESCE_WINDOW_MS = 2000;

/**
 * What the reducer records, as opposed to what it computes.
 *
 * `withActivity: false` skips the card activity feed: the backend derives
 * card events from the command log and has no `activity` column, so its
 * call of this very reducer must not invent one (§7.4.1). The client keeps
 * the default `true` — it shows the event optimistically.
 */
export interface ReduceOptions {
  withActivity?: boolean;
}

/** Client defaults: the activity feed is on. */
const CLIENT_OPTIONS: ReduceOptions = {};

/** A single activity event's identity — both parts come from the action. */
interface ActivityStamp {
  at: number;
  id: string;
}

/**
 * Identity of the n-th activity event an action appends (append order).
 * Callers pass `activityIds`; the fallback keeps console dispatches and
 * tests deterministic instead of minting an id inside the reducer.
 */
function activityStamp(
  action: BoardScopedAction,
  index: number,
): ActivityStamp {
  return {
    at: action.at,
    id: action.activityIds?.[index] ?? `act-${action.at}-${index}`,
  };
}

/**
 * Return the card with `type` appended to its activity feed (new event at
 * the end, capped to `MAX_CARD_ACTIVITY`). Repeats of a coalesced type
 * within the window update the last event's timestamp instead of adding
 * a row — title/description edits fire per keystroke.
 */
function appendActivity(
  card: Card,
  type: CardActivityType,
  action: BoardScopedAction,
  index: number,
  options: ReduceOptions,
  detail?: string,
): Card {
  if (options.withActivity === false) return card;
  // An inverse command rewinds the feed instead of growing it. Idempotent
  // on purpose: a command that appends twice (a title *and* a description
  // change) rewinds to the same feed both times.
  if (action.cardActivity !== undefined) {
    if (action.cardActivity.length === 0) {
      const { activity: _dropped, ...rest } = card;
      return rest as Card;
    }
    return { ...card, activity: [...action.cardActivity] };
  }
  const stamp = activityStamp(action, index);
  const { at } = stamp;
  const previous = card.activity ?? [];
  const last = previous[previous.length - 1];
  if (
    last &&
    last.type === type &&
    COALESCED_ACTIVITY_TYPES.includes(type) &&
    at - last.at <= ACTIVITY_COALESCE_WINDOW_MS
  ) {
    return {
      ...card,
      activity: [...previous.slice(0, -1), { ...last, at }],
    };
  }
  const event: CardActivityEvent = { id: stamp.id, type, at, actorId: null };
  if (detail !== undefined) event.detail = detail;
  return {
    ...card,
    activity: [...previous, event].slice(-MAX_CARD_ACTIVITY),
  };
}

/**
 * A fresh card's first (and only mandatory) activity event, or `undefined`
 * when the caller keeps no feed (`withActivity: false`) — the field is then
 * left off the card entirely rather than set to an empty array.
 */
function createdActivity(
  stamp: ActivityStamp,
  options: ReduceOptions,
): CardActivityEvent[] | undefined {
  if (options.withActivity === false) return undefined;
  return [{ id: stamp.id, type: "created", at: stamp.at, actorId: null }];
}

/**
 * Pure board reducer — every action returns a new Board without mutating the
 * input, so it is trivially testable. Each action has its own handler; the
 * reducer is just the dispatch point.
 *
 * Multi-board: board-level actions carry an optional `boardId` that selects
 * which board in the `Board[]` state they apply to (defaults to the first
 * one). ADD_BOARD / REMOVE_BOARD / IMPORT_BOARDS operate on the array
 * itself. The URL (`/board/:boardId`) is the source of truth for which
 * board is active; the reducer stays URL-agnostic.
 */

export type BoardState = Board[];

/**
 * Routing plus the deterministic inputs every board-scoped command carries
 * (TASK-21.7a). The reducer reads no clock, generates no id and touches no
 * storage: everything it writes comes out of the action, so the same
 * command replays identically on the client, on the server and inside a
 * property test — and its inverse can be computed from the command alone.
 */
export interface BoardScopedAction {
  /** Id of the board the action applies to; omitted = first board. */
  boardId?: string;
  /** Command clock (ms): every timestamp the reducer writes comes from here. */
  at: number;
  /**
   * Client-generated idempotency key (§7.0). The reducer ignores it; redo
   * re-sends the original command with a fresh one (TASK-21.7d).
   */
  commandId?: string;
  /** Ids for the activity events this command appends, in append order. */
  activityIds?: string[];
  /**
   * Inverse-only override (TASK-21.7d): an undo command writes back the
   * exact `board.updatedAt` its `do` overwrote instead of stamping `at`,
   * so undo returns the board to the state it had, timestamps included.
   * Never set by the UI or by the server.
   */
  boardUpdatedAt?: number;
  /** Inverse-only override: same idea for the touched card's `updatedAt`. */
  cardUpdatedAt?: number;
  /**
   * Set by `invert()`: this command undoes another one (TASK-21.7d).
   *
   * Collection guards — `LIMITS` on cards/columns/labels/checklists and the
   * WIP limit — exist to stop *new* content from growing past what the app
   * can hold. An inverse adds nothing new: it puts back what was just taken
   * away, so it is never refused. A refused undo is the worst outcome
   * available — Ctrl+Z silently does nothing and the card the user deleted
   * by accident is gone for good; a column briefly over its limit is a
   * state the app already has (an import, or a limit lowered under the
   * current count) and shows honestly with a red counter until it is back
   * under. Text clamps still apply: they bound a field, not a collection.
   */
  inverse?: boolean;
  /**
   * Inverse-only: the activity feed of the card this command touches, as
   * it was before the command being undone. Undo takes its own tracks back
   * instead of logging a second, contradictory event — the feed of a card
   * whose rename was undone shows one rename, not two of them saying
   * opposite things. An empty array means the card had no feed at all.
   */
  cardActivity?: CardActivityEvent[];
}

export type BoardScoped<T extends object> = T & BoardScopedAction;

export interface AddColumnAction {
  type: "ADD_COLUMN";
  /** Id of the column this command creates (generated by the caller). */
  newColumnId: string;
  title: string;
}

export interface RenameColumnAction {
  type: "RENAME_COLUMN";
  columnId: string;
  title: string;
}

export interface DeleteColumnAction {
  type: "DELETE_COLUMN";
  columnId: string;
}

export interface RenameBoardAction {
  type: "RENAME_BOARD";
  title: string;
}

export interface AddCardAction {
  type: "ADD_CARD";
  /** Id of the card this command creates (generated by the caller). */
  newCardId: string;
  columnId: string;
  title: string;
  /** Labels to attach to the new card right away (from the composer). */
  labelIds?: string[];
  /**
   * Insert position within the column (inline "add between cards").
   * Clamped to [0, count]; omitted appends to the end.
   */
  atIndex?: number;
}

export interface UpdateCardAction {
  type: "UPDATE_CARD";
  cardId: string;
  /** Partial patch — set only the fields that changed. */
  title?: string;
  description?: string;
  /**
   * Live-edit marker: per-keystroke edits from an open editor keep
   * `updatedAt` quiet. The debounced TOUCH_CARD that ends the editing
   * session stamps the final time.
   */
  quiet?: boolean;
}

/**
 * Commit the "last edited" timestamp (`at`) after a burst of quiet live
 * edits — one `updatedAt` per editing session, not one per keystroke.
 */
export interface TouchCardAction {
  type: "TOUCH_CARD";
  cardId: string;
}

export interface DeleteCardAction {
  type: "DELETE_CARD";
  cardId: string;
}

export interface ArchiveCardAction {
  type: "ARCHIVE_CARD";
  cardId: string;
  /**
   * Archive timestamp; defaults to `at`. Set explicitly when the command
   * is the inverse of an unarchive — the card goes back to the archive it
   * came from, with the date it had.
   */
  archivedAt?: number;
}

export interface UnarchiveCardAction {
  type: "UNARCHIVE_CARD";
  cardId: string;
  /** Target column; defaults to the first column of the board. */
  columnId?: string;
  /**
   * Insert position in the target column; omitted appends. Undo of an
   * archive puts the card back where it was, not at the bottom (§3.2).
   */
  index?: number;
}

export interface ArchiveColumnCardsAction {
  type: "ARCHIVE_COLUMN_CARDS";
  columnId: string;
}

export interface RestoreBoardAction {
  type: "RESTORE_BOARD";
  /** Full board snapshot to restore (undo/redo). */
  board: Board;
  /** Which board to restore (defaults to the first board). */
  boardId?: string;
}

export interface ImportBoardsAction {
  type: "IMPORT_BOARDS";
  boards: BoardState;
}

/**
 * Attach/detach a label — absolute, not a toggle: two clients toggling the
 * same label would race each other into the opposite result, and a relative
 * command cannot be inverted without knowing what it did (TASK-21.7b).
 */
export interface SetCardLabelAction {
  type: "SET_CARD_LABEL";
  cardId: string;
  labelId: string;
  /** Target state: `true` attaches the label, `false` detaches it. */
  on: boolean;
  /** Insert position in `labelIds` when attaching; omitted appends. */
  index?: number;
}

export interface AddLabelAction {
  type: "ADD_LABEL";
  /** Full label (id generated by the caller — needed to toggle it right after). */
  label: Label;
}

export interface RenameLabelAction {
  type: "RENAME_LABEL";
  labelId: string;
  name: string;
}

export interface SetLabelColorAction {
  type: "SET_LABEL_COLOR";
  labelId: string;
  color: Label["color"];
}

export interface DeleteLabelAction {
  type: "DELETE_LABEL";
  labelId: string;
}

export interface AddChecklistAction {
  type: "ADD_CHECKLIST";
  cardId: string;
  /** Id of the checklist this command creates (generated by the caller). */
  newChecklistId: string;
  title: string;
}

export interface RenameChecklistAction {
  type: "RENAME_CHECKLIST";
  cardId: string;
  checklistId: string;
  title: string;
}

export interface DeleteChecklistAction {
  type: "DELETE_CHECKLIST";
  cardId: string;
  checklistId: string;
}

export interface AddChecklistItemAction {
  type: "ADD_CHECKLIST_ITEM";
  cardId: string;
  checklistId: string;
  /** Id of the item this command creates (generated by the caller). */
  newItemId: string;
  text: string;
}

/** Check/uncheck an item — absolute, for the same reason as labels. */
export interface SetChecklistItemDoneAction {
  type: "SET_CHECKLIST_ITEM_DONE";
  cardId: string;
  checklistId: string;
  itemId: string;
  done: boolean;
}

export interface RenameChecklistItemAction {
  type: "RENAME_CHECKLIST_ITEM";
  cardId: string;
  checklistId: string;
  itemId: string;
  text: string;
}

export interface DeleteChecklistItemAction {
  type: "DELETE_CHECKLIST_ITEM";
  cardId: string;
  checklistId: string;
  itemId: string;
}

export interface SetCardDueDateAction {
  type: "SET_CARD_DUE_DATE";
  cardId: string;
  /** Unix timestamp (ms), or `undefined` to clear the due date. */
  dueDate?: number;
}

export interface SetCardCoverAction {
  type: "SET_CARD_COVER";
  cardId: string;
  /** New cover, or `undefined` to remove it. */
  cover?: CardCover;
}

export interface DuplicateCardAction {
  type: "DUPLICATE_CARD";
  cardId: string;
  /** Id of the copy (generated by the caller). */
  newCardId: string;
  /** Localized title for the copy ("Copy of …"); defaults to the source title. */
  title?: string;
}

export interface DuplicateColumnAction {
  type: "DUPLICATE_COLUMN";
  columnId: string;
  /** Id of the column copy (generated by the caller). */
  newColumnId: string;
  /**
   * Ids for the card copies, positionally matching the source column's
   * `cardIds`. A source card without an id here is not copied.
   */
  newCardIds: string[];
  /** Localized title for the copy ("Copy of …"); defaults to the source title. */
  title?: string;
}

export interface MoveCardAction {
  type: "MOVE_CARD";
  cardId: string;
  fromColumnId: string;
  /**
   * Position the card is leaving (0-based). The reducer removes the card
   * by id — this is recorded so the inverse move is derivable from the
   * command alone, without the board it applied to (TASK-21.7b).
   */
  fromIndex: number;
  toColumnId: string;
  /** Insert position in the destination column (0-based). */
  toIndex: number;
}

export interface MoveColumnAction {
  type: "MOVE_COLUMN";
  columnId: string;
  /** Current index of the column (0-based). */
  fromIndex: number;
  /** Target index with arrayMove semantics (0-based). */
  toIndex: number;
}

/** Available card-sort criteria for a column. */
export const COLUMN_SORT_OPTIONS = ["createdAt", "dueDate", "title"] as const;
export type ColumnSortBy = (typeof COLUMN_SORT_OPTIONS)[number];

/** Sort a column's cards by a criterion (dragging restores manual order). */
export interface SortColumnAction {
  type: "SORT_COLUMN";
  columnId: string;
  sortBy: ColumnSortBy;
}

/**
 * Set a column's card order outright — the inverse of `SORT_COLUMN` (which
 * is destructive by nature) and of any other reordering. `cardIds` must be
 * a permutation of the column's current ids, or the command is ignored.
 */
export interface SetColumnCardOrderAction {
  type: "SET_COLUMN_CARD_ORDER";
  columnId: string;
  cardIds: string[];
}

/**
 * Put a deleted card back, with its content and its position (TASK-21.7c).
 * The inverse of `DELETE_CARD`; on the backend the same undo becomes
 * "clear `deletedAt`" once cards are soft-deleted (§7.3).
 */
export interface RestoreCardAction {
  type: "RESTORE_CARD";
  card: Card;
  /** Column to put it back into; omitted for an archived card (no column). */
  columnId?: string;
  /** Position inside that column; omitted appends. */
  index?: number;
}

/** Put a deleted column back with its cards, at its old position. */
export interface RestoreColumnAction {
  type: "RESTORE_COLUMN";
  column: Column;
  /** Position among the board's columns. */
  index: number;
  /** The cards the column held (they were deleted with it). */
  cards: Card[];
}

/** Put a deleted label back, with the cards it was attached to. */
export interface RestoreLabelAction {
  type: "RESTORE_LABEL";
  label: Label;
  /** Position in `board.labels`. */
  index: number;
  /** Where the label sat in each card's `labelIds`. */
  assignments?: { cardId: string; index: number }[];
}

/** Put a deleted checklist back on its card, at its old position. */
export interface RestoreChecklistAction {
  type: "RESTORE_CHECKLIST";
  cardId: string;
  checklist: Checklist;
  index: number;
}

/** Put a deleted checklist item back, at its old position. */
export interface RestoreChecklistItemAction {
  type: "RESTORE_CHECKLIST_ITEM";
  cardId: string;
  checklistId: string;
  item: ChecklistItem;
  index: number;
}

/**
 * Write `cards` back exactly as they are given and set the column's order
 * to `cardIds` — the inverse of `ARCHIVE_COLUMN_CARDS`, which empties a
 * column at once.
 *
 * Cards the column gained *since* keep their place at the end; cards listed
 * in `cards` but not in `cardIds` are taken out of the column (that is what
 * makes the command the exact inverse of itself, and therefore undoable in
 * its own right).
 */
export interface RestoreColumnCardsAction {
  type: "RESTORE_COLUMN_CARDS";
  columnId: string;
  /** The column's card order to write. */
  cardIds: string[];
  /** The cards as they were (archive timestamp and feed included). */
  cards: Card[];
}

/** Set (or clear) a column's WIP limit. */
export interface SetColumnWipLimitAction {
  type: "SET_COLUMN_WIP_LIMIT";
  columnId: string;
  /** Max cards allowed, or `undefined` to remove the limit. */
  wipLimit?: number;
}

export interface AddBoardAction {
  type: "ADD_BOARD";
  /** Complete board object (id generated by the caller for navigation). */
  board: Board;
}

export interface RemoveBoardAction {
  type: "REMOVE_BOARD";
  boardId: string;
}

/** Archive a board (data kept, hidden from the normal switcher list). */
export interface ArchiveBoardAction {
  type: "ARCHIVE_BOARD";
  boardId: string;
  /** Command clock (ms) — the archive stamp and `updatedAt`. */
  at: number;
}

/** Bring an archived board back to the active list. */
export interface UnarchiveBoardAction {
  type: "UNARCHIVE_BOARD";
  boardId: string;
  /** Command clock (ms) — the new `updatedAt`. */
  at: number;
}

export type BoardAction =
  | BoardScoped<AddColumnAction>
  | BoardScoped<RenameColumnAction>
  | BoardScoped<DeleteColumnAction>
  | BoardScoped<RenameBoardAction>
  | BoardScoped<AddCardAction>
  | BoardScoped<UpdateCardAction>
  | BoardScoped<TouchCardAction>
  | BoardScoped<DeleteCardAction>
  | BoardScoped<ArchiveCardAction>
  | BoardScoped<UnarchiveCardAction>
  | BoardScoped<ArchiveColumnCardsAction>
  | BoardScoped<SetCardLabelAction>
  | BoardScoped<AddLabelAction>
  | BoardScoped<RenameLabelAction>
  | BoardScoped<SetLabelColorAction>
  | BoardScoped<DeleteLabelAction>
  | BoardScoped<AddChecklistAction>
  | BoardScoped<RenameChecklistAction>
  | BoardScoped<DeleteChecklistAction>
  | BoardScoped<AddChecklistItemAction>
  | BoardScoped<SetChecklistItemDoneAction>
  | BoardScoped<RenameChecklistItemAction>
  | BoardScoped<DeleteChecklistItemAction>
  | BoardScoped<SetCardDueDateAction>
  | BoardScoped<SetCardCoverAction>
  | BoardScoped<DuplicateCardAction>
  | BoardScoped<DuplicateColumnAction>
  | BoardScoped<MoveCardAction>
  | BoardScoped<MoveColumnAction>
  | BoardScoped<SortColumnAction>
  | BoardScoped<SetColumnCardOrderAction>
  | BoardScoped<SetColumnWipLimitAction>
  | BoardScoped<RestoreCardAction>
  | BoardScoped<RestoreColumnAction>
  | BoardScoped<RestoreLabelAction>
  | BoardScoped<RestoreChecklistAction>
  | BoardScoped<RestoreChecklistItemAction>
  | BoardScoped<RestoreColumnCardsAction>
  | RestoreBoardAction
  | ImportBoardsAction
  | AddBoardAction
  | RemoveBoardAction
  | ArchiveBoardAction
  | UnarchiveBoardAction;

/** Initial state: the seed board (used when localStorage is empty). */
export function initialBoardState(): BoardState {
  return [createSeedBoard()];
}

/**
 * The `board.updatedAt` a command writes — `at`, unless the command is an
 * inverse restoring the exact value its `do` overwrote (TASK-21.7d).
 */
function boardStamp(action: BoardScopedAction): number {
  return action.boardUpdatedAt ?? action.at;
}

/** Same for the `updatedAt` of the card a command touches. */
function cardStamp(action: BoardScopedAction): number {
  return action.cardUpdatedAt ?? action.at;
}

/**
 * Does this command have to obey the collection guards? An inverse does
 * not — see `BoardScopedAction.inverse`.
 */
function guarded(action: BoardScopedAction): boolean {
  return action.inverse !== true;
}

interface ColumnShape {
  id: string;
  title: string;
  cardIds: string[];
  createdAt: number;
}

function addColumn(board: Board, action: BoardScoped<AddColumnAction>): Board {
  if (board.columns.length >= LIMITS.columnsPerBoard) return board;
  if (board.columns.some((c) => c.id === action.newColumnId)) return board;
  const newColumn: ColumnShape = {
    id: action.newColumnId,
    title: clampText(action.title.trim(), LIMITS.columnTitle),
    cardIds: [],
    createdAt: action.at,
  };
  return { ...board, columns: [...board.columns, newColumn] };
}

function renameColumn(board: Board, action: RenameColumnAction): Board {
  const title = clampText(action.title.trim(), LIMITS.columnTitle);
  if (!title) return board;
  const column = board.columns.find((c) => c.id === action.columnId);
  // Renaming to the same title (or a missing column) is a no-op, so no undo
  // step is recorded and `updatedAt` is not bumped.
  if (!column || column.title === title) return board;
  return {
    ...board,
    columns: board.columns.map((col) =>
      col.id === action.columnId ? { ...col, title } : col,
    ),
  };
}

function deleteColumn(board: Board, action: DeleteColumnAction): Board {
  const column = board.columns.find((c) => c.id === action.columnId);
  if (!column) return board;
  const cards = { ...board.cards };
  for (const cardId of column.cardIds) delete cards[cardId];
  return {
    ...board,
    columns: board.columns.filter((c) => c.id !== action.columnId),
    cards,
  };
}

function renameBoard(board: Board, action: RenameBoardAction): Board {
  const title = clampText(action.title.trim(), LIMITS.boardTitle);
  if (!title || title === board.title) return board;
  return { ...board, title };
}

function addCard(
  board: Board,
  action: BoardScoped<AddCardAction>,
  options: ReduceOptions,
): Board {
  const column = board.columns.find((c) => c.id === action.columnId);
  if (!column) return board;
  if (board.cards[action.newCardId]) return board;
  if (column.cardIds.length >= LIMITS.cardsPerColumn) return board;
  if (atWipLimit(column, true)) return board;
  const at = action.at;
  const newCard: Card = {
    id: action.newCardId,
    title: clampText(action.title.trim(), LIMITS.cardTitle),
    labelIds: action.labelIds ?? [],
    createdAt: at,
    updatedAt: at,
  };
  const activity = createdActivity(activityStamp(action, 0), options);
  if (activity) newCard.activity = activity;
  return {
    ...board,
    columns: board.columns.map((col) => {
      if (col.id !== action.columnId) return col;
      // Inline insert (hover zone between cards) vs plain append.
      if (action.atIndex === undefined) {
        return { ...col, cardIds: [...col.cardIds, newCard.id] };
      }
      const ids = [...col.cardIds];
      ids.splice(
        Math.max(0, Math.min(action.atIndex, ids.length)),
        0,
        newCard.id,
      );
      return { ...col, cardIds: ids };
    }),
    cards: { ...board.cards, [newCard.id]: newCard },
  };
}

function updateCard(
  board: Board,
  action: BoardScoped<UpdateCardAction>,
  options: ReduceOptions,
): Board {
  const target = board.cards[action.cardId];
  if (!target) return board;

  // Live editing: clamp length only — trimming here would eat the trailing
  // space of every keystroke while the user types.
  const title =
    action.title === undefined
      ? target.title
      : clampText(action.title, LIMITS.cardTitle);
  // Empty description means "no description" — drop the field entirely.
  const description =
    action.description === undefined
      ? target.description
      : clampText(action.description.trim(), LIMITS.description) || undefined;

  if (
    title === target.title &&
    (description ?? "") === (target.description ?? "")
  ) {
    return board;
  }
  let nextCard: Card = {
    ...target,
    title,
    description,
    updatedAt: action.quiet ? target.updatedAt : cardStamp(action),
  };
  if (title !== target.title) {
    nextCard = appendActivity(nextCard, "renamed", action, 0, options);
  }
  if ((description ?? "") !== (target.description ?? "")) {
    nextCard = appendActivity(
      nextCard,
      "description-changed",
      action,
      1,
      options,
    );
  }
  return {
    ...board,
    cards: {
      ...board.cards,
      [action.cardId]: nextCard,
    },
  };
}

function deleteCard(board: Board, action: DeleteCardAction): Board {
  if (!board.cards[action.cardId]) return board;
  const cards = { ...board.cards };
  delete cards[action.cardId];
  const columns = board.columns.map((col) => ({
    ...col,
    cardIds: col.cardIds.filter((id) => id !== action.cardId),
  }));
  return { ...board, columns, cards };
}

/** Take a card off the board without deleting it — TASK-18.1 archive. */
function archiveCard(
  board: Board,
  action: BoardScoped<ArchiveCardAction>,
  options: ReduceOptions,
): Board {
  const target = board.cards[action.cardId];
  if (!target || target.archivedAt !== undefined) return board;
  let nextCard: Card = {
    ...target,
    archivedAt: action.archivedAt ?? action.at,
    updatedAt: cardStamp(action),
  };
  nextCard = appendActivity(nextCard, "archived", action, 0, options);
  return {
    ...board,
    columns: board.columns.map((col) => ({
      ...col,
      cardIds: col.cardIds.filter((id) => id !== action.cardId),
    })),
    cards: { ...board.cards, [action.cardId]: nextCard },
  };
}

/**
 * Put an archived card back on the board, into `columnId` (defaults to the
 * first column) at `index` (appends when omitted). Respects the WIP limit —
 * a full column refuses the restore rather than silently breaking the cap.
 */
function unarchiveCard(
  board: Board,
  action: BoardScoped<UnarchiveCardAction>,
  options: ReduceOptions,
): Board {
  const target = board.cards[action.cardId];
  if (!target || target.archivedAt === undefined) return board;
  const column =
    board.columns.find((col) => col.id === action.columnId) ?? board.columns[0];
  if (!column) return board;
  if (guarded(action)) {
    if (column.cardIds.length >= LIMITS.cardsPerColumn) return board;
    if (atWipLimit(column, true)) return board;
  }
  const restoredCard: Card = {
    ...target,
    archivedAt: undefined,
    updatedAt: cardStamp(action),
  };
  // Exact-optional cleanup: `archivedAt: undefined` must not survive.
  delete restoredCard.archivedAt;
  const nextCard = appendActivity(
    restoredCard,
    "unarchived",
    action,
    0,
    options,
  );
  return {
    ...board,
    columns: board.columns.map((col) =>
      col.id === column.id
        ? {
            ...col,
            cardIds: insertAt(
              col.cardIds,
              clamp(action.index ?? col.cardIds.length, 0, col.cardIds.length),
              action.cardId,
            ),
          }
        : col,
    ),
    cards: { ...board.cards, [action.cardId]: nextCard },
  };
}

/** Archive every card of a column in one undoable step (clear "Done"). */
function archiveColumnCards(
  board: Board,
  action: BoardScoped<ArchiveColumnCardsAction>,
  options: ReduceOptions,
): Board {
  const column = board.columns.find((col) => col.id === action.columnId);
  if (!column || column.cardIds.length === 0) return board;
  const at = action.at;
  const cards = { ...board.cards };
  column.cardIds.forEach((cardId, index) => {
    const target = cards[cardId];
    if (!target || target.archivedAt !== undefined) return;
    let nextCard: Card = { ...target, archivedAt: at, updatedAt: at };
    nextCard = appendActivity(nextCard, "archived", action, index, options);
    cards[cardId] = nextCard;
  });
  return {
    ...board,
    columns: board.columns.map((col) =>
      col.id === action.columnId ? { ...col, cardIds: [] } : col,
    ),
    cards,
  };
}

/**
 * Duplicate a card in place: the copy lands right below the original with
 * all content (description, checklists, due date, cover, labels) but fresh
 * ids and timestamps. Deep-clones nested structures so the copies don't
 * share mutable state with the source.
 */
function duplicateCard(
  board: Board,
  action: BoardScoped<DuplicateCardAction>,
  options: ReduceOptions,
): Board {
  const source = board.cards[action.cardId];
  if (!source) return board;
  if (board.cards[action.newCardId]) return board;
  const columnIndex = board.columns.findIndex((col) =>
    col.cardIds.includes(source.id),
  );
  if (columnIndex === -1) return board;
  if (board.columns[columnIndex].cardIds.length >= LIMITS.cardsPerColumn) {
    return board;
  }
  if (atWipLimit(board.columns[columnIndex], true)) return board;
  const at = action.at;
  const copy: Card = {
    ...source,
    id: action.newCardId,
    title: action.title ?? source.title,
    // Deep-copy nested content so later edits never alias the original.
    description: source.description,
    checklists: source.checklists
      ? (structuredClone(source.checklists) as Checklist[])
      : undefined,
    dueDate: source.dueDate,
    cover: source.cover
      ? (structuredClone(source.cover) as CardCover)
      : undefined,
    labelIds: [...source.labelIds],
    // The copy is a new card — it starts its own history, not the source's.
    activity: createdActivity(activityStamp(action, 0), options),
    createdAt: at,
    updatedAt: at,
  };
  if (copy.activity === undefined) delete copy.activity;
  const columns = board.columns.map((col, index) =>
    index === columnIndex
      ? {
          ...col,
          cardIds: insertAt(
            col.cardIds,
            col.cardIds.indexOf(source.id) + 1,
            copy.id,
          ),
        }
      : col,
  );
  return {
    ...board,
    columns,
    cards: { ...board.cards, [copy.id]: copy },
  };
}

/**
 * Duplicate a column with every card in it. The copy is placed immediately
 * to the right of the original; all cards get fresh ids (their checklist
 * ids stay as-is — they are unique per card).
 */
function duplicateColumn(
  board: Board,
  action: BoardScoped<DuplicateColumnAction>,
  options: ReduceOptions,
): Board {
  if (board.columns.length >= LIMITS.columnsPerBoard) return board;
  if (board.columns.some((col) => col.id === action.newColumnId)) return board;
  const sourceIndex = board.columns.findIndex(
    (col) => col.id === action.columnId,
  );
  if (sourceIndex === -1) return board;
  const source = board.columns[sourceIndex];
  const at = action.at;
  const cardIds = action.newCardIds;
  const cards = { ...board.cards };
  source.cardIds.forEach((sourceId, index) => {
    const sourceCard = board.cards[sourceId];
    // A source card the caller did not mint an id for is not copied.
    if (!sourceCard || !cardIds[index]) return;
    const cardCopy: Card = {
      ...sourceCard,
      id: cardIds[index],
      checklists: sourceCard.checklists
        ? (structuredClone(sourceCard.checklists) as Checklist[])
        : undefined,
      dueDate: sourceCard.dueDate,
      cover: sourceCard.cover
        ? (structuredClone(sourceCard.cover) as CardCover)
        : undefined,
      labelIds: [...sourceCard.labelIds],
      activity: createdActivity(activityStamp(action, index), options),
      createdAt: at,
      updatedAt: at,
    };
    if (cardCopy.activity === undefined) delete cardCopy.activity;
    cards[cardIds[index]] = cardCopy;
  });
  const copy: Column = {
    id: action.newColumnId,
    title: action.title ?? source.title,
    cardIds: source.cardIds
      .map((sourceId, index) => (sourceId in board.cards ? cardIds[index] : ""))
      .filter((id): id is string => Boolean(id)),
    // Keep the source's WIP limit — the copy starts with the same count,
    // so dropping it would silently unlimit the copy.
    ...(source.wipLimit !== undefined ? { wipLimit: source.wipLimit } : {}),
    createdAt: at,
  };
  const columns = [
    ...board.columns.slice(0, sourceIndex + 1),
    copy,
    ...board.columns.slice(sourceIndex + 1),
  ];
  return { ...board, columns, cards };
}

function setCardLabel(
  board: Board,
  action: BoardScoped<SetCardLabelAction>,
  options: ReduceOptions,
): Board {
  const target = board.cards[action.cardId];
  if (!target) return board;
  // Ignore labels that no longer exist on the board.
  if (!board.labels.some((l) => l.id === action.labelId)) return board;
  const has = target.labelIds.includes(action.labelId);
  // Already in the requested state — nothing to do.
  if (has === action.on) return board;
  // Adding is capped; removing a label is always allowed.
  if (
    action.on &&
    guarded(action) &&
    target.labelIds.length >= LIMITS.labelsPerCard
  ) {
    return board;
  }
  const labelIds = action.on
    ? insertAt(
        target.labelIds,
        clamp(
          action.index ?? target.labelIds.length,
          0,
          target.labelIds.length,
        ),
        action.labelId,
      )
    : target.labelIds.filter((id) => id !== action.labelId);
  // Snapshot the label name at change time — the feed keeps showing it
  // even after the label is renamed or deleted.
  const labelName = board.labels.find((l) => l.id === action.labelId)?.name;
  const nextCard = appendActivity(
    { ...target, labelIds },
    action.on ? "label-added" : "label-removed",
    action,
    0,
    options,
    labelName,
  );
  return {
    ...board,
    cards: {
      ...board.cards,
      [action.cardId]: nextCard,
    },
  };
}

function addLabel(board: Board, action: AddLabelAction): Board {
  const { label } = action;
  // Guard against duplicate ids (e.g. double-submitted create).
  if (board.labels.some((l) => l.id === label.id)) return board;
  if (board.labels.length >= LIMITS.labelsPerBoard) return board;
  return {
    ...board,
    labels: [
      ...board.labels,
      {
        ...label,
        name: clampText(label.name.trim(), LIMITS.labelName) || label.name,
      },
    ],
  };
}

function renameLabel(board: Board, action: RenameLabelAction): Board {
  const label = board.labels.find((l) => l.id === action.labelId);
  if (!label) return board;
  const name = clampText(action.name.trim(), LIMITS.labelName) || label.name;
  // Same name (or empty input falling back to the current one) is a no-op.
  if (name === label.name) return board;
  return {
    ...board,
    labels: board.labels.map((l) =>
      l.id === action.labelId ? { ...l, name } : l,
    ),
  };
}

function setLabelColor(board: Board, action: SetLabelColorAction): Board {
  const label = board.labels.find((l) => l.id === action.labelId);
  // Re-picking the same color (or an unknown label) is a no-op.
  if (!label || label.color === action.color) return board;
  return {
    ...board,
    labels: board.labels.map((l) =>
      l.id === action.labelId ? { ...l, color: action.color } : l,
    ),
  };
}

function deleteLabel(board: Board, action: DeleteLabelAction): Board {
  if (!board.labels.some((l) => l.id === action.labelId)) return board;
  const cards: Record<string, Card> = {};
  for (const [id, card] of Object.entries(board.cards)) {
    cards[id] = card.labelIds.includes(action.labelId)
      ? { ...card, labelIds: card.labelIds.filter((x) => x !== action.labelId) }
      : card;
  }
  return {
    ...board,
    labels: board.labels.filter((l) => l.id !== action.labelId),
    cards,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Stamp the card's `updatedAt` after a burst of quiet live edits. */
function touchCard(board: Board, action: BoardScoped<TouchCardAction>): Board {
  const target = board.cards[action.cardId];
  if (!target) return board;
  const at = cardStamp(action);
  if (target.updatedAt === at) return board;
  return {
    ...board,
    cards: { ...board.cards, [action.cardId]: { ...target, updatedAt: at } },
  };
}

/**
 * Apply `fn` to a card's checklists and return a new board with the updated
 * card (and a bumped `updatedAt`); `null` when the card doesn't exist.
 * Callers turn a `null`/unchanged result into a reducer no-op.
 */
function patchChecklists(
  board: Board,
  action: BoardScoped<{ cardId: string }>,
  fn: (checklists: Checklist[]) => Checklist[] | null,
): Board | null {
  const cardId = action.cardId;
  const target = board.cards[cardId];
  if (!target) return null;
  const checklists = fn(target.checklists ?? []);
  if (checklists === null || checklists === (target.checklists ?? [])) {
    return null;
  }
  // An empty list means "no checklists" — drop the field entirely.
  const next = checklists.length > 0 ? checklists : undefined;
  return {
    ...board,
    cards: {
      ...board.cards,
      [cardId]: { ...target, checklists: next, updatedAt: cardStamp(action) },
    },
  };
}

/** Map over a checklist's items, or return `null` when it doesn't exist. */
function mapChecklistItems(
  checklists: Checklist[],
  checklistId: string,
  fn: (items: Checklist["items"]) => Checklist["items"] | null,
): Checklist[] | null {
  let changed = false;
  const next = checklists.map((checklist) => {
    if (checklist.id !== checklistId) return checklist;
    const items = fn(checklist.items);
    if (items === null || items === checklist.items) return checklist;
    changed = true;
    return { ...checklist, items };
  });
  return changed ? next : null;
}

function addChecklist(
  board: Board,
  action: BoardScoped<AddChecklistAction>,
): Board | null {
  const title = clampText(action.title.trim(), LIMITS.checklistTitle);
  if (!title) return null;
  return patchChecklists(board, action, (checklists) =>
    checklists.length >= LIMITS.checklistsPerCard ||
    checklists.some((c) => c.id === action.newChecklistId)
      ? null
      : [...checklists, { id: action.newChecklistId, title, items: [] }],
  );
}

function renameChecklist(
  board: Board,
  action: BoardScoped<RenameChecklistAction>,
): Board | null {
  const title = clampText(action.title.trim(), LIMITS.checklistTitle);
  return patchChecklists(board, action, (checklists) => {
    if (!title) return null;
    const next = checklists.map((checklist) =>
      checklist.id === action.checklistId ? { ...checklist, title } : checklist,
    );
    return next.some((c, i) => c !== checklists[i]) ? next : null;
  });
}

function deleteChecklist(
  board: Board,
  action: BoardScoped<DeleteChecklistAction>,
): Board | null {
  return patchChecklists(board, action, (checklists) =>
    checklists.some((c) => c.id === action.checklistId)
      ? checklists.filter((c) => c.id !== action.checklistId)
      : null,
  );
}

function addChecklistItem(
  board: Board,
  action: BoardScoped<AddChecklistItemAction>,
): Board | null {
  const text = clampText(action.text.trim(), LIMITS.checklistItem);
  if (!text) return null;
  return patchChecklists(board, action, (checklists) =>
    mapChecklistItems(checklists, action.checklistId, (items) =>
      items.length >= LIMITS.itemsPerChecklist ||
      items.some((item) => item.id === action.newItemId)
        ? null
        : [...items, { id: action.newItemId, text, done: false }],
    ),
  );
}

function setChecklistItemDone(
  board: Board,
  action: BoardScoped<SetChecklistItemDoneAction>,
): Board | null {
  return patchChecklists(board, action, (checklists) =>
    mapChecklistItems(checklists, action.checklistId, (items) => {
      const next = items.map((item) =>
        item.id === action.itemId && item.done !== action.done
          ? { ...item, done: action.done }
          : item,
      );
      return next.some((item, i) => item !== items[i]) ? next : null;
    }),
  );
}

function renameChecklistItem(
  board: Board,
  action: BoardScoped<RenameChecklistItemAction>,
): Board | null {
  const text = clampText(action.text.trim(), LIMITS.checklistItem);
  if (!text) return null;
  return patchChecklists(board, action, (checklists) =>
    mapChecklistItems(checklists, action.checklistId, (items) => {
      const next = items.map((item) =>
        item.id === action.itemId ? { ...item, text } : item,
      );
      return next.some((item, i) => item !== items[i]) ? next : null;
    }),
  );
}

function deleteChecklistItem(
  board: Board,
  action: BoardScoped<DeleteChecklistItemAction>,
): Board | null {
  return patchChecklists(board, action, (checklists) =>
    mapChecklistItems(checklists, action.checklistId, (items) =>
      items.some((item) => item.id === action.itemId)
        ? items.filter((item) => item.id !== action.itemId)
        : null,
    ),
  );
}

/** Set (or clear) a card's due date — `undefined` drops the field entirely. */
function setCardDueDate(
  board: Board,
  action: BoardScoped<SetCardDueDateAction>,
  options: ReduceOptions,
): Board {
  const target = board.cards[action.cardId];
  if (!target) return board;
  const dueDate =
    action.dueDate !== undefined && Number.isFinite(action.dueDate)
      ? action.dueDate
      : undefined;
  if (dueDate === target.dueDate) return board;
  let nextCard: Card = { ...target, updatedAt: cardStamp(action) };
  if (dueDate === undefined) {
    // Drop the field entirely (no `dueDate: undefined` key left behind).
    delete nextCard.dueDate;
    nextCard = appendActivity(nextCard, "due-date-removed", action, 0, options);
  } else {
    nextCard.dueDate = dueDate;
    nextCard = appendActivity(nextCard, "due-date-set", action, 0, options);
  }
  return {
    ...board,
    cards: {
      ...board.cards,
      [action.cardId]: nextCard,
    },
  };
}

/** A cover is valid when its type/value pair is one the app can render. */
function isValidCover(cover: unknown): cover is CardCover {
  if (typeof cover !== "object" || cover === null) return false;
  const c = cover as Partial<CardCover>;
  if (c.type === "color") {
    return (COVER_COLORS as readonly string[]).includes(c.value as string);
  }
  if (c.type === "gradient") {
    return (COVER_GRADIENTS as readonly string[]).includes(c.value as string);
  }
  return false;
}

/** Structural equality for covers (cheap, avoids a needless commit). */
function isSameCover(
  a: CardCover | undefined,
  b: CardCover | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.type === b.type && a.value === b.value;
}

/**
 * Set (or clear) a card's cover — `undefined` drops the field entirely.
 * A malformed `cover` (wrong type/value) is treated as removal so a
 * hand-edited import cannot poison the render.
 */
function setCardCover(
  board: Board,
  action: BoardScoped<SetCardCoverAction>,
): Board {
  const target = board.cards[action.cardId];
  if (!target) return board;
  const cover = isValidCover(action.cover) ? action.cover : undefined;
  if (isSameCover(cover, target.cover)) return board;
  const nextCard: Card = { ...target, updatedAt: cardStamp(action) };
  if (cover === undefined) {
    // Drop the field entirely (no `cover: undefined` key left behind).
    delete nextCard.cover;
  } else {
    nextCard.cover = cover;
  }
  return {
    ...board,
    cards: {
      ...board.cards,
      [action.cardId]: nextCard,
    },
  };
}

/** Move a card between (or within) columns, inserting at `toIndex`. */
function moveCard(
  board: Board,
  action: BoardScoped<MoveCardAction>,
  options: ReduceOptions,
): Board {
  if (!board.cards[action.cardId]) return board;
  const from = board.columns.find((c) => c.id === action.fromColumnId);
  const to = board.columns.find((c) => c.id === action.toColumnId);
  if (!from || !to) return board;

  // Moving to the position the card already occupies is a no-op.
  if (action.fromColumnId === action.toColumnId) {
    const currentIndex = from.cardIds.indexOf(action.cardId);
    if (currentIndex === action.toIndex) return board;
  }

  // A full (WIP-limited) destination refuses cards from other columns.
  if (
    action.fromColumnId !== action.toColumnId &&
    guarded(action) &&
    atWipLimit(to, true)
  ) {
    return board;
  }

  const columns = board.columns.map((col) => {
    if (col.id !== action.fromColumnId && col.id !== action.toColumnId) {
      return col;
    }
    // Remove from the source column first (no same-column moves).
    let next = col.cardIds.filter((id) => id !== action.cardId);
    if (col.id === action.toColumnId) {
      const at = clamp(action.toIndex, 0, next.length);
      next = [...next.slice(0, at), action.cardId, ...next.slice(at)];
    }
    return { ...col, cardIds: next };
  });

  // A drop that lands the card back where it was (an out-of-range index
  // clamped onto its own position) must not count as a change: it would
  // bump `updatedAt` and cost the user an undo step for nothing.
  if (sameCardOrder(board.columns, columns)) return board;

  // Cross-column moves land in the feed; same-column reorders don't
  // (they're pure layout, not progress).
  let cards = board.cards;
  if (action.fromColumnId !== action.toColumnId) {
    cards = {
      ...board.cards,
      [action.cardId]: appendActivity(
        board.cards[action.cardId],
        "moved",
        action,
        0,
        options,
        to.title,
      ),
    };
  }

  return { ...board, columns, cards };
}

/** Reorder columns with arrayMove semantics (like @dnd-kit's arrayMove). */
/**
 * Sort a column's cards by a criterion. `cardIds` is the manual order —
 * sorting rewrites it, and any later drag simply overwrites it again
 * (manual order always wins, no "sort mode" to remember).
 * Due-date sorts float undated cards to the bottom; title compares
 * case-insensitively.
 */
function sortColumn(board: Board, action: SortColumnAction): Board {
  const column = board.columns.find((c) => c.id === action.columnId);
  if (!column) return board;
  const sorted = [...column.cardIds].sort((aId, bId) => {
    const a = board.cards[aId];
    const b = board.cards[bId];
    if (!a || !b) return 0;
    switch (action.sortBy) {
      case "createdAt":
        return a.createdAt - b.createdAt;
      case "dueDate": {
        const ad = a.dueDate ?? Number.POSITIVE_INFINITY;
        const bd = b.dueDate ?? Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        // Same/no date — fall back to creation order for stability.
        return a.createdAt - b.createdAt;
      }
      case "title":
        return a.title.localeCompare(b.title, undefined, {
          sensitivity: "base",
        });
    }
  });
  if (sorted.every((id, i) => id === column.cardIds[i])) return board;
  return {
    ...board,
    columns: board.columns.map((c) =>
      c.id === column.id ? { ...c, cardIds: sorted } : c,
    ),
  };
}

/**
 * Rewrite a column's card order outright. Accepts only a permutation of
 * what the column already holds, so a hand-edited command (or a stale
 * inverse) cannot drop, duplicate or smuggle in a card.
 */
function setColumnCardOrder(
  board: Board,
  action: BoardScoped<SetColumnCardOrderAction>,
): Board {
  const column = board.columns.find((c) => c.id === action.columnId);
  if (!column) return board;
  const { cardIds } = action;
  if (cardIds.length !== column.cardIds.length) return board;
  if (new Set(cardIds).size !== cardIds.length) return board;
  const current = new Set(column.cardIds);
  if (!cardIds.every((id) => current.has(id))) return board;
  if (cardIds.every((id, i) => id === column.cardIds[i])) return board;
  return {
    ...board,
    columns: board.columns.map((c) =>
      c.id === column.id ? { ...c, cardIds: [...cardIds] } : c,
    ),
  };
}

/**
 * Put a card back exactly as it was, at its old position. The card object
 * travels in the command (the frontend has nowhere else to keep it), so no
 * data is invented here — `updatedAt`, `archivedAt` and the activity feed
 * come back untouched. A card with no `columnId` was archived when it was
 * deleted and belongs to no column.
 */
function restoreCard(
  board: Board,
  action: BoardScoped<RestoreCardAction>,
): Board {
  const { card } = action;
  if (board.cards[card.id]) return board;
  const column =
    action.columnId === undefined
      ? undefined
      : board.columns.find((c) => c.id === action.columnId);
  if (action.columnId !== undefined && !column) return board;
  if (column && guarded(action)) {
    if (column.cardIds.length >= LIMITS.cardsPerColumn) return board;
    if (atWipLimit(column, true)) return board;
  }
  return {
    ...board,
    columns: column
      ? board.columns.map((c) =>
          c.id === column.id
            ? {
                ...c,
                cardIds: insertAt(
                  c.cardIds,
                  clamp(action.index ?? c.cardIds.length, 0, c.cardIds.length),
                  card.id,
                ),
              }
            : c,
        )
      : board.columns,
    cards: { ...board.cards, [card.id]: card },
  };
}

/** Put a deleted column back at its index, with the cards it took down. */
function restoreColumn(
  board: Board,
  action: BoardScoped<RestoreColumnAction>,
): Board {
  const { column } = action;
  if (board.columns.some((c) => c.id === column.id)) return board;
  if (guarded(action) && board.columns.length >= LIMITS.columnsPerBoard) {
    return board;
  }
  const cards = { ...board.cards };
  for (const card of action.cards) cards[card.id] = card;
  return {
    ...board,
    columns: insertAt(
      board.columns,
      clamp(action.index, 0, board.columns.length),
      column,
    ),
    cards,
  };
}

/** Put a deleted label back at its index, re-attached where it was. */
function restoreLabel(
  board: Board,
  action: BoardScoped<RestoreLabelAction>,
): Board {
  const { label } = action;
  if (board.labels.some((l) => l.id === label.id)) return board;
  if (guarded(action) && board.labels.length >= LIMITS.labelsPerBoard) {
    return board;
  }
  const cards = { ...board.cards };
  for (const { cardId, index } of action.assignments ?? []) {
    const card = cards[cardId];
    if (!card || card.labelIds.includes(label.id)) continue;
    if (guarded(action) && card.labelIds.length >= LIMITS.labelsPerCard) {
      continue;
    }
    cards[cardId] = {
      ...card,
      labelIds: insertAt(
        card.labelIds,
        clamp(index, 0, card.labelIds.length),
        label.id,
      ),
    };
  }
  return {
    ...board,
    labels: insertAt(
      board.labels,
      clamp(action.index, 0, board.labels.length),
      label,
    ),
    cards,
  };
}

/** Put a deleted checklist back on its card, at its old position. */
function restoreChecklist(
  board: Board,
  action: BoardScoped<RestoreChecklistAction>,
): Board | null {
  return patchChecklists(board, action, (checklists) =>
    checklists.some((c) => c.id === action.checklist.id) ||
    (guarded(action) && checklists.length >= LIMITS.checklistsPerCard)
      ? null
      : insertAt(
          checklists,
          clamp(action.index, 0, checklists.length),
          action.checklist,
        ),
  );
}

/** Put a deleted checklist item back, at its old position. */
function restoreChecklistItem(
  board: Board,
  action: BoardScoped<RestoreChecklistItemAction>,
): Board | null {
  return patchChecklists(board, action, (checklists) =>
    mapChecklistItems(checklists, action.checklistId, (items) =>
      items.some((item) => item.id === action.item.id) ||
      (guarded(action) && items.length >= LIMITS.itemsPerChecklist)
        ? null
        : insertAt(items, clamp(action.index, 0, items.length), action.item),
    ),
  );
}

/**
 * Put a column's bulk-archived cards back, in their old order. Cards the
 * column gained in the meantime keep their place at the end — this is a
 * compensation for one command, not a snapshot of the whole column.
 *
 * The cards in the payload are authoritative: whatever `cardIds` does not
 * list is taken out of the column. So the command undoes itself — pass the
 * previous card objects and the previous order and the column is exactly
 * where it was.
 */
function restoreColumnCards(
  board: Board,
  action: BoardScoped<RestoreColumnCardsAction>,
): Board {
  const column = board.columns.find((c) => c.id === action.columnId);
  if (!column) return board;
  const cards = { ...board.cards };
  for (const card of action.cards) cards[card.id] = card;
  const written = new Set(action.cards.map((card) => card.id));
  const restored = action.cardIds.filter((id) => id in cards);
  // Kept: what the column gained meanwhile. Dropped: cards this command
  // rewrote but left out of the order (they go back to the archive).
  const extras = column.cardIds.filter(
    (id) => !restored.includes(id) && !written.has(id),
  );
  const cardIds = [...restored, ...extras];
  if (guarded(action) && cardIds.length > LIMITS.cardsPerColumn) return board;
  if (
    cardIds.length === column.cardIds.length &&
    cardIds.every((id, i) => id === column.cardIds[i]) &&
    action.cards.every((card) => board.cards[card.id] === card)
  ) {
    return board;
  }
  return {
    ...board,
    columns: board.columns.map((c) =>
      c.id === column.id ? { ...c, cardIds } : c,
    ),
    cards,
  };
}

/**
 * A column accepts a new card (add/duplicate/move in) only while it is
 * below its WIP limit. A column already over its limit (limit lowered
 * under the current count, undo, import) refuses everything new.
 */
function atWipLimit(column: Column, isMovingIn: boolean): boolean {
  if (column.wipLimit === undefined) return false;
  const count = column.cardIds.length + (isMovingIn ? 1 : 0);
  return count > column.wipLimit;
}

/**
 * Set (or clear) a column's WIP limit — `undefined` drops the field
 * entirely. The value is clamped to 1…LIMITS.wipLimitMax so hand-edited
 * imports/console dispatches cannot poison the UI.
 */
function setColumnWipLimit(
  board: Board,
  action: SetColumnWipLimitAction,
): Board {
  const column = board.columns.find((c) => c.id === action.columnId);
  if (!column) return board;
  const wipLimit =
    action.wipLimit !== undefined && Number.isFinite(action.wipLimit)
      ? clamp(Math.round(action.wipLimit), 1, LIMITS.wipLimitMax)
      : undefined;
  if (wipLimit === column.wipLimit) return board;
  const columns = board.columns.map((col) => {
    if (col.id !== action.columnId) return col;
    const next = { ...col };
    if (wipLimit === undefined) {
      // Drop the field entirely (no `wipLimit: undefined` key left behind).
      delete next.wipLimit;
    } else {
      next.wipLimit = wipLimit;
    }
    return next;
  });
  return { ...board, columns };
}

function moveColumn(
  board: Board,
  action: BoardScoped<MoveColumnAction>,
): Board {
  if (action.fromIndex === action.toIndex) return board;
  const columns = [...board.columns];
  if (columns[action.fromIndex]?.id !== action.columnId) return board;
  const [moved] = columns.splice(action.fromIndex, 1);
  const to = clamp(action.toIndex, 0, columns.length);
  columns.splice(to, 0, moved);
  // A clamped target can land the column back on its own index.
  if (columns.every((col, i) => col === board.columns[i])) return board;
  return { ...board, columns };
}

/**
 * Bump the updated board's `updatedAt` and write it back at its position
 * (board order in the array is stable — the active board is picked by the
 * router, not by position).
 */
function commit(
  state: BoardState,
  index: number,
  board: Board,
  action: BoardScopedAction,
): BoardState {
  return state.map((b, i) =>
    i === index ? { ...board, updatedAt: boardStamp(action) } : b,
  );
}

/**
 * Apply one command. `options` only changes what is *recorded* alongside
 * the result (the activity feed) — never the data itself, so the client and
 * the backend compute the same board from the same command (§7.4.1).
 */
export function boardReducer(
  state: BoardState,
  action: BoardAction,
  options: ReduceOptions = CLIENT_OPTIONS,
): BoardState {
  // Array-level actions do not target a single board.
  if (action.type === "ADD_BOARD") {
    if (state.length >= LIMITS.boardsCount) return state;
    return state.some((b) => b.id === action.board.id)
      ? state
      : [...state, action.board];
  }
  if (action.type === "REMOVE_BOARD") {
    // The last remaining board cannot be removed (the app always shows one).
    return state.length <= 1
      ? state
      : state.filter((b) => b.id !== action.boardId);
  }
  if (action.type === "ARCHIVE_BOARD") {
    // Archiving keeps every byte of the board — only the timestamp is set.
    // Like REMOVE_BOARD this is organizational (no per-board undo entry).
    return state.map((b) =>
      b.id === action.boardId && !b.archivedAt
        ? { ...b, archivedAt: action.at, updatedAt: action.at }
        : b,
    );
  }
  if (action.type === "UNARCHIVE_BOARD") {
    return state.map((b) => {
      if (b.id !== action.boardId || !b.archivedAt) return b;
      const { archivedAt: _archivedAt, ...rest } = b;
      return { ...rest, updatedAt: action.at };
    });
  }
  if (action.type === "IMPORT_BOARDS") {
    return action.boards;
  }

  const boardId = "boardId" in action ? action.boardId : undefined;
  const index = boardId ? state.findIndex((b) => b.id === boardId) : 0;
  const board = state[index];
  if (!board) return state;

  if (action.type === "RESTORE_BOARD") {
    // A whole-board snapshot (backup restore) — keep its timestamps
    // untouched. Undo no longer goes through here (TASK-21.7d), which is
    // also why this is the one board-scoped action without a command clock.
    return state.map((b, i) => (i === index ? action.board : b));
  }

  /** Commit a handler's result, or nothing when it changed nothing. */
  const committed = (next: Board | null): BoardState =>
    next === null || next === board
      ? state
      : commit(state, index, next, action);

  switch (action.type) {
    case "ADD_COLUMN":
      return committed(addColumn(board, action));
    case "RENAME_COLUMN":
      return committed(renameColumn(board, action));
    case "DELETE_COLUMN":
      return committed(deleteColumn(board, action));
    case "RENAME_BOARD":
      return committed(renameBoard(board, action));
    case "ADD_CARD":
      return committed(addCard(board, action, options));
    case "UPDATE_CARD":
      return committed(updateCard(board, action, options));
    case "TOUCH_CARD":
      return committed(touchCard(board, action));
    case "DELETE_CARD":
      return committed(deleteCard(board, action));
    case "ARCHIVE_CARD":
      return committed(archiveCard(board, action, options));
    case "UNARCHIVE_CARD":
      return committed(unarchiveCard(board, action, options));
    case "ARCHIVE_COLUMN_CARDS":
      return committed(archiveColumnCards(board, action, options));
    case "SET_CARD_LABEL":
      return committed(setCardLabel(board, action, options));
    case "ADD_LABEL":
      return committed(addLabel(board, action));
    case "RENAME_LABEL":
      return committed(renameLabel(board, action));
    case "SET_LABEL_COLOR":
      return committed(setLabelColor(board, action));
    case "DELETE_LABEL":
      return committed(deleteLabel(board, action));
    case "ADD_CHECKLIST":
      return committed(addChecklist(board, action));
    case "RENAME_CHECKLIST":
      return committed(renameChecklist(board, action));
    case "DELETE_CHECKLIST":
      return committed(deleteChecklist(board, action));
    case "ADD_CHECKLIST_ITEM":
      return committed(addChecklistItem(board, action));
    case "SET_CHECKLIST_ITEM_DONE":
      return committed(setChecklistItemDone(board, action));
    case "RENAME_CHECKLIST_ITEM":
      return committed(renameChecklistItem(board, action));
    case "DELETE_CHECKLIST_ITEM":
      return committed(deleteChecklistItem(board, action));
    case "SET_CARD_DUE_DATE":
      return committed(setCardDueDate(board, action, options));
    case "SET_CARD_COVER":
      return committed(setCardCover(board, action));
    case "DUPLICATE_CARD":
      return committed(duplicateCard(board, action, options));
    case "DUPLICATE_COLUMN":
      return committed(duplicateColumn(board, action, options));
    case "MOVE_CARD":
      return committed(moveCard(board, action, options));
    case "MOVE_COLUMN":
      return committed(moveColumn(board, action));
    case "SORT_COLUMN":
      return committed(sortColumn(board, action));
    case "SET_COLUMN_CARD_ORDER":
      return committed(setColumnCardOrder(board, action));
    case "SET_COLUMN_WIP_LIMIT":
      return committed(setColumnWipLimit(board, action));
    case "RESTORE_CARD":
      return committed(restoreCard(board, action));
    case "RESTORE_COLUMN":
      return committed(restoreColumn(board, action));
    case "RESTORE_LABEL":
      return committed(restoreLabel(board, action));
    case "RESTORE_CHECKLIST":
      return committed(restoreChecklist(board, action));
    case "RESTORE_CHECKLIST_ITEM":
      return committed(restoreChecklistItem(board, action));
    case "RESTORE_COLUMN_CARDS":
      return committed(restoreColumnCards(board, action));
    default:
      return state;
  }
}
