import type { BoardAction, BoardState } from "./board-reducer";
import { isCardLinkType } from "./card-links";
import {
  CARD_ACTIVITY_TYPES,
  CARD_PRIORITIES,
  CLAIM_LEASE_MAX_MS,
  COVER_COLORS,
  COVER_GRADIENTS,
  LABEL_COLORS,
  LIMITS,
  MAX_CARD_ACTIVITY,
} from "../types/kanban";

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
 * The result is *rebuilt* from an allow-list, never the input object: a
 * field the command type does not define (a forged `cardActivity` on a
 * fresh command, a stray `actorId`, a nested `card.evil`) never reaches the
 * reducer, the command log or the SSE fan-out.
 *
 * Only the board-scoped column/card/label/checklist actions plus the
 * board-level commands (`RENAME_BOARD`, `ARCHIVE_BOARD`, `UNARCHIVE_BOARD`)
 * are understood; anything else (array-level `BoardAction`s, unknown types)
 * is rejected here rather than guessed at.
 */

/**
 * Longest id accepted on the wire. Real ids are UUIDs (36 chars), Prisma
 * cuids (25) and `mcp-`-prefixed command ids (≤ 64); 128 leaves headroom
 * without letting an id field carry a payload.
 */
export const MAX_ID_LENGTH = 128;

/** The JS Date range (±8.64e15 ms): anything outside it is not a date. */
const MAX_TIMESTAMP = 8.64e15;

/**
 * Ids that would *replace* an object's prototype when written with
 * `record[id] = value` — every board keeps its cards in a plain record.
 */
const RESERVED_IDS: ReadonlySet<string> = new Set(["__proto__"]);

/**
 * The most activity events one command can append: one per card of a
 * column (`DUPLICATE_COLUMN`, `ARCHIVE_COLUMN_CARDS`).
 */
const MAX_ACTIVITY_IDS = LIMITS.cardsPerColumn;

/**
 * Which command types an inverse may carry `cardUpdatedAt` / `cardActivity`
 * on — exactly the ones `invert()` emits them for. Anywhere else the field
 * is meaningless at best and a forged feed at worst, so it is dropped.
 */
const CARD_STAMPED_TYPES: ReadonlySet<string> = new Set([
  "UPDATE_CARD",
  "TOUCH_CARD",
  "ARCHIVE_CARD",
  "UNARCHIVE_CARD",
  "SET_CARD_DUE_DATE",
  "SET_CARD_PRIORITY",
  "SET_CARD_ASSIGN",
  "CLAIM_CARD",
  "ADD_CARD_LINK",
  "REMOVE_CARD_LINK",
  "SET_CARD_COVER",
  "RENAME_CHECKLIST",
  "DELETE_CHECKLIST",
  "RESTORE_CHECKLIST",
  "SET_CHECKLIST_ITEM_DONE",
  "RENAME_CHECKLIST_ITEM",
  "DELETE_CHECKLIST_ITEM",
  "RESTORE_CHECKLIST_ITEM",
]);
const CARD_ACTIVITY_REWIND_TYPES: ReadonlySet<string> = new Set([
  ...[...CARD_STAMPED_TYPES].filter((type) => type !== "TOUCH_CARD"),
  "MOVE_CARD",
  "SET_CARD_LABEL",
]);

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

type Json = Record<string, unknown>;

/** The input is a plain JSON object (not `null`, not an array). */
function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, field: string): Json {
  if (!isRecord(value)) fail(field, "must be an object");
  return value;
}

/** Absent on the wire: `undefined` or JSON `null`. */
function absent(value: unknown): value is undefined | null {
  return value === undefined || value === null;
}

/** Copy `value` into `out[key]` unless it is `undefined` (omit-when-unset). */
function put(out: Json, key: string, value: unknown): void {
  if (value !== undefined) out[key] = value;
}

interface StringOptions {
  /** Reject values whose trimmed length is zero. */
  nonBlank?: boolean;
  /** Reject values longer than this bound. */
  max?: number;
}

function checkString(
  value: unknown,
  field: string,
  options: StringOptions = {},
): string {
  if (typeof value !== "string") fail(field, "must be a string");
  if (options.nonBlank && value.trim().length === 0) {
    fail(field, "must not be blank");
  }
  // The raw length, not the trimmed one: half a megabyte of padding around
  // one visible character is still half a megabyte on the wire and in a log.
  if (options.max !== undefined && value.length > options.max) {
    fail(field, `must be at most ${options.max} characters`);
  }
  return value;
}

function readString(
  obj: Json,
  key: string,
  field: string,
  options: StringOptions = {},
): string {
  return checkString(obj[key], field, options);
}

function readOptionalString(
  obj: Json,
  key: string,
  field: string,
  options: StringOptions = {},
): string | undefined {
  if (absent(obj[key])) return undefined;
  return readString(obj, key, field, options);
}

/** A non-blank, length-capped id that is safe as a plain-object key. */
function checkId(value: unknown, field: string): string {
  const id = checkString(value, field, { nonBlank: true, max: MAX_ID_LENGTH });
  if (RESERVED_IDS.has(id)) fail(field, "is a reserved id");
  return id;
}

function readId(obj: Json, key: string, field: string): string {
  return checkId(obj[key], field);
}

function readOptionalId(
  obj: Json,
  key: string,
  field: string,
): string | undefined {
  if (absent(obj[key])) return undefined;
  return readId(obj, key, field);
}

function readNumber(obj: Json, key: string, field: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(field, "must be a finite number");
  }
  return value;
}

/** A Unix timestamp (ms) a `Date` can represent — `1e300` is not one. */
function readTimestamp(obj: Json, key: string, field: string): number {
  const value = readNumber(obj, key, field);
  if (Math.abs(value) > MAX_TIMESTAMP) {
    fail(field, "must be a timestamp within the Date range");
  }
  return value;
}

function readOptionalTimestamp(
  obj: Json,
  key: string,
  field: string,
): number | undefined {
  if (absent(obj[key])) return undefined;
  return readTimestamp(obj, key, field);
}

function readInteger(obj: Json, key: string, field: string, min = 0): number {
  const value = readNumber(obj, key, field);
  if (!Number.isInteger(value) || value < min) {
    fail(field, `must be an integer >= ${min}`);
  }
  return value;
}

function readOptionalInteger(
  obj: Json,
  key: string,
  field: string,
  min = 0,
): number | undefined {
  if (absent(obj[key])) return undefined;
  return readInteger(obj, key, field, min);
}

function readArray(
  obj: Json,
  key: string,
  field: string,
  max?: number,
): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) fail(field, "must be an array");
  if (max !== undefined && value.length > max) {
    fail(field, `must hold at most ${max} entries`);
  }
  return value;
}

/** An array of ids; the length cap is checked before any entry is read. */
function readIdArray(
  obj: Json,
  key: string,
  field: string,
  max: number,
): string[] {
  const value = obj[key];
  if (!Array.isArray(value)) fail(field, "must be an array of strings");
  if (value.length > max) fail(field, `must hold at most ${max} entries`);
  return value.map((entry, index) => checkId(entry, `${field}[${index}]`));
}

function readBoolean(obj: Json, key: string, field: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") fail(field, "must be a boolean");
  return value;
}

function readOptionalBoolean(
  obj: Json,
  key: string,
  field: string,
): boolean | undefined {
  if (obj[key] === undefined) return undefined;
  return readBoolean(obj, key, field);
}

/** One activity-feed entry (`CardActivityEvent`), rebuilt. */
function validateActivityEvent(value: unknown, field: string): Json {
  const event = asRecord(value, field);
  const out: Json = {
    id: readId(event, "id", `${field}.id`),
  };
  if (
    typeof event.type !== "string" ||
    !(CARD_ACTIVITY_TYPES as readonly string[]).includes(event.type)
  ) {
    fail(`${field}.type`, "must be a known activity type");
  }
  out.type = event.type;
  out.at = readTimestamp(event, "at", `${field}.at`);
  // `null` is a real value here ("no actor known"), not an absent field.
  // Not `readId`: a feed recorded before sign-in may hold an empty actor.
  out.actorId = absent(event.actorId)
    ? null
    : readString(event, "actorId", `${field}.actorId`, {
        max: MAX_ID_LENGTH,
      });
  // A detail is a display snapshot of a title or name — at most a card title.
  put(
    out,
    "detail",
    readOptionalString(event, "detail", `${field}.detail`, {
      max: LIMITS.cardTitle,
    }),
  );
  return out;
}

/** A card's activity feed, capped like the reducer caps it. */
function validateActivity(value: unknown, field: string): Json[] {
  if (!Array.isArray(value)) fail(field, "must be an array");
  if (value.length > MAX_CARD_ACTIVITY) {
    fail(field, `must hold at most ${MAX_CARD_ACTIVITY} entries`);
  }
  return value.map((event, index) =>
    validateActivityEvent(event, `${field}[${index}]`),
  );
}

/**
 * Board-scoped commands all carry the deterministic clock and routing.
 * Returns the head of the rebuilt action.
 *
 * The inverse-only overrides (`boardUpdatedAt`, `cardUpdatedAt`,
 * `cardActivity`) are kept only on a command flagged `inverse: true` —
 * the only kind `invert()` puts them on. A fresh command carrying them is
 * a hand-crafted one rewriting history (someone else's activity feed,
 * a back-dated `updatedAt`), so they are dropped there.
 */
function common(action: Json, type: string): Json {
  const out: Json = { type };
  out.at = readTimestamp(action, "at", "action.at");
  put(out, "boardId", readOptionalId(action, "boardId", "action.boardId"));
  put(
    out,
    "commandId",
    readOptionalId(action, "commandId", "action.commandId"),
  );
  const inverse = readOptionalBoolean(action, "inverse", "action.inverse");
  put(out, "inverse", inverse);
  if (action.activityIds !== undefined) {
    out.activityIds = readIdArray(
      action,
      "activityIds",
      "action.activityIds",
      MAX_ACTIVITY_IDS,
    );
  }
  if (inverse === true) {
    put(
      out,
      "boardUpdatedAt",
      readOptionalTimestamp(action, "boardUpdatedAt", "action.boardUpdatedAt"),
    );
    if (CARD_STAMPED_TYPES.has(type)) {
      put(
        out,
        "cardUpdatedAt",
        readOptionalTimestamp(action, "cardUpdatedAt", "action.cardUpdatedAt"),
      );
    }
    if (CARD_ACTIVITY_REWIND_TYPES.has(type) && !absent(action.cardActivity)) {
      out.cardActivity = validateActivity(
        action.cardActivity,
        "action.cardActivity",
      );
    }
  }
  return out;
}

/**
 * A card snapshot carried by a restore command, rebuilt field by field.
 * Everything the writers persist is validated here (TASK-30.2): without
 * the nested checks a `RESTORE_*` snapshot could smuggle oversized text or
 * unlimited checklists past the collection limits the create commands
 * enforce.
 */
function validateCard(value: unknown, field: string): Json {
  const card = asRecord(value, field);
  const out: Json = {
    id: readId(card, "id", `${field}.id`),
    title: readString(card, "title", `${field}.title`, {
      max: LIMITS.cardTitle,
    }),
  };
  put(
    out,
    "description",
    readOptionalString(card, "description", `${field}.description`, {
      max: LIMITS.description,
    }),
  );
  out.labelIds = readIdArray(
    card,
    "labelIds",
    `${field}.labelIds`,
    LIMITS.labelsPerCard,
  );
  out.createdAt = readTimestamp(card, "createdAt", `${field}.createdAt`);
  out.updatedAt = readTimestamp(card, "updatedAt", `${field}.updatedAt`);
  put(
    out,
    "dueDate",
    readOptionalTimestamp(card, "dueDate", `${field}.dueDate`),
  );
  put(
    out,
    "archivedAt",
    readOptionalTimestamp(card, "archivedAt", `${field}.archivedAt`),
  );
  // TASK-97: a RESTORE_* snapshot must validate the fields the create/edit
  // commands constrain — priority, assignee and the activity feed.
  if (!absent(card.priority)) {
    if (
      typeof card.priority !== "string" ||
      !(CARD_PRIORITIES as readonly string[]).includes(card.priority)
    ) {
      fail(`${field}.priority`, "must be a known priority");
    }
    out.priority = card.priority;
  }
  put(
    out,
    "assigneeId",
    readOptionalId(card, "assigneeId", `${field}.assigneeId`),
  );
  put(
    out,
    "claimedBy",
    readOptionalId(card, "claimedBy", `${field}.claimedBy`),
  );
  put(
    out,
    "leaseUntil",
    readOptionalTimestamp(card, "leaseUntil", `${field}.leaseUntil`),
  );
  // Server-side denormalized columns (TASK-36, TASK-47) ride along in the
  // snapshot so an undo does not blank the avatar or attachment badge.
  put(
    out,
    "lastActorId",
    readOptionalId(card, "lastActorId", `${field}.lastActorId`),
  );
  // No upper bound: the counter is the server's, and an undo must not
  // fail on a count the upload limit was later lowered under.
  put(
    out,
    "attachmentCount",
    readOptionalInteger(card, "attachmentCount", `${field}.attachmentCount`),
  );
  if (!absent(card.activity)) {
    out.activity = validateActivity(card.activity, `${field}.activity`);
  }
  if (!absent(card.cover)) {
    out.cover = validateCover(card.cover, `${field}.cover`);
  }
  if (!absent(card.checklists)) {
    out.checklists = readArray(
      card,
      "checklists",
      `${field}.checklists`,
      LIMITS.checklistsPerCard,
    ).map((checklist, index) =>
      validateChecklist(checklist, `${field}.checklists[${index}]`),
    );
  }
  if (!absent(card.links)) {
    out.links = readArray(
      card,
      "links",
      `${field}.links`,
      LIMITS.linksPerCard,
    ).map((link, index) => validateCardLink(link, `${field}.links[${index}]`));
  }
  return out;
}

function validateColumn(value: unknown, field: string): Json {
  const column = asRecord(value, field);
  const out: Json = {
    id: readId(column, "id", `${field}.id`),
    title: readString(column, "title", `${field}.title`, {
      max: LIMITS.columnTitle,
    }),
    cardIds: readIdArray(
      column,
      "cardIds",
      `${field}.cardIds`,
      LIMITS.cardsPerColumn,
    ),
    createdAt: readTimestamp(column, "createdAt", `${field}.createdAt`),
  };
  const wipLimit = readOptionalInteger(
    column,
    "wipLimit",
    `${field}.wipLimit`,
    1,
  );
  if (wipLimit !== undefined && wipLimit > LIMITS.wipLimitMax) {
    fail(`${field}.wipLimit`, `must be at most ${LIMITS.wipLimitMax}`);
  }
  put(out, "wipLimit", wipLimit);
  return out;
}

function validateChecklistItem(value: unknown, field: string): Json {
  const item = asRecord(value, field);
  return {
    id: readId(item, "id", `${field}.id`),
    text: readString(item, "text", `${field}.text`, {
      max: LIMITS.checklistItem,
    }),
    done: readBoolean(item, "done", `${field}.done`),
  };
}

/** One link row of a restore snapshot: id, known type, non-blank target. */
function validateCardLink(value: unknown, field: string): Json {
  const link = asRecord(value, field);
  const out: Json = {
    id: readId(link, "id", `${field}.id`),
    targetCardId: readId(link, "targetCardId", `${field}.targetCardId`),
  };
  if (!isCardLinkType(link.type)) {
    fail(`${field}.type`, "must be a known link type");
  }
  out.type = link.type;
  return out;
}

function validateChecklist(value: unknown, field: string): Json {
  const checklist = asRecord(value, field);
  return {
    id: readId(checklist, "id", `${field}.id`),
    title: readString(checklist, "title", `${field}.title`, {
      max: LIMITS.checklistTitle,
    }),
    items: readArray(
      checklist,
      "items",
      `${field}.items`,
      LIMITS.itemsPerChecklist,
    ).map((item, index) =>
      validateChecklistItem(item, `${field}.items[${index}]`),
    ),
  };
}

function validateCover(value: unknown, field: string): Json {
  const cover = asRecord(value, field);
  if (cover.type === "color") {
    if (!(COVER_COLORS as readonly string[]).includes(cover.value as string)) {
      fail(`${field}.value`, "must be a known cover color");
    }
    return { type: "color", value: cover.value };
  }
  if (cover.type === "gradient") {
    if (
      !(COVER_GRADIENTS as readonly string[]).includes(cover.value as string)
    ) {
      fail(`${field}.value`, "must be a known cover gradient");
    }
    return { type: "gradient", value: cover.value };
  }
  fail(`${field}.type`, 'must be "color" or "gradient"');
}

/**
 * Label colors accepted on the wire: the current picker palette plus the
 * retired `amber` (persisted labels may still carry it, TASK-16).
 */
function validateLabelColor(value: unknown, field: string): string {
  const known = [...LABEL_COLORS, "amber"] as readonly string[];
  if (typeof value !== "string" || !known.includes(value)) {
    fail(field, "must be a known label color");
  }
  return value;
}

function validateLabel(value: unknown, field: string): Json {
  const label = asRecord(value, field);
  return {
    id: readId(label, "id", `${field}.id`),
    name: readString(label, "name", `${field}.name`, {
      nonBlank: true,
      max: LIMITS.labelName,
    }),
    color: validateLabelColor(label.color, `${field}.color`),
  };
}

/** A restore payload's card list — never more than one column holds. */
function validateCards(action: Json): Json[] {
  return readArray(action, "cards", "action.cards", LIMITS.cardsPerColumn).map(
    (card, index) => validateCard(card, `action.cards[${index}]`),
  );
}

/** Validate one command payload and rebuild it as a `BoardAction`. */
function parseAction(action: Json): BoardAction {
  const type = action.type;
  if (typeof type !== "string") fail("action.type", "must be a string");

  const out = (): Json => common(action, type);
  const id = (key: string): string => readId(action, key, `action.${key}`);
  const optionalId = (key: string): string | undefined =>
    readOptionalId(action, key, `action.${key}`);
  const index = (key: string): number =>
    readInteger(action, key, `action.${key}`);
  const optionalIndex = (key: string): number | undefined =>
    readOptionalInteger(action, key, `action.${key}`);
  const text = (key: string, max: number): string =>
    readString(action, key, `action.${key}`, { nonBlank: true, max });

  let result: Json;
  switch (type) {
    case "ADD_COLUMN":
      result = out();
      result.newColumnId = id("newColumnId");
      result.title = text("title", LIMITS.columnTitle);
      break;
    case "RENAME_COLUMN":
      result = out();
      result.columnId = id("columnId");
      result.title = text("title", LIMITS.columnTitle);
      break;
    case "DELETE_COLUMN":
    case "ARCHIVE_COLUMN_CARDS":
      result = out();
      result.columnId = id("columnId");
      break;
    case "RENAME_BOARD":
      result = out();
      result.title = text("title", LIMITS.boardTitle);
      break;
    case "ARCHIVE_BOARD":
    case "UNARCHIVE_BOARD":
      result = out();
      break;
    case "MOVE_COLUMN":
      result = out();
      result.columnId = id("columnId");
      result.fromIndex = index("fromIndex");
      result.toIndex = index("toIndex");
      break;
    case "DUPLICATE_COLUMN":
      result = out();
      result.columnId = id("columnId");
      result.newColumnId = id("newColumnId");
      result.newCardIds = readIdArray(
        action,
        "newCardIds",
        "action.newCardIds",
        LIMITS.cardsPerColumn,
      );
      put(
        result,
        "title",
        readOptionalString(action, "title", "action.title", {
          max: LIMITS.columnTitle,
        }),
      );
      break;
    case "SORT_COLUMN":
      result = out();
      result.columnId = id("columnId");
      if (
        !["createdAt", "dueDate", "title"].includes(action.sortBy as string)
      ) {
        fail("action.sortBy", "must be createdAt, dueDate or title");
      }
      result.sortBy = action.sortBy;
      break;
    case "SET_COLUMN_CARD_ORDER":
      result = out();
      result.columnId = id("columnId");
      result.cardIds = readIdArray(
        action,
        "cardIds",
        "action.cardIds",
        LIMITS.cardsPerColumn,
      );
      break;
    case "SET_COLUMN_WIP_LIMIT": {
      result = out();
      result.columnId = id("columnId");
      const wipLimit = readOptionalInteger(
        action,
        "wipLimit",
        "action.wipLimit",
        1,
      );
      if (wipLimit !== undefined && wipLimit > LIMITS.wipLimitMax) {
        fail("action.wipLimit", `must be at most ${LIMITS.wipLimitMax}`);
      }
      put(result, "wipLimit", wipLimit);
      break;
    }
    case "ADD_CARD":
      result = out();
      result.newCardId = id("newCardId");
      result.columnId = id("columnId");
      result.title = text("title", LIMITS.cardTitle);
      if (action.labelIds !== undefined) {
        result.labelIds = readIdArray(
          action,
          "labelIds",
          "action.labelIds",
          LIMITS.labelsPerCard,
        );
      }
      put(result, "atIndex", optionalIndex("atIndex"));
      break;
    case "UPDATE_CARD":
      result = out();
      result.cardId = id("cardId");
      put(
        result,
        "title",
        readOptionalString(action, "title", "action.title", {
          max: LIMITS.cardTitle,
        }),
      );
      put(
        result,
        "description",
        readOptionalString(action, "description", "action.description", {
          max: LIMITS.description,
        }),
      );
      put(
        result,
        "quiet",
        readOptionalBoolean(action, "quiet", "action.quiet"),
      );
      break;
    case "TOUCH_CARD":
    case "DELETE_CARD":
      result = out();
      result.cardId = id("cardId");
      break;
    case "ARCHIVE_CARD":
      result = out();
      result.cardId = id("cardId");
      put(
        result,
        "archivedAt",
        readOptionalTimestamp(action, "archivedAt", "action.archivedAt"),
      );
      break;
    case "UNARCHIVE_CARD":
      result = out();
      result.cardId = id("cardId");
      put(result, "columnId", optionalId("columnId"));
      put(result, "index", optionalIndex("index"));
      break;
    case "SET_CARD_DUE_DATE":
      result = out();
      result.cardId = id("cardId");
      put(
        result,
        "dueDate",
        readOptionalTimestamp(action, "dueDate", "action.dueDate"),
      );
      break;
    case "SET_CARD_PRIORITY": {
      result = out();
      result.cardId = id("cardId");
      const { priority } = action;
      if (
        typeof priority !== "string" ||
        !(CARD_PRIORITIES as readonly string[]).includes(priority)
      ) {
        fail("action.priority", "must be a known priority");
      }
      result.priority = priority;
      break;
    }
    case "SET_CARD_ASSIGN": {
      result = out();
      result.cardId = id("cardId");
      if (action.assigneeId === null) {
        result.assigneeId = null;
      } else if (
        typeof action.assigneeId !== "string" ||
        action.assigneeId.trim() === ""
      ) {
        fail("action.assigneeId", "must be null or a non-blank user id");
      } else {
        result.assigneeId = id("assigneeId");
      }
      break;
    }
    case "CLAIM_CARD": {
      result = out();
      result.cardId = id("cardId");
      const at = readTimestamp(action, "at", "action.at");
      if (action.claimedBy === null) {
        if (action.leaseUntil !== null && action.leaseUntil !== undefined) {
          fail("action.leaseUntil", "must be null when releasing a claim");
        }
        result.claimedBy = null;
        result.leaseUntil = null;
      } else if (
        typeof action.claimedBy !== "string" ||
        action.claimedBy.trim() === ""
      ) {
        fail("action.claimedBy", "must be null or a non-blank user id");
      } else {
        result.claimedBy = id("claimedBy");
        const lease = readOptionalTimestamp(
          action,
          "leaseUntil",
          "action.leaseUntil",
        );
        if (lease === undefined) {
          fail("action.leaseUntil", "is required when claiming");
        }
        // A forward lease may not run past the cap; a past value is allowed
        // so an inverse can restore a lapsed claim verbatim.
        if (lease > at + CLAIM_LEASE_MAX_MS) {
          fail("action.leaseUntil", "lease is too long");
        }
        result.leaseUntil = lease;
      }
      break;
    }
    case "ADD_CARD_LINK":
    case "REMOVE_CARD_LINK": {
      result = out();
      result.cardId = id("cardId");
      result.linkId = id("linkId");
      result.targetCardId = id("targetCardId");
      if (!isCardLinkType(action.linkType)) {
        fail("action.linkType", "must be a known link type");
      }
      result.linkType = action.linkType;
      break;
    }
    case "SET_CARD_COVER":
      result = out();
      result.cardId = id("cardId");
      if (!absent(action.cover)) {
        result.cover = validateCover(action.cover, "action.cover");
      }
      break;
    case "MOVE_CARD":
      result = out();
      result.cardId = id("cardId");
      result.fromColumnId = id("fromColumnId");
      result.toColumnId = id("toColumnId");
      result.fromIndex = index("fromIndex");
      result.toIndex = index("toIndex");
      break;
    case "DUPLICATE_CARD":
      result = out();
      result.cardId = id("cardId");
      result.newCardId = id("newCardId");
      put(
        result,
        "title",
        readOptionalString(action, "title", "action.title", {
          max: LIMITS.cardTitle,
        }),
      );
      break;
    case "RESTORE_CARD":
      result = out();
      result.card = validateCard(action.card, "action.card");
      put(result, "columnId", optionalId("columnId"));
      put(result, "index", optionalIndex("index"));
      break;
    case "RESTORE_COLUMN":
      result = out();
      result.column = validateColumn(action.column, "action.column");
      result.index = index("index");
      result.cards = validateCards(action);
      break;
    case "RESTORE_COLUMN_CARDS":
      result = out();
      result.columnId = id("columnId");
      result.cardIds = readIdArray(
        action,
        "cardIds",
        "action.cardIds",
        LIMITS.cardsPerColumn,
      );
      result.cards = validateCards(action);
      break;
    case "RESTORE_CHECKLIST":
      result = out();
      result.cardId = id("cardId");
      result.checklist = validateChecklist(
        action.checklist,
        "action.checklist",
      );
      result.index = index("index");
      break;
    case "RESTORE_CHECKLIST_ITEM":
      result = out();
      result.cardId = id("cardId");
      result.checklistId = id("checklistId");
      result.item = validateChecklistItem(action.item, "action.item");
      result.index = index("index");
      break;
    case "SET_CARD_LABEL":
      result = out();
      result.cardId = id("cardId");
      result.labelId = id("labelId");
      result.on = readBoolean(action, "on", "action.on");
      put(result, "index", optionalIndex("index"));
      break;
    case "ADD_LABEL":
      result = out();
      result.label = validateLabel(action.label, "action.label");
      break;
    case "RENAME_LABEL":
      result = out();
      result.labelId = id("labelId");
      result.name = text("name", LIMITS.labelName);
      break;
    case "SET_LABEL_COLOR":
      result = out();
      result.labelId = id("labelId");
      result.color = validateLabelColor(action.color, "action.color");
      break;
    case "DELETE_LABEL":
      result = out();
      result.labelId = id("labelId");
      break;
    case "RESTORE_LABEL":
      result = out();
      result.label = validateLabel(action.label, "action.label");
      result.index = index("index");
      if (action.assignments !== undefined) {
        result.assignments = readArray(
          action,
          "assignments",
          "action.assignments",
        ).map((entry, position) => {
          const field = `action.assignments[${position}]`;
          const assignment = asRecord(entry, field);
          return {
            cardId: readId(assignment, "cardId", `${field}.cardId`),
            index: readInteger(assignment, "index", `${field}.index`),
          };
        });
      }
      break;
    case "ADD_CHECKLIST":
      result = out();
      result.cardId = id("cardId");
      result.newChecklistId = id("newChecklistId");
      result.title = text("title", LIMITS.checklistTitle);
      break;
    case "RENAME_CHECKLIST":
      result = out();
      result.cardId = id("cardId");
      result.checklistId = id("checklistId");
      result.title = text("title", LIMITS.checklistTitle);
      break;
    case "DELETE_CHECKLIST":
      result = out();
      result.cardId = id("cardId");
      result.checklistId = id("checklistId");
      break;
    case "ADD_CHECKLIST_ITEM":
      result = out();
      result.cardId = id("cardId");
      result.checklistId = id("checklistId");
      result.newItemId = id("newItemId");
      result.text = text("text", LIMITS.checklistItem);
      break;
    case "SET_CHECKLIST_ITEM_DONE":
      result = out();
      result.cardId = id("cardId");
      result.checklistId = id("checklistId");
      result.itemId = id("itemId");
      result.done = readBoolean(action, "done", "action.done");
      break;
    case "RENAME_CHECKLIST_ITEM":
      result = out();
      result.cardId = id("cardId");
      result.checklistId = id("checklistId");
      result.itemId = id("itemId");
      result.text = text("text", LIMITS.checklistItem);
      break;
    case "DELETE_CHECKLIST_ITEM":
      result = out();
      result.cardId = id("cardId");
      result.checklistId = id("checklistId");
      result.itemId = id("itemId");
      break;
    default:
      fail("action.type", `unsupported action type: ${type}`);
  }

  return result as unknown as BoardAction;
}

/**
 * Strictly validate one `BoardAction` for the API boundary. Returns a
 * rebuilt copy holding only the fields the command type defines, or the
 * field path that failed (so the caller can answer `400 { field }`) —
 * never a clamped action, and never the input object itself.
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

/* ------------------------------------------------------------------ import */

/** Result of checking an imported `boards` array. */
export type BoardsValidationResult =
  | { ok: true; boards: BoardState }
  | { ok: false; field: string; message: string };

/**
 * Structural and integrity checks for an imported board set (export file,
 * server import) — the step before the lenient `normalizeBoards` pass.
 *
 * Split of duties: whatever normalization can repair stays its job (text
 * clamps, the legacy `labelId`, unknown label colors, malformed optional
 * card fields), so old exports keep importing. What it cannot repair is
 * refused here with a field path instead of surfacing later as a raw
 * `TypeError` or a server 500: wrong types on required fields, timestamps
 * that are not dates, collections over `LIMITS`, duplicate ids, a column
 * listing a card that does not exist, a card sitting in two places.
 */
export function validateImportedBoards(input: unknown): BoardsValidationResult {
  try {
    if (!Array.isArray(input)) fail("boards", "must be an array");
    if (input.length > LIMITS.boardsCount) {
      fail("boards", `must hold at most ${LIMITS.boardsCount} boards`);
    }
    const boardIds = new Set<string>();
    input.forEach((board, index) => {
      const field = `boards[${index}]`;
      const id = checkImportedBoard(board, field);
      if (boardIds.has(id)) fail(`${field}.id`, "duplicates another board");
      boardIds.add(id);
    });
    return { ok: true, boards: input as BoardState };
  } catch (error) {
    if (error instanceof FieldError) {
      return { ok: false, field: error.field, message: error.message };
    }
    throw error;
  }
}

/** Check one imported board; returns its id. */
function checkImportedBoard(value: unknown, field: string): string {
  const board = asRecord(value, field);
  const id = readId(board, "id", `${field}.id`);
  readString(board, "title", `${field}.title`);
  readTimestamp(board, "createdAt", `${field}.createdAt`);
  readTimestamp(board, "updatedAt", `${field}.updatedAt`);
  readOptionalTimestamp(board, "archivedAt", `${field}.archivedAt`);

  const labelIds = new Set<string>();
  readArray(board, "labels", `${field}.labels`, LIMITS.labelsPerBoard).forEach(
    (entry, index) => {
      const labelField = `${field}.labels[${index}]`;
      const label = asRecord(entry, labelField);
      const labelId = readId(label, "id", `${labelField}.id`);
      // The name is clamped by normalization; the color falls back there.
      readString(label, "name", `${labelField}.name`);
      if (labelIds.has(labelId)) {
        fail(`${labelField}.id`, "duplicates another label");
      }
      labelIds.add(labelId);
    },
  );

  const cards = asRecord(board.cards, `${field}.cards`);
  for (const [key, entry] of Object.entries(cards)) {
    checkImportedCard(key, entry, `${field}.cards[${JSON.stringify(key)}]`);
  }

  const columnIds = new Set<string>();
  // Card id → the column field that already holds it.
  const placed = new Map<string, string>();
  readArray(
    board,
    "columns",
    `${field}.columns`,
    LIMITS.columnsPerBoard,
  ).forEach((entry, index) => {
    const columnField = `${field}.columns[${index}]`;
    const column = asRecord(entry, columnField);
    const columnId = readId(column, "id", `${columnField}.id`);
    if (columnIds.has(columnId)) {
      fail(`${columnField}.id`, "duplicates another column");
    }
    columnIds.add(columnId);
    readString(column, "title", `${columnField}.title`);
    readTimestamp(column, "createdAt", `${columnField}.createdAt`);
    const cardIds = readIdArray(
      column,
      "cardIds",
      `${columnField}.cardIds`,
      LIMITS.cardsPerColumn,
    );
    cardIds.forEach((cardId, position) => {
      const idField = `${columnField}.cardIds[${position}]`;
      if (!Object.hasOwn(cards, cardId)) {
        fail(idField, "references a card that does not exist");
      }
      if (placed.has(cardId)) {
        fail(idField, `is already placed at ${placed.get(cardId)}`);
      }
      placed.set(cardId, idField);
    });
  });
  return id;
}

/** Check one imported card stored under `key`. */
function checkImportedCard(key: string, value: unknown, field: string): void {
  const card = asRecord(value, field);
  const id = readId(card, "id", `${field}.id`);
  if (id !== key) fail(`${field}.id`, "must match the key it is stored under");
  readString(card, "title", `${field}.title`);
  readOptionalString(card, "description", `${field}.description`);
  // `labelId` (single, nullable) is the v1 shape normalization converts.
  // A card cannot carry more labels than a board defines; normalization
  // trims the list further to `labelsPerCard`.
  if (card.labelIds !== undefined) {
    readIdArray(card, "labelIds", `${field}.labelIds`, LIMITS.labelsPerBoard);
  } else if (card.labelId !== undefined && card.labelId !== null) {
    readId(card, "labelId", `${field}.labelId`);
  }
  readTimestamp(card, "createdAt", `${field}.createdAt`);
  readTimestamp(card, "updatedAt", `${field}.updatedAt`);
  readOptionalTimestamp(card, "archivedAt", `${field}.archivedAt`);
  readOptionalTimestamp(card, "dueDate", `${field}.dueDate`);
}
