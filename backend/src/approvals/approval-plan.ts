import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import type {
  ApprovalKind,
  ApprovalOperationName,
  ApprovalPlan,
  ApprovalPlanCommand,
  ApprovalPlanOperation,
  ApprovalRisk,
} from "@janosik/shared";
import { APPROVAL_OPERATIONS, boardReducer } from "@janosik/shared";
import type { Board, BoardAction } from "@janosik/shared";
import { classifyCommandAction } from "@/auth/token-scope";
import type { BoardAgentPolicy } from "@/auth/token-scope";
import { validateCommandAction } from "@/commands/command-validation";

/**
 * Approval-plan normalization and hashing (ADR §6.7, TASK-166.5).
 *
 * The plan is the exact executable intent: commands or exactly one lifecycle
 * operation. `action.at` is server time, not intent, so it is stripped before
 * the plan is stored and hashed; on apply the server stamps it again. The
 * canonical JSON sorts object keys recursively, keeps array order and omits
 * absent `commands`/`operations`, so the hash is stable across re-serialized
 * requests from any client.
 */

const MAX_COMMAND_ID = 64;
const MAX_IF_MATCH_VERSIONS = 100;

/** Recursively key-sorted, whitespace-free JSON (canonical form). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) out[key] = sortJson(entry);
    }
    return out;
  }
  return value;
}

/** `sha256(utf8(canonicalJson(...)))`, lower-case 64 hex characters. */
export function approvalPlanHash(plan: ApprovalPlan): string {
  const payload = {
    schemaVersion: plan.schemaVersion,
    boardId: plan.boardId,
    ...(plan.commands !== undefined ? { commands: plan.commands } : {}),
    ...(plan.operations !== undefined ? { operations: plan.operations } : {}),
  };
  return createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

function bad(field: string, message: string): never {
  throw new BadRequestException({
    message: `Invalid approval plan (${field}): ${message}`,
    field,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A DTO as plain JSON: class instances keep only their defined fields. */
export function plainRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

function normalizeCommandId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > MAX_COMMAND_ID
  ) {
    bad(field, `must be a non-empty string up to ${MAX_COMMAND_ID} characters`);
  }
  return value;
}

function normalizeIfMatchVersions(
  value: unknown,
  field: string,
): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) bad(field, "must be an object");
  const entries = Object.entries(value);
  if (entries.length > MAX_IF_MATCH_VERSIONS) {
    bad(field, `must contain at most ${MAX_IF_MATCH_VERSIONS} entries`);
  }
  const out: Record<string, number> = {};
  for (const [key, entry] of entries) {
    if (!Number.isInteger(entry) || (entry as number) < 0) {
      bad(`${field}.${key}`, "must be a non-negative integer");
    }
    out[key] = entry as number;
  }
  return out;
}

/**
 * Strip the fields that are transport context rather than intent: the server
 * clock (`at`) and the action-level board id (the plan already carries the
 * board at top level). Both are re-added at apply time, so excluding them
 * keeps the hash identical for a client that omits them and for the server
 * that fills them in.
 */
function withoutPlanFields(action: BoardAction): Record<string, unknown> {
  const rest: Record<string, unknown> = {
    ...(action as unknown as Record<string, unknown>),
  };
  delete rest.at;
  delete rest.boardId;
  return rest;
}

/** Fingerprint a stored command payload against a plan action. */
export function planActionFingerprint(action: unknown): string {
  if (action === null || typeof action !== "object") {
    return JSON.stringify(action);
  }
  const rest = { ...(action as Record<string, unknown>) };
  delete rest.at;
  delete rest.boardId;
  return JSON.stringify(sortJson(rest));
}

/** Validate one plan command through the same validator as `/commands`. */
export function normalizePlanCommand(
  raw: unknown,
  index: number,
  boardId: string,
): ApprovalPlanCommand {
  const field = `commands[${index}]`;
  if (!isRecord(raw)) bad(field, "must be an object");
  const commandId = normalizeCommandId(raw.commandId, `${field}.commandId`);
  const action = validateCommandAction(raw.action, { allowMissingAt: true });
  const actionBoard = (action as { boardId?: unknown }).boardId;
  if (actionBoard !== undefined && actionBoard !== boardId) {
    bad(
      `${field}.action.boardId`,
      "must be absent or match the board in the plan",
    );
  }
  const ifMatch =
    raw.ifMatch === undefined
      ? undefined
      : Number.isInteger(raw.ifMatch) && (raw.ifMatch as number) >= 0
        ? (raw.ifMatch as number)
        : bad(`${field}.ifMatch`, "must be a non-negative integer");
  const ifMatchVersions = normalizeIfMatchVersions(
    raw.ifMatchVersions,
    `${field}.ifMatchVersions`,
  );
  return {
    commandId,
    action: withoutPlanFields(action) as ApprovalPlanCommand["action"],
    ...(ifMatch !== undefined ? { ifMatch } : {}),
    ...(ifMatchVersions !== undefined ? { ifMatchVersions } : {}),
  };
}

const OPERATION_SET = new Set<string>(APPROVAL_OPERATIONS);

/** Validate one lifecycle operation: whitelisted, board-scoped, one only. */
export function normalizePlanOperation(
  raw: unknown,
  boardId: string,
): ApprovalPlanOperation {
  if (!isRecord(raw)) bad("operations[0]", "must be an object");
  if (typeof raw.op !== "string" || !OPERATION_SET.has(raw.op)) {
    bad("operations[0].op", "is not a whitelisted lifecycle operation");
  }
  if (!isRecord(raw.target)) bad("operations[0].target", "must be an object");
  if (raw.target.boardId !== boardId) {
    bad("operations[0].target.boardId", "must match the board in the route");
  }
  if (!isRecord(raw.body)) bad("operations[0].body", "must be an object");
  return {
    op: raw.op as ApprovalOperationName,
    target: raw.target,
    body: raw.body,
  };
}

/**
 * Normalize the request body into the stored/hashed plan. `commands` and
 * `operations` are mutually exclusive; limits are applied by the caller with
 * the board policy in hand.
 */
export function normalizeApprovalPlan(
  raw: unknown,
  boardId: string,
): ApprovalPlan {
  if (!isRecord(raw)) bad("plan", "must be an object");
  if (raw.schemaVersion !== 1) bad("plan.schemaVersion", "must be 1");
  if (raw.boardId !== boardId) {
    bad("plan.boardId", "must match the board in the route");
  }
  const hasCommands = raw.commands !== undefined;
  const hasOperations = raw.operations !== undefined;
  if (hasCommands === hasOperations) {
    bad(
      hasCommands ? "plan" : "plan.commands",
      "provide exactly one of commands or operations",
    );
  }
  if (hasCommands) {
    if (!Array.isArray(raw.commands) || raw.commands.length === 0) {
      bad("plan.commands", "must be a non-empty array");
    }
    const commands = raw.commands.map((entry, index) =>
      normalizePlanCommand(entry, index, boardId),
    );
    const ids = new Set<string>();
    for (const command of commands) {
      if (ids.has(command.commandId)) {
        bad("plan.commands", `repeats commandId ${command.commandId}`);
      }
      ids.add(command.commandId);
    }
    return { schemaVersion: 1, boardId, commands };
  }
  if (!Array.isArray(raw.operations) || raw.operations.length !== 1) {
    bad("plan.operations", "must contain exactly one operation");
  }
  return {
    schemaVersion: 1,
    boardId,
    operations: [normalizePlanOperation(raw.operations[0], boardId)],
  };
}

/** Build the plan for already prepared live commands (at stripped). */
export function planFromPreparedCommands(
  boardId: string,
  commands: Array<{
    dto: {
      commandId: string;
      ifMatch?: number;
      ifMatchVersions?: Record<string, number>;
    };
    action: BoardAction;
  }>,
): ApprovalPlan {
  return {
    schemaVersion: 1,
    boardId,
    commands: commands.map((entry) => ({
      commandId: entry.dto.commandId,
      action: withoutPlanFields(entry.action) as ApprovalPlanCommand["action"],
      ...(entry.dto.ifMatch !== undefined
        ? { ifMatch: entry.dto.ifMatch }
        : {}),
      ...(entry.dto.ifMatchVersions !== undefined
        ? { ifMatchVersions: entry.dto.ifMatchVersions }
        : {}),
    })),
  };
}

/** Build a lifecycle-operation plan from the values an endpoint will apply. */
export function planFromOperation(
  boardId: string,
  op: ApprovalOperationName,
  target: Record<string, unknown>,
  body: Record<string, unknown>,
): ApprovalPlan {
  return {
    schemaVersion: 1,
    boardId,
    operations: [{ op, target: { ...target, boardId }, body }],
  };
}

/** Requirement classification for a plan against the current board. */
export interface PlanRequirement {
  /** The approval kind the plan maps to (destructive > done > custom). */
  kind: ApprovalKind;
  /** True when policy/preset requires a human decision for this plan. */
  requiresApproval: boolean;
  /** Highest preset the plan needs after approval. */
  requiredScope: "worker" | "reviewer" | "admin";
  /** Stable action name used in errors and summaries. */
  action: string;
}

const RISK_HIGH = new Set([
  "DELETE_COLUMN",
  "board.delete",
  "member.remove",
  "share.revoke",
  "share.delete",
]);

const RISK_MEDIUM = new Set([
  "DELETE_CARD",
  "ARCHIVE_COLUMN_CARDS",
  "DELETE_LABEL",
  "DELETE_CHECKLIST",
  "DELETE_CHECKLIST_ITEM",
  "member.invite",
  "member.update",
  "share.create",
  "share.update",
  "attachment.delete",
]);

const OPERATION_SUMMARY: Record<ApprovalOperationName, string> = {
  "board.delete": "Delete the board",
  "member.invite": "Invite a board member",
  "member.update": "Change a board member",
  "member.remove": "Remove a board member",
  "share.create": "Create a public share link",
  "share.update": "Change a public share link",
  "share.revoke": "Revoke a public share link",
  "share.delete": "Permanently delete a share link",
  "attachment.delete": "Delete another user's attachment",
};

/**
 * Classify a plan the way the command transaction will see it. `board` is
 * the current aggregate; earlier commands of a plan are replayed through the
 * reducer so a create-then-move-to-done is judged at its real point.
 */
export function classifyPlan(
  plan: ApprovalPlan,
  board: Board,
  policy: BoardAgentPolicy,
  principalTrustedCi: boolean,
): PlanRequirement {
  if (plan.operations !== undefined) {
    const operation = plan.operations[0];
    if (operation === undefined) bad("plan.operations", "must not be empty");
    const kind: ApprovalKind = "destructive";
    const requiresApproval =
      policy.destructive !== "deny" && !principalTrustedCi;
    return {
      kind,
      requiresApproval,
      requiredScope: "admin",
      action: operation.op,
    };
  }

  let kind: ApprovalKind = "custom";
  let requiresApproval = false;
  let requiredScope: PlanRequirement["requiredScope"] = "worker";
  let action = "batch";
  let running = board;

  for (const command of plan.commands ?? []) {
    const rawAction = command.action as unknown as BoardAction;
    const actionForClassification = {
      ...rawAction,
      boardId: plan.boardId,
      at: Date.now(),
    } as BoardAction;
    const rule = classifyCommandAction(actionForClassification, running);
    action = rule.action;
    if (rule.requiredScope === "admin") requiredScope = "admin";
    else if (rule.requiredScope === "reviewer" && requiredScope !== "admin") {
      requiredScope = "reviewer";
    }
    if (rule.destructive) {
      kind = "destructive";
      if (policy.destructive !== "deny" && !principalTrustedCi) {
        requiresApproval = true;
      }
    } else if (
      rule.policyKey !== undefined &&
      policy.requireApprovalFor.includes(rule.policyKey) &&
      !principalTrustedCi
    ) {
      requiresApproval = true;
      if (kind !== "destructive") {
        kind = rule.policyKey === "move_to_done" ? "done" : "custom";
      }
    }
    // Replay the command so later commands see the same aggregate. The
    // reducer tolerates a no-op; this is only a classification pass.
    running = replay(running, actionForClassification);
  }

  if ((plan.commands?.length ?? 0) > 1) action = "batch";
  return { kind, requiresApproval, requiredScope, action };
}

/** Minimal reducer replay for classification (no activity, no writes). */
function replay(board: Board, action: BoardAction): Board {
  try {
    const next = boardReducer([board], action, { withActivity: false });
    return next[0] ?? board;
  } catch {
    return board;
  }
}

/** A short, human-readable plan summary (max 500 chars). */
export function summarizePlan(plan: ApprovalPlan, action: string): string {
  if (plan.operations !== undefined) {
    const operation = plan.operations[0];
    return operation ? OPERATION_SUMMARY[operation.op] : action;
  }
  const commands = plan.commands ?? [];
  if (commands.length === 1) {
    return `Apply ${action} (1 command)`;
  }
  const types = [
    ...new Set(commands.map((command) => String(command.action.type))),
  ];
  return `Apply ${commands.length} commands: ${types.slice(0, 4).join(", ")}${
    types.length > 4 ? ", …" : ""
  }`.slice(0, 500);
}

/** Risk from the actions a plan contains (ADR §10.2). */
export function riskOfPlan(plan: ApprovalPlan): ApprovalRisk {
  const actions =
    plan.operations?.map((operation) => operation.op) ??
    plan.commands?.map((command) => String(command.action.type)) ??
    [];
  if (actions.some((action) => RISK_HIGH.has(action))) return "high";
  if (actions.some((action) => RISK_MEDIUM.has(action))) return "medium";
  return "low";
}

/** Card id carried by a command plan, when it is unambiguous. */
export function cardIdOfPlan(plan: ApprovalPlan): string | null {
  const ids = new Set<string>();
  for (const command of plan.commands ?? []) {
    const cardId = command.action.cardId;
    if (typeof cardId === "string") ids.add(cardId);
  }
  return ids.size === 1 ? [...ids][0]! : null;
}
