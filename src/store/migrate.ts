import type {
  Board,
  Card,
  CardCover,
  Checklist,
  ChecklistItem,
} from "@/types/kanban";
import { COVER_COLORS, COVER_GRADIENTS } from "@/types/kanban";
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
 *
 * v5: `Card.cover` (TASK-5) — optional `{ type, value }`; only a pair the
 * app can render survives, malformed shapes are dropped.
 *
 * v6: `Card.activity` (TASK-12) — optional event list; only well-formed
 * events (known type, finite timestamp) survive, malformed or empty lists
 * are dropped. Cards without activity are valid — the UI falls back to a
 * single "created" row from `createdAt`.
 */

import { CARD_ACTIVITY_TYPES, LIMITS, MAX_CARD_ACTIVITY } from "@/types/kanban";
import type { CardActivityEvent } from "@/types/kanban";

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

/**
 * A cover is either absent or a well-formed `{ type, value }` pair the app
 * can render; malformed shapes (hand-edited imports) are dropped.
 */
function toCover(value: unknown): CardCover | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const c = value as Partial<CardCover>;
  if (c.type === "color") {
    return (COVER_COLORS as readonly string[]).includes(c.value as string)
      ? { type: "color", value: c.value as (typeof COVER_COLORS)[number] }
      : undefined;
  }
  if (c.type === "gradient") {
    return (COVER_GRADIENTS as readonly string[]).includes(c.value as string)
      ? { type: "gradient", value: c.value as (typeof COVER_GRADIENTS)[number] }
      : undefined;
  }
  return undefined;
}

/**
 * An activity event survives only when fully well-formed: known type,
 * finite timestamp, `actorId` of the current shape (always `null` today),
 * optional string detail. Everything else (hand-edited imports) is dropped.
 */
function toActivityEvent(value: unknown): CardActivityEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Partial<CardActivityEvent>;
  if (typeof e.id !== "string") return null;
  if (!(CARD_ACTIVITY_TYPES as readonly string[]).includes(e.type as string)) {
    return null;
  }
  if (typeof e.at !== "number" || !Number.isFinite(e.at)) return null;
  if (e.actorId !== null && typeof e.actorId !== "string") return null;
  if (e.detail !== undefined && typeof e.detail !== "string") return null;
  const event: CardActivityEvent = {
    id: e.id,
    type: e.type as CardActivityEvent["type"],
    at: e.at,
    actorId: e.actorId,
  };
  if (e.detail !== undefined) event.detail = e.detail;
  return event;
}

function toActivity(value: unknown): CardActivityEvent[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const events = value
    .map(toActivityEvent)
    .filter((event): event is CardActivityEvent => event !== null)
    .slice(-MAX_CARD_ACTIVITY);
  return events.length > 0 ? events : undefined;
}

/** Clamp text to its LIMITS bound (imports can bypass UI maxLength). */
function clampText(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function normalizeCard(card: LegacyCard): Card {
  const { labelId, labelIds, checklists, dueDate, cover, activity, ...rest } =
    card;
  const title = clampText(rest.title, LIMITS.cardTitle);
  const description =
    typeof rest.description === "string"
      ? clampText(rest.description, LIMITS.description)
      : rest.description;
  return {
    ...rest,
    title,
    description,
    labelIds: toLabelIds(labelIds ?? labelId),
    checklists: toChecklists(checklists)?.map((checklist) => ({
      ...checklist,
      title: clampText(checklist.title, LIMITS.checklistTitle),
      items: checklist.items.map((item) => ({
        ...item,
        text: clampText(item.text, LIMITS.checklistItem),
      })),
    })),
    dueDate: toDueDate(dueDate),
    cover: toCover(cover),
    activity: toActivity(activity),
  };
}

export function normalizeBoard(board: Board): Board {
  return {
    ...board,
    title: clampText(board.title, LIMITS.boardTitle),
    columns: board.columns.map((column) => ({
      ...column,
      title: clampText(column.title, LIMITS.columnTitle),
    })),
    labels: board.labels.map((label) => ({
      ...label,
      name: clampText(label.name, LIMITS.labelName),
    })),
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
    const needsFix =
      board.title.length > LIMITS.boardTitle ||
      board.columns.some((column) => column.title.length > LIMITS.columnTitle) ||
      board.labels.some((label) => label.name.length > LIMITS.labelName) ||
      Object.values(board.cards).some((card) => {
        const legacy = card as LegacyCard;
        if (card.title.length > LIMITS.cardTitle) return true;
        if ((card.description ?? "").length > LIMITS.description) return true;
        if (!Array.isArray(legacy.labelIds)) return true;
        if (!isChecklistsCurrent(legacy.checklists)) return true;
        if (!isDueDateCurrent(legacy.dueDate)) return true;
        if (!isCoverCurrent(legacy.cover)) return true;
        return !isActivityCurrent(legacy.activity);
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

/** True when the stored cover is `undefined` or a well-formed pair. */
function isCoverCurrent(value: unknown): boolean {
  if (value === undefined) return true;
  const cover = toCover(value);
  return (
    cover !== undefined &&
    cover.type === (value as CardCover).type &&
    cover.value === (value as CardCover).value
  );
}

/**
 * True when the stored activity field is already in the current shape —
 * `undefined` or an array of well-formed events (no re-sanitize on load).
 */
function isActivityCurrent(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((event) => toActivityEvent(event) !== null);
}
