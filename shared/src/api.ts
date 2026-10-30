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
import type { UserAvatarColor } from "./types/account";
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

/**
 * Conflict categories a command can be refused with (§7.4):
 * - `version` — a precondition (`ifMatch`/`ifMatchVersions`) is stale;
 * - `wip` — the command would break a collection/WIP limit;
 * - `id` — the command names an entity id that already belongs to another
 *   board (the writers upsert by global id, so applying it would rewrite
 *   that board's row).
 */
export type CommandConflict = "version" | "wip" | "id";

/** `409` body of `POST /boards/:id/commands`. */
export interface ConflictError {
  conflict: CommandConflict;
  currentVersion: number;
}

/**
 * Who performed a command (TASK-157): a person at a browser session
 * (`"human"`) or an agent/integration authenticating with a personal API
 * token (`"agent"`). Recorded on the command and activity rows so the feed
 * can tell a swarm's edits from a teammate's.
 */
export type ActorType = "human" | "agent";

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
  /**
   * Whether a person or an agent issued the command (TASK-157). Omitted on
   * frames written before the field existed — treat as `"human"`.
   */
  actorType?: ActorType;
  /**
   * The issuing client's idempotency key. Lets a client recognise its own
   * echo by key rather than by `actorId` — one account may run several
   * writers at once (tabs, MCP agents on the same personal key).
   */
  commandId?: string;
  /**
   * Entities the command actually wrote, as `Command.touches` labels
   * (`card:<id>`, `column:<id>`, `label:<id>`, `checklist:<id>`,
   * `checklistItem:<id>`, `board:<id>`; TASK-30.1). Empty for a command
   * that changed nothing — the server computes it from its own writes, so
   * a client can mark its undo history foreign without diffing the board.
   */
  touches: string[];
}

/** Server-sent event describing a committed command (TASK-30). */
export interface CommandSseEvent {
  type: "command";
  seq: number;
  action: BoardAction;
  actorId: string;
  /** Whether a person or an agent issued the command (TASK-157). */
  actorType?: ActorType;
  /** The issuing client's idempotency key (see `CommandDeltaEntry.commandId`). */
  commandId?: string;
  /** Touched entity labels — same contract as `CommandDeltaEntry.touches`. */
  touches: string[];
}

/** A user currently connected to the board (`presence`, TASK-36). */
export interface PresenceUser {
  id: string;
  displayName: string;
  /** Chosen avatar color (TASK-36.1); `null` → the id-hash default. */
  avatarColor: UserAvatarColor | null;
  /** Stored avatar image name (TASK-47); `null` → render the initials. */
  avatarPath: string | null;
}

/**
 * Presence is a delta stream (TASK-36), not a repeated full roster:
 * - `sync`  — the complete roster, sent once when a stream connects;
 * - `join`  — a user's first live session on the board appeared;
 * - `leave` — their last live session went away;
 * - `update`— their public identity changed.
 * K clients joining is O(K) small frames, not O(K²) roster copies.
 */
export type PresenceSseEvent =
  | { type: "presence"; op: "sync"; users: PresenceUser[]; epoch?: number }
  | { type: "presence"; op: "join"; user: PresenceUser; epoch?: number }
  | { type: "presence"; op: "leave"; userId: string; epoch?: number }
  | { type: "presence"; op: "update"; user: PresenceUser; epoch?: number };

/**
 * Periodic stream keep-alive (TASK-145). Carries the board's current
 * presence `epoch` (when presence is enabled): a client whose last applied
 * presence epoch does not match has missed a delta — it reconnects to get a
 * fresh `sync` instead of trusting a silently incomplete roster.
 */
export interface KeepAliveSseEvent {
  type: "keepalive";
  presenceEpoch?: number;
}

/** What happened to a user's membership of a board (TASK-36). */
export type MembershipChange = "accepted" | "updated" | "removed";

/**
 * Server-sent event: a board's member directory changed (TASK-36). Open
 * member lists re-read the directory; `removed` for the removed user
 * themselves closes their stream and drops the board.
 */
export interface MembershipSseEvent {
  type: "membership";
  boardId: string;
  userId: string;
  change: MembershipChange;
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
/**
 * The server could not replay the full gap since `?since=` (the delta hit
 * its cap, or the requested seq is older than the retained log): the client
 * must refetch the board snapshot instead of trusting the stream to catch up.
 */
export interface ResyncSseEvent {
  type: "resync";
}

export type BoardSseEvent =
  | CommandSseEvent
  | PresenceSseEvent
  | ActivitySseEvent
  | MembershipSseEvent
  | KeepAliveSseEvent
  | ResyncSseEvent;

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
  /** Chosen avatar color (TASK-36.1); `null` → the id-hash default. */
  avatarColor: UserAvatarColor | null;
  /** Stored avatar image name (TASK-47); `null` → render the initials. */
  avatarPath: string | null;
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
 * One "from → to" line of a command's history diff (TASK-37). `field` names
 * the changed slot (`title`, `description`, `dueDate`, `column`, `label`,
 * `checklist`, `checklistItem`); values are display snapshots captured when
 * the command was applied, so a deleted label still renders its name.
 */
export interface ActivityChange {
  field: string;
  from: string | null;
  to: string | null;
}

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
  /**
   * Whether a person or an agent caused the entry (TASK-157). Omitted on
   * legacy rows — treat as `"human"`.
   */
  actorType?: ActorType;
  /** Command entries: the single card the command touched, when unambiguous. */
  cardId?: string;
  /** `Activity.details` snapshot (member email/role, comment text, …). */
  details?: Record<string, unknown> | null;
  /** Write-time snapshot for the sentence (label, item text, comment id). */
  detail?: string;
  /** Before → after lines captured at write time (TASK-37): commands freeze
   *  the display snapshot at apply time, comment rows carry their text. */
  changes?: ActivityChange[];
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

/** Lifecycle of the TASK-50 video transcode ("ужиматор"): video uploads
 * re-encode to a compact H.264 MP4 in a background job — `none` for
 * non-videos, `pending` while queued/running, `done` once `content`
 * serves the MP4, `failed` keeps the playable original. */
export type AttachmentTranscodeStatus = "none" | "pending" | "done" | "failed";

/** One card file attachment (TASK-47) — metadata only; the blob streams
 * from `GET /attachments/:id/content` to board members. */
export interface AttachmentDto {
  id: string;
  cardId: string;
  /** Original client-side file name (untrusted — never a path). */
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  /** Unix ms. */
  createdAt: number;
  /** TASK-50 video transcode state; `none` for non-video files. */
  transcodeStatus: AttachmentTranscodeStatus;
  /** TASK-70: an ffmpeg-made image thumbnail is available. */
  hasThumbnail: boolean;
  /** TASK-70: a video poster frame is available. */
  hasPoster: boolean;
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
  /** Chosen avatar color (TASK-36.1); `null` → the id-hash default. */
  avatarColor: UserAvatarColor | null;
  /** Stored avatar image name (TASK-47); `null` → render the initials. */
  avatarPath: string | null;
  /**
   * Opt-out of scheduled digests/reminders (TASK-153): the documented
   * account setting is now reachable through `PATCH /users/me`.
   */
  notifyDigest?: boolean;
  /** Unix ms of account creation — "member since" in the account panel. */
  createdAt: number;
  /**
   * Unix ms of the email confirmation (TASK-53); `null` (or absent, in test
   * doubles) → the address is not confirmed yet and the app shows the
   * verification gate.
   */
  emailVerifiedAt?: number | null;
  /**
   * `GET /auth/me` only: the master who minted the access token this request
   * used (its `imp` claim), or `null` for a normal session or an API key.
   * Lets the app confirm server-side that a hash-delivered token really is a
   * support session before adopting it.
   */
  impersonatedBy?: string | null;
}

/**
 * Body of register/login/refresh: `{ accessToken, user }` — the refresh
 * token never appears in the body, it rides the httpOnly cookie (§7.0).
 */
export interface AuthResponseDto {
  accessToken: string;
  user: AuthUserDto;
}

/**
 * OAuth login (TASK-54). The backend speaks the authorization-code flow of
 * each provider; the ids are stable wire values shared by the admin
 * settings API, so the provider list lives here next to the auth DTOs.
 */
export const OAUTH_PROVIDER_IDS = ["google", "yandex"] as const;

/** Every provider id the OAuth endpoints and admin settings accept. */
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

/** One login button on the sign-in screen (only enabled providers appear). */
export interface OAuthProviderDto {
  id: OAuthProviderId;
  /** Human-readable button label ("Google", "Яндекс"). */
  label: string;
}

/** Body of `GET /auth/oauth/providers`. */
export interface AuthOAuthProvidersResponse {
  providers: OAuthProviderDto[];
}

/**
 * Body of `GET /auth/config` (TASK-38a) — the sign-in screen reads it before
 * a session exists, to decide whether to offer registration.
 */
export interface AuthConfigResponse {
  /** False when the operator closed sign-up (env or the master panel). */
  allowRegistration: boolean;
  /** False when public read-only board links are disabled. */
  allowPublicShares: boolean;
}

/** Body of `PATCH /users/me` (TASK-36.1): only changed fields are sent. */
export interface UpdateProfileRequest {
  /** `null` clears the name (the UI then falls back to the email). */
  displayName?: string | null;
  /** `null` restores the id-hash default color. */
  avatarColor?: UserAvatarColor | null;
  /** Opt out of scheduled digests/reminders (TASK-153). */
  notifyDigest?: boolean;
}

/** Body of `POST /users/me/password` (TASK-36.1). */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * A personal API token as listed by `GET /users/me/tokens` (TASK-36.1).
 * The plaintext is never returned again after creation.
 */
export interface UserTokenDto {
  id: string;
  name: string;
  /** Unix ms. */
  createdAt: number;
  /** Unix ms of the last authenticated request; `null` until first use. */
  lastUsedAt: number | null;
  /** Unix ms expiry; `null` = never expires. */
  expiresAt: number | null;
  /** Unix ms revoke time; `null` while active/expired. */
  revokedAt: number | null;
  /**
   * Board the token is scoped to (TASK-157); `null` = every board its owner
   * can access.
   */
  boardId: string | null;
  /** When true the token may only read (TASK-157). */
  readOnly: boolean;
  /** Requests per minute this token may make; `null` = no per-token limit. */
  rateLimitPerMinute: number | null;
}

/** Body of `POST /users/me/tokens` (TASK-36.1). */
export interface CreateUserTokenRequest {
  name: string;
  /** ISO-8601 expiry; omitted/`null` = never expires. Must be in the future. */
  expiresAt?: string | null;
  /** Scope to one board (TASK-157); omitted/`null` = every board. */
  boardId?: string | null;
  /** Read-only token (TASK-157); omitted = read/write. */
  readOnly?: boolean;
  /** Per-token request limit per minute (TASK-157); omitted/`null` = none. */
  rateLimitPerMinute?: number | null;
}

/** Response of `POST /users/me/tokens`: the plaintext appears exactly once. */
export interface CreateUserTokenResponse {
  token: string;
  apiToken: UserTokenDto;
}
