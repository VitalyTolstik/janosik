import type { BoardAction } from "./board-reducer";
import { COVER_COLORS, COVER_GRADIENTS, LIMITS } from "../types/kanban";

/**
 * Strict command validation for the API boundary (ROADMAP §7.0 two modes).
 *
 * `normalizeBoards` (migrate.ts) is the lenient mode: it clamps everything
 * that arrives past the UI, which is right for imports and localStorage but
 * wrong for a live API — silently shrinking a 400-character title hides a
 * client bug instead of reporting it. This module is the strict mode: it
 * rejects a command with the offending field so the endpoint can answer
 * `400 { field }` and the client learns what it got wrong.
 *
 * Only the board-scoped column/card/label/checklist actions are understood;
 * anything else (array-level BoardActions, unknown types) is rejected here
 * rather than guessed at.
 */

/** Result of validating one `BoardAction`. */
export type ActionValidationResult =
  | { ok: true; action: BoardAction }
  | { ok: false; field: string; message: string };

/** Internal thrown error carrying the field path a failure belongs to. */
class FieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "FieldError";
  }
}

/** Abort validation for `field` with `message`. */
function fail(field: string, message: string): never {
  throw new FieldError(field, message);
}

/** The input is a plain JSON object (not `null`, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) fail(field, "must be an object");
  return value;
}

interface StringOptions {
  /** Reject values whose trimmed length is zero. */
  nonBlank?: boolean;
  /** Reject values whose trimmed length exceeds this bound. */
  max?: number;
}

function readString(
  obj: Record<string, unknown>,
  key: string,
  field: string,
  options: StringOptions = {},
): string {
  const value = obj[key];
  if (typeof value !== "string") fail(field, "must be a string");
  const length = value.trim().length;
  if (options.nonBlank && length === 0) fail(field, "must not be blank");
  if (options.max !== undefined && length > options.max) {
    fail(field, `must be at most ${options.max} characters`);
  }
  return value;
}

function readOptionalString(
  obj: Record<string, unknown>,
  key: string,
  field: string,
  options: StringOptions = {},
): string | undefined {
  if (obj[key] === undefined || obj[key] === null) return undefined;
  return readString(obj, key, field, options);
}

function readNumber(
  obj: Record<string, unknown>,
  key: string,
  field: string,
): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(field, "must be a finite number");
  }
  return value;
}

function readOptionalNumber(
  obj: Record<string, unknown>,
  key: string,
  field: string,
): number | undefined {
  if (obj[key] === undefined || obj[key] === null) return undefined;
  return readNumber(obj, key, field);
}

function readInteger(
  obj: Record<string, unknown>,
  key: string,
  field: string,
  min = 0,
): number {
  const value = readNumber(obj, key, field);
  if (!Number.isInteger(value) || value < min) {
    fail(field, `must be an integer >= ${min}`);
  }
  return value;
}

function readOptionalInteger(
  obj: Record<string, unknown>,
  key: string,
  field: string,
  min = 0,
): number | undefined {
  if (obj[key] === undefined || obj[key] === null) return undefined;
  return readInteger(obj, key, field, min);
}

function readStringArray(
  obj: Record<string, unknown>,
  key: string,
  field: string,
  max?: number,
): string[] {
  const value = obj[key];
  if (!Array.isArray(value)) fail(field, "must be an array of strings");
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      fail(`${field}[${index}]`, "must be a non-empty string");
    }
  }
  if (max !== undefined && value.length > max) {
    fail(field, `must hold at most ${max} entries`);
  }
  return value as string[];
}

/** Board-scoped commands all carry the deterministic clock and routing. */
function common(action: Record<string, unknown>): void {
  readNumber(action, "at", "action.at");
  readOptionalString(action, "boardId", "action.boardId");
  readOptionalString(action, "commandId", "action.commandId");
  if (action.inverse !== undefined && typeof action.inverse !== "boolean") {
    fail("action.inverse", "must be a boolean");
  }
  if (action.activityIds !== undefined) {
    readStringArray(action, "activityIds", "action.activityIds");
  }
}

/** A card snapshot carried by a restore command. */
function validateCard(value: unknown, field: string): void {
  const card = asRecord(value, field);
  readString(card, "id", `${field}.id`, { nonBlank: true });
  readString(card, "title", `${field}.title`, { max: LIMITS.cardTitle });
  readStringArray(card, "labelIds", `${field}.labelIds`, LIMITS.labelsPerCard);
  readNumber(card, "createdAt", `${field}.createdAt`);
  readNumber(card, "updatedAt", `${field}.updatedAt`);
}

function validateColumn(value: unknown, field: string): void {
  const column = asRecord(value, field);
  readString(column, "id", `${field}.id`, { nonBlank: true });
  readString(column, "title", `${field}.title`, { max: LIMITS.columnTitle });
  readStringArray(column, "cardIds", `${field}.cardIds`);
  readNumber(column, "createdAt", `${field}.createdAt`);
  const wipLimit = readOptionalInteger(
    column,
    "wipLimit",
    `${field}.wipLimit`,
    1,
  );
  if (wipLimit !== undefined && wipLimit > LIMITS.wipLimitMax) {
    fail(`${field}.wipLimit`, `must be at most ${LIMITS.wipLimitMax}`);
  }
}

function validateChecklistItem(value: unknown, field: string): void {
  const item = asRecord(value, field);
  readString(item, "id", `${field}.id`, { nonBlank: true });
  readString(item, "text", `${field}.text`, { max: LIMITS.checklistItem });
  if (typeof item.done !== "boolean")
    fail(`${field}.done`, "must be a boolean");
}

function validateChecklist(value: unknown, field: string): void {
  const checklist = asRecord(value, field);
  readString(checklist, "id", `${field}.id`, { nonBlank: true });
  readString(checklist, "title", `${field}.title`, {
    max: LIMITS.checklistTitle,
  });
  const items = checklist.items;
  if (!Array.isArray(items)) fail(`${field}.items`, "must be an array");
  items.forEach((item, index) =>
    validateChecklistItem(item, `${field}.items[${index}]`),
  );
}

function validateCover(value: unknown, field: string): void {
  const cover = asRecord(value, field);
  if (cover.type === "color") {
    if (!(COVER_COLORS as readonly string[]).includes(cover.value as string)) {
      fail(`${field}.value`, "must be a known cover color");
    }
    return;
  }
  if (cover.type === "gradient") {
    if (
      !(COVER_GRADIENTS as readonly string[]).includes(cover.value as string)
    ) {
      fail(`${field}.value`, "must be a known cover gradient");
    }
    return;
  }
  fail(`${field}.type`, 'must be "color" or "gradient"');
}

/** Validate one command payload and return it narrowed to `BoardAction`. */
function parseAction(action: Record<string, unknown>): BoardAction {
  const type = action.type;
  if (typeof type !== "string") fail("action.type", "must be a string");

  switch (type) {
    case "ADD_COLUMN":
      common(action);
      readString(action, "newColumnId", "action.newColumnId", {
        nonBlank: true,
      });
      readString(action, "title", "action.title", {
        nonBlank: true,
        max: LIMITS.columnTitle,
      });
      break;
    case "RENAME_COLUMN":
      common(action);
      readString(action, "columnId", "action.columnId", { nonBlank: true });
      readString(action, "title", "action.title", {
        nonBlank: true,
        max: LIMITS.columnTitle,
      });
      break;
    case "DELETE_COLUMN":
      common(action);
      readString(action, "columnId", "action.columnId", { nonBlank: true });
      break;
    case "MOVE_COLUMN":
      common(action);
      readString(action, "columnId", "action.columnId", { nonBlank: true });
      readInteger(action, "fromIndex", "action.fromIndex");
      readInteger(action, "toIndex", "action.toIndex");
      break;
    case "DUPLICATE_COLUMN":
      common(action);
      readString(action, "columnId", "action.columnId", { nonBlank: true });
      readString(action, "newColumnId", "action.newColumnId", {
        nonBlank: true,
      });
      readStringArray(action, "newCardIds", "action.newCardIds");
      readOptionalString(action, "title", "action.title", {
        max: LIMITS.columnTitle,
      });
      break;
    case "SORT_COLUMN":
      common(action);
      readString(action, "columnId", "action.columnId", { nonBlank: true });
      if (
        !["createdAt", "dueDate", "title"].includes(action.sortBy as string)
      ) {
        fail("action.sortBy", "must be createdAt, dueDate or title");
      }
      break;
    case "SET_COLUMN_CARD_ORDER":
      common(action);
      readString(action, "columnId", "action.columnId", { nonBlank: true });
      readStringArray(action, "cardIds", "action.cardIds");
      break;
    case "SET_COLUMN_WIP_LIMIT": {
      common(action);
      readString(action, "columnId", "action.columnId", { nonBlank: true });
      const wipLimit = readOptionalInteger(
        action,
        "wipLimit",
        "action.wipLimit",
        1,
      );
      if (wipLimit !== undefined && wipLimit > LIMITS.wipLimitMax) {
        fail("action.wipLimit", `must be at most ${LIMITS.wipLimitMax}`);
      }
      break;
    }
    case "ADD_CARD":
      common(action);
      readString(action, "newCardId", "action.newCardId", { nonBlank: true });
      readString(action, "columnId", "action.columnId", { nonBlank: true });
      readString(action, "title", "action.title", {
        nonBlank: true,
        max: LIMITS.cardTitle,
      });
      if (action.labelIds !== undefined) {
        readStringArray(
          action,
          "labelIds",
          "action.labelIds",
          LIMITS.labelsPerCard,
        );
      }
      readOptionalInteger(action, "atIndex", "action.atIndex");
      break;
    case "UPDATE_CARD":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      readOptionalString(action, "title", "action.title", {
        max: LIMITS.cardTitle,
      });
      readOptionalString(action, "description", "action.description", {
        max: LIMITS.description,
      });
      if (action.quiet !== undefined && typeof action.quiet !== "boolean") {
        fail("action.quiet", "must be a boolean");
      }
      break;
    case "TOUCH_CARD":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      break;
    case "DELETE_CARD":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      break;
    case "ARCHIVE_CARD":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      readOptionalNumber(action, "archivedAt", "action.archivedAt");
      break;
    case "UNARCHIVE_CARD":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      readOptionalString(action, "columnId", "action.columnId");
      readOptionalInteger(action, "index", "action.index");
      break;
    case "ARCHIVE_COLUMN_CARDS":
      common(action);
      readString(action, "columnId", "action.columnId", { nonBlank: true });
      break;
    case "SET_CARD_DUE_DATE":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      readOptionalNumber(action, "dueDate", "action.dueDate");
      break;
    case "SET_CARD_COVER":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      if (action.cover !== undefined && action.cover !== null) {
        validateCover(action.cover, "action.cover");
      }
      break;
    case "MOVE_CARD":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      readString(action, "fromColumnId", "action.fromColumnId", {
        nonBlank: true,
      });
      readString(action, "toColumnId", "action.toColumnId", {
        nonBlank: true,
      });
      readInteger(action, "fromIndex", "action.fromIndex");
      readInteger(action, "toIndex", "action.toIndex");
      break;
    case "DUPLICATE_CARD":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      readString(action, "newCardId", "action.newCardId", { nonBlank: true });
      readOptionalString(action, "title", "action.title", {
        max: LIMITS.cardTitle,
      });
      break;
    case "RESTORE_CARD":
      common(action);
      validateCard(action.card, "action.card");
      readOptionalString(action, "columnId", "action.columnId");
      readOptionalInteger(action, "index", "action.index");
      break;
    case "RESTORE_COLUMN":
      common(action);
      validateColumn(action.column, "action.column");
      readInteger(action, "index", "action.index");
      if (!Array.isArray(action.cards))
        fail("action.cards", "must be an array");
      (action.cards as unknown[]).forEach((card, index) =>
        validateCard(card, `action.cards[${index}]`),
      );
      break;
    case "RESTORE_COLUMN_CARDS":
      common(action);
      readString(action, "columnId", "action.columnId", { nonBlank: true });
      readStringArray(action, "cardIds", "action.cardIds");
      if (!Array.isArray(action.cards))
        fail("action.cards", "must be an array");
      (action.cards as unknown[]).forEach((card, index) =>
        validateCard(card, `action.cards[${index}]`),
      );
      break;
    case "RESTORE_CHECKLIST":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      validateChecklist(action.checklist, "action.checklist");
      readInteger(action, "index", "action.index");
      break;
    case "RESTORE_CHECKLIST_ITEM":
      common(action);
      readString(action, "cardId", "action.cardId", { nonBlank: true });
      readString(action, "checklistId", "action.checklistId", {
        nonBlank: true,
      });
      validateChecklistItem(action.item, "action.item");
      readInteger(action, "index", "action.index");
      break;
    default:
      fail("action.type", `unsupported action type: ${type}`);
  }

  return action as unknown as BoardAction;
}

/**
 * Strictly validate one `BoardAction` for the API boundary. Returns the
 * narrowed action on success, or the field path that failed (so the caller
 * can answer `400 { field }`) — never a clamped action.
 */
export function validateBoardAction(input: unknown): ActionValidationResult {
  try {
    const action = asRecord(input, "action");
    return { ok: true, action: parseAction(action) };
  } catch (error) {
    if (error instanceof FieldError) {
      return { ok: false, field: error.field, message: error.message };
    }
    throw error;
  }
}
