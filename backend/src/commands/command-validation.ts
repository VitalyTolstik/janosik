import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { BoardAction } from "@janosik/shared";
import { MAX_COMMAND_BYTES, validateBoardAction } from "@janosik/shared";
import type { CreateCommandDto } from "./dto/create-command.dto";

/**
 * Command validation shared by the live command transport and the approval
 * plan validator (TASK-166.5). Keeping the two on one function is what makes
 * "the same validator as batch/plan" true instead of aspirational: a plan
 * that would be refused by `POST /commands` is refused before an approval is
 * created, and an approved plan is prepared exactly like the original call.
 */

/** Every action type the command endpoint understands (TASK-96). */
type CommandActionType = Exclude<
  BoardAction["type"],
  "RESTORE_BOARD" | "IMPORT_BOARDS" | "ADD_BOARD" | "REMOVE_BOARD"
>;

const ACTION_REGISTRY: Record<CommandActionType, true> = {
  RENAME_BOARD: true,
  SET_BOARD_COLUMN_STYLE: true,
  SET_BOARD_WORKFLOW: true,
  ARCHIVE_BOARD: true,
  UNARCHIVE_BOARD: true,
  ADD_COLUMN: true,
  RENAME_COLUMN: true,
  DELETE_COLUMN: true,
  DUPLICATE_COLUMN: true,
  MOVE_COLUMN: true,
  SORT_COLUMN: true,
  SET_COLUMN_WIP_LIMIT: true,
  SET_COLUMN_ACCENT: true,
  SET_COLUMN_CARD_ORDER: true,
  ADD_CARD: true,
  UPDATE_CARD: true,
  TOUCH_CARD: true,
  DELETE_CARD: true,
  ARCHIVE_CARD: true,
  UNARCHIVE_CARD: true,
  ARCHIVE_COLUMN_CARDS: true,
  SET_CARD_DUE_DATE: true,
  SET_CARD_PRIORITY: true,
  SET_CARD_ASSIGN: true,
  CLAIM_CARD: true,
  SET_CARD_TASK_SPEC: true,
  ADD_CARD_LINK: true,
  REMOVE_CARD_LINK: true,
  SET_CARD_COVER: true,
  MOVE_CARD: true,
  DUPLICATE_CARD: true,
  SET_CARD_LABEL: true,
  ADD_LABEL: true,
  RENAME_LABEL: true,
  SET_LABEL_COLOR: true,
  DELETE_LABEL: true,
  ADD_CHECKLIST: true,
  RENAME_CHECKLIST: true,
  DELETE_CHECKLIST: true,
  ADD_CHECKLIST_ITEM: true,
  SET_CHECKLIST_ITEM_DONE: true,
  RENAME_CHECKLIST_ITEM: true,
  DELETE_CHECKLIST_ITEM: true,
  RESTORE_CARD: true,
  RESTORE_COLUMN: true,
  RESTORE_COLUMN_CARDS: true,
  RESTORE_LABEL: true,
  RESTORE_CHECKLIST: true,
  RESTORE_CHECKLIST_ITEM: true,
};

export const SUPPORTED_COMMAND_ACTIONS = new Set<string>(
  Object.keys(ACTION_REGISTRY),
);

export const MAX_COMMAND_BYTES_INTERNAL = 8 * 1024 * 1024;

/**
 * B-5: how far a client's `action.at` may drift from the server clock and
 * still be trusted. Kept with the validation helpers so the approval planner
 * and the live transport share the exact same rule.
 */
export const COMMAND_AT_MAX_SKEW_MS = 5 * 60 * 1000;

/** ECMAScript's Date range (ms) — same bound the command transport uses. */
const MAX_DATE_MS = 8.64e15;

/** Field names whose numeric values the writers turn into `Date`s. */
const DATE_FIELD = /^(at|dueDate|[a-z]+At)$/;

/** A validated command action plus the wire DTO it came from. */
export interface PreparedCommand {
  dto: CreateCommandDto;
  action: BoardAction;
  fingerprint: string;
}

/**
 * Validate one action through the shared reducer validator and rebuild it
 * from the allow-list. `allowMissingAt` lets an approval plan omit the server
 * clock: a placeholder is used for validation and stripped by the planner.
 */
export function validateCommandAction(
  raw: unknown,
  options: { allowOversize?: boolean; allowMissingAt?: boolean } = {},
): BoardAction {
  const bytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
  const cap =
    options.allowOversize === true
      ? MAX_COMMAND_BYTES_INTERNAL
      : MAX_COMMAND_BYTES;
  if (bytes > cap) {
    throw new PayloadTooLargeException({
      message: `Command is too large (${bytes} bytes, max ${cap})`,
      field: "action",
      code: "payload_too_large",
      limit: cap,
      retryable: false,
    });
  }
  const candidate =
    options.allowMissingAt === true &&
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    typeof (raw as Record<string, unknown>).at !== "number"
      ? { ...(raw as Record<string, unknown>), at: 0 }
      : raw;
  const validation = validateBoardAction(candidate);
  if (!validation.ok) {
    throw new BadRequestException({
      message: `Invalid command (${validation.field}): ${validation.message}`,
      field: validation.field,
    });
  }
  if (!SUPPORTED_COMMAND_ACTIONS.has(validation.action.type)) {
    throw new BadRequestException({
      message: `Unsupported command type: ${validation.action.type}`,
      field: "action.type",
    });
  }
  assertDatesInRange(validation.action);
  return validation.action;
}

/**
 * Prepare one command for the live transport: validate, clamp the client
 * clock and freeze the idempotency fingerprint before the clamp.
 */
export function prepareCommandDto(
  dto: CreateCommandDto,
  options: { allowOversize?: boolean; allowMissingAt?: boolean } = {},
): PreparedCommand {
  const action = validateCommandAction(dto.action, {
    ...(options.allowOversize === true ? { allowOversize: true } : {}),
    ...(options.allowMissingAt === true ? { allowMissingAt: true } : {}),
  });
  const clamped = clampActionAt(action, Date.now());
  return {
    dto,
    action: clamped,
    fingerprint: actionFingerprint(clamped),
  };
}

/** JSON round-trip so no `undefined` reaches a Prisma `Json` column. */
export function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(entry).sort()) {
        sorted[key] = (entry as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return entry;
  });
}

/** Stable identity of an action for the idempotency check, without `at`. */
export function actionFingerprint(action: unknown): string {
  if (action === null || typeof action !== "object") {
    return stableStringify(action);
  }
  const rest: Record<string, unknown> = {
    ...(jsonSafe(action) as Record<string, unknown>),
  };
  delete rest.at;
  return stableStringify(rest);
}

/** B-5: replace an `at` outside the trusted skew window with server time. */
export function clampActionAt<T extends BoardAction>(
  action: T,
  now: number,
): T {
  const at = (action as { at?: unknown }).at;
  if (typeof at !== "number") return action;
  if (Number.isFinite(at) && Math.abs(at - now) <= COMMAND_AT_MAX_SKEW_MS) {
    return action;
  }
  return { ...action, at: now };
}

function assertDatesInRange(action: unknown): void {
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 8 || value === null || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      const field = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
      if (
        typeof entry === "number" &&
        DATE_FIELD.test(key) &&
        !(Number.isFinite(entry) && Math.abs(entry) <= MAX_DATE_MS)
      ) {
        throw new BadRequestException({
          message: `Invalid command (${field}): must be a valid timestamp`,
          field,
        });
      }
      visit(entry, field, depth + 1);
    }
  };
  visit(action, "action", 0);
}
