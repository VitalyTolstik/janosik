import type { BoardAction } from "./board-reducer";
import { DEFAULT_CARD_PRIORITY } from "./board-reducer";
import type { Board, Card, CardActivityEvent } from "../types/kanban";
import { clamp } from "../utils/text";

/**
 * Inverse commands — the compensation half of undo (TASK-21.7d).
 *
 * Undo is not a rewind: instead of restoring a snapshot of the whole board
 * (which in a shared board erases everyone else's edits made in between),
 * every command gets an *inverse command* that undoes exactly what it did
 * and nothing else — selective undo, the way Figma and Linear do it.
 *
 * The inverse is computed at dispatch time, while the board the command
 * applied to (`before`) is still at hand: that is the only moment the
 * deleted card, the old title or the previous card order is still known.
 * From then on the history keeps two plain actions per step and not a
 * single `Board` object.
 *
 * Exactness: applying a command and then its inverse must return the board
 * to what it was, timestamps included. Since the reducer stamps everything
 * it writes from the command (TASK-21.7a), an inverse simply carries the
 * old values back — `boardUpdatedAt` / `cardUpdatedAt` for the bookkeeping
 * stamps, full `Card`/`Column`/`Label` payloads for the restores. The
 * activity feed is the one exception: it is an append-only audit log, so
 * undoing a rename appends "renamed" rather than erasing the entry (the
 * invariant is asserted with the feed off — the mode the backend uses).
 */

/**
 * The card's activity feed as it stands — an inverse rewinds the feed to
 * this instead of appending an event of its own (`cardActivity`).
 */
function feedOf(card: Card): CardActivityEvent[] {
  return card.activity ?? [];
}

/** Where a card sits on the board: its column and index, if any. */
function locate(
  board: Board,
  cardId: string,
): { columnId: string; index: number } | null {
  for (const column of board.columns) {
    const index = column.cardIds.indexOf(cardId);
    if (index !== -1) return { columnId: column.id, index };
  }
  return null;
}

/** The cards a column holds, in order (missing ids are skipped). */
function cardsOf(board: Board, cardIds: readonly string[]): Card[] {
  return cardIds
    .map((id) => board.cards[id])
    .filter((card): card is Card => card !== undefined);
}

/**
 * The command that undoes `action` when applied to the board `action`
 * produced — or `null` when the command has no inverse (whole-board
 * imports, board-level bookkeeping) and therefore no undo step.
 *
 * `before` is the board as it was *before* `action` was applied. Pass the
 * same board the reducer got, or the inverse describes the wrong state.
 */
export function invert(before: Board, action: BoardAction): BoardAction | null {
  const inverse = build(before, action);
  if (inverse === null) return null;
  return {
    ...inverse,
    // Undo is a return to a previous state, not a fresh edit: it restores
    // the board's own `updatedAt`, and the collection guards step aside for
    // it (`BoardScopedAction.inverse`) so an undo is never refused.
    boardUpdatedAt: before.updatedAt,
    inverse: true,
  } as BoardAction;
}

function build(before: Board, action: BoardAction): BoardAction | null {
  // Actions without a command clock (imports, board bookkeeping) have no
  // inverse anyway — they fall through to `null` below.
  const at = "at" in action ? action.at : before.updatedAt;
  const boardId = "boardId" in action ? action.boardId : undefined;
  /** Shared head of every inverse: same board, same clock as the command. */
  const head = { at, boardId };

  switch (action.type) {
    /* ---------------------------------------------------------------- columns */
    case "ADD_COLUMN":
      return { ...head, type: "DELETE_COLUMN", columnId: action.newColumnId };

    case "RENAME_COLUMN": {
      const column = before.columns.find((c) => c.id === action.columnId);
      if (!column) return null;
      return {
        ...head,
        type: "RENAME_COLUMN",
        columnId: column.id,
        title: column.title,
      };
    }

    case "DELETE_COLUMN": {
      const index = before.columns.findIndex((c) => c.id === action.columnId);
      if (index === -1) return null;
      const column = before.columns[index];
      return {
        ...head,
        type: "RESTORE_COLUMN",
        column,
        index,
        cards: cardsOf(before, column.cardIds),
      };
    }

    case "MOVE_COLUMN": {
      // The reducer clamps the target into the array, so the column ends up
      // at the clamped index — that is where the inverse picks it up.
      const landed = clamp(action.toIndex, 0, before.columns.length - 1);
      return {
        ...head,
        type: "MOVE_COLUMN",
        columnId: action.columnId,
        fromIndex: landed,
        toIndex: action.fromIndex,
      };
    }

    case "SORT_COLUMN":
    case "SET_COLUMN_CARD_ORDER": {
      const column = before.columns.find((c) => c.id === action.columnId);
      if (!column) return null;
      return {
        ...head,
        type: "SET_COLUMN_CARD_ORDER",
        columnId: column.id,
        cardIds: [...column.cardIds],
      };
    }

    case "SET_COLUMN_WIP_LIMIT": {
      const column = before.columns.find((c) => c.id === action.columnId);
      if (!column) return null;
      return {
        ...head,
        type: "SET_COLUMN_WIP_LIMIT",
        columnId: column.id,
        wipLimit: column.wipLimit,
      };
    }

    case "DUPLICATE_COLUMN":
      return { ...head, type: "DELETE_COLUMN", columnId: action.newColumnId };

    case "RESTORE_COLUMN":
      return { ...head, type: "DELETE_COLUMN", columnId: action.column.id };

    /* ------------------------------------------------------------------ board */
    case "RENAME_BOARD":
      return { ...head, type: "RENAME_BOARD", title: before.title };

    /* ------------------------------------------------------------------ cards */
    case "ADD_CARD":
      return { ...head, type: "DELETE_CARD", cardId: action.newCardId };

    case "DUPLICATE_CARD":
      return { ...head, type: "DELETE_CARD", cardId: action.newCardId };

    case "UPDATE_CARD": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      return {
        ...head,
        type: "UPDATE_CARD",
        cardId: card.id,
        title: card.title,
        // An empty string is how the reducer spells "no description".
        description: card.description ?? "",
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "TOUCH_CARD": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      return {
        ...head,
        type: "TOUCH_CARD",
        cardId: card.id,
        cardUpdatedAt: card.updatedAt,
      };
    }

    case "DELETE_CARD": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      const spot = locate(before, card.id);
      return {
        ...head,
        type: "RESTORE_CARD",
        card,
        // An archived card belongs to no column — it comes back as it was.
        ...(spot ? { columnId: spot.columnId, index: spot.index } : {}),
      };
    }

    case "RESTORE_CARD":
      return { ...head, type: "DELETE_CARD", cardId: action.card.id };

    case "ARCHIVE_CARD": {
      const card = before.cards[action.cardId];
      if (!card || card.archivedAt !== undefined) return null;
      const spot = locate(before, card.id);
      if (!spot) return null;
      return {
        ...head,
        type: "UNARCHIVE_CARD",
        cardId: card.id,
        columnId: spot.columnId,
        index: spot.index,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "UNARCHIVE_CARD": {
      const card = before.cards[action.cardId];
      if (!card || card.archivedAt === undefined) return null;
      return {
        ...head,
        type: "ARCHIVE_CARD",
        cardId: card.id,
        // Back into the archive with the date it had, not with today's.
        archivedAt: card.archivedAt,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "ARCHIVE_COLUMN_CARDS": {
      const column = before.columns.find((c) => c.id === action.columnId);
      if (!column || column.cardIds.length === 0) return null;
      return {
        ...head,
        type: "RESTORE_COLUMN_CARDS",
        columnId: column.id,
        cardIds: [...column.cardIds],
        cards: cardsOf(before, column.cardIds),
      };
    }

    case "RESTORE_COLUMN_CARDS": {
      const column = before.columns.find((c) => c.id === action.columnId);
      if (!column) return null;
      // The command undoes itself: the previous card objects (archive
      // stamps included) and the previous order. A card the payload adds
      // from nowhere cannot be un-added this way — that only happens for a
      // hand-dispatched restore, which gets no undo step.
      const cards = cardsOf(
        before,
        action.cards.map((card) => card.id),
      );
      if (cards.length !== action.cards.length) return null;
      return {
        ...head,
        type: "RESTORE_COLUMN_CARDS",
        columnId: column.id,
        cardIds: [...column.cardIds],
        cards,
      };
    }

    case "MOVE_CARD": {
      const from = before.columns.find((c) => c.id === action.fromColumnId);
      const to = before.columns.find((c) => c.id === action.toColumnId);
      if (!from || !to) return null;
      const sameColumn = from.id === to.id;
      // Where the card lands: the reducer removes it first, so the target
      // column is one shorter when the insert position is clamped.
      const landed = clamp(
        action.toIndex,
        0,
        sameColumn ? from.cardIds.length - 1 : to.cardIds.length,
      );
      return {
        ...head,
        type: "MOVE_CARD",
        cardId: action.cardId,
        fromColumnId: to.id,
        fromIndex: landed,
        toColumnId: from.id,
        toIndex: action.fromIndex,
        ...(before.cards[action.cardId]
          ? { cardActivity: feedOf(before.cards[action.cardId]) }
          : {}),
      };
    }

    case "SET_CARD_DUE_DATE": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      return {
        ...head,
        type: "SET_CARD_DUE_DATE",
        cardId: card.id,
        dueDate: card.dueDate,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "SET_CARD_PRIORITY": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      return {
        ...head,
        type: "SET_CARD_PRIORITY",
        cardId: card.id,
        priority: card.priority ?? DEFAULT_CARD_PRIORITY,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "SET_CARD_ASSIGN": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      return {
        ...head,
        type: "SET_CARD_ASSIGN",
        cardId: card.id,
        assigneeId: card.assigneeId ?? null,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "ADD_CARD_LINK": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      return {
        ...head,
        type: "REMOVE_CARD_LINK",
        cardId: card.id,
        linkId: action.linkId,
        targetCardId: action.targetCardId,
        linkType: action.linkType,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "REMOVE_CARD_LINK": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      // The link's payload travels in the remove command itself — re-adding
      // it needs nothing but the command (TASK-21.7b).
      return {
        ...head,
        type: "ADD_CARD_LINK",
        cardId: card.id,
        linkId: action.linkId,
        targetCardId: action.targetCardId,
        linkType: action.linkType,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "SET_CARD_COVER": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      return {
        ...head,
        type: "SET_CARD_COVER",
        cardId: card.id,
        cover: card.cover,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    /* ----------------------------------------------------------------- labels */
    case "SET_CARD_LABEL": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      const index = card.labelIds.indexOf(action.labelId);
      return {
        ...head,
        type: "SET_CARD_LABEL",
        cardId: card.id,
        labelId: action.labelId,
        on: !action.on,
        cardActivity: feedOf(card),
        // Re-attaching puts the label back where it sat in the list.
        ...(index === -1 ? {} : { index }),
      };
    }

    case "ADD_LABEL":
      return { ...head, type: "DELETE_LABEL", labelId: action.label.id };

    case "RENAME_LABEL": {
      const label = before.labels.find((l) => l.id === action.labelId);
      if (!label) return null;
      return {
        ...head,
        type: "RENAME_LABEL",
        labelId: label.id,
        name: label.name,
      };
    }

    case "SET_LABEL_COLOR": {
      const label = before.labels.find((l) => l.id === action.labelId);
      if (!label) return null;
      return {
        ...head,
        type: "SET_LABEL_COLOR",
        labelId: label.id,
        color: label.color,
      };
    }

    case "DELETE_LABEL": {
      const index = before.labels.findIndex((l) => l.id === action.labelId);
      if (index === -1) return null;
      const label = before.labels[index];
      // Every card it was attached to, and where in the list it sat.
      const assignments = Object.values(before.cards)
        .map((card) => ({
          cardId: card.id,
          index: card.labelIds.indexOf(label.id),
        }))
        .filter((entry) => entry.index !== -1);
      return {
        ...head,
        type: "RESTORE_LABEL",
        label,
        index,
        ...(assignments.length > 0 ? { assignments } : {}),
      };
    }

    case "RESTORE_LABEL":
      return { ...head, type: "DELETE_LABEL", labelId: action.label.id };

    /* ------------------------------------------------------------- checklists */
    case "ADD_CHECKLIST": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      return {
        ...head,
        type: "DELETE_CHECKLIST",
        cardId: card.id,
        checklistId: action.newChecklistId,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "RENAME_CHECKLIST": {
      const card = before.cards[action.cardId];
      const checklist = card?.checklists?.find(
        (c) => c.id === action.checklistId,
      );
      if (!card || !checklist) return null;
      return {
        ...head,
        type: "RENAME_CHECKLIST",
        cardId: card.id,
        checklistId: checklist.id,
        title: checklist.title,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "DELETE_CHECKLIST": {
      const card = before.cards[action.cardId];
      const index =
        card?.checklists?.findIndex((c) => c.id === action.checklistId) ?? -1;
      if (!card || index === -1) return null;
      return {
        ...head,
        type: "RESTORE_CHECKLIST",
        cardId: card.id,
        checklist: (card.checklists ?? [])[index],
        index,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "RESTORE_CHECKLIST": {
      const card = before.cards[action.cardId];
      return {
        ...head,
        type: "DELETE_CHECKLIST",
        cardId: action.cardId,
        checklistId: action.checklist.id,
        ...(card
          ? { cardUpdatedAt: card.updatedAt, cardActivity: feedOf(card) }
          : {}),
      };
    }

    case "ADD_CHECKLIST_ITEM": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      return {
        ...head,
        type: "DELETE_CHECKLIST_ITEM",
        cardId: card.id,
        checklistId: action.checklistId,
        itemId: action.newItemId,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "SET_CHECKLIST_ITEM_DONE": {
      const card = before.cards[action.cardId];
      if (!card) return null;
      return {
        ...head,
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId: card.id,
        checklistId: action.checklistId,
        itemId: action.itemId,
        done: !action.done,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "RENAME_CHECKLIST_ITEM": {
      const card = before.cards[action.cardId];
      const item = card?.checklists
        ?.find((c) => c.id === action.checklistId)
        ?.items.find((i) => i.id === action.itemId);
      if (!card || !item) return null;
      return {
        ...head,
        type: "RENAME_CHECKLIST_ITEM",
        cardId: card.id,
        checklistId: action.checklistId,
        itemId: item.id,
        text: item.text,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "DELETE_CHECKLIST_ITEM": {
      const card = before.cards[action.cardId];
      const items =
        card?.checklists?.find((c) => c.id === action.checklistId)?.items ?? [];
      const index = items.findIndex((i) => i.id === action.itemId);
      if (!card || index === -1) return null;
      return {
        ...head,
        type: "RESTORE_CHECKLIST_ITEM",
        cardId: card.id,
        checklistId: action.checklistId,
        item: items[index],
        index,
        cardUpdatedAt: card.updatedAt,
        cardActivity: feedOf(card),
      };
    }

    case "RESTORE_CHECKLIST_ITEM": {
      const card = before.cards[action.cardId];
      return {
        ...head,
        type: "DELETE_CHECKLIST_ITEM",
        cardId: action.cardId,
        checklistId: action.checklistId,
        itemId: action.item.id,
        ...(card
          ? { cardUpdatedAt: card.updatedAt, cardActivity: feedOf(card) }
          : {}),
      };
    }

    /* ---------------------------------------------------- not undoable steps */
    // Whole-data-set and board-level bookkeeping: the board switcher's own
    // actions are organizational, not content edits, and an import replaces
    // everything (its "undo" is the auto-backup, TASK-21.2).
    case "RESTORE_BOARD":
    case "IMPORT_BOARDS":
    case "ADD_BOARD":
    case "REMOVE_BOARD":
    case "ARCHIVE_BOARD":
    case "UNARCHIVE_BOARD":
      return null;

    default: {
      // A new action without an inverse does not compile: add a case above.
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
