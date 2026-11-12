import {
  BOARD_AGENT_POLICY_ACTIONS,
  DEFAULT_BOARD_AGENT_POLICY,
  type BoardAgentPolicy,
  type BoardAgentPolicyAction,
} from "@janosik/shared";

/**
 * TASK-179.7 — the pure half of the Board Settings policy editor.
 *
 * The server stores the whole policy JSON and compares one version, so the
 * client must merge a stale draft field by field instead of sending the whole
 * stale object. Everything in this module is deliberately free of React and
 * i18n so the CAS rules can be tested without rendering the editor.
 */

export type PolicyField =
  | "destructive"
  | "requireApprovalFor"
  | "maxCommandsPerRun"
  | "maxCardsPerRun"
  | "approvalTtlMinutes";

export const POLICY_FIELDS: readonly PolicyField[] = [
  "destructive",
  "requireApprovalFor",
  "maxCommandsPerRun",
  "maxCardsPerRun",
  "approvalTtlMinutes",
];

export const POLICY_LIMITS = {
  maxCommandsPerRun: { min: 1, max: 100 },
  maxCardsPerRun: { min: 1, max: 50 },
  approvalTtlMinutes: { min: 5, max: 1_440 },
} as const;

/** Editable text representation of the policy; numbers stay strings while typing. */
export interface PolicyDraft {
  destructive: BoardAgentPolicy["destructive"];
  requireApprovalFor: BoardAgentPolicyAction[];
  maxCommandsPerRun: string;
  maxCardsPerRun: string;
  approvalTtlMinutes: string;
}

export type PolicyFieldValue = PolicyDraft[PolicyField];

/**
 * The policy keys the backend classifies as destructive (`token-scope.ts`):
 * six command actions plus the lifecycle actions. A destructive action always
 * needs approval when `destructive: "approval"` and is hard-blocked when
 * `destructive: "deny"`, so its `requireApprovalFor` checkbox cannot change
 * behaviour. The editor shows them disabled as "covered by destructive mode".
 *
 * Keep this list in sync with `DESTRUCTIVE_COMMAND_POLICY` and the
 * `destructive: true` entries of `LIFECYCLE_ACTIONS` in
 * `backend/src/auth/token-scope.ts`.
 */
export const DESTRUCTIVE_POLICY_ACTIONS = [
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
] as const satisfies readonly BoardAgentPolicyAction[];

const DESTRUCTIVE_SET = new Set<string>(DESTRUCTIVE_POLICY_ACTIONS);

export function isDestructivePolicyAction(
  action: BoardAgentPolicyAction,
): boolean {
  return DESTRUCTIVE_SET.has(action);
}

/** The only keys whose checkbox is meaningful; destructive keys come last. */
export const EDITABLE_POLICY_ACTIONS = BOARD_AGENT_POLICY_ACTIONS.filter(
  (action) => !DESTRUCTIVE_SET.has(action),
);

export const POLICY_TRIGGER_ORDER: readonly BoardAgentPolicyAction[] = [
  ...EDITABLE_POLICY_ACTIONS,
  ...BOARD_AGENT_POLICY_ACTIONS.filter((action) => DESTRUCTIVE_SET.has(action)),
];

export function draftOf(policy: BoardAgentPolicy): PolicyDraft {
  return {
    destructive: policy.destructive,
    requireApprovalFor: [...policy.requireApprovalFor],
    maxCommandsPerRun: String(policy.maxCommandsPerRun),
    maxCardsPerRun: String(policy.maxCardsPerRun),
    approvalTtlMinutes: String(policy.approvalTtlMinutes),
  };
}

export function intInRange(
  value: string,
  min: number,
  max: number,
): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

export interface PolicyDraftValidation {
  ok: boolean;
  maxCommandsPerRun: number | null;
  maxCardsPerRun: number | null;
  approvalTtlMinutes: number | null;
}

export function validatePolicyDraft(draft: PolicyDraft): PolicyDraftValidation {
  const maxCommandsPerRun = intInRange(
    draft.maxCommandsPerRun,
    POLICY_LIMITS.maxCommandsPerRun.min,
    POLICY_LIMITS.maxCommandsPerRun.max,
  );
  const maxCardsPerRun = intInRange(
    draft.maxCardsPerRun,
    POLICY_LIMITS.maxCardsPerRun.min,
    POLICY_LIMITS.maxCardsPerRun.max,
  );
  const approvalTtlMinutes = intInRange(
    draft.approvalTtlMinutes,
    POLICY_LIMITS.approvalTtlMinutes.min,
    POLICY_LIMITS.approvalTtlMinutes.max,
  );
  return {
    ok:
      maxCommandsPerRun !== null &&
      maxCardsPerRun !== null &&
      approvalTtlMinutes !== null,
    maxCommandsPerRun,
    maxCardsPerRun,
    approvalTtlMinutes,
  };
}

/** The validated policy, or `null` when a numeric field is out of range. */
export function policyOfDraft(draft: PolicyDraft): BoardAgentPolicy | null {
  const checked = validatePolicyDraft(draft);
  if (!checked.ok) return null;
  return {
    schemaVersion: 1,
    destructive: draft.destructive,
    requireApprovalFor: BOARD_AGENT_POLICY_ACTIONS.filter((action) =>
      draft.requireApprovalFor.includes(action),
    ),
    approverRoles: ["ADMIN"],
    maxCommandsPerRun: checked.maxCommandsPerRun as number,
    maxCardsPerRun: checked.maxCardsPerRun as number,
    approvalTtlMinutes: checked.approvalTtlMinutes as number,
  };
}

function numericDraftValue(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

function sameActionSet(
  left: readonly BoardAgentPolicyAction[],
  right: readonly BoardAgentPolicyAction[],
): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((action) => rightSet.has(action));
}

/** Compare one draft field with a server policy without normalizing the draft. */
export function policyFieldEqual(
  field: PolicyField,
  draft: PolicyDraft,
  policy: BoardAgentPolicy,
): boolean {
  switch (field) {
    case "destructive":
      return draft.destructive === policy.destructive;
    case "requireApprovalFor":
      return sameActionSet(draft.requireApprovalFor, policy.requireApprovalFor);
    case "maxCommandsPerRun":
      return (
        numericDraftValue(draft.maxCommandsPerRun) === policy.maxCommandsPerRun
      );
    case "maxCardsPerRun":
      return numericDraftValue(draft.maxCardsPerRun) === policy.maxCardsPerRun;
    case "approvalTtlMinutes":
      return (
        numericDraftValue(draft.approvalTtlMinutes) ===
        policy.approvalTtlMinutes
      );
  }
}

export function policyFieldValue(
  policy: BoardAgentPolicy,
  field: PolicyField,
): PolicyFieldValue {
  switch (field) {
    case "destructive":
      return policy.destructive;
    case "requireApprovalFor":
      return [...policy.requireApprovalFor];
    case "maxCommandsPerRun":
      return String(policy.maxCommandsPerRun);
    case "maxCardsPerRun":
      return String(policy.maxCardsPerRun);
    case "approvalTtlMinutes":
      return String(policy.approvalTtlMinutes);
  }
}

export function draftFieldValue(
  draft: PolicyDraft,
  field: PolicyField,
): PolicyFieldValue {
  switch (field) {
    case "destructive":
      return draft.destructive;
    case "requireApprovalFor":
      return [...draft.requireApprovalFor];
    case "maxCommandsPerRun":
      return draft.maxCommandsPerRun;
    case "maxCardsPerRun":
      return draft.maxCardsPerRun;
    case "approvalTtlMinutes":
      return draft.approvalTtlMinutes;
  }
}

export function setDraftField(
  draft: PolicyDraft,
  field: PolicyField,
  value: PolicyFieldValue,
): PolicyDraft {
  switch (field) {
    case "destructive":
      return { ...draft, destructive: value as PolicyDraft["destructive"] };
    case "requireApprovalFor":
      return {
        ...draft,
        requireApprovalFor: value as BoardAgentPolicyAction[],
      };
    case "maxCommandsPerRun":
      return { ...draft, maxCommandsPerRun: value as string };
    case "maxCardsPerRun":
      return { ...draft, maxCardsPerRun: value as string };
    case "approvalTtlMinutes":
      return { ...draft, approvalTtlMinutes: value as string };
  }
}

/** Fields the user actually edited relative to the last synced server policy. */
export function localPolicyFields(
  draft: PolicyDraft,
  base: BoardAgentPolicy,
): PolicyField[] {
  return POLICY_FIELDS.filter((field) => !policyFieldEqual(field, draft, base));
}

export interface PolicyFieldConflict {
  field: PolicyField;
  /** The user's value; the draft keeps it until the admin chooses. */
  local: PolicyFieldValue;
  /** The newer server value that was loaded after the 409. */
  server: PolicyFieldValue;
}

export interface PolicyMergeResult {
  draft: PolicyDraft;
  conflicts: PolicyFieldConflict[];
  localFields: PolicyField[];
}

/**
 * The field-level CAS merge (TASK-179.7 / independent review #4).
 *
 * `base` is the server policy the draft was based on, `latest` is what the
 * server returned after the 409 and `draft` is the user's local state. Only
 * fields in `localFields` are carried over. A field changed on both sides to
 * different values is not applied silently: it stays local in the draft and
 * is reported as a conflict until the admin chooses "mine" or "server".
 */
export function mergePolicyDraft({
  base,
  previous,
  latest,
  draft,
  localFields,
}: {
  base: BoardAgentPolicy;
  /** The server policy this draft was last synced against, if different. */
  previous?: BoardAgentPolicy;
  latest: BoardAgentPolicy;
  draft: PolicyDraft;
  localFields: readonly PolicyField[];
}): PolicyMergeResult {
  const baseDraft = draftOf(base);
  const previousDraft = previous === undefined ? null : draftOf(previous);
  let merged = draftOf(latest);
  const conflicts: PolicyFieldConflict[] = [];

  for (const field of localFields) {
    const localValue = draftFieldValue(draft, field);
    const changedSinceBase = !policyFieldEqual(field, baseDraft, latest);
    const changedSinceSync =
      previousDraft !== null && !policyFieldEqual(field, previousDraft, latest);
    const sameAsServer = policyFieldEqual(field, draft, latest);

    merged = setDraftField(merged, field, localValue);
    if ((changedSinceBase || changedSinceSync) && !sameAsServer) {
      conflicts.push({
        field,
        local: localValue,
        server: policyFieldValue(latest, field),
      });
    }
  }

  return {
    draft: merged,
    conflicts,
    localFields: localPolicyFields(merged, latest),
  };
}

/** Apply one explicit conflict choice; "server" replaces the local value. */
export function resolvePolicyConflict(
  draft: PolicyDraft,
  conflict: PolicyFieldConflict,
  choice: "mine" | "server",
): PolicyDraft {
  if (choice === "mine") return draft;
  return setDraftField(draft, conflict.field, conflict.server);
}

export function policyEquals(
  left: BoardAgentPolicy,
  right: BoardAgentPolicy,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.destructive === right.destructive &&
    sameActionSet(left.requireApprovalFor, right.requireApprovalFor) &&
    left.approverRoles.length === right.approverRoles.length &&
    left.approverRoles.every((role) => right.approverRoles.includes(role)) &&
    left.maxCommandsPerRun === right.maxCommandsPerRun &&
    left.maxCardsPerRun === right.maxCardsPerRun &&
    left.approvalTtlMinutes === right.approvalTtlMinutes
  );
}

export function isDefaultPolicy(policy: BoardAgentPolicy): boolean {
  return policyEquals(policy, DEFAULT_BOARD_AGENT_POLICY);
}

/** Toggle an editable trigger and keep the wire order canonical. */
export function togglePolicyAction(
  actions: readonly BoardAgentPolicyAction[],
  action: BoardAgentPolicyAction,
): BoardAgentPolicyAction[] {
  if (isDestructivePolicyAction(action)) return [...actions];
  const next = actions.includes(action)
    ? actions.filter((entry) => entry !== action)
    : [...actions, action];
  return BOARD_AGENT_POLICY_ACTIONS.filter((entry) => next.includes(entry));
}
