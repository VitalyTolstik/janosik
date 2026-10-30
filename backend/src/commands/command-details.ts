import type { ActivityChange, Board, BoardAction, Card } from "@janosik/shared";
import { cardOf, DEFAULT_CARD_PRIORITY, LIMITS } from "@janosik/shared";

/**
 * The display snapshot stored on a `Command` row (TASK-37) and rendered by
 * the history feed. `detail` feeds the sentence ("checked «Buy milk»"),
 * `changes` are the "from → to" lines; both are freeze-dried at apply time
 * while the before/after aggregates are still in hand — an action payload
 * only carries the new values, and a label deleted tomorrow must still show
 * its name in yesterday's history.
 */
export interface CommandDetails {
  detail?: string;
  changes?: ActivityChange[];
}

/**
 * Snapshots are for reading, not for storage — clip the ones that slipped
 * past the UI clamp. The bar is the description limit, not a display size:
 * a clipped pair hides the actual change (two identical truncated walls)
 * and a change beyond the cut would freeze as no change at all. The feed
 * collapses context and highlights the changed fragment on render.
 */
const SNAPSHOT_MAX = LIMITS.description;

function clip(value: string | null): string | null {
  if (value === null) return null;
  return value.length > SNAPSHOT_MAX
    ? `${value.slice(0, SNAPSHOT_MAX)}…`
    : value;
}

function columnTitle(board: Board, cardId: string): string | null {
  return (
    board.columns.find((column) => column.cardIds.includes(cardId))?.title ??
    null
  );
}

function labelName(board: Board, labelId: string): string | null {
  return board.labels.find((label) => label.id === labelId)?.name ?? null;
}

function checklistTitle(card: Card | undefined, checklistId: string) {
  return (
    card?.checklists?.find((checklist) => checklist.id === checklistId)
      ?.title ?? null
  );
}

function checklistItem(
  card: Card | undefined,
  checklistId: string,
  itemId: string,
): string | null {
  const checklist = card?.checklists?.find((c) => c.id === checklistId);
  return checklist?.items.find((item) => item.id === itemId)?.text ?? null;
}

function isoOrNull(at: number | undefined): string | null {
  return at === undefined ? null : new Date(at).toISOString();
}

/**
 * The diff of one just-applied command, or `null` when the command has no
 * story to tell at a field level (a create, an archive, a no-op). Pure:
 * every input — including both aggregates — is passed in.
 */
export function commandDetails(
  action: BoardAction,
  before: Board,
  after: Board,
): CommandDetails | null {
  switch (action.type) {
    case "UPDATE_CARD": {
      const from = cardOf(before, action.cardId);
      const to = cardOf(after, action.cardId);
      if (!from || !to) return null;
      const changes: ActivityChange[] = [];
      if (action.title !== undefined && from.title !== to.title) {
        changes.push({
          field: "title",
          from: clip(from.title),
          to: clip(to.title),
        });
      }
      const fromDescription = from.description ?? null;
      const toDescription = to.description ?? null;
      if (
        action.description !== undefined &&
        fromDescription !== toDescription
      ) {
        changes.push({
          field: "description",
          from: clip(fromDescription),
          to: clip(toDescription),
        });
      }
      return changes.length > 0 ? { changes } : null;
    }

    case "MOVE_CARD": {
      const from = columnTitle(before, action.cardId);
      const to = columnTitle(after, action.cardId);
      if (from === to) return null;
      return {
        ...(to !== null ? { detail: to } : {}),
        changes: [{ field: "column", from, to }],
      };
    }

    // Board- and column-level commands have no card to hang a diff on, but
    // they still deserve the name they touched (the watch feed reads it back).
    case "ADD_COLUMN":
      return {
        changes: [{ field: "column", from: null, to: clip(action.title) }],
      };

    case "DUPLICATE_COLUMN": {
      const to =
        after.columns.find((column) => column.id === action.newColumnId)
          ?.title ?? null;
      return { changes: [{ field: "column", from: null, to: clip(to) }] };
    }

    case "RENAME_COLUMN": {
      const from =
        before.columns.find((column) => column.id === action.columnId)?.title ??
        null;
      const to =
        after.columns.find((column) => column.id === action.columnId)?.title ??
        null;
      if (from === to) return null;
      return { changes: [{ field: "column", from: clip(from), to: clip(to) }] };
    }

    case "DELETE_COLUMN": {
      const from =
        before.columns.find((column) => column.id === action.columnId)?.title ??
        null;
      return { changes: [{ field: "column", from: clip(from), to: null }] };
    }

    case "RENAME_BOARD":
      return {
        changes: [
          { field: "title", from: clip(before.title), to: clip(action.title) },
        ],
      };

    // Column commands that are not a value diff still name the column.
    case "MOVE_COLUMN":
    case "SORT_COLUMN":
    case "SET_COLUMN_CARD_ORDER":
    case "ARCHIVE_COLUMN_CARDS": {
      const title =
        after.columns.find((column) => column.id === action.columnId)?.title ??
        before.columns.find((column) => column.id === action.columnId)?.title ??
        null;
      return { detail: clip(title) ?? undefined };
    }

    case "SET_COLUMN_WIP_LIMIT": {
      const title =
        after.columns.find((column) => column.id === action.columnId)?.title ??
        null;
      return { detail: clip(title) ?? undefined };
    }

    case "DUPLICATE_CARD": {
      const title = cardOf(after, action.newCardId)?.title ?? null;
      return { detail: clip(title) ?? undefined };
    }

    case "ADD_LABEL":
      return {
        changes: [{ field: "label", from: null, to: clip(action.label.name) }],
      };

    case "RENAME_LABEL": {
      const from = labelName(before, action.labelId);
      if (from === action.name) return null;
      return {
        changes: [{ field: "label", from: clip(from), to: clip(action.name) }],
      };
    }

    case "SET_LABEL_COLOR": {
      const from =
        before.labels.find((label) => label.id === action.labelId)?.color ??
        null;
      const to =
        after.labels.find((label) => label.id === action.labelId)?.color ??
        action.color;
      if (from === to) return null;
      return { changes: [{ field: "label", from, to }] };
    }

    case "DELETE_LABEL": {
      const from = labelName(before, action.labelId);
      return { changes: [{ field: "label", from: clip(from), to: null }] };
    }

    case "DELETE_CARD": {
      const title = cardOf(before, action.cardId)?.title ?? null;
      return { detail: clip(title) ?? undefined };
    }

    case "RESTORE_CARD":
      return { detail: clip(action.card.title) ?? undefined };

    case "RESTORE_COLUMN":
    case "RESTORE_COLUMN_CARDS": {
      const title =
        action.type === "RESTORE_COLUMN"
          ? action.column.title
          : (before.columns.find((column) => column.id === action.columnId)
              ?.title ?? null);
      return { detail: clip(title) ?? undefined };
    }

    case "RESTORE_LABEL":
      return { detail: clip(action.label.name) ?? undefined };

    case "RESTORE_CHECKLIST":
      return { detail: clip(action.checklist.title) ?? undefined };

    case "RESTORE_CHECKLIST_ITEM":
      return { detail: clip(action.item.text) ?? undefined };

    case "RESTORE_BOARD":
      return { detail: clip(action.board.title) ?? undefined };

    case "SET_CARD_LABEL": {
      const name =
        labelName(after, action.labelId) ?? labelName(before, action.labelId);
      if (name === null) return null;
      return {
        detail: name,
        changes: [
          {
            field: "label",
            from: action.on ? null : name,
            to: action.on ? name : null,
          },
        ],
      };
    }

    case "SET_CARD_DUE_DATE": {
      const from = cardOf(before, action.cardId);
      if (!from) return null;
      return {
        changes: [
          {
            field: "dueDate",
            from: isoOrNull(from.dueDate),
            to: isoOrNull(action.dueDate),
          },
        ],
      };
    }

    case "SET_CARD_PRIORITY": {
      const from = cardOf(before, action.cardId);
      if (!from) return null;
      return {
        changes: [
          {
            field: "priority",
            from: from.priority ?? DEFAULT_CARD_PRIORITY,
            to: action.priority,
          },
        ],
      };
    }

    case "SET_CARD_ASSIGN": {
      const from = cardOf(before, action.cardId);
      if (!from) return null;
      return {
        changes: [
          {
            field: "assignee",
            from: from.assigneeId ?? null,
            to: action.assigneeId ?? null,
          },
        ],
      };
    }

    case "CLAIM_CARD": {
      const from = cardOf(before, action.cardId);
      const to = cardOf(after, action.cardId);
      if (!from || !to) return null;
      const changes: ActivityChange[] = [];
      if ((from.claimedBy ?? null) !== (to.claimedBy ?? null)) {
        changes.push({
          field: "claimedBy",
          from: from.claimedBy ?? null,
          to: to.claimedBy ?? null,
        });
      }
      if ((from.leaseUntil ?? null) !== (to.leaseUntil ?? null)) {
        changes.push({
          field: "leaseUntil",
          from: isoOrNull(from.leaseUntil),
          to: isoOrNull(to.leaseUntil),
        });
      }
      return changes.length > 0 ? { changes } : null;
    }

    case "SET_CARD_TASK_SPEC": {
      const from = cardOf(before, action.cardId);
      const to = cardOf(after, action.cardId);
      if (!from || !to) return null;
      const changes: ActivityChange[] = [];
      // A list reads as its items joined inline; an empty (or cleared) list
      // is `null` — the same "—" the rest of the feed uses.
      const render = (list: string[] | undefined): string | null =>
        list && list.length > 0 ? clip(list.join("; ")) : null;
      if (
        action.acceptanceCriteria !== undefined &&
        (from.acceptanceCriteria ?? []).join("; ") !==
          (to.acceptanceCriteria ?? []).join("; ")
      ) {
        changes.push({
          field: "acceptanceCriteria",
          from: render(from.acceptanceCriteria),
          to: render(to.acceptanceCriteria),
        });
      }
      if (
        action.definitionOfDone !== undefined &&
        (from.definitionOfDone ?? []).join("; ") !==
          (to.definitionOfDone ?? []).join("; ")
      ) {
        changes.push({
          field: "definitionOfDone",
          from: render(from.definitionOfDone),
          to: render(to.definitionOfDone),
        });
      }
      return changes.length > 0 ? { changes } : null;
    }

    case "ADD_CARD_LINK":
    case "REMOVE_CARD_LINK": {
      // The readable half is the target card's title, frozen while the
      // aggregate is in hand — like a label name, it must survive the
      // target being renamed or deleted afterwards. A remove prefers the
      // `before` title and falls back to `after` (the link is gone either
      // way; only the name matters); an add reads the `after` aggregate.
      const titleOf = (board: Board): string | null =>
        cardOf(board, action.targetCardId)?.title ?? null;
      const adding = action.type === "ADD_CARD_LINK";
      const from = adding ? null : (titleOf(before) ?? titleOf(after));
      const to = adding ? titleOf(after) : null;
      const name = adding ? to : from;
      return {
        ...(name !== null ? { detail: name } : {}),
        changes: [{ field: "link", from, to }],
      };
    }

    case "SET_CARD_COVER": {
      const from = cardOf(before, action.cardId);
      const to = cardOf(after, action.cardId);
      if (!from || !to) return null;
      const value = (card: typeof from): string | null =>
        card.cover ? `${card.cover.type}:${card.cover.value}` : null;
      return {
        changes: [{ field: "cover", from: value(from), to: value(to) }],
      };
    }

    case "ADD_CHECKLIST": {
      return {
        detail: clip(action.title) ?? undefined,
        changes: [
          { field: "checklist", from: null, to: clip(action.title) ?? null },
        ],
      };
    }

    case "RENAME_CHECKLIST": {
      const from = checklistTitle(
        cardOf(before, action.cardId),
        action.checklistId,
      );
      return {
        detail: clip(action.title) ?? undefined,
        changes: [
          {
            field: "checklist",
            from: clip(from),
            to: clip(action.title),
          },
        ],
      };
    }

    case "DELETE_CHECKLIST": {
      const from = checklistTitle(
        cardOf(before, action.cardId),
        action.checklistId,
      );
      return {
        ...(from !== null ? { detail: from } : {}),
        changes: [{ field: "checklist", from: clip(from), to: null }],
      };
    }

    case "ADD_CHECKLIST_ITEM": {
      return {
        detail: clip(action.text) ?? undefined,
        changes: [
          { field: "checklistItem", from: null, to: clip(action.text) ?? null },
        ],
      };
    }

    case "RENAME_CHECKLIST_ITEM": {
      const from = checklistItem(
        cardOf(before, action.cardId),
        action.checklistId,
        action.itemId,
      );
      return {
        detail: clip(action.text) ?? undefined,
        changes: [
          { field: "checklistItem", from: clip(from), to: clip(action.text) },
        ],
      };
    }

    case "DELETE_CHECKLIST_ITEM": {
      const from = checklistItem(
        cardOf(before, action.cardId),
        action.checklistId,
        action.itemId,
      );
      return {
        ...(from !== null ? { detail: from } : {}),
        changes: [{ field: "checklistItem", from: clip(from), to: null }],
      };
    }

    case "SET_CHECKLIST_ITEM_DONE": {
      const text =
        checklistItem(
          cardOf(before, action.cardId),
          action.checklistId,
          action.itemId,
        ) ??
        checklistItem(
          cardOf(after, action.cardId),
          action.checklistId,
          action.itemId,
        );
      return {
        ...(text !== null ? { detail: clip(text) ?? undefined } : {}),
        changes: [
          {
            field: "checklistItemDone",
            from: action.done ? "false" : "true",
            to: action.done ? "true" : "false",
          },
        ],
      };
    }

    default:
      return null;
  }
}
