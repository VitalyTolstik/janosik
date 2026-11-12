import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  AgentsOverviewApprovalStatus,
  AgentsOverviewRunStatus,
  AgentsOverviewSection,
  AgentsOverviewSessionStatus,
  ApprovalStatus,
} from "@janosik/shared";

/** Effective approval statuses that are decided (everything but pending). */
const DECIDED_APPROVAL_STATUSES = new Set<ApprovalStatus>([
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "consumed",
]);

/**
 * TASK-179.10 effective expiry: `pending` and `approved` rows past their
 * `expiresAt` are shown as `expired` without writing the row. A stored
 * terminal status is never rewritten. `now` must be the request's single time
 * slice, shared by items, filters, totals and counts.
 */
export function effectiveApprovalStatus(
  status: ApprovalStatus,
  expiresAt: Date | number,
  now: Date | number,
): ApprovalStatus {
  if (status !== "pending" && status !== "approved") return status;
  const expiresAtMs =
    expiresAt instanceof Date ? expiresAt.getTime() : expiresAt;
  const nowMs = now instanceof Date ? now.getTime() : now;
  return expiresAtMs <= nowMs ? "expired" : status;
}

/** True when the effective status belongs in the decided/history group. */
export function isDecidedApprovalStatus(status: ApprovalStatus): boolean {
  return DECIDED_APPROVAL_STATUSES.has(status);
}

/** Escape LIKE metacharacters so `q` is a literal substring search. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export interface OverviewBindingInput {
  section: AgentsOverviewSection;
  boardId: string | null;
  q: string | undefined;
  status: string | undefined;
  kind: string | undefined;
  tokenId: string | undefined;
  sessionId: string | undefined;
  from: number | undefined;
  to: number | undefined;
  /** Sorted `boardId:role` pairs; a membership change invalidates cursors. */
  scope: string[];
}

/**
 * A cursor is opaque and bound to the section, every filter and the caller's
 * current board/role scope. Reusing it with another filter/scope is a client
 * error, not a way to page through a wider set.
 */
export function overviewBinding(input: OverviewBindingInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: 1,
        section: input.section,
        boardId: input.boardId,
        q: input.q ?? null,
        status: input.status ?? null,
        kind: input.kind ?? null,
        tokenId: input.tokenId ?? null,
        sessionId: input.sessionId ?? null,
        from: input.from ?? null,
        to: input.to ?? null,
        scope: input.scope,
      }),
    )
    .digest("base64url");
}

export type OverviewCursorGroup =
  "approval_pending" | "approval_decided" | "session" | "run";

export interface OverviewCursor {
  v: 1;
  /** Binding hash from {@link overviewBinding}. */
  b: string;
  g: OverviewCursorGroup;
  /** Timestamp key (expiresAt/decidedAt/startedAt/createdAt). */
  t: number | null;
  /** Id tiebreaker; `null` only for the start-of-decided-group cursor. */
  i: string | null;
}

const CURSOR_GROUPS = new Set<OverviewCursorGroup>([
  "approval_pending",
  "approval_decided",
  "session",
  "run",
]);

export function encodeOverviewCursor(cursor: OverviewCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeOverviewCursor(
  raw: string,
  binding: string,
): OverviewCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidCursor();
  }
  const value = parsed as Record<string, unknown>;
  if (value.v !== 1 || value.b !== binding) throw invalidCursor();
  if (
    typeof value.g !== "string" ||
    !CURSOR_GROUPS.has(value.g as OverviewCursorGroup)
  ) {
    throw invalidCursor();
  }
  const group = value.g as OverviewCursorGroup;
  const timestamp =
    value.t === null || value.t === undefined
      ? null
      : typeof value.t === "number" && Number.isFinite(value.t)
        ? value.t
        : undefined;
  const id =
    value.i === null || value.i === undefined
      ? null
      : typeof value.i === "string" && value.i.length > 0
        ? value.i
        : undefined;
  if (timestamp === undefined || id === undefined) throw invalidCursor();
  // Only the decided group may point at its start (before the first row).
  if (id === null && (group !== "approval_decided" || timestamp !== null)) {
    throw invalidCursor();
  }
  if (timestamp === null && group !== "approval_decided") throw invalidCursor();
  return { v: 1, b: binding, g: group, t: timestamp, i: id };
}

export function invalidCursor(): BadRequestException {
  return new BadRequestException({
    message: "Invalid or stale cursor",
    code: "invalid_cursor",
    retryable: false,
  });
}

export function invalidFilter(
  filter: string,
  allowed: readonly string[],
): BadRequestException {
  return new BadRequestException({
    message: `Unsupported ${filter} filter for this section`,
    code: "invalid_filter",
    filter,
    allowed,
    retryable: false,
  });
}

export function invalidRange(): BadRequestException {
  return new BadRequestException({
    message: "`from` must be less than or equal to `to`",
    code: "invalid_range",
    retryable: false,
  });
}

const APPROVAL_STATUS_FILTERS = new Set<AgentsOverviewApprovalStatus>([
  "all",
  "pending",
  "decided",
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "consumed",
]);

const SESSION_STATUS_FILTERS = new Set<AgentsOverviewSessionStatus>([
  "all",
  "live",
  "stale",
  "paused",
  "active",
  "idle",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

const RUN_STATUS_FILTERS = new Set<AgentsOverviewRunStatus>([
  "all",
  "applied",
  "reverted",
  "failed",
]);

export function parseApprovalStatusFilter(
  raw: string | undefined,
): AgentsOverviewApprovalStatus {
  const value = raw?.trim() || "all";
  if (!APPROVAL_STATUS_FILTERS.has(value as AgentsOverviewApprovalStatus)) {
    throw invalidFilter("status", [...APPROVAL_STATUS_FILTERS]);
  }
  return value as AgentsOverviewApprovalStatus;
}

export function parseSessionStatusFilter(
  raw: string | undefined,
): AgentsOverviewSessionStatus {
  const value = raw?.trim() || "all";
  if (!SESSION_STATUS_FILTERS.has(value as AgentsOverviewSessionStatus)) {
    throw invalidFilter("status", [...SESSION_STATUS_FILTERS]);
  }
  return value as AgentsOverviewSessionStatus;
}

export function parseRunStatusFilter(
  raw: string | undefined,
): AgentsOverviewRunStatus {
  const value = raw?.trim() || "all";
  if (!RUN_STATUS_FILTERS.has(value as AgentsOverviewRunStatus)) {
    throw invalidFilter("status", [...RUN_STATUS_FILTERS]);
  }
  return value as AgentsOverviewRunStatus;
}
