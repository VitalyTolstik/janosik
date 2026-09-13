import type {
  Board,
  Card,
  CardActivityEvent,
  CardActivityType,
  CardCover,
  Checklist,
  Column,
  Label,
} from "@/types/kanban";
import { LIMITS, MAX_CARD_ACTIVITY } from "@/types/kanban";
import { COVER_COLORS, COVER_GRADIENTS } from "@/types/kanban";

export type { Board } from "@/types/kanban";
import { createId } from "@/utils/id";
import { createSeedBoard } from "@/store/seed-data";

/** Insert a value at `index`, returning a new array (no in-place mutation). */
function insertAt<T>(array: T[], index: number, value: T): T[] {
  return [...array.slice(0, index), value, ...array.slice(index)];
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
 * Return the card with `type` appended to its activity feed (new event at
 * the end, capped to `MAX_CARD_ACTIVITY`). Repeats of a coalesced type
 * within the window update the last event's timestamp instead of adding
 * a row — title/description edits fire per keystroke.
 */
function appendActivity(
  card: Card,
  type: CardActivityType,
  detail?: string,
): Card {
  const at = Date.now();
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
  const event: CardActivityEvent = { id: createId(), type, at, actorId: null };
  if (detail !== undefined) event.detail = detail;
  return {
    ...card,
    activity: [...previous, event].slice(-MAX_CARD_ACTIVITY),
  };
}

/** A fresh card's first (and only mandatory) activity event. */
function createdActivity(at: number): CardActivityEvent[] {
  return [{ id: createId(), type: "created", at, actorId: null }];
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

/** Adds the routing target for board-level actions (defaults to the first board). */
export interface BoardScopedAction {
  /** Id of the board the action applies to; omitted = first board. */
  boardId?: string;
}

export type BoardScoped<T extends object> = T & BoardScopedAction;

export interface AddColumnAction {
  type: "ADD_COLUMN";
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

export interface TouchCardAction {
  type: "TOUCH_CARD";
  cardId: string;
  /**
   * Commit the "last edited" timestamp after a burst of quiet live
   * edits — one `updatedAt` per editing session, not one per keystroke.
   */
  at?: number;
}

export interface DeleteCardAction {
  type: "DELETE_CARD";
  cardId: string;
}

export interface ArchiveCardAction {
  type: "ARCHIVE_CARD";
  cardId: string;
}

export interface UnarchiveCardAction {
  type: "UNARCHIVE_CARD";
  cardId: string;
  /** Target column; defaults to the first column of the board. */
  columnId?: string;
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

export interface ToggleCardLabelAction {
  type: "TOGGLE_CARD_LABEL";
  cardId: string;
  labelId: string;
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
  text: string;
}

export interface ToggleChecklistItemAction {
  type: "TOGGLE_CHECKLIST_ITEM";
  cardId: string;
  checklistId: string;
  itemId: string;
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
  /** Localized title for the copy ("Copy of …"); defaults to the source title. */
  title?: string;
}

export interface DuplicateColumnAction {
  type: "DUPLICATE_COLUMN";
  columnId: string;
  /** Localized title for the copy ("Copy of …"); defaults to the source title. */
  title?: string;
}

export interface MoveCardAction {
  type: "MOVE_CARD";
  cardId: string;
  fromColumnId: string;
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
}

/** Bring an archived board back to the active list. */
export interface UnarchiveBoardAction {
  type: "UNARCHIVE_BOARD";
  boardId: string;
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
  | BoardScoped<ToggleCardLabelAction>
  | BoardScoped<AddLabelAction>
  | BoardScoped<RenameLabelAction>
  | BoardScoped<SetLabelColorAction>
  | BoardScoped<DeleteLabelAction>
  | BoardScoped<AddChecklistAction>
  | BoardScoped<RenameChecklistAction>
  | BoardScoped<DeleteChecklistAction>
  | BoardScoped<AddChecklistItemAction>
  | BoardScoped<ToggleChecklistItemAction>
  | BoardScoped<RenameChecklistItemAction>
  | BoardScoped<DeleteChecklistItemAction>
  | BoardScoped<SetCardDueDateAction>
  | BoardScoped<SetCardCoverAction>
  | BoardScoped<DuplicateCardAction>
  | BoardScoped<DuplicateColumnAction>
  | BoardScoped<MoveCardAction>
  | BoardScoped<MoveColumnAction>
  | BoardScoped<SortColumnAction>
  | BoardScoped<SetColumnWipLimitAction>
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

interface ColumnShape {
  id: string;
  title: string;
  cardIds: string[];
  createdAt: number;
}

function addColumn(board: Board, action: AddColumnAction): Board {
  if (board.columns.length >= LIMITS.columnsPerBoard) return board;
  const newColumn: ColumnShape = {
    id: createId(),
    title: clampText(action.title.trim(), LIMITS.columnTitle),
    cardIds: [],
    createdAt: Date.now(),
  };
  return { ...board, columns: [...board.columns, newColumn] };
}

function renameColumn(board: Board, action: RenameColumnAction): Board {
  const title = clampText(action.title.trim(), LIMITS.columnTitle);
  if (!title) return board;
  const columns = board.columns.map((col) =>
    col.id === action.columnId ? { ...col, title } : col,
  );
  return { ...board, columns };
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

function addCard(board: Board, action: AddCardAction): Board {
  const column = board.columns.find((c) => c.id === action.columnId);
  if (!column) return board;
  if (column.cardIds.length >= LIMITS.cardsPerColumn) return board;
  if (atWipLimit(column, true)) return board;
  const now = Date.now();
  const newCard: Card = {
    id: createId(),
    title: clampText(action.title.trim(), LIMITS.cardTitle),
    labelIds: action.labelIds ?? [],
    activity: createdActivity(now),
    createdAt: now,
    updatedAt: now,
  };
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

function updateCard(board: Board, action: UpdateCardAction): Board {
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
    updatedAt: action.quiet ? target.updatedAt : Date.now(),
  };
  if (title !== target.title) nextCard = appendActivity(nextCard, "renamed");
  if ((description ?? "") !== (target.description ?? "")) {
    nextCard = appendActivity(nextCard, "description-changed");
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
function archiveCard(board: Board, action: ArchiveCardAction): Board {
  const target = board.cards[action.cardId];
  if (!target || target.archivedAt !== undefined) return board;
  const now = Date.now();
  let nextCard: Card = { ...target, archivedAt: now, updatedAt: now };
  nextCard = appendActivity(nextCard, "archived");
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
 * Put an archived card back on the board, at the end of `columnId`
 * (defaults to the first column). Respects the WIP limit — a full column
 * refuses the restore rather than silently breaking the cap.
 */
function unarchiveCard(board: Board, action: UnarchiveCardAction): Board {
  const target = board.cards[action.cardId];
  if (!target || target.archivedAt === undefined) return board;
  const column =
    board.columns.find((col) => col.id === action.columnId) ?? board.columns[0];
  if (!column) return board;
  if (atWipLimit(column, true)) return board;
  const now = Date.now();
  const restoredCard: Card = {
    ...target,
    archivedAt: undefined,
    updatedAt: now,
  };
  // Exact-optional cleanup: `archivedAt: undefined` must not survive.
  delete restoredCard.archivedAt;
  const nextCard = appendActivity(restoredCard, "unarchived");
  return {
    ...board,
    columns: board.columns.map((col) =>
      col.id === column.id
        ? { ...col, cardIds: [...col.cardIds, action.cardId] }
        : col,
    ),
    cards: { ...board.cards, [action.cardId]: nextCard },
  };
}

/** Archive every card of a column in one undoable step (clear "Done"). */
function archiveColumnCards(
  board: Board,
  action: ArchiveColumnCardsAction,
): Board {
  const column = board.columns.find((col) => col.id === action.columnId);
  if (!column || column.cardIds.length === 0) return board;
  const now = Date.now();
  const cards = { ...board.cards };
  for (const cardId of column.cardIds) {
    const target = cards[cardId];
    if (!target || target.archivedAt !== undefined) continue;
    let nextCard: Card = { ...target, archivedAt: now, updatedAt: now };
    nextCard = appendActivity(nextCard, "archived");
    cards[cardId] = nextCard;
  }
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
function duplicateCard(board: Board, action: DuplicateCardAction): Board {
  const source = board.cards[action.cardId];
  if (!source) return board;
  const columnIndex = board.columns.findIndex((col) =>
    col.cardIds.includes(source.id),
  );
  if (columnIndex === -1) return board;
  if (board.columns[columnIndex].cardIds.length >= LIMITS.cardsPerColumn) {
    return board;
  }
  if (atWipLimit(board.columns[columnIndex], true)) return board;
  const now = Date.now();
  const copy: Card = {
    ...source,
    id: createId(),
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
    activity: createdActivity(now),
    createdAt: now,
    updatedAt: now,
  };
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
function duplicateColumn(board: Board, action: DuplicateColumnAction): Board {
  if (board.columns.length >= LIMITS.columnsPerBoard) return board;
  const sourceIndex = board.columns.findIndex(
    (col) => col.id === action.columnId,
  );
  if (sourceIndex === -1) return board;
  const source = board.columns[sourceIndex];
  const now = Date.now();
  const cardIds = source.cardIds.map(() => createId());
  const cards = { ...board.cards };
  source.cardIds.forEach((sourceId, index) => {
    const sourceCard = board.cards[sourceId];
    if (!sourceCard) return;
    cards[cardIds[index]] = {
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
      activity: createdActivity(now),
      createdAt: now,
      updatedAt: now,
    };
  });
  const copy: Column = {
    id: createId(),
    title: action.title ?? source.title,
    cardIds: cardIds.filter((_, index) => source.cardIds[index] in board.cards),
    // Keep the source's WIP limit — the copy starts with the same count,
    // so dropping it would silently unlimit the copy.
    ...(source.wipLimit !== undefined ? { wipLimit: source.wipLimit } : {}),
    createdAt: now,
  };
  const columns = [
    ...board.columns.slice(0, sourceIndex + 1),
    copy,
    ...board.columns.slice(sourceIndex + 1),
  ];
  return { ...board, columns, cards };
}

function toggleCardLabel(board: Board, action: ToggleCardLabelAction): Board {
  const target = board.cards[action.cardId];
  if (!target) return board;
  // Ignore toggles for labels that no longer exist on the board.
  if (!board.labels.some((l) => l.id === action.labelId)) return board;
  const has = target.labelIds.includes(action.labelId);
  // Adding is capped; removing a label is always allowed.
  if (!has && target.labelIds.length >= LIMITS.labelsPerCard) return board;
  const labelIds = has
    ? target.labelIds.filter((id) => id !== action.labelId)
    : [...target.labelIds, action.labelId];
  // No-op when the list wouldn't change.
  if (labelIds.length === target.labelIds.length) return board;
  // Snapshot the label name at toggle time — the feed keeps showing it
  // even after the label is renamed or deleted.
  const labelName = board.labels.find((l) => l.id === action.labelId)?.name;
  const nextCard = appendActivity(
    { ...target, labelIds },
    has ? "label-removed" : "label-added",
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
  const labels = board.labels.map((label) =>
    label.id === action.labelId
      ? {
          ...label,
          name: clampText(action.name.trim(), LIMITS.labelName) || label.name,
        }
      : label,
  );
  return { ...board, labels };
}

function setLabelColor(board: Board, action: SetLabelColorAction): Board {
  const labels = board.labels.map((label) =>
    label.id === action.labelId ? { ...label, color: action.color } : label,
  );
  return { ...board, labels };
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
function touchCard(board: Board, action: TouchCardAction): Board {
  const target = board.cards[action.cardId];
  if (!target) return board;
  const at = action.at ?? Date.now();
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
  cardId: string,
  fn: (checklists: Checklist[]) => Checklist[] | null,
): Board | null {
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
      [cardId]: { ...target, checklists: next, updatedAt: Date.now() },
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

function addChecklist(board: Board, action: AddChecklistAction): Board | null {
  const title = clampText(action.title.trim(), LIMITS.checklistTitle);
  if (!title) return null;
  return patchChecklists(board, action.cardId, (checklists) =>
    checklists.length >= LIMITS.checklistsPerCard
      ? null
      : [...checklists, { id: createId(), title, items: [] }],
  );
}

function renameChecklist(
  board: Board,
  action: RenameChecklistAction,
): Board | null {
  const title = clampText(action.title.trim(), LIMITS.checklistTitle);
  return patchChecklists(board, action.cardId, (checklists) => {
    if (!title) return null;
    const next = checklists.map((checklist) =>
      checklist.id === action.checklistId ? { ...checklist, title } : checklist,
    );
    return next.some((c, i) => c !== checklists[i]) ? next : null;
  });
}

function deleteChecklist(
  board: Board,
  action: DeleteChecklistAction,
): Board | null {
  return patchChecklists(board, action.cardId, (checklists) =>
    checklists.some((c) => c.id === action.checklistId)
      ? checklists.filter((c) => c.id !== action.checklistId)
      : null,
  );
}

function addChecklistItem(
  board: Board,
  action: AddChecklistItemAction,
): Board | null {
  const text = clampText(action.text.trim(), LIMITS.checklistItem);
  if (!text) return null;
  return patchChecklists(board, action.cardId, (checklists) =>
    mapChecklistItems(checklists, action.checklistId, (items) =>
      items.length >= LIMITS.itemsPerChecklist
        ? null
        : [...items, { id: createId(), text, done: false }],
    ),
  );
}

function toggleChecklistItem(
  board: Board,
  action: ToggleChecklistItemAction,
): Board | null {
  return patchChecklists(board, action.cardId, (checklists) =>
    mapChecklistItems(checklists, action.checklistId, (items) => {
      const next = items.map((item) =>
        item.id === action.itemId ? { ...item, done: !item.done } : item,
      );
      return next.some((item, i) => item !== items[i]) ? next : null;
    }),
  );
}

function renameChecklistItem(
  board: Board,
  action: RenameChecklistItemAction,
): Board | null {
  const text = clampText(action.text.trim(), LIMITS.checklistItem);
  if (!text) return null;
  return patchChecklists(board, action.cardId, (checklists) =>
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
  action: DeleteChecklistItemAction,
): Board | null {
  return patchChecklists(board, action.cardId, (checklists) =>
    mapChecklistItems(checklists, action.checklistId, (items) =>
      items.some((item) => item.id === action.itemId)
        ? items.filter((item) => item.id !== action.itemId)
        : null,
    ),
  );
}

/** Set (or clear) a card's due date — `undefined` drops the field entirely. */
function setCardDueDate(board: Board, action: SetCardDueDateAction): Board {
  const target = board.cards[action.cardId];
  if (!target) return board;
  const dueDate =
    action.dueDate !== undefined && Number.isFinite(action.dueDate)
      ? action.dueDate
      : undefined;
  if (dueDate === target.dueDate) return board;
  let nextCard: Card = { ...target, updatedAt: Date.now() };
  if (dueDate === undefined) {
    // Drop the field entirely (no `dueDate: undefined` key left behind).
    delete nextCard.dueDate;
    nextCard = appendActivity(nextCard, "due-date-removed");
  } else {
    nextCard.dueDate = dueDate;
    nextCard = appendActivity(nextCard, "due-date-set");
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
function setCardCover(board: Board, action: SetCardCoverAction): Board {
  const target = board.cards[action.cardId];
  if (!target) return board;
  const cover = isValidCover(action.cover) ? action.cover : undefined;
  if (isSameCover(cover, target.cover)) return board;
  const nextCard: Card = { ...target, updatedAt: Date.now() };
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
function moveCard(board: Board, action: MoveCardAction): Board {
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
  if (action.fromColumnId !== action.toColumnId && atWipLimit(to, true)) {
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

  // Cross-column moves land in the feed; same-column reorders don't
  // (they're pure layout, not progress).
  let cards = board.cards;
  if (action.fromColumnId !== action.toColumnId) {
    cards = {
      ...board.cards,
      [action.cardId]: appendActivity(
        board.cards[action.cardId],
        "moved",
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

function moveColumn(board: Board, action: MoveColumnAction): Board {
  if (action.fromIndex === action.toIndex) return board;
  const columns = [...board.columns];
  if (columns[action.fromIndex]?.id !== action.columnId) return board;
  const [moved] = columns.splice(action.fromIndex, 1);
  const to = clamp(action.toIndex, 0, columns.length);
  columns.splice(to, 0, moved);
  return { ...board, columns };
}

/**
 * Bump the updated board's `updatedAt` and write it back at its position
 * (board order in the array is stable — the active board is picked by the
 * router, not by position).
 */
function commit(state: BoardState, index: number, board: Board): BoardState {
  return state.map((b, i) =>
    i === index ? { ...board, updatedAt: Date.now() } : b,
  );
}

export function boardReducer(
  state: BoardState,
  action: BoardAction,
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
        ? { ...b, archivedAt: Date.now(), updatedAt: Date.now() }
        : b,
    );
  }
  if (action.type === "UNARCHIVE_BOARD") {
    return state.map((b) => {
      if (b.id !== action.boardId || !b.archivedAt) return b;
      const { archivedAt: _archivedAt, ...rest } = b;
      return { ...rest, updatedAt: Date.now() };
    });
  }
  if (action.type === "IMPORT_BOARDS") {
    return action.boards;
  }

  const boardId = "boardId" in action ? action.boardId : undefined;
  const index = boardId ? state.findIndex((b) => b.id === boardId) : 0;
  const board = state[index];
  if (!board) return state;

  switch (action.type) {
    case "ADD_COLUMN":
      return commit(state, index, addColumn(board, action));
    case "RENAME_COLUMN":
      return commit(state, index, renameColumn(board, action));
    case "DELETE_COLUMN":
      return commit(state, index, deleteColumn(board, action));
    case "RENAME_BOARD": {
      const next = renameBoard(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "ADD_CARD":
      return commit(state, index, addCard(board, action));
    case "UPDATE_CARD": {
      const next = updateCard(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "TOUCH_CARD": {
      const next = touchCard(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "DELETE_CARD":
      return commit(state, index, deleteCard(board, action));
    case "ARCHIVE_CARD": {
      const next = archiveCard(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "UNARCHIVE_CARD": {
      const next = unarchiveCard(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "ARCHIVE_COLUMN_CARDS": {
      const next = archiveColumnCards(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "TOGGLE_CARD_LABEL": {
      const next = toggleCardLabel(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "ADD_LABEL": {
      const next = addLabel(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "RENAME_LABEL": {
      const next = renameLabel(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "SET_LABEL_COLOR": {
      const next = setLabelColor(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "DELETE_LABEL": {
      const next = deleteLabel(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "ADD_CHECKLIST": {
      const next = addChecklist(board, action);
      return next ? commit(state, index, next) : state;
    }
    case "RENAME_CHECKLIST": {
      const next = renameChecklist(board, action);
      return next ? commit(state, index, next) : state;
    }
    case "DELETE_CHECKLIST": {
      const next = deleteChecklist(board, action);
      return next ? commit(state, index, next) : state;
    }
    case "ADD_CHECKLIST_ITEM": {
      const next = addChecklistItem(board, action);
      return next ? commit(state, index, next) : state;
    }
    case "TOGGLE_CHECKLIST_ITEM": {
      const next = toggleChecklistItem(board, action);
      return next ? commit(state, index, next) : state;
    }
    case "RENAME_CHECKLIST_ITEM": {
      const next = renameChecklistItem(board, action);
      return next ? commit(state, index, next) : state;
    }
    case "DELETE_CHECKLIST_ITEM": {
      const next = deleteChecklistItem(board, action);
      return next ? commit(state, index, next) : state;
    }
    case "SET_CARD_DUE_DATE": {
      const next = setCardDueDate(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "SET_CARD_COVER": {
      const next = setCardCover(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "DUPLICATE_CARD": {
      const next = duplicateCard(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "DUPLICATE_COLUMN": {
      const next = duplicateColumn(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "MOVE_CARD": {
      const next = moveCard(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "MOVE_COLUMN": {
      const next = moveColumn(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "SORT_COLUMN": {
      const next = sortColumn(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "SET_COLUMN_WIP_LIMIT": {
      const next = setColumnWipLimit(board, action);
      return next === board ? state : commit(state, index, next);
    }
    case "RESTORE_BOARD":
      // Undo/redo restores an exact snapshot — keep its timestamps untouched.
      return state.map((b, i) => (i === index ? action.board : b));
    default:
      return state;
  }
}
