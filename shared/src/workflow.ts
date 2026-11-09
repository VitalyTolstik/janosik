import type { BoardRole } from "./api";
import type { Board, Card } from "./types/kanban";
import { LIMITS } from "./types/kanban";

/**
 * Admin-configurable card workflow.
 *
 * A board's columns *are* the card's statuses: a card sits in exactly one
 * column, and `column.cardIds` is the single source of truth for where it is.
 * The workflow is therefore an optional rule layer over `columnId`, not a
 * second state model. `Board.workflow` absent or `enabled: false` keeps the
 * legacy behaviour — every cross-column move is allowed.
 *
 * The same evaluator is used by the UI (pre-check), the shared reducer
 * (structure and conditions) and the backend (role, conditions and WIP under
 * the board lock), so all three layers agree on what a transition means.
 */

/** Current shape of `BoardWorkflow`; bump only on a breaking change. */
export const WORKFLOW_SCHEMA_VERSION = 1 as const;

/** Only these roles may be named by a transition (a VIEWER never moves). */
export type WorkflowRole = Extract<BoardRole, "ADMIN" | "MEMBER">;

/** Every transition condition the MVP understands. */
export const WORKFLOW_CONDITIONS = [
  "requireAssignee",
  "requireDueDate",
  "requireDescription",
  "requireChecklistsDone",
] as const;

export type WorkflowCondition = (typeof WORKFLOW_CONDITIONS)[number];

/** Collection bounds for one board's workflow config. */
export const WORKFLOW_LIMITS = {
  /** 12×12 directed pairs plus headroom for global transitions. */
  transitions: 200,
  /** Human label on a transition. */
  label: 100,
  /** Longest transition id, matching `MAX_ID_LENGTH` on the wire. */
  id: 128,
} as const;

/** One directed rule: a card may move `fromColumnId → toColumnId`. */
export interface WorkflowTransition {
  /** Stable id for the editor, tests and history. */
  id: string;
  /** `null` = from any column (a global transition). */
  fromColumnId: string | null;
  /** Destination column; `null` is reserved for a future phase. */
  toColumnId: string;
  /** Who may use it; absent = `["ADMIN", "MEMBER"]`. Never empty. */
  allowedRoles?: WorkflowRole[];
  /** All conditions must hold (AND); absent = no conditions. */
  conditions?: WorkflowCondition[];
  /** Human label such as "Send back for rework". */
  label?: string;
  /** `false` keeps the rule in the config but disabled. */
  enabled?: boolean;
}

/** Optional workflow stored on a board. */
export interface BoardWorkflow {
  schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  enabled: boolean;
  /** Start column; absent = the board's first column. */
  initialColumnId?: string;
  /** Columns that count as done; empty = no done semantics. */
  doneColumnIds: string[];
  transitions: WorkflowTransition[];
}

/** Why a move is allowed or denied. */
export type WorkflowDenialCode =
  | "card_not_found"
  | "transition_not_allowed"
  | "role_not_allowed"
  | "condition_failed";

/**
 * Result of evaluating one card → column transition. `allowedToColumnIds` is
 * only filled by {@link evaluateTransition}, which knows the whole board;
 * the lower-level helper returns the pair decision alone.
 */
export type WorkflowDecision =
  | {
      allowed: true;
      sameColumn: boolean;
      transition?: WorkflowTransition;
    }
  | {
      allowed: false;
      code: WorkflowDenialCode;
      fromColumnId: string | null;
      toColumnId: string;
      failedConditions: WorkflowCondition[];
      /** Roles that would have allowed the edge (`role_not_allowed`). */
      requiredRoles?: WorkflowRole[];
    };

export type TransitionDecision = WorkflowDecision & {
  /** All other columns the card may move to under the current workflow. */
  allowedToColumnIds: string[];
};

const DEFAULT_ROLES: readonly WorkflowRole[] = ["ADMIN", "MEMBER"];

/** Narrow an untrusted value to a known condition. */
export function isWorkflowCondition(
  value: unknown,
): value is WorkflowCondition {
  return (
    typeof value === "string" &&
    (WORKFLOW_CONDITIONS as readonly string[]).includes(value)
  );
}

/** Narrow an untrusted value to a transition role. */
export function isWorkflowRole(value: unknown): value is WorkflowRole {
  return value === "ADMIN" || value === "MEMBER";
}

/** The conditions a card currently fails, in canonical order. */
export function failedConditions(
  card: Card,
  conditions: readonly WorkflowCondition[] | undefined,
): WorkflowCondition[] {
  if (!conditions || conditions.length === 0) return [];
  const failed: WorkflowCondition[] = [];
  for (const condition of conditions) {
    if (condition === "requireAssignee" && !card.assigneeId) {
      failed.push(condition);
    } else if (
      condition === "requireDueDate" &&
      !(typeof card.dueDate === "number" && Number.isFinite(card.dueDate))
    ) {
      failed.push(condition);
    } else if (
      condition === "requireDescription" &&
      (card.description ?? "").trim() === ""
    ) {
      failed.push(condition);
    } else if (
      condition === "requireChecklistsDone" &&
      !areChecklistsDone(card)
    ) {
      failed.push(condition);
    }
  }
  return failed;
}

/** Vacuous truth: a card without checklists has nothing left to tick. */
function areChecklistsDone(card: Card): boolean {
  return (card.checklists ?? []).every((checklist) =>
    checklist.items.every((item) => item.done),
  );
}

/** The roles a transition accepts (an absent list means ADMIN + MEMBER). */
export function transitionRoles(
  transition: Pick<WorkflowTransition, "allowedRoles">,
): WorkflowRole[] {
  return transition.allowedRoles && transition.allowedRoles.length > 0
    ? transition.allowedRoles
    : [...DEFAULT_ROLES];
}

/**
 * Evaluate one pair without the board around it. Role `undefined` means
 * "check structure and card conditions only" — that is what the reducer
 * passes, because a reducer may not depend on who is viewing the board.
 */
export function evaluateCardTransition(
  workflow: BoardWorkflow | undefined,
  card: Card,
  fromColumnId: string,
  toColumnId: string,
  role?: BoardRole,
): WorkflowDecision {
  // Sorting inside a column is layout, not a status change.
  if (fromColumnId === toColumnId) {
    return { allowed: true, sameColumn: true };
  }
  if (!workflow?.enabled) {
    return { allowed: true, sameColumn: false };
  }

  const enabled = workflow.transitions.filter(
    (transition) => transition.enabled !== false,
  );
  // A specific edge always wins over a global one: a global "escalation"
  // rule must never become a hole in a stricter pair.
  const specific = enabled.filter(
    (transition) =>
      transition.fromColumnId === fromColumnId &&
      transition.toColumnId === toColumnId,
  );
  const candidates =
    specific.length > 0
      ? specific
      : enabled.filter(
          (transition) =>
            transition.fromColumnId === null &&
            transition.toColumnId === toColumnId,
        );

  if (candidates.length === 0) {
    return {
      allowed: false,
      code: "transition_not_allowed",
      fromColumnId,
      toColumnId,
      failedConditions: [],
    };
  }

  const roleCandidates =
    role === undefined
      ? candidates
      : candidates.filter((transition) =>
          transitionRoles(transition).includes(role as WorkflowRole),
        );
  if (roleCandidates.length === 0) {
    const roles = new Set<WorkflowRole>();
    for (const transition of candidates) {
      for (const allowed of transitionRoles(transition)) roles.add(allowed);
    }
    return {
      allowed: false,
      code: "role_not_allowed",
      fromColumnId,
      toColumnId,
      failedConditions: [],
      requiredRoles: [...roles],
    };
  }

  for (const transition of roleCandidates) {
    const failed = failedConditions(card, transition.conditions);
    if (failed.length === 0) {
      return { allowed: true, sameColumn: false, transition };
    }
  }
  return {
    allowed: false,
    code: "condition_failed",
    fromColumnId,
    toColumnId,
    failedConditions: failedConditions(card, roleCandidates[0]?.conditions),
  };
}

/**
 * Evaluate a move for a card on a board, exactly the way the UI and the
 * server do. `role === undefined` keeps the role check out (reducer replay);
 * the UI passes the caller's role and the server passes the membership role.
 */
export function evaluateTransition(
  board: Board,
  cardId: string,
  toColumnId: string,
  role?: BoardRole,
): TransitionDecision {
  const card = board.cards[cardId];
  const from = board.columns.find((column) => column.cardIds.includes(cardId));
  const to = board.columns.find((column) => column.id === toColumnId);
  if (!card || !from || !to) {
    return {
      allowed: false,
      code: "card_not_found",
      fromColumnId: from?.id ?? null,
      toColumnId,
      failedConditions: [],
      allowedToColumnIds: [],
    };
  }
  const decision = evaluateCardTransition(
    board.workflow,
    card,
    from.id,
    to.id,
    role,
  );
  return {
    ...decision,
    allowedToColumnIds: board.columns
      .filter((column) => column.id !== from.id)
      .filter(
        (column) =>
          evaluateCardTransition(board.workflow, card, from.id, column.id, role)
            .allowed,
      )
      .map((column) => column.id),
  };
}

/** Configured start column, falling back to the board's first column. */
export function workflowInitialColumnId(board: Board): string | undefined {
  const configured = board.workflow?.initialColumnId;
  if (configured && board.columns.some((column) => column.id === configured)) {
    return configured;
  }
  return board.columns[0]?.id;
}

/**
 * Columns that count as done (configured ids that still exist), falling back
 * to the last column for boards without a workflow — the pre-feature MCP
 * convention.
 */
export function workflowDoneColumnIds(board: Board): string[] {
  const configured = (board.workflow?.doneColumnIds ?? []).filter((id) =>
    board.columns.some((column) => column.id === id),
  );
  if (configured.length > 0) return configured;
  const last = board.columns.at(-1)?.id;
  return last ? [last] : [];
}

/** A ready-to-save workflow for the board's current columns. */
export function suggestWorkflowTemplate(
  columns: readonly { id: string }[],
): BoardWorkflow {
  const transitions: WorkflowTransition[] = [];
  for (let index = 0; index < columns.length - 1; index += 1) {
    const from = columns[index].id;
    const to = columns[index + 1].id;
    transitions.push({
      id: `tr-${index}-forward`,
      fromColumnId: from,
      toColumnId: to,
      allowedRoles: ["ADMIN", "MEMBER"],
    });
    transitions.push({
      id: `tr-${index}-back`,
      fromColumnId: to,
      toColumnId: from,
      allowedRoles: ["ADMIN", "MEMBER"],
    });
  }
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    enabled: columns.length > 1,
    ...(columns[0] ? { initialColumnId: columns[0].id } : {}),
    doneColumnIds: columns.length > 0 ? [columns.at(-1)!.id] : [],
    transitions,
  };
}

/* ------------------------------------------------------------------ shape */

export type WorkflowValidation =
  | { ok: true; workflow: BoardWorkflow }
  | { ok: false; field: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= WORKFLOW_LIMITS.id &&
    value !== "__proto__"
  );
}

/**
 * Strictly validate and rebuild a workflow config. Used by the command
 * validator, the importer and the master editor; unknown keys are dropped so
 * the stored JSON stays canonical.
 *
 * Structural only: column references are checked separately by
 * {@link workflowReferenceError}, because a command validator does not see
 * the board the command targets.
 */
export function validateWorkflowShape(
  input: unknown,
  field = "workflow",
): WorkflowValidation {
  const fail = (at: string, message: string): WorkflowValidation => ({
    ok: false,
    field: at,
    message,
  });
  if (!isRecord(input)) return fail(field, "must be an object");
  if (input.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    return fail(`${field}.schemaVersion`, "must be 1");
  }
  if (typeof input.enabled !== "boolean") {
    return fail(`${field}.enabled`, "must be a boolean");
  }

  let initialColumnId: string | undefined;
  if (input.initialColumnId !== undefined) {
    if (!isId(input.initialColumnId)) {
      return fail(`${field}.initialColumnId`, "must be a valid column id");
    }
    initialColumnId = input.initialColumnId;
  }

  if (!Array.isArray(input.doneColumnIds)) {
    return fail(`${field}.doneColumnIds`, "must be an array");
  }
  if (!input.doneColumnIds.every(isId)) {
    return fail(`${field}.doneColumnIds`, "must hold valid column ids");
  }
  const doneColumnIds = [...input.doneColumnIds];
  if (new Set(doneColumnIds).size !== doneColumnIds.length) {
    return fail(`${field}.doneColumnIds`, "must not repeat a column");
  }
  if (doneColumnIds.length > LIMITS.columnsPerBoard) {
    return fail(
      `${field}.doneColumnIds`,
      `must hold at most ${LIMITS.columnsPerBoard} columns`,
    );
  }

  if (!Array.isArray(input.transitions)) {
    return fail(`${field}.transitions`, "must be an array");
  }
  if (input.transitions.length > WORKFLOW_LIMITS.transitions) {
    return fail(
      `${field}.transitions`,
      `must hold at most ${WORKFLOW_LIMITS.transitions} transitions`,
    );
  }

  const transitions: WorkflowTransition[] = [];
  const pairs = new Set<string>();
  const transitionIds = new Set<string>();
  for (const [index, entry] of input.transitions.entries()) {
    const at = `${field}.transitions[${index}]`;
    if (!isRecord(entry)) return fail(at, "must be an object");
    if (!isId(entry.id)) return fail(`${at}.id`, "invalid id");
    if (transitionIds.has(entry.id)) {
      return fail(`${at}.id`, "duplicates another transition id");
    }
    transitionIds.add(entry.id);
    if (entry.fromColumnId !== null && !isId(entry.fromColumnId)) {
      return fail(`${at}.fromColumnId`, "must be a column id or null");
    }
    if (!isId(entry.toColumnId)) {
      return fail(`${at}.toColumnId`, "must be a column id");
    }
    if (entry.fromColumnId === entry.toColumnId) {
      return fail(
        `${at}.toColumnId`,
        "a transition cannot target its own column",
      );
    }
    const pair = `${entry.fromColumnId ?? "*"}\u0000${entry.toColumnId}`;
    if (pairs.has(pair)) {
      return fail(`${at}.toColumnId`, "duplicates another transition pair");
    }
    pairs.add(pair);

    let allowedRoles: WorkflowRole[] | undefined;
    if (entry.allowedRoles !== undefined) {
      if (
        !Array.isArray(entry.allowedRoles) ||
        entry.allowedRoles.length === 0
      ) {
        return fail(`${at}.allowedRoles`, "must be a non-empty array");
      }
      if (!entry.allowedRoles.every(isWorkflowRole)) {
        return fail(`${at}.allowedRoles`, "may only name ADMIN or MEMBER");
      }
      allowedRoles = [...new Set(entry.allowedRoles)];
    }

    let conditions: WorkflowCondition[] | undefined;
    if (entry.conditions !== undefined) {
      const rawConditions = entry.conditions;
      if (!Array.isArray(rawConditions)) {
        return fail(`${at}.conditions`, "must be an array");
      }
      if (!rawConditions.every(isWorkflowCondition)) {
        return fail(`${at}.conditions`, "contains an unknown condition");
      }
      conditions = WORKFLOW_CONDITIONS.filter((condition) =>
        rawConditions.includes(condition),
      );
    }

    let label: string | undefined;
    if (entry.label !== undefined) {
      if (
        typeof entry.label !== "string" ||
        entry.label.length > WORKFLOW_LIMITS.label
      ) {
        return fail(
          `${at}.label`,
          `must be a string of at most ${WORKFLOW_LIMITS.label} characters`,
        );
      }
      label = entry.label;
    }

    let enabled: boolean | undefined;
    if (entry.enabled !== undefined) {
      if (typeof entry.enabled !== "boolean") {
        return fail(`${at}.enabled`, "must be a boolean");
      }
      enabled = entry.enabled;
    }

    transitions.push({
      id: entry.id,
      fromColumnId: entry.fromColumnId as string | null,
      toColumnId: entry.toColumnId,
      ...(allowedRoles ? { allowedRoles } : {}),
      ...(conditions && conditions.length > 0 ? { conditions } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    });
  }

  if (input.enabled === true && transitions.length === 0) {
    return fail(
      `${field}.transitions`,
      "an enabled workflow needs at least one transition",
    );
  }

  return {
    ok: true,
    workflow: {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      enabled: input.enabled,
      ...(initialColumnId !== undefined ? { initialColumnId } : {}),
      doneColumnIds,
      transitions,
    },
  };
}

/** Lenient read for stored JSON (database, localStorage): invalid → absent. */
export function readBoardWorkflow(value: unknown): BoardWorkflow | undefined {
  if (value === null || value === undefined) return undefined;
  const result = validateWorkflowShape(value);
  return result.ok ? result.workflow : undefined;
}

/**
 * Check that every column reference exists. Returns the field path of the
 * first broken reference, or `null` when the config is consistent.
 *
 * The editor and the import remapper clean dangling references; the server
 * refuses a *new* config that names a column the board does not have.
 */
export function workflowReferenceError(
  workflow: BoardWorkflow,
  columns: readonly { id: string }[],
  field = "workflow",
): { field: string; message: string } | null {
  const ids = new Set(columns.map((column) => column.id));
  if (
    workflow.initialColumnId !== undefined &&
    !ids.has(workflow.initialColumnId)
  ) {
    return {
      field: `${field}.initialColumnId`,
      message: "references a column that does not exist",
    };
  }
  const doneIndex = workflow.doneColumnIds.findIndex((id) => !ids.has(id));
  if (doneIndex !== -1) {
    return {
      field: `${field}.doneColumnIds[${doneIndex}]`,
      message: "references a column that does not exist",
    };
  }
  for (const [index, transition] of workflow.transitions.entries()) {
    if (transition.fromColumnId !== null && !ids.has(transition.fromColumnId)) {
      return {
        field: `${field}.transitions[${index}].fromColumnId`,
        message: "references a column that does not exist",
      };
    }
    if (!ids.has(transition.toColumnId)) {
      return {
        field: `${field}.transitions[${index}].toColumnId`,
        message: "references a column that does not exist",
      };
    }
  }
  if (workflow.enabled && columns.length < 2) {
    return {
      field: `${field}.enabled`,
      message: "an enabled workflow needs at least two columns",
    };
  }
  return null;
}

/**
 * Rewrite a workflow's column ids through `idMap` (import / duplicate). A
 * transition whose from/to column is missing from the map is dropped; an
 * enabled config that loses all edges is saved disabled rather than invalid.
 */
export function remapBoardWorkflow(
  workflow: BoardWorkflow,
  idMap: ReadonlyMap<string, string>,
): BoardWorkflow {
  const mapId = (id: string): string | undefined => idMap.get(id);
  const transitions: WorkflowTransition[] = [];
  const pairs = new Set<string>();
  for (const transition of workflow.transitions) {
    const toColumnId = mapId(transition.toColumnId);
    const fromColumnId =
      transition.fromColumnId === null
        ? null
        : (mapId(transition.fromColumnId) ?? undefined);
    if (toColumnId === undefined) continue;
    if (fromColumnId === undefined) continue;
    if (fromColumnId === toColumnId) continue;
    const pair = `${fromColumnId ?? "*"}\u0000${toColumnId}`;
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    transitions.push({
      ...transition,
      fromColumnId,
      toColumnId,
    });
  }
  const initialColumnId =
    workflow.initialColumnId === undefined
      ? undefined
      : mapId(workflow.initialColumnId);
  const doneColumnIds = workflow.doneColumnIds
    .map((id) => mapId(id))
    .filter((id): id is string => id !== undefined);
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    enabled: workflow.enabled && transitions.length > 0,
    ...(initialColumnId !== undefined ? { initialColumnId } : {}),
    doneColumnIds,
    transitions,
  };
}

/**
 * Which conditions is a transition missing for a card? Empty means the card
 * may take the edge. Shared by the editor preview and the move menus.
 */
export function transitionBlockingConditions(
  workflow: BoardWorkflow | undefined,
  card: Card,
  fromColumnId: string,
  toColumnId: string,
  role?: BoardRole,
): WorkflowCondition[] {
  const decision = evaluateCardTransition(
    workflow,
    card,
    fromColumnId,
    toColumnId,
    role,
  );
  return decision.allowed ? [] : decision.failedConditions;
}
