import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Board, BoardAction, ScopePreset } from "@janosik/shared";
import type { AuthPrincipal } from "./auth-principal";

/**
 * TASK-166 scope and destructive gate — the one place that turns a principal
 * plus a board policy into an allow/deny answer. REST guards, the command
 * transport, attachment/comment services and the MCP-facing API all call
 * these helpers, so the matrix cannot drift between transports.
 *
 * The evaluation order is fixed by the ADR (§5.2): board role first (the
 * guards enforce it), then the token preset, then the destructive/approval
 * policy. `trustedCi` is checked only after the preset and the hard-deny
 * policy, so it can never raise a preset or bypass `destructive: "deny"`.
 */

/** Ordered presets: a higher rank inherits every lower permission. */
export const SCOPE_RANK: Record<ScopePreset, number> = {
  observer: 0,
  worker: 1,
  reviewer: 2,
  admin: 3,
};

/** Approval-policy keys understood by `Board.agentPolicy` (§6.3). */
export const AGENT_POLICY_KEYS = [
  "move_to_done",
  "delete_card",
  "delete_column",
  "delete_label",
  "delete_checklist",
  "delete_checklist_item",
  "archive_column_cards",
  "delete_board",
  "member.invite",
  "member.update",
  "member.remove",
  "share.create",
  "share.update",
  "share.revoke",
  "share.delete",
  "attachment.delete",
  "workflow.update",
] as const;

export type AgentPolicyKey = (typeof AGENT_POLICY_KEYS)[number];

/** Validated board agent policy. `NULL` in the DB means these defaults. */
export interface BoardAgentPolicy {
  schemaVersion: 1;
  destructive: "approval" | "deny";
  requireApprovalFor: AgentPolicyKey[];
  approverRoles: ["ADMIN"];
  maxCommandsPerRun: number;
  maxCardsPerRun: number;
  approvalTtlMinutes: number;
}

/** Default approval list from ADR §6.3 (`move_to_done` is opt-in). */
export const DEFAULT_REQUIRE_APPROVAL_FOR: readonly AgentPolicyKey[] = [
  "member.invite",
  "member.update",
  "member.remove",
  "share.create",
  "share.update",
  "share.revoke",
  "share.delete",
  "attachment.delete",
  "delete_board",
  "workflow.update",
];

export const DEFAULT_BOARD_AGENT_POLICY: BoardAgentPolicy = {
  schemaVersion: 1,
  destructive: "approval",
  requireApprovalFor: [...DEFAULT_REQUIRE_APPROVAL_FOR],
  approverRoles: ["ADMIN"],
  maxCommandsPerRun: 100,
  maxCardsPerRun: 50,
  approvalTtlMinutes: 60,
};

const POLICY_KEYS = new Set<string>(AGENT_POLICY_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

/**
 * Read a stored `Board.agentPolicy`. A corrupt or partial value fails safe:
 * the destructive mode falls back to `approval` (never `deny` by accident,
 * because a typo must not silently lock every agent out), and a malformed
 * approval list falls back to the default list. A deliberate empty list is
 * preserved. Policy editing (166.3/166.6) validates strictly on write.
 */
export function readBoardAgentPolicy(value: unknown): BoardAgentPolicy {
  if (!isRecord(value)) return { ...DEFAULT_BOARD_AGENT_POLICY };
  const requireApprovalFor = Array.isArray(value.requireApprovalFor)
    ? value.requireApprovalFor.filter(
        (key): key is AgentPolicyKey =>
          typeof key === "string" && POLICY_KEYS.has(key),
      )
    : [...DEFAULT_REQUIRE_APPROVAL_FOR];
  return {
    schemaVersion: 1,
    destructive: value.destructive === "deny" ? "deny" : "approval",
    requireApprovalFor,
    approverRoles: ["ADMIN"],
    maxCommandsPerRun: boundedInt(value.maxCommandsPerRun, 100, 1, 100),
    maxCardsPerRun: boundedInt(value.maxCardsPerRun, 50, 1, 50),
    approvalTtlMinutes: boundedInt(value.approvalTtlMinutes, 60, 5, 1440),
  };
}

/** A preset/approval requirement for one action. */
export interface AgentActionRule {
  /** Stable action name used in errors (`DELETE_CARD`, `member.invite`). */
  action: string;
  /** Minimum effective token scope. */
  requiredScope: ScopePreset;
  /** Destructive actions need approval by default. */
  destructive: boolean;
  /** Extra approval trigger from `Board.agentPolicy.requireApprovalFor`. */
  policyKey?: AgentPolicyKey;
  /** Browser undo is never delegated to a PAT, whatever its preset. */
  patForbidden?: boolean;
}

/** Lifecycle actions outside the command log (`/members`, `/shares`, …). */
export const LIFECYCLE_ACTIONS = {
  "board.delete": {
    action: "board.delete",
    requiredScope: "admin",
    destructive: true,
    policyKey: "delete_board",
  },
  "member.invite": {
    action: "member.invite",
    requiredScope: "admin",
    destructive: true,
    policyKey: "member.invite",
  },
  "member.update": {
    action: "member.update",
    requiredScope: "admin",
    destructive: true,
    policyKey: "member.update",
  },
  "member.remove": {
    action: "member.remove",
    requiredScope: "admin",
    destructive: true,
    policyKey: "member.remove",
  },
  "share.create": {
    action: "share.create",
    requiredScope: "admin",
    destructive: true,
    policyKey: "share.create",
  },
  "share.update": {
    action: "share.update",
    requiredScope: "admin",
    destructive: true,
    policyKey: "share.update",
  },
  "share.revoke": {
    action: "share.revoke",
    requiredScope: "admin",
    destructive: true,
    policyKey: "share.revoke",
  },
  "share.delete": {
    action: "share.delete",
    requiredScope: "admin",
    destructive: true,
    policyKey: "share.delete",
  },
  "attachment.delete": {
    action: "attachment.delete",
    requiredScope: "admin",
    destructive: true,
    policyKey: "attachment.delete",
  },
  "comment.delete": {
    action: "comment.delete",
    requiredScope: "worker",
    destructive: false,
  },
  "workflow.update": {
    action: "SET_BOARD_WORKFLOW",
    requiredScope: "admin",
    destructive: false,
    policyKey: "workflow.update",
  },
  "undo.restore": {
    action: "RESTORE",
    requiredScope: "worker",
    destructive: false,
    patForbidden: true,
  },
} as const satisfies Record<string, AgentActionRule>;

export type LifecycleAction = keyof typeof LIFECYCLE_ACTIONS;

/** Command action types that are destructive by themselves (ADR §7.1). */
const DESTRUCTIVE_COMMAND_POLICY: Record<
  string,
  { policyKey: AgentPolicyKey }
> = {
  DELETE_CARD: { policyKey: "delete_card" },
  DELETE_COLUMN: { policyKey: "delete_column" },
  ARCHIVE_COLUMN_CARDS: { policyKey: "archive_column_cards" },
  DELETE_LABEL: { policyKey: "delete_label" },
  DELETE_CHECKLIST: { policyKey: "delete_checklist" },
  DELETE_CHECKLIST_ITEM: { policyKey: "delete_checklist_item" },
};

const RESTORE_COMMANDS = new Set<string>([
  "RESTORE_CARD",
  "RESTORE_COLUMN",
  "RESTORE_COLUMN_CARDS",
  "RESTORE_LABEL",
  "RESTORE_CHECKLIST",
  "RESTORE_CHECKLIST_ITEM",
]);

/** Does this action put/create a card into a configured done column? */
function isDoneTransition(action: BoardAction, board: Board): boolean {
  const done = new Set(board.workflow?.doneColumnIds ?? []);
  if (done.size === 0) return false;
  switch (action.type) {
    case "ADD_CARD":
      return done.has(action.columnId);
    case "MOVE_CARD": {
      if (!done.has(action.toColumnId)) return false;
      const source = board.columns.find((column) =>
        column.cardIds.includes(action.cardId),
      )?.id;
      // Reordering inside a done column is not a done transition.
      return source !== action.toColumnId;
    }
    case "UNARCHIVE_CARD": {
      // Resolve exactly like the reducer: unknown/absent column ids fall back
      // to the board's first column. Checking `action.columnId` literally
      // would let a worker put a card into a Done first column via a bogus id.
      const target =
        board.columns.find((column) => column.id === action.columnId) ??
        board.columns[0];
      return target !== undefined && done.has(target.id);
    }
    case "DUPLICATE_CARD": {
      const source = board.columns.find((column) =>
        column.cardIds.includes(action.cardId),
      );
      return source !== undefined && done.has(source.id);
    }
    default:
      return false;
  }
}

/**
 * Classify one command against the board state it will run on. `board` is the
 * running aggregate (earlier commands in a batch are already applied), so a
 * create followed by a move is judged at the point it actually happens.
 */
export function classifyCommandAction(
  action: BoardAction,
  board: Board,
): AgentActionRule {
  if (RESTORE_COMMANDS.has(action.type)) {
    return LIFECYCLE_ACTIONS["undo.restore"];
  }
  if (action.type === "SET_BOARD_WORKFLOW") {
    return LIFECYCLE_ACTIONS["workflow.update"];
  }
  if (action.type === "ARCHIVE_BOARD" || action.type === "UNARCHIVE_BOARD") {
    return {
      action: action.type,
      requiredScope: "admin",
      destructive: false,
    };
  }
  const destructive = DESTRUCTIVE_COMMAND_POLICY[action.type];
  if (destructive) {
    return {
      action: action.type,
      requiredScope: "worker",
      destructive: true,
      policyKey: destructive.policyKey,
    };
  }
  if (isDoneTransition(action, board)) {
    return {
      action: action.type,
      requiredScope: "reviewer",
      destructive: false,
      policyKey: "move_to_done",
    };
  }
  return { action: action.type, requiredScope: "worker", destructive: false };
}

/** The effective preset carried by a PAT principal (safe fallback: worker). */
export function effectiveTokenScope(
  principal: AuthPrincipal | undefined,
): ScopePreset {
  const identity = principal?.tokenIdentity;
  if (identity !== undefined) return identity.effectiveTokenScope;
  return principal?.tokenScope?.readOnly === true ? "observer" : "worker";
}

function scopeError(rule: AgentActionRule, actual: ScopePreset) {
  return new ForbiddenException({
    message:
      `This API token's scope does not allow ${rule.action} ` +
      `(requires ${rule.requiredScope}, token is ${actual})`,
    code: "scope_denied",
    requiredScope: rule.requiredScope,
    effectiveTokenScope: actual,
    action: rule.action,
  });
}

/**
 * A board-scoped token aimed at another board. This is not a preset problem,
 * so the response deliberately omits `requiredScope`/`effectiveTokenScope`
 * (an observer must not read "requires observer, token is observer").
 */
function boardScopeError(action: string): ForbiddenException {
  return new ForbiddenException({
    message: "This API token is scoped to a different board",
    code: "scope_denied",
    reason: "board_scope",
    action: action || "board.access",
  });
}

function approvalError(rule: AgentActionRule) {
  // 166.5 adds `approvalId`/`planHash`/`expiresAt` when it creates the
  // ApprovalRequest. Until then this is the documented, clean seam: the
  // destructive action is refused and nothing is applied.
  return new ConflictException({
    message:
      `${rule.action} is destructive and needs human approval; ` +
      "no approval was applied",
    code: "approval_required",
    action: rule.action,
    retryable: false,
  });
}

function destructiveDeniedError(rule: AgentActionRule) {
  return new ForbiddenException({
    message: `This board's policy blocks destructive actions (${rule.action})`,
    code: "destructive_denied",
    action: rule.action,
    reason: "board_policy",
  });
}

/** Refuse a PAT action below `required` — humans never pass through here. */
export function assertPatPreset(
  principal: AuthPrincipal | undefined,
  required: ScopePreset,
  action: string,
): void {
  if (principal?.via !== "pat") return;
  const actual = effectiveTokenScope(principal);
  if (SCOPE_RANK[actual] >= SCOPE_RANK[required]) return;
  throw scopeError(
    { action, requiredScope: required, destructive: false },
    actual,
  );
}

/** Account-wide routes (`POST /boards`, import) refuse a board-scoped PAT. */
export function assertAccountWidePreset(
  principal: AuthPrincipal | undefined,
  action: string,
  required: ScopePreset = "admin",
): void {
  if (principal?.via !== "pat") return;
  if (
    principal.tokenScope?.boardId !== null &&
    principal.tokenScope?.boardId !== undefined
  ) {
    throw scopeError(
      { action, requiredScope: required, destructive: false },
      effectiveTokenScope(principal),
    );
  }
  assertPatPreset(principal, required, action);
}

/** A board-scoped PAT may only touch the board it names. */
export function assertTokenBoardScope(
  principal: AuthPrincipal | undefined,
  boardId: string,
  action: string,
): void {
  if (principal?.via !== "pat") return;
  const scoped = principal.tokenScope?.boardId;
  if (scoped === null || scoped === undefined || scoped === boardId) return;
  throw boardScopeError(action);
}

/**
 * Apply the preset and destructive/approval gate for one action.
 *
 * Order (ADR §5.2): pattern denied → preset → destructive hard block →
 * trustedCi → approval. A human browser JWT is not gated.
 */
export function assertAgentRule(
  principal: AuthPrincipal | undefined,
  policy: unknown,
  rule: AgentActionRule,
): void {
  if (principal?.via !== "pat") return;
  const actual = effectiveTokenScope(principal);
  if (rule.patForbidden === true) {
    throw scopeError(rule, actual);
  }
  if (SCOPE_RANK[actual] < SCOPE_RANK[rule.requiredScope]) {
    throw scopeError(rule, actual);
  }

  const effectivePolicy = readBoardAgentPolicy(policy);
  const trusted = principal.tokenIdentity?.trustedCi === true;

  if (rule.destructive) {
    if (effectivePolicy.destructive === "deny") {
      throw destructiveDeniedError(rule);
    }
    if (!trusted) throw approvalError(rule);
    return;
  }

  if (
    rule.policyKey !== undefined &&
    effectivePolicy.requireApprovalFor.includes(rule.policyKey) &&
    !trusted
  ) {
    throw approvalError(rule);
  }
}
