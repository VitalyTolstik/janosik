/**
 * API contract shared by the UI and the future NestJS backend (§7.4).
 *
 * Mutations travel as a single command-log transport: the client posts a
 * `CommandRequest` and the server replays the very same `BoardAction`
 * through `boardReducer` from this package. This module is intentionally
 * minimal — only the wire shapes the two sides must agree on.
 */

import type { BoardAction } from "./store/board-reducer";
import type { Board } from "./types/kanban";
import type { BoardExportFile } from "./utils/board-serialization";

/** Body of `POST /boards/:id/commands` (§7.0). */
export interface CommandRequest {
  /** Client-generated idempotency key: a retry with the same id returns the stored result. */
  commandId: string;
  /** The reducer action to apply — the same shape the client already dispatches. */
  action: BoardAction;
  /** Expected board version; a mismatch is answered with `ConflictError`. */
  ifMatch?: number;
  /**
   * Per-entity optimistic-concurrency preconditions (TASK-29), keyed by the
   * touch key (`card:<id>`, `column:<id>`, …) with the entity `version` the
   * client last saw. Used for undo of text edits: if another writer has
   * changed the entity since, the server refuses with `409 {conflict:
   * "version"}` and the client refuses the undo instead of clobbering the
   * foreign text (§7.0). Omitted keys are not checked (positional changes
   * stay last-write-wins).
   */
  ifMatchVersions?: Record<string, number>;
}

/** Per-entity versions returned so the client can reconcile its optimistic state. */
export type EntityVersions = Record<string, number>;

/** `200` body of `POST /boards/:id/commands`. */
export interface CommandResponse {
  /** Monotonic board sequence number — the ordering and board version (§7.0). */
  seq: number;
  /** Version counters of the entities the command touched. */
  versions: EntityVersions;
}

/** Conflict categories the reducer guards can raise (§7.4). */
export type CommandConflict = "version" | "wip";

/** `409` body of `POST /boards/:id/commands`. */
export interface ConflictError {
  conflict: CommandConflict;
  currentVersion: number;
}

/**
 * One entry of `GET /boards/:id/commands?since=<seq>` — the delta catch-up
 * after an SSE gap. Carries the committed action so a client replays it
 * through `boardReducer`.
 */
export interface CommandDeltaEntry {
  /** Monotonic board sequence of the command. */
  seq: number;
  /** The committed action, exactly as it was applied. */
  action: BoardAction;
  /** Who issued the command. */
  actorId: string;
}

/** Server-sent event describing a committed command (TASK-30). */
export interface CommandSseEvent {
  type: "command";
  seq: number;
  action: BoardAction;
  actorId: string;
}

/** A user currently connected to the board (`presence`, TASK-36). */
export interface PresenceUser {
  id: string;
  displayName: string;
}

/** Server-sent event listing the users currently on the board (TASK-36). */
export interface PresenceSseEvent {
  type: "presence";
  users: PresenceUser[];
}

/** Server-sent event for non-reducer activity, e.g. a new comment (TASK-37). */
export interface ActivitySseEvent {
  type: "activity";
  id: string;
  boardId: string;
  cardId?: string;
  actorId: string;
  at: number;
  kind: string;
  detail?: string;
}

/** Discriminated union of every `GET /boards/:id/events` event (§7.4). */
export type BoardSseEvent =
  CommandSseEvent | PresenceSseEvent | ActivitySseEvent;

/**
 * Board membership roles (§7.0) — mirrors the backend Prisma `Role` enum.
 * ADMIN manages the board and members; MEMBER edits content; VIEWER reads.
 */
export type BoardRole = "ADMIN" | "MEMBER" | "VIEWER";

/** A row of `GET /boards/:id/members` (avatars/member modal, TASK-35). */
export interface BoardMemberDto {
  userId: string;
  displayName: string | null;
  email: string;
  role: BoardRole;
  /** Unix ms expiry of a time-limited VIEWER; `null` when unbounded. */
  expiresAt: number | null;
}

/** Body of `POST /boards/:id/members` — ADMIN-only invite (TASK-35). */
export interface InviteMemberRequest {
  email: string;
  role: BoardRole;
  /**
   * ISO-8601 expiry; only meaningful for `VIEWER` (other roles store
   * `null`). Omitted = unbounded.
   */
  expiresAt?: string | null;
}

/** Body of `PATCH /boards/:id/members/:userId` — ADMIN-only update. */
export interface UpdateMemberRequest {
  role?: BoardRole;
  /** `null` clears the VIEWER expiry; omitted keeps the current value. */
  expiresAt?: string | null;
}

/**
 * A pending invitation of `GET /invitations` (TASK-35 addendum): the row
 * exists but grants no access until the invitee accepts it. Invitees accept
 * or decline from the notifications bell; admins can cancel by removing the
 * member row.
 */
export interface BoardInvitationDto {
  /** `BoardMember.id` — the invitation is the pending membership row. */
  id: string;
  boardId: string;
  boardTitle: string;
  role: BoardRole;
  /** Unix ms expiry proposed for a VIEWER, or `null`. */
  expiresAt: number | null;
  /** Unix ms when the invitation was created. */
  createdAt: number;
  invitedByName: string | null;
  invitedByEmail: string | null;
}

/** Board counters shown in the switcher (`GET /boards`). */
export interface BoardCounters {
  cards: number;
  columns: number;
}

/** A `GET /boards` entry — boards the caller is a member of. */
export interface BoardSummary {
  id: string;
  title: string;
  /** Unix ms when the board is archived; omitted while active. */
  archivedAt?: number;
  counters: BoardCounters;
  /** The caller's role on this board — drives the ADMIN-only UI (TASK-29). */
  role: BoardRole;
}

/** Aggregate of `GET /boards/:id` — exactly the frontend `Board` model. */
export type BoardAggregate = Board;

/**
 * A non-command event type stored in `Activity` (§7.3): membership changes
 * and comments — everything a `BoardAction` cannot express (TASK-28).
 */
export const ACTIVITY_EVENT_TYPES = [
  "member_invited",
  "member_invite_accepted",
  "member_invite_declined",
  "member_role_changed",
  "member_expiry_changed",
  "member_removed",
  "comment_added",
  "comment_deleted",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/** Where a feed entry came from: the command log or an `Activity` row. */
export type ActivityFeedSource = "command" | "activity";

/**
 * One entry of `GET /boards/:id/activity` or `GET /cards/:id/activity`
 * (§7.4). The feed merges the Command log with `Activity` rows by time; the
 * cursor is opaque and pages are newest-first.
 */
export interface ActivityFeedEntry {
  source: ActivityFeedSource;
  /** `commandId` for commands, `Activity.id` otherwise. */
  id: string;
  /** Command `seq` — present on command entries (the composite tie-break). */
  seq?: number;
  /** Creation time, Unix ms — the primary sort key. */
  at: number;
  /** `BoardAction.type` or `Activity.type`. */
  type: string;
  /** Who caused the entry (real user id). */
  actorId: string;
  /** Command entries: the single card the command touched, when unambiguous. */
  cardId?: string;
  /** `Activity.details` snapshot (member email/role, comment text, …). */
  details?: Record<string, unknown> | null;
}

/** A page of an activity feed, newest-first (`nextCursor: null` = end). */
export interface ActivityFeedPage {
  items: ActivityFeedEntry[];
  nextCursor: string | null;
}

/** A card comment (plain text, TASK-28; UI in TASK-37). */
export interface CommentDto {
  id: string;
  cardId: string;
  authorId: string;
  text: string;
  /** Unix ms. */
  createdAt: number;
}

/** A page of `GET /cards/:id/comments`, newest-first. */
export interface CommentPage {
  items: CommentDto[];
  nextCursor: string | null;
}

/**
 * JSON envelope shared with the UI file format (§7.4): body of
 * `POST /boards/import` and payload of `GET /boards/:id/export`.
 */
export type BoardEnvelope = BoardExportFile;

/** Public user projection returned by the auth endpoints (§7.4, TASK-24). */
export interface AuthUserDto {
  id: string;
  email: string;
  displayName: string | null;
}

/**
 * Body of register/login/refresh: `{ accessToken, user }` — the refresh
 * token never appears in the body, it rides the httpOnly cookie (§7.0).
 */
export interface AuthResponseDto {
  accessToken: string;
  user: AuthUserDto;
}
