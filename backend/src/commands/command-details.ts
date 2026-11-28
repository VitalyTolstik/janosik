import type { ActivityChange, Board, BoardAction, Card } from "@janosik/shared";
import {
  boardEpicProgress,
  cardOf,
  DEFAULT_CARD_PRIORITY,
  epicOf,
} from "@janosik/shared";

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
 * past the UI clamp. TASK-200.11 lowers the bar from the 64 000-character
 * description limit to a bounded history snapshot: a per-keystroke edit of a
 * long document used to freeze two 64k walls into every command row (and,
 * before partitioning, into the board's 30-day command log). The feed only
 * renders a context window around the changed fragment, so 1 024 characters
 * keep the useful part; the ellipsis marks the cut. Description pairs get a
 * window centred on the first difference; other long strings keep head and
 * tail.
 */
export const COMMAND_DETAIL_TEXT_MAX = 1_024;
/**
 * Hard ceiling for one side-table blob. The per-field clamp above already
 * bounds ordinary diffs; this catches hand-built/legacy shapes (a long
 * `cardOrder`, a future action with many changes) before they reach the
 * side table. 16 KiB is a worst-case bound, not an inline target: JSONB above
 * roughly 2 KiB is TOAST-compressed by PostgreSQL, and the command's action
 * payload is separate and still required for replay.
 */
export const COMMAND_DETAILS_MAX_BYTES = 16 * 1_024;
/** More changes than any current action emits; a guard against new ones. */
export const COMMAND_DETAIL_MAX_CHANGES = 16;

function clippedTo(value: string | null, limit: number): string | null {
  if (value === null || value.length <= limit) return value;
  // Keep both ends: a cardOrder or a long document usually changes near the
  // start or the end, and a prefix-only clip can make two different walls
  // freeze as the same string. One character is reserved for the ellipsis.
  const room = Math.max(limit - 1, 0);
  const head = Math.ceil(room * 0.7);
  const tail = room - head;
  return `${value.slice(0, head)}…${tail > 0 ? value.slice(value.length - tail) : ""}`;
}

function clip(value: string | null): string | null {
  return clippedTo(value, COMMAND_DETAIL_TEXT_MAX);
}

/**
 * Clip a from/to pair around the first difference. A prefix-only clip (or a
 * plain head+tail clip) can freeze a middle edit of a long description as two
 * identical walls; the history feed then has nothing to show. Keep a context
 * window centred on the first differing character, with an ellipsis on each
 * side that was cut. Short pairs are returned as-is.
 */
function clipPair(
  from: string | null,
  to: string | null,
): [string | null, string | null] {
  const max = COMMAND_DETAIL_TEXT_MAX;
  if (
    from === null ||
    to === null ||
    (from.length <= max && to.length <= max)
  ) {
    return [clip(from), clip(to)];
  }
  const shared = Math.min(from.length, to.length);
  let prefix = 0;
  while (prefix < shared && from[prefix] === to[prefix]) prefix += 1;
  const context = Math.floor((max - 2) / 2);
  const window = (value: string): string => {
    if (value.length <= max) return value;
    const start = Math.max(0, prefix - context);
    const room = max - (start > 0 ? 1 : 0);
    const end = Math.min(value.length, start + room);
    const cutEnd = end < value.length;
    const body = value.slice(start, end - (cutEnd ? 1 : 0));
    return `${start > 0 ? "…" : ""}${body}${cutEnd ? "…" : ""}`;
  };
  return [window(from), window(to)];
}

function withLimit(
  details: CommandDetails,
  textLimit: number,
  changeLimit: number,
): CommandDetails {
  const changes =
    details.changes === undefined
      ? undefined
      : details.changes.slice(0, changeLimit).map((change) => ({
          ...change,
          from: clippedTo(change.from, textLimit),
          to: clippedTo(change.to, textLimit),
        }));
  return {
    ...(details.detail !== undefined
      ? { detail: clippedTo(details.detail, textLimit) ?? "" }
      : {}),
    ...(changes === undefined ? {} : { changes }),
  };
}

/**
 * Enforce `COMMAND_DETAILS_MAX_BYTES` without losing the shape: shrink every
 * string step by step, then the change list. Deterministic, so a replay of
 * the same action freezes exactly the same snapshot.
 */
export function capCommandDetails(
  details: CommandDetails | null,
): CommandDetails | null {
  if (details === null) return null;
  const size = (value: CommandDetails): number =>
    Buffer.byteLength(JSON.stringify(value), "utf8");
  for (const limit of [
    COMMAND_DETAIL_TEXT_MAX,
    512,
    256,
    128,
    64,
    32,
    16,
    8,
    4,
    2,
    1,
  ]) {
    const candidate = withLimit(details, limit, COMMAND_DETAIL_MAX_CHANGES);
    if (size(candidate) <= COMMAND_DETAILS_MAX_BYTES) return candidate;
  }
  for (let count = COMMAND_DETAIL_MAX_CHANGES - 1; count >= 0; count -= 1) {
    const candidate = withLimit(details, 1, count);
    if (size(candidate) <= COMMAND_DETAILS_MAX_BYTES) return candidate;
  }
  return { detail: "", changes: [] };
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

function cardEpicChange(
  before: Board,
  after: Board,
  cardId: string,
): ActivityChange | undefined {
  const previous = cardOf(before, cardId)?.epicId;
  const next = cardOf(after, cardId)?.epicId;
  if (previous === next) return undefined;
  return {
    field: "epic",
    from: epicOf(before, previous)?.title ?? null,
    to: epicOf(after, next)?.title ?? null,
  };
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
  return capCommandDetails(uncappedCommandDetails(action, before, after));
}

function uncappedCommandDetails(
  action: BoardAction,
  before: Board,
  after: Board,
): CommandDetails | null {
  switch (action.type) {
    case "ADD_EPIC":
    case "RESTORE_EPIC": {
      const title = epicOf(after, action.epic.id)?.title ?? action.epic.title;
      return {
        detail: title,
        changes: [{ field: "epic", from: null, to: title }],
      };
    }
    case "DELETE_EPIC": {
      const epic = epicOf(before, action.epicId);
      if (!epic) return null;
      const count = boardEpicProgress(before).get(epic.id)?.total ?? 0;
      return {
        detail: `${epic.title} (${count} ${count === 1 ? "card keeps its column" : "cards keep their columns"})`,
        changes: [{ field: "epic", from: epic.title, to: null }],
      };
    }
    case "SET_EPIC_STATUS": {
      const from = epicOf(before, action.epicId);
      const to = epicOf(after, action.epicId);
      if (!from || !to) return null;
      return {
        detail: to.title,
        changes: [{ field: "epicStatus", from: from.status, to: to.status }],
      };
    }
    case "UPDATE_EPIC": {
      const from = epicOf(before, action.epicId);
      const to = epicOf(after, action.epicId);
      if (!from || !to) return null;
      const [fromDescription, toDescription] = clipPair(
        from.description ?? null,
        to.description ?? null,
      );
      const changes: ActivityChange[] = [
        { field: "epicTitle", from: from.title, to: to.title },
        { field: "epicDescription", from: fromDescription, to: toDescription },
        {
          field: "epicOwner",
          from: from.ownerId ?? null,
          to: to.ownerId ?? null,
        },
        {
          field: "epicStart",
          from: isoOrNull(from.startDate),
          to: isoOrNull(to.startDate),
        },
        {
          field: "epicDue",
          from: isoOrNull(from.dueDate),
          to: isoOrNull(to.dueDate),
        },
      ];
      return {
        detail: to.title,
        changes: changes.filter((change) => change.from !== change.to),
      };
    }
    case "SET_CARD_EPIC":
    case "ADD_CARD": {
      const cardId =
        action.type === "ADD_CARD" ? action.newCardId : action.cardId;
      const change = cardEpicChange(before, after, cardId);
      return change
        ? { detail: cardOf(after, cardId)?.title, changes: [change] }
        : null;
    }

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
        const [fromClip, toClip] = clipPair(fromDescription, toDescription);
        changes.push({
          field: "description",
          from: fromClip,
          to: toClip,
        });
      }
      return changes.length > 0 ? { changes } : null;
    }

    case "MOVE_CARD": {
      const from = columnTitle(before, action.cardId);
      const to = columnTitle(after, action.cardId);
      const changes: ActivityChange[] = [];
      if (action.fromColumnId === action.toColumnId) {
        const fromIndex =
          before.columns
            .find((column) => column.id === action.fromColumnId)
            ?.cardIds.indexOf(action.cardId) ?? -1;
        const toIndex =
          after.columns
            .find((column) => column.id === action.toColumnId)
            ?.cardIds.indexOf(action.cardId) ?? -1;
        if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
          changes.push({
            field: "position",
            from: String(fromIndex + 1),
            to: String(toIndex + 1),
          });
        }
      } else if (from !== to) {
        changes.push({ field: "column", from, to });
      }
      const epic = cardEpicChange(before, after, action.cardId);
      if (epic) changes.push(epic);
      return changes.length > 0
        ? { ...(to !== null ? { detail: to } : {}), changes }
        : null;
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

    case "SET_BOARD_COLUMN_STYLE":
      return {
        changes: [
          {
            field: "columnStyle",
            from: before.columnStyle ?? "signature",
            to: after.columnStyle ?? "signature",
          },
        ],
      };

    case "SET_BOARD_WORKFLOW": {
      const summary = (workflow: typeof before.workflow): string =>
        workflow === undefined
          ? "off"
          : workflow.enabled
            ? `on (${workflow.transitions.length})`
            : `off (${workflow.transitions.length})`;
      return {
        changes: [
          {
            field: "workflow",
            from: summary(before.workflow),
            to: summary(after.workflow),
          },
        ],
      };
    }

    // Column commands that are not a value diff still name the column.
    case "MOVE_COLUMN":
    case "ARCHIVE_COLUMN_CARDS": {
      const title =
        after.columns.find((column) => column.id === action.columnId)?.title ??
        before.columns.find((column) => column.id === action.columnId)?.title ??
        null;
      return { detail: clip(title) ?? undefined };
    }

    case "SORT_COLUMN":
    case "SET_COLUMN_CARD_ORDER": {
      const previous = before.columns.find(
        (column) => column.id === action.columnId,
      );
      const current = after.columns.find(
        (column) => column.id === action.columnId,
      );
      const names = (board: Board, ids: string[]) =>
        ids.map((id) => board.cards[id]?.title ?? id).join(", ");
      const from = names(before, previous?.cardIds ?? []);
      const to = names(after, current?.cardIds ?? []);
      const [fromClip, toClip] = clipPair(from, to);
      return {
        detail: clip(current?.title ?? previous?.title ?? null) ?? undefined,
        ...(from === to
          ? {}
          : {
              // Clip around the first reordered pair, not just the prefix:
              // a reorder in the middle of a long column must stay visible.
              changes: [{ field: "cardOrder", from: fromClip, to: toClip }],
            }),
      };
    }

    case "SET_COLUMN_WIP_LIMIT": {
      const previous = before.columns.find(
        (column) => column.id === action.columnId,
      );
      const current = after.columns.find(
        (column) => column.id === action.columnId,
      );
      return {
        detail: clip(current?.title ?? null) ?? undefined,
        changes: [
          {
            field: "wipLimit",
            from: previous?.wipLimit == null ? null : String(previous.wipLimit),
            to: current?.wipLimit == null ? null : String(current.wipLimit),
          },
        ],
      };
    }

    case "SET_COLUMN_ACCENT": {
      const previous = before.columns.find(
        (column) => column.id === action.columnId,
      );
      const current = after.columns.find(
        (column) => column.id === action.columnId,
      );
      const value = (column: typeof previous): string | null =>
        column?.accent ? `${column.accent.type}:${column.accent.value}` : null;
      return {
        detail: clip(current?.title ?? previous?.title ?? null) ?? undefined,
        changes: [
          {
            field: "accent",
            from: value(previous),
            to: value(current),
          },
        ],
      };
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
        list && list.length > 0 ? list.join("; ") : null;
      if (
        action.acceptanceCriteria !== undefined &&
        (from.acceptanceCriteria ?? []).join("; ") !==
          (to.acceptanceCriteria ?? []).join("; ")
      ) {
        const [fromClip, toClip] = clipPair(
          render(from.acceptanceCriteria),
          render(to.acceptanceCriteria),
        );
        changes.push({
          field: "acceptanceCriteria",
          from: fromClip,
          to: toClip,
        });
      }
      if (
        action.definitionOfDone !== undefined &&
        (from.definitionOfDone ?? []).join("; ") !==
          (to.definitionOfDone ?? []).join("; ")
      ) {
        const [fromClip, toClip] = clipPair(
          render(from.definitionOfDone),
          render(to.definitionOfDone),
        );
        changes.push({
          field: "definitionOfDone",
          from: fromClip,
          to: toClip,
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
