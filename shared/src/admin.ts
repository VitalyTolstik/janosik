import type { BoardAction } from "./store/board-reducer";

/**
 * Admin (master account) wire contract — §7.4, TASK-36.
 *
 * The master account is a platform operator, not a `User`: it authenticates
 * through `/api/v1/admin/auth/*` (own JWT audience, own refresh cookie) and
 * every `/api/v1/admin/*` read or mutation is audited server-side. These
 * shapes are the admin panel's only view of the data — password and token
 * hashes never leave the backend.
 */

/**
 * Master tier (TASK-36) — mirrors the Prisma `AdminRole` enum. Only OWNER
 * sees and manages the `/admin/admins` area (create masters, block them,
 * reset passwords); OPERATOR keeps full data access but cannot escalate.
 */
export type AdminRole = "OWNER" | "OPERATOR";

/** Public projection of the master account behind `/admin/auth/*`. */
export interface AdminUserDto {
  id: string;
  email: string;
  displayName: string | null;
  /** Master tier — see `AdminRole`. */
  role: AdminRole;
  /** Unix ms. */
  createdAt: number;
  /** Unix ms of the last successful login; `null` until the first one. */
  lastLoginAt: number | null;
}

/** A row of `GET /admin/admins` — the master roster. */
export interface AdminMasterRowDto {
  id: string;
  email: string;
  displayName: string | null;
  role: AdminRole;
  /** Unix ms when the master is blocked; `null` while active. */
  disabledAt: number | null;
  /** Unix ms of the lockout window; `null` when not locked. */
  lockedUntil: number | null;
  /** Consecutive failed logins since the last success (lockout counter). */
  failedLogins: number;
  /** Unix ms; `null` until the first successful login. */
  lastLoginAt: number | null;
  /** Unix ms. */
  createdAt: number;
}

/** Body of `POST /admin/admins` (owners only). */
export interface AdminCreateMasterRequest {
  email: string;
  displayName?: string;
  /** Tier of the new account; default: OPERATOR. */
  role?: AdminRole;
}

/**
 * `POST /admin/admins` answer — the generated password is returned exactly
 * once and never recoverable again; the new master should change it after
 * the first login.
 */
export interface AdminCreateMasterResponse {
  admin: AdminMasterRowDto;
  temporaryPassword: string;
}

/** Body of `PATCH /admin/admins/:id` (owners only). */
export interface AdminUpdateMasterRequest {
  disabled?: boolean;
  displayName?: string;
}

/** Body of `POST /admin/auth/login|refresh` — token + public projection. */
export interface AdminAuthResponseDto {
  accessToken: string;
  admin: AdminUserDto;
}

/** One point of a dashboard sparkline (oldest first). */
export interface AdminDayPoint {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  count: number;
}

/** Runtime info for the dashboard infrastructure card (TASK-43). */
export interface AdminRuntimeDto {
  /** Backend version from package.json. */
  version: string;
  /** Process uptime in seconds. */
  uptimeSec: number;
  nodeEnv: string;
  /** Round-trip of a `SELECT 1` against PostgreSQL, ms. */
  databaseLatencyMs: number;
}

/** `GET /admin/metrics` — the dashboard’s whole dataset. */
export interface AdminMetricsDto {
  users: { total: number; last7d: number; disabled: number };
  boards: { active: number; archived: number; deleted: number };
  cards: { active: number; archived: number };
  commands: { last24h: number; last7d: number };
  comments: { total: number };
  sessions: { active: number };
  admins: { total: number };
  /** Process/database runtime — rendered as the infra card. */
  runtime: AdminRuntimeDto;
  /** Registrations per day, last 14 days, oldest first. */
  registrationsByDay: AdminDayPoint[];
  /** Commands per day, last 14 days, oldest first. */
  commandsByDay: AdminDayPoint[];
}

/** A row of `GET /admin/users`. Counters are aggregates, never row dumps. */
export interface AdminUserRowDto {
  id: string;
  email: string;
  displayName: string | null;
  /** Unix ms. */
  createdAt: number;
  /** Unix ms when the master blocked the account; `null` while active. */
  disabledAt: number | null;
}

/**
 * A row of `GET /admin/boards` — `Board` columns plus the owner reference.
 *
 * `Board` has no owner column: the owner is the first `BoardMember` with
 * role ADMIN, so the row carries that membership's `userId` (the join key
 * support actually needs — board titles are not unique). `ownerEmail` is
 * only a human label next to the id.
 */
export interface AdminBoardRowDto {
  id: string;
  title: string;
  /** `BoardMember.userId` of the first ADMIN; `null` for an orphan board. */
  userId: string | null;
  /** Label for `userId`; `null` alongside a null owner. */
  ownerEmail: string | null;
  /** Unix ms. */
  createdAt: number;
  /** Unix ms. */
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
}

/**
 * A row of `GET /admin/cards` — every card on the platform (TASK-43) keyed
 * by its foreign keys. Titles ride along as labels only: a card is located
 * by `boardId`/`columnId`, never by a board title (titles are not unique).
 */
export interface AdminCardRowDto {
  id: string;
  title: string;
  /** `Card.column.boardId` — the board join key. */
  boardId: string;
  boardTitle: string;
  /** `Card.columnId` — the column join key. */
  columnId: string;
  columnTitle: string;
  /** `Comment.id` of every visible comment on the card. */
  commentIds: string[];
  /** Unix ms. */
  createdAt: number;
  /** Unix ms. */
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
}

/** A row of `GET /admin/sessions` — an active refresh session (TASK-43). */
export interface AdminSessionRowDto {
  id: string;
  /** `RefreshToken.userId` — the session's user join key. */
  userId: string;
  /** Label for `userId`. */
  userEmail: string;
  /** Unix ms. */
  createdAt: number;
  /** Unix ms. */
  expiresAt: number;
}

/** A row of `GET /admin/tokens` — a personal API token (TASK-43). */
export interface AdminTokenRowDto {
  id: string;
  /** `ApiToken.userId` — the token's user join key. */
  userId: string;
  /** Label for `userId`. */
  userEmail: string;
  name: string;
  /** Unix ms. */
  createdAt: number;
  /** Unix ms; `null` until first use. */
  lastUsedAt: number | null;
  /** Unix ms; `null` when non-expiring. */
  expiresAt: number | null;
  /** Unix ms; `null` while active. */
  revokedAt: number | null;
}

/** A row of `GET /admin/comments` — cross-board comment moderation. */
export interface AdminCommentRowDto {
  id: string;
  /** `Comment.cardId` — the card join key. */
  cardId: string;
  cardTitle: string;
  /** `Comment.authorId` — the author join key. */
  authorId: string;
  /** Label for `authorId`. */
  authorEmail: string;
  text: string;
  /** Unix ms. */
  createdAt: number;
  /** Unix ms; `null` while visible. */
  updatedAt: number;
  deletedAt: number | null;
}

/** A row of `GET /admin/commands` — the cross-board command log. */
export interface AdminCommandRowDto {
  id: string;
  /** `Command.boardId`. */
  boardId: string;
  boardTitle: string;
  /** `Command.actorId`. */
  actorId: string;
  /** Label for `actorId`. */
  actorEmail: string;
  /** `BoardAction.type`. */
  type: string;
  seq: number;
  /** Unix ms. */
  createdAt: number;
}

/** A row of `GET /admin/audit` — who did what in the admin panel. */
export interface AdminAuditRowDto {
  id: string;
  /** `AdminAuditLog.adminId`; `null` for unknown-email login attempts. */
  adminId: string | null;
  /** Denormalized `AdminAuditLog.adminEmail`, kept when the admin is gone. */
  adminEmail: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  /** Unix ms. */
  createdAt: number;
}

/** A page of any admin listing (`total` = rows matching the filter). */
export interface AdminPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Body of `POST /admin/users`. Without `password` the server generates one. */
export interface AdminCreateUserRequest {
  email: string;
  displayName?: string;
  password?: string;
}

/**
 * `POST /admin/users` answer. `temporaryPassword` is the generated password,
 * returned exactly once (when the request did not carry one) so the master
 * can hand it over — it is never retrievable again.
 */
export interface AdminCreateUserResponse {
  user: AdminUserRowDto;
  temporaryPassword: string | null;
}

/** Body of `PATCH /admin/users/:id`. */
export interface AdminUpdateUserRequest {
  disabled?: boolean;
  displayName?: string;
}

/** Body of `POST /admin/boards` — a board is always created for an owner. */
export interface AdminCreateBoardRequest {
  title: string;
  ownerEmail: string;
}

/**
 * Body of `POST /admin/boards/:id/commands` (TASK-43): a board content
 * command applied **through the command log** on behalf of the board owner,
 * so the reducer stays the single source of truth (§7.4.1). `commandId` is
 * generated server-side when omitted; retries may pass the same id.
 */
export interface AdminBoardCommandRequest {
  commandId?: string;
  action: BoardAction;
}

/** Every action the audit log can carry (TASK-36). */
export const ADMIN_AUDIT_ACTIONS = [
  "admin.login",
  "admin.login_failed",
  "admin.login_locked",
  "admin.logout",
  "admin.sessions_revoked",
  "admin.create",
  "admin.disable",
  "admin.enable",
  "admin.update",
  "admin.password_changed",
  "admin.password_reset",
  "admin.owner_granted",
  "user.create",
  "user.update",
  "user.disable",
  "user.enable",
  "user.sessions_revoked",
  "user.tokens_revoked",
  "board.create",
  "board.archive",
  "board.unarchive",
  "board.delete",
  "board.command",
  "card.archive",
  "card.unarchive",
  "card.delete",
  "session.revoke",
  "token.revoke",
  "comment.delete",
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

/** Validation bounds for master-created accounts (mirrors the register DTO). */
export const ADMIN_PASSWORD_MIN = 8;
export const ADMIN_PASSWORD_MAX = 100;

/** `GET /admin/*` page size bounds. */
export const ADMIN_PAGE_LIMITS = { min: 1, max: 100, default: 50 } as const;
