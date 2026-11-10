/**
 * API contract shared by the UI and the future NestJS backend (§7.4).
 *
 * Mutations travel as a single command-log transport: the client posts a
 * `CommandRequest` and the server replays the very same `BoardAction`
 * through `boardReducer` from this package. This module is intentionally
 * minimal — only the wire shapes the two sides must agree on.
 */

import type { BoardAction } from "./store/board-reducer";
import type { Board, CommentKind } from "./types/kanban";
import type { WorkflowCondition, WorkflowRole } from "./workflow";
import type { UserAvatarColor } from "./types/account";
import type { BoardExportFile } from "./utils/board-serialization";
import type { AnnouncementLocale } from "./announcements";

/** Body of `POST /boards/:id/commands` (§7.0). */
export interface CommandRequest {
  /** Client-generated idempotency key: a retry with the same id returns the stored result. */
  commandId: string;
  /** The reducer action to apply — the same shape the client already dispatches. */
  action: BoardAction;
  /** Expected board version; a mismatch is answered with `ConflictError`. */
  ifMatch?: number;
  /**
   * TASK-166.7: optional idempotency key for the `AgentRun` created for a
   * single destructive PAT command. Ignored for non-destructive commands and
   * browser sessions (D16).
   */
  clientRunId?: string;
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
  /** TASK-166.7: the agent run this command belongs to, when one was created. */
  runId?: string | null;
}

/**
 * Upper bound on the commands in one batch (TASK-160). A batch shares one
 * board lock, one aggregate load and one transaction, so the ceiling keeps a
 * single write bounded; a caller that needs more sends several batches.
 */
export const COMMAND_BATCH_MAX = 100;

/**
 * Body of `POST /boards/:id/commands/batch` (TASK-160). The server applies
 * every command in order, in one transaction under the board's single write
 * lock, so an agent's "create a card and set its fields" step costs one
 * round-trip and one lock instead of one per command. All-or-nothing: a
 * failure on any command rolls the whole batch back.
 */
export interface CommandBatchRequest {
  commands: CommandRequest[];
  /**
   * TASK-166.7: idempotency key for the `AgentRun` created for a PAT batch.
   * A repeat with the same key and the same `commandId` set returns the
   * existing run; another plan on the same key is `409 run_conflict`.
   */
  clientRunId?: string;
}

/**
 * `200` body of `POST /boards/:id/commands/batch` — one `CommandResponse`
 * per request command, in the same order. A command that was already applied
 * (a retried `commandId`) returns its stored result. `runId` is the PAT run
 * created for this batch, or `null` for a human batch / an ordinary replay.
 */
export interface CommandBatchResponse {
  runId?: string | null;
  results: CommandResponse[];
}

/**
 * Conflict categories a command can be refused with (§7.4):
 * - `version` — a precondition (`ifMatch`/`ifMatchVersions`) is stale;
 * - `wip` — the command would break a collection/WIP limit;
 * - `id` — the command names an entity id that already belongs to another
 *   board (the writers upsert by global id, so applying it would rewrite
 *   that board's row);
 * - `workflow` — the move is forbidden by the board's configured workflow.
 */
export type CommandConflict = "version" | "wip" | "id" | "workflow";

/** Machine-readable details of a `409 { conflict: "workflow" }` refusal. */
export interface WorkflowConflictDetails {
  code: "transition_not_allowed" | "role_not_allowed" | "condition_failed";
  fromColumnId: string | null;
  toColumnId: string;
  /** Other columns the card may move to for this role and card state. */
  allowedToColumnIds: string[];
  /** Roles that would have allowed the edge (`role_not_allowed` only). */
  requiredRoles?: WorkflowRole[];
  /** Conditions that failed (`condition_failed` only). */
  failedConditions?: WorkflowCondition[];
}

/** `409` body of `POST /boards/:id/commands`. */
export interface ConflictError {
  conflict: CommandConflict;
  currentVersion: number;
  /** Only for `conflict: "workflow"`. */
  workflow?: WorkflowConflictDetails;
}

/**
 * Machine-readable error codes the server emits today (TASK-166.4, ADR §8.2).
 * This is a published catalog, not a closed union: clients must still tolerate
 * an unknown code from a newer server and fall back to the HTTP status.
 */
export const API_ERROR_CODES = [
  "scope_denied",
  "destructive_denied",
  "agent_paused",
  "agent_session_closed",
  "agent_session_invalid",
  "pat_required",
  "pat_forbidden",
  "pat_read_only",
  "approval_required",
  "approval_expired",
  "approval_mismatch",
  "approval_owner_mismatch",
  "approval_not_pending",
  "approval_rejected",
  "approval_cancelled",
  "approval_consumed",
  "version_conflict",
  "id_conflict",
  "workflow_conflict",
  "run_conflict",
  "run_expired",
  "limit_exceeded",
  "idempotency_conflict",
  "idempotency_in_progress",
  "payload_too_large",
  "rate_limited",
  "login_backoff",
  "export_in_progress",
  "announcement_translations_incomplete",
  "announcement_source_translation_required",
  "board_write_timeout",
  "not_found",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "conflict",
  "method_not_allowed",
  "gone",
  "unsupported_media_type",
  "range_not_satisfiable",
  "service_unavailable",
  "internal_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number] | (string & {});

/**
 * The one error body every REST route returns (TASK-166.4, ADR §8.1).
 *
 * `code` and `retryable` are the parts an agent branches on; `message` is an
 * English fallback, localizable by `code`. `requestId` is the same value as
 * the `X-Request-Id` response header. `currentVersion` is always present as a
 * number or `null` — for a command conflict it is `max(Command.seq)`, not
 * `Board.version`.
 *
 * The legacy top-level `field`, `conflict`, `workflow` and `retryAfter`
 * fields remain for existing clients; `statusCode` is kept as a compatibility
 * mirror of the HTTP status. Unknown extra keys must be ignored.
 */
export interface ApiErrorEnvelope {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
  requestId: string;
  currentVersion: number | null;
  statusCode?: number;
  /** The request field a validation or idempotency error points at. */
  field?: string;
  /** Optional machine-readable context (`messages`, `versionOf`, …). */
  details?: Record<string, unknown>;
  /** Legacy conflict category — same value as the matching `*_conflict` code. */
  conflict?: CommandConflict;
  /** Only for a workflow conflict; unchanged from `ConflictError`. */
  workflow?: WorkflowConflictDetails;
  /** Destinations the card may move to on a workflow conflict. */
  allowedToColumnIds?: string[];
  /** Announcement locales that still need a translation (admin error). */
  missingLocales?: string[];
  /** Semantic limit (WIP/collection/board/run) and the observed count. */
  limit?: number;
  current?: number;
  /** Idempotency key that caused `idempotency_conflict`/`_in_progress`. */
  key?: string;
  /** Seconds to wait before retrying a retryable error. */
  retryAfter?: number;
  /** Resource name for `not_found` (`board`, `card`, `share`, …). */
  resource?: string;
  /** Required and actual preset for a scope denial. */
  requiredScope?: ScopePreset;
  effectiveTokenScope?: ScopePreset;
  requiredRoles?: string[];
  /** Approval seam: filled in by 166.5 when an approval exists. */
  approvalId?: string;
  planHash?: string;
  expiresAt?: number;
  /** Prefixes of the expected/actual hash when a plan did not match. */
  expectedPlanHash?: string;
  actualPlanHash?: string;
  /** Action name for scope/policy/approval errors (`DELETE_CARD`, …). */
  action?: string;
  /** `board_policy`, `board_scope`, … */
  reason?: string;
  /** Pause scope for `agent_paused` (`session`, `board`, `token`). */
  pauseScope?: string;
  /** Mirror of `pauseScope` used by the agent-pause contract. */
  scope?: string;
  /** When the pause/approval state was set (Unix ms). */
  pausedAt?: number;
  /** Approval state for `approval_not_pending`/`approval_consumed`. */
  status?: string;
  /** Run that consumed an approval. */
  runId?: string | null;
}

/** Header carrying a REST idempotency key (ADR §6.12). */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Idempotency record lifetime in hours (ADR §6.11). */
export const IDEMPOTENCY_TTL_HOURS = 24;

/**
 * REST write operations that honour `Idempotency-Key` (ADR §6.11/§7.2).
 * Command writes are idempotent through `CommandRequest.commandId` instead.
 */
export type IdempotencyScope =
  | "create_board"
  | "import_boards"
  | "duplicate_card"
  | "add_comment"
  | "create_share"
  | "upload_attachment";

/**
 * Who performed a command (TASK-157): a person at a browser session
 * (`"human"`) or an agent/integration authenticating with a personal API
 * token (`"agent"`), or a platform administrator (`"admin"`). Administrative
 * commands retain a board user as the storage actor; the administrative
 * audit identifies the actual administrator.
 */
export type ActorType = "human" | "agent" | "admin";

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
  /**
   * TASK-166 attribution: the PAT and agent session that issued the command.
   * Omitted for browser sessions and rows written before the fields existed.
   */
  apiTokenId?: string;
  agentSessionId?: string;
  runId?: string | null;
  /** Token-name snapshot at write time (`ApiToken.name`). */
  agentName?: string;
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
  /** TASK-166 attribution — same contract as `CommandDeltaEntry`. */
  apiTokenId?: string;
  agentSessionId?: string;
  runId?: string | null;
  agentName?: string;
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
  /** TASK-166: keep `actorType` on activity frames too. */
  actorType?: ActorType;
  at: number;
  kind: string;
  detail?: string;
  /** TASK-166 attribution — same contract as `CommandDeltaEntry`. */
  apiTokenId?: string;
  agentSessionId?: string;
  runId?: string | null;
  agentName?: string;
}

/** TASK-166: an agent-session control-plane transition. */
export interface AgentSseEvent {
  type: "agent";
  op: "started" | "paused" | "resumed" | "ended";
  sessionId?: string;
  scope?: "board" | "token" | "session";
  at: number;
}

/** TASK-166: an approval changed state (TASK-166.5). */
export interface ApprovalSseEvent {
  type: "approval";
  approvalId: string;
  status: ApprovalStatus;
  cardId?: string;
  at: number;
}

/**
 * TASK-166.7: a run-level lifecycle event on the board stream. A successful
 * human rollback emits `run.reverted` after its transaction commits; the
 * original run is `runId`, the new audit run is `revertRunId`.
 */
export interface RunSseEvent {
  type: "run";
  op: "reverted";
  runId: string;
  revertRunId: string;
  at: number;
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
  | ResyncSseEvent
  | AgentSseEvent
  | ApprovalSseEvent
  | RunSseEvent;

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

/**
 * A pending invitation on `GET /boards/:id/invitations` (ADMIN only): the
 * inviter can see and cancel a row the invitee has not answered yet.
 */
export interface BoardPendingInvitationDto {
  id: string;
  userId: string;
  displayName: string | null;
  email: string;
  role: BoardRole;
  /** Unix ms expiry of a time-limited VIEWER; `null` when unbounded. */
  expiresAt: number | null;
  /** Unix ms the invitation was created. */
  createdAt: number;
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
  // TASK-166 agent control / approvals / pause.
  "approval_requested",
  "approval_approved",
  "approval_rejected",
  "approval_cancelled",
  "approval_expired",
  "approval_consumed",
  "agent_session_started",
  "agent_session_ended",
  "agent_session_paused",
  "agent_session_resumed",
  "agents_paused",
  "agents_resumed",
  "agent_policy_changed",
  "run_reverted",
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
  /** TASK-166 attribution: the PAT, session and run behind the entry. */
  apiTokenId?: string;
  agentSessionId?: string;
  runId?: string | null;
  /** Token-name snapshot at write time. */
  agentName?: string;
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

/**
 * TASK-166 agent sessions: the board-scoped work context of one PAT
 * (`start`/`heartbeat`/`end`). A session is not an account and grants no
 * rights beyond the token that owns it.
 */
export const AGENT_SESSION_STATUSES = [
  "active",
  "idle",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number];

/** A session whose heartbeat is older than this is reported as `stale`. */
export const AGENT_SESSION_STALE_MS = 5 * 60 * 1000;

/** Body of `POST /boards/:id/agent-sessions`. */
export interface CreateAgentSessionRequest {
  name?: string;
  clientName?: string;
  model?: string;
}

/** Body of `POST /boards/:id/agent-sessions/:sessionId/heartbeat`. */
export interface AgentSessionHeartbeatRequest {
  status?: Exclude<AgentSessionStatus, "completed" | "failed" | "cancelled">;
  currentCardId?: string | null;
  summary?: string;
}

/** Body of `POST /boards/:id/agent-sessions/:sessionId/end`. */
export interface EndAgentSessionRequest {
  status?: "completed" | "failed" | "cancelled";
  summary?: string;
}

/** One agent session (`GET` list/detail and the start/heartbeat/end replies). */
export interface AgentSessionDto {
  id: string;
  userId: string;
  apiTokenId: string;
  boardId: string;
  name: string | null;
  clientName: string | null;
  model: string | null;
  status: AgentSessionStatus;
  currentCardId: string | null;
  currentRunId: string | null;
  startedAt: number;
  lastHeartbeatAt: number;
  /** Computed: no heartbeat for `AGENT_SESSION_STALE_MS` and not terminal. */
  stale: boolean;
  paused: boolean;
  pausedAt: number | null;
  pausedBy: string | null;
  pausedReason: string | null;
  pauseScope: "board" | "token" | "session" | null;
  endedAt: number | null;
  endReason: string | null;
  summary: string | null;
}

/**
 * The pause state of one level (TASK-166.3).
 */
export interface AgentPauseStateDto {
  scope: "board" | "token" | "session";
  paused: boolean;
  pausedAt: number | null;
  pausedBy: string | null;
  reason: string | null;
}

/** `POST /boards/:id/agents/pause|resume` response. */
export interface BoardAgentPauseDto extends AgentPauseStateDto {
  scope: "board";
  boardId: string;
}

/**
 * `POST /agents/pause-all|resume-all` response. `affected` is the number of
 * live tokens whose `stopAllPausedAt` stamp changed in this call.
 */
export interface AgentStopAllPauseDto {
  paused: boolean;
  pausedAt: number | null;
  pausedBy: string | null;
  affected: number;
}

/**
 * `GET /boards/:id/search?q=` (TASK-157, D11) — the ids of cards whose title,
 * description, a checklist item or a comment contains the query. A server
 * search reaches text that is not in the board aggregate (comments), so the
 * MCP search can span the whole card, not just its title and description.
 */
export interface BoardCardSearchResult {
  cardIds: string[];
}

/** A card comment (plain text, TASK-28; UI in TASK-37). */
export interface CommentDto {
  id: string;
  cardId: string;
  authorId: string;
  text: string;
  /**
   * Structured kind (TASK-157, D10) — `note` by default, or one of the swarm
   * vocabulary values (`status`, `question`, `blocker`, `evidence`,
   * `handoff`). Lets a reader filter ("only blockers") without parsing text.
   */
  kind: CommentKind;
  /** TASK-166: `agent` when a PAT wrote the comment, otherwise `human`. */
  actorType: ActorType;
  /** TASK-166 attribution; absent on public shares and legacy rows. */
  apiTokenId?: string | null;
  agentSessionId?: string | null;
  agentName?: string | null;
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
  /** TASK-166 attribution for the "own upload" rule; null on legacy rows. */
  uploadedByTokenId?: string | null;
  uploadedBySessionId?: string | null;
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

/** TASK-166: `POST /boards/import?dryRun=1` preview — writes nothing. */
export interface BoardImportPreviewDto {
  boards: number;
  cards: number;
  columns: number;
  labels: number;
  /** True when the operator cap would accept this envelope right now. */
  withinLimit: boolean;
}

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
  /**
   * TASK-166.9 opt-out of immediate attention e-mails. Omitted means on; the
   * in-app attention inbox is unaffected.
   */
  notifyAttention?: boolean;
  /**
   * Canonical language of the interface, announcement banner and email.
   * Omitted for accounts created before localization; the client adopts its
   * current language once, and the server treats "not chosen" as English for
   * email while the banner uses the requested/Accept-Language locale.
   */
  locale?: AnnouncementLocale;
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
  /**
   * TASK-166: whether this account has a local password. `false` means an
   * OAuth-only account; the account panel uses it to choose the deletion
   * proof instead of guessing from the login method.
   */
  hasPassword?: boolean;
  /**
   * `GET /auth/me` only: which proof `DELETE /users/me` expects.
   */
  deletionMethod?: "password" | "email_code";
  /**
   * `GET /auth/me` only (TASK-166): how the browser session authenticated.
   * Kept for diagnostics; deletion uses `hasPassword`/`deletionMethod`.
   */
  authMethod?: "password" | "oauth";
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
 * `GET /auth/me`: the user projection plus the optional token identity
 * (TASK-166) and impersonation marker. A browser session gets `token: null`.
 */
export interface ServerInfoDto {
  version: string;
  apiVersion: string;
}

export interface AuthMeResponseDto extends AuthUserDto {
  impersonatedBy: string | null;
  token: ApiTokenIdentityDto | null;
  session: AgentSessionDto | null;
  server?: ServerInfoDto;
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
  /**
   * TASK-166 runtime limits. `boards: null` means unlimited (the default in
   * server mode); a positive number is an operator safety cap. `importBytes`
   * is the board-import envelope cap.
   */
  limits: {
    boards: number | null;
    importBytes: number;
  };
}

/**
 * TASK-166 self-service data export (`POST /users/me/export`). The bundle is
 * built by the existing `DataExport` queue and downloaded through a TTL link.
 */
export interface UserDataExportDto {
  id: string;
  status: "pending" | "ready" | "failed";
  /** Unix ms. */
  createdAt: number;
  /** Unix ms; the artifact is deleted at this point. */
  expiresAt: number;
  sizeBytes: number | null;
  error: string | null;
}

/** `POST /users/me/delete/request-code` — OAuth-only accounts. */
export interface RequestAccountDeletionCodeRequest {
  /**
   * An access token issued by OAuth login no more than 10 minutes ago. The
   * server checks the signature, `sub`, `iat` and the `authMethod` claim.
   */
  oauthProof?: string;
}

/** `POST /users/me/delete/request-code` response. */
export interface RequestAccountDeletionCodeResponse {
  expiresAt: number;
  queued: boolean;
}

/**
 * `DELETE /users/me` — session-only. A password account sends its current
 * password; an OAuth-only account sends `oauthProof` plus the `emailCode`.
 */
export interface DeleteAccountRequest {
  password?: string;
  oauthProof?: string;
  emailCode?: string;
  /** Must equal the account email (case-insensitive) — a typed confirmation. */
  confirmEmail: string;
}

/** `DELETE /users/me` response: the account is disabled now, purged later. */
export interface DeleteAccountResponse {
  status: "scheduled";
  /** Unix ms — seven days after the request. */
  deleteAfter: number;
}

/** Body of `PATCH /users/me` (TASK-36.1): only changed fields are sent. */
export interface UpdateProfileRequest {
  /** `null` clears the name (the UI then falls back to the email). */
  displayName?: string | null;
  /** `null` restores the id-hash default color. */
  avatarColor?: UserAvatarColor | null;
  /** Opt out of scheduled digests/reminders (TASK-153). */
  notifyDigest?: boolean;
  /** Opt out of immediate attention e-mails (TASK-166.9). */
  notifyAttention?: boolean;
  /** Canonical language for the UI, announcements and email. */
  locale?: AnnouncementLocale | null;
}

/** Body of `POST /users/me/password` (TASK-36.1). */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * TASK-166 capability preset. A preset never raises the board role; `readOnly`
 * still yields an effective `observer`.
 */
export const SCOPE_PRESETS = [
  "observer",
  "worker",
  "reviewer",
  "admin",
] as const;

export type ScopePreset = (typeof SCOPE_PRESETS)[number];

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
  /** TASK-166 capability preset; `readOnly` still wins when true. */
  scopePreset: ScopePreset;
  /** TASK-166 trusted-CI escape hatch (explicit, never a preset). */
  trustedCi: boolean;
  /** Unix ms of an individual pause; `null` when not individually paused. */
  individualPausedAt: number | null;
  individualPausedBy: string | null;
  individualPausedReason: string | null;
  /** Unix ms of the bulk "stop all" pause; `null` when not paused that way. */
  stopAllPausedAt: number | null;
  stopAllPausedBy: string | null;
  /** True while either pause source is active. */
  paused: boolean;
  /** `observer` when `readOnly`, otherwise `scopePreset` (not authorization). */
  effectiveTokenScope: ScopePreset;
}

/**
 * The token half of the identity surface (`GET /auth/me` for a PAT and
 * `janosik_whoami`). It exposes no secret and no token hash.
 */
export interface ApiTokenIdentityDto {
  id: string;
  name: string;
  scopePreset: ScopePreset;
  trustedCi: boolean;
  effectiveTokenScope: ScopePreset;
  boardId: string | null;
  readOnly: boolean;
  rateLimitPerMinute: number | null;
  individualPausedAt: number | null;
  stopAllPausedAt: number | null;
  paused: boolean;
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
  /** TASK-166 preset; defaults to `worker`. */
  scopePreset?: ScopePreset;
  /** TASK-166 trusted CI; defaults to `false`, session JWT only. */
  trustedCi?: boolean;
}

/** Response of `POST /users/me/tokens`: the plaintext appears exactly once. */
export interface CreateUserTokenResponse {
  token: string;
  apiToken: UserTokenDto;
}

/* ------------------------------------------------------------------ *
 * TASK-166.5 — approval & handoff API
 * ------------------------------------------------------------------ */

export const APPROVAL_KINDS = ["destructive", "done", "custom"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "consumed",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_RISKS = ["low", "medium", "high"] as const;
export type ApprovalRisk = (typeof APPROVAL_RISKS)[number];

/** Lifecycle operations a plan may carry instead of commands (§6.7). */
export const APPROVAL_OPERATIONS = [
  "board.delete",
  "member.invite",
  "member.update",
  "member.remove",
  "share.create",
  "share.update",
  "share.revoke",
  "share.delete",
  "attachment.delete",
] as const;
export type ApprovalOperationName = (typeof APPROVAL_OPERATIONS)[number];

/**
 * One command in an approval plan. `action.at` is deliberately absent: the
 * server clock is not part of the intent or the `planHash`.
 */
export interface ApprovalPlanCommand {
  commandId: string;
  action: Record<string, unknown> & { type: string };
  ifMatch?: number;
  ifMatchVersions?: Record<string, number>;
}

/** One lifecycle operation in an approval plan. */
export interface ApprovalPlanOperation {
  op: ApprovalOperationName;
  target: Record<string, unknown>;
  body: Record<string, unknown>;
}

/** The exact executable plan an approval authorizes (§6.7). */
export interface ApprovalPlan {
  schemaVersion: 1;
  boardId: string;
  commands?: ApprovalPlanCommand[];
  operations?: ApprovalPlanOperation[];
}

/** Body of `POST /boards/:id/approvals` (PAT only). */
export interface CreateApprovalRequest {
  kind: ApprovalKind;
  cardId?: string;
  /** Requested lifetime; the server clamps it to the board policy and 5 min. */
  ttlMinutes?: number;
  plan: ApprovalPlan;
}

/** Body of `POST /boards/:id/approvals/:approvalId/decision` (session only). */
export interface ApprovalDecisionRequest {
  decision: "approve" | "reject";
  planHash: string;
  comment?: string;
}

/**
 * One `ApprovalRequest` row. `plan` is present on a detail read for a board
 * ADMIN or the requesting token; the list omits it to keep pages small.
 */
export interface ApprovalRequestDto {
  id: string;
  boardId: string;
  cardId: string | null;
  requestedBy: string;
  requestedByTokenId: string;
  agentSessionId: string | null;
  kind: ApprovalKind;
  actionType: string;
  summary: string;
  risk: ApprovalRisk;
  planHash: string;
  status: ApprovalStatus;
  expiresAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  decisionComment: string | null;
  runId: string | null;
  consumedAt: number | null;
  createdAt: number;
  plan?: ApprovalPlan;
}

/** `GET /boards/:id/approvals` filters. */
export interface ApprovalListQuery {
  status?: ApprovalStatus;
  kind?: ApprovalKind;
  cardId?: string;
  limit?: number;
}

/* ------------------------------------------------------------------ *
 * TASK-166.7 — run grouping & rollback
 * ------------------------------------------------------------------ */

export const AGENT_RUN_KINDS = ["batch", "plan", "single", "revert"] as const;
export type AgentRunKind = (typeof AGENT_RUN_KINDS)[number];

export const AGENT_RUN_STATUSES = ["applied", "reverted", "failed"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/**
 * One `AgentRun` — the unit of audit and rollback (§6.6, TASK-166.7). A run
 * belongs to exactly one board; `clientRunId` is the optional idempotency key
 * scoped to that board. `firstSeq`/`lastSeq` are the `Command.seq` range.
 */
export interface AgentRunDto {
  id: string;
  boardId: string;
  apiTokenId: string | null;
  agentSessionId: string | null;
  actorId: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  clientRunId: string | null;
  planHash: string | null;
  approvalId: string | null;
  commandCount: number;
  firstSeq: number | null;
  lastSeq: number | null;
  revertsRunId: string | null;
  createdAt: number;
  appliedAt: number;
  revertedAt: number | null;
}

/** `GET /boards/:id/runs` returns summaries: no commands or preimages. */
export type RunSummaryDto = AgentRunDto;

/**
 * `GET /boards/:id/runs/:runId`. `preimages` are present for a board ADMIN
 * browser session only; an API token (even its owner is a board ADMIN) gets
 * the run, its commands and attribution without the before-state snapshots
 * (§7.2/§11.3).
 */
export interface RunDetailDto {
  run: AgentRunDto;
  commands: CommandDeltaEntry[];
  preimages: Record<string, unknown>;
}

/**
 * One reason a run cannot be reverted as it stands. `expectedVersion` is the
 * `postVersion` recorded when the run applied; `currentVersion` is what the
 * entity has now.
 */
export interface RevertConflictDto {
  touch: string;
  expectedVersion: number;
  currentVersion: number;
  reason: string;
}

/** Body of `POST /boards/:id/runs/:runId/revert` and `…/revert/preview`. */
export interface RevertRunRequest {
  /** Preview only; the server writes nothing. Defaults to `false`. */
  dryRun?: boolean;
  /** Idempotency key for a real revert (required when `dryRun` is false). */
  commandId?: string;
}

/**
 * `POST …/runs/:runId/revert` with `{ dryRun: true }`. `diff` is present for
 * a board ADMIN browser session only; an observer gets conflicts without
 * snapshots.
 */
export interface RevertPreviewDto {
  dryRun: true;
  run: RunSummaryDto;
  conflicts: RevertConflictDto[];
  canRevert: boolean;
  diff?: Record<string, unknown>;
}

/** `GET /boards/:id/runs` filters. */
export interface RunListQuery {
  status?: AgentRunStatus;
  kind?: AgentRunKind;
  apiTokenId?: string;
  agentSessionId?: string;
  clientRunId?: string;
  limit?: number;
  /** Run id to page after (older rows). */
  cursor?: string;
}

/* ------------------------------------------------------------------ *
 * TASK-166.8 — plan preview & atomic apply
 * ------------------------------------------------------------------ */

/**
 * One command of a plan. A plan is the exact intent stored in the approval
 * and hashed by `planHash`; `action.at` and the action-level `boardId` are
 * transport context, so the server strips them before hashing and stamps the
 * clock again on apply.
 */
export interface PlanCommandRequest {
  commandId: string;
  action: Record<string, unknown> & { type: string };
  ifMatch?: number;
  ifMatchVersions?: Record<string, number>;
}

/** Body of `POST /boards/:id/plans` (dry-run) and `/plans/apply`. */
export interface PlanRequest {
  commands: PlanCommandRequest[];
  /** Idempotency key for the `AgentRun` (`kind: "plan"`) on apply. */
  clientRunId?: string;
}

/** Body of `POST /boards/:id/plans/apply`. */
export interface PlanApplyRequest extends PlanRequest {
  /** Lower-case sha256 of the canonical plan returned by the preview. */
  planHash: string;
}

/** Why the preview expects the apply to be refused (all-or-nothing). */
export type PlanConflictCode =
  | "version"
  | "wip"
  | "workflow"
  | "id"
  | "scope"
  | "destructive_denied"
  | "invalid";

/**
 * One reason the plan would not apply as it stands. `index` is the zero-based
 * command position; plan-level conflicts (scope, policy) omit it.
 */
export interface PlanConflictDto {
  index?: number;
  commandId?: string;
  code: PlanConflictCode;
  message: string;
  /** Board `seq` at the command's point in the plan, for version conflicts. */
  currentVersion?: number;
}

/**
 * A non-blocking observation. `approval_required` is a warning, not a
 * conflict: a human decision makes the plan applicable.
 */
export type PlanWarningCode =
  "approval_required" | "destructive" | "reviewer_required" | "no_op";

export interface PlanWarningDto {
  index?: number;
  commandId?: string;
  code: PlanWarningCode;
  message: string;
}

/** One entity changed by the plan, with the state before and after. */
export interface PlanChangeDto {
  /** `touch` label (`card:<id>`, `column:<id>`, `label:<id>`, `board:<id>`). */
  touch: string;
  kind: "create" | "update" | "delete";
  /**
   * Full entity for a create/delete; for an update only the changed
   * top-level fields.
   */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Top-level fields that differ on an update. */
  fields?: string[];
}

/** How the server classifies the plan against the board and token. */
export interface PlanRequirementDto {
  kind: ApprovalKind;
  requiresApproval: boolean;
  requiredScope: "worker" | "reviewer" | "admin";
  action: string;
  risk: ApprovalRisk;
  summary: string;
}

/**
 * `200` body of `POST /boards/:id/plans` — a pure dry-run. Nothing is written,
 * no `AgentRun` and no `ApprovalRequest` is created. `plan` is the canonical
 * intent (without `at`), so an agent can echo it back to `/plans/apply`.
 */
export interface PlanPreviewDto {
  dryRun: true;
  schemaVersion: 1;
  boardId: string;
  planHash: string;
  plan: ApprovalPlan;
  commandCount: number;
  /** Commands that create cards (`ADD_CARD`/`DUPLICATE_CARD`/`DUPLICATE_COLUMN`). */
  cardCreates: number;
  /** Effective caps after the board policy is applied. */
  limits: { commands: number; cards: number };
  requirement: PlanRequirementDto;
  diff: PlanChangeDto[];
  warnings: PlanWarningDto[];
  conflicts: PlanConflictDto[];
  /** True when `conflicts` is empty; approval may still be required. */
  canApply: boolean;
}

/**
 * `200` body of `POST /boards/:id/plans/apply` — one `CommandResponse` per
 * command, in order, plus the run that groups them (PAT only).
 */
export interface PlanApplyResponse extends CommandBatchResponse {
  planHash: string;
}

/* ------------------------------------------------------------------ *
 * TASK-166.9 — attention inbox, notification settings and digest v2
 * ------------------------------------------------------------------ */

/**
 * Stable wire names of the attention categories (ADR §10.5). `token.revoked`
 * is emitted by the personal-token revocation path; the owner is the only
 * recipient.
 */
export const ATTENTION_NOTIFICATION_TYPES = [
  "approval.requested",
  "approval.decided",
  "approval.cancelled",
  "approval.consumed",
  "approval.expired",
  "agent.blocked",
  "agent.needs_human",
  "claim.expired",
  "quota.exceeded",
  "token.revoked",
] as const;
export type AttentionNotificationType =
  (typeof ATTENTION_NOTIFICATION_TYPES)[number];

/**
 * One in-app attention event for the current user. `boardId` is null only for
 * account-level events (the board quota); every board-scoped row is filtered
 * against live membership on read.
 */
export interface AttentionNotificationDto {
  id: string;
  type: AttentionNotificationType;
  boardId: string | null;
  title: string;
  body: string | null;
  /** Small, non-sensitive context: ids, risk, action, limit, current. */
  data: Record<string, unknown> | null;
  /** Unix ms; null while unread. */
  readAt: number | null;
  createdAt: number;
}

/** Newest-first page of the current user's attention inbox. */
export interface AttentionNotificationPage {
  items: AttentionNotificationDto[];
  nextCursor: string | null;
  /** Unread rows across every board the user can still see. */
  unreadCount: number;
}

/** `GET /users/me/notifications` filters. */
export interface AttentionNotificationListQuery {
  /** Restrict to one board; requires live membership. */
  boardId?: string;
  unreadOnly?: boolean;
  cursor?: string;
  limit?: number;
}

/** Per-account notification switches used by the attention/digest flows. */
export interface NotificationSettingsDto {
  /** Scheduled board digests and due reminders (existing TASK-72 switch). */
  notifyDigest: boolean;
  /** Immediate attention e-mails; the in-app inbox is always written. */
  notifyAttention: boolean;
}

/** Body of `PATCH /users/me/notification-settings`. */
export interface UpdateNotificationSettingsRequest {
  notifyDigest?: boolean;
  notifyAttention?: boolean;
}
