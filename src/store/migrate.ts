import type {
  Board,
  Card,
  Checklist,
  ChecklistItem,
} from "@/types/kanban";
import type { BoardState } from "@/store/board-reducer";

/**
 * Migration for boards saved by older versions of the app.
 *
 * v1 → v2: cards had a single `labelId: string | null`; now they carry
 * `labelIds: string[]`. Any persisted data (localStorage `janosik-boards`)
 * written before this change is normalized here so the rest of the app can
 * rely on the current shape.
 *
 * v3: `Card.checklists` (TASK-3) — optional, so old data loads as-is; the
 * normalizer only sanitizes the field when it is present but malformed
 * (e.g. a hand-edited import): non-arrays are dropped, items keep only
 * well-formed entries. This lets the rest of the app trust the shape.
 *
 * v4: `Card.dueDate` (TASK-4) — optional Unix timestamp; only a non-finite
 * number (garbage from a hand-edited import) is dropped.
 */

type LegacyCard = Card & { labelId?: unknown; labelIds?: unknown };

function toLabelIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === "string");
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
}

function toChecklistItem(value: unknown): ChecklistItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Partial<ChecklistItem>;
  if (typeof item.id !== "string" || typeof item.text !== "string") {
    return null;
  }
  return { id: item.id, text: item.text, done: item.done === true };
}

function toChecklist(value: unknown): Checklist | null {
  if (typeof value !== "object" || value === null) return null;
  const checklist = value as Partial<Checklist>;
  if (typeof checklist.id !== "string" || typeof checklist.title !== "string") {
    return null;
  }
  const items = Array.isArray(checklist.items)
    ? checklist.items
        .map(toChecklistItem)
        .filter((item): item is ChecklistItem => item !== null)
    : [];
  return { id: checklist.id, title: checklist.title, items };
}

function toChecklists(value: unknown): Checklist[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const checklists = value
    .map(toChecklist)
    .filter((checklist): checklist is Checklist => checklist !== null);
  return checklists.length > 0 ? checklists : undefined;
}

/** A due date is either absent or a finite number; anything else is garbage. */
function toDueDate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeCard(card: LegacyCard): Card {
  const { labelId, labelIds, checklists, dueDate, ...rest } = card;
  return {
    ...rest,
    labelIds: toLabelIds(labelIds ?? labelId),
    checklists: toChecklists(checklists),
    dueDate: toDueDate(dueDate),
  };
}

export function normalizeBoard(board: Board): Board {
  return {
    ...board,
    cards: Object.fromEntries(
      Object.entries(board.cards).map(([id, card]) => [
        id,
        normalizeCard(card),
      ]),
    ),
  };
}

/** Normalize every board in the state array (no-op when already current). */
export function normalizeBoards(state: BoardState): BoardState {
  return state.map((board) => {
    const needsFix = Object.values(board.cards).some((card) => {
      const legacy = card as LegacyCard;
      if (!Array.isArray(legacy.labelIds)) return true;
      if (!isChecklistsCurrent(legacy.checklists)) return true;
      return !isDueDateCurrent(legacy.dueDate);
    });
    return needsFix ? normalizeBoard(board) : board;
  });
}

/**
 * True when the stored checklists field is already in the current shape —
 * `undefined` or a well-formed array. Avoids rebuilding every card on load.
 */
function isChecklistsCurrent(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((checklist) => {
    if (typeof checklist !== "object" || checklist === null) return false;
    const c = checklist as Partial<Checklist>;
    return (
      typeof c.id === "string" &&
      typeof c.title === "string" &&
      Array.isArray(c.items) &&
      c.items.every((item) => {
        if (typeof item !== "object" || item === null) return false;
        const i = item as Partial<ChecklistItem>;
        return (
          typeof i.id === "string" &&
          typeof i.text === "string" &&
          typeof i.done === "boolean"
        );
      })
    );
  });
}

/** True when the stored due date is `undefined` or a finite number. */
function isDueDateCurrent(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "number" && Number.isFinite(value));
}
