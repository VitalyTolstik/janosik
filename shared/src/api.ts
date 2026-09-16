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
}

/** Aggregate of `GET /boards/:id` — exactly the frontend `Board` model. */
export type BoardAggregate = Board;

/**
 * JSON envelope shared with the UI file format (§7.4): body of
 * `POST /boards/import` and payload of `GET /boards/:id/export`.
 */
export type BoardEnvelope = BoardExportFile;
