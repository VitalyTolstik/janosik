import type { OAuthProviderId } from "./api";
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
  priority: string | null;
  /** Unix ms deadline; `null` when unset. */
  dueDate: number | null;
  /** Jira-style assignee (TASK-49): `User.id`; `null` when unassigned. */
  assigneeId: string | null;
  /** Label of `assigneeId`; `null` when unassigned. */
  assigneeEmail: string | null;
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
  /** Free JSON payload the command carried (new card title, move targets…). */
  payload: Record<string, unknown> | null;
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
  /**
   * TASK-51: master override — moves the sign-in address instantly, without
   * the double opt-in the self-service flow requires. Every session of the
   * user is revoked and the change is audited.
   */
  email?: string;
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
  "user.email_changed",
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
  "email.settings_changed",
  "email.test_sent",
  "oauth.settings_changed",
  "throttle.settings_changed",
  "demo.started",
  "demo.stopped",
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

/**
 * Outgoing mail presets (TASK-52): the master panel picks a provider and
 * only supplies credentials — host/port/TLS come from the preset, so no
 * code or env change is needed to switch provider. `custom` keeps the
 * host/port editable for anything not on the list.
 */
export interface EmailSmtpPreset {
  id:
    "gmail" | "yandex" | "mailru" | "brevo" | "sendgrid" | "custom" | "mailpit";
  label: string;
  host: string;
  port: number;
  /** `true` → implicit TLS (465); `false` → STARTTLS on a plain port. */
  secure: boolean;
  usernameHint: string;
  passwordLabel: string;
  helpUrl: string;
}

export const EMAIL_SMTP_PRESETS: readonly EmailSmtpPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    usernameHint: "you@gmail.com",
    passwordLabel: "App password (16 characters)",
    helpUrl: "https://support.google.com/accounts/answer/185833",
  },
  {
    id: "yandex",
    label: "Yandex",
    host: "smtp.yandex.ru",
    port: 465,
    secure: true,
    usernameHint: "you@yandex.ru",
    passwordLabel: "App password",
    helpUrl: "https://id.yandex.ru/security/authorization-apps",
  },
  {
    id: "mailru",
    label: "Mail.ru",
    host: "smtp.mail.ru",
    port: 465,
    secure: true,
    usernameHint: "you@mail.ru",
    passwordLabel: "App password",
    helpUrl: "https://help.mail.ru/mail/mail-settings/password",
  },
  {
    id: "brevo",
    label: "Brevo",
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    usernameHint: "Brevo account email",
    passwordLabel: "SMTP key",
    helpUrl: "https://app.brevo.com/settings/keys/api",
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    host: "smtp.sendgrid.net",
    port: 587,
    secure: false,
    usernameHint: "apikey",
    passwordLabel: "API key",
    helpUrl: "https://app.sendgrid.com/settings/api_keys",
  },
  {
    id: "custom",
    label: "Custom SMTP",
    host: "",
    port: 587,
    secure: false,
    usernameHint: "SMTP username",
    passwordLabel: "SMTP password",
    helpUrl: "",
  },
] as const;

/**
 * Sandbox presets (TASK-52.1, reworked in TASK-55): a local mail catcher that
 * never reaches real inboxes — letters land in a web inbox the owner can open
 * on the same machine. The preset points at a Mailpit sidecar on the host
 * (SMTP localhost:1025, web inbox http://localhost:8025); no credentials are
 * needed and nothing is created server-side.
 */
export const EMAIL_SMTP_TEST_PRESETS: readonly EmailSmtpPreset[] = [
  {
    id: "mailpit",
    label: "Mailpit",
    host: "localhost",
    port: 1025,
    secure: false,
    usernameHint: "no auth",
    passwordLabel: "no auth",
    helpUrl: "http://localhost:8025",
  },
] as const;

/** Every provider id the settings row/API accepts. */
export const EMAIL_SMTP_PRESET_IDS = [
  ...EMAIL_SMTP_PRESETS,
  ...EMAIL_SMTP_TEST_PRESETS,
].map((p) => p.id);

/**
 * `GET /admin/email-settings` — the saved transport config with the password
 * masked (`hasPassword`); the secret itself never leaves the backend.
 * `source` says where the currently active transport comes from: the saved
 * row, the SMTP_* env bootstrap, or nothing (log mode).
 */
export interface AdminEmailSettingsDto {
  provider: (typeof EMAIL_SMTP_PRESET_IDS)[number];
  host: string;
  port: number;
  secure: boolean;
  from: string;
  username: string;
  enabled: boolean;
  hasPassword: boolean;
  source: "db" | "env" | "none";
  /** A transport is configured right now (saved enabled row or env). */
  active: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /**
   * Sandbox web inbox for the `mailpit` test provider — where its letters
   * can actually be read (a local Mailpit instance). `null` for every other
   * provider, and for the env bootstrap. There are no credentials to hide:
   * the inbox lives on localhost only.
   */
  webViewer: { url: string } | null;
}

/**
 * `PUT /admin/email-settings`. For a preset provider the backend takes
 * host/port/secure from the preset and ignores the client's values; with
 * `custom` they are required. `password` semantics: `undefined` = keep the
 * stored one, `null` = clear it, a string = replace it. With the `mailpit`
 * sandbox no credentials are needed — the client's username/password are
 * ignored and the transport is anonymous.
 */
export interface AdminUpdateEmailSettingsRequest {
  provider: (typeof EMAIL_SMTP_PRESET_IDS)[number];
  host?: string;
  port?: number;
  secure?: boolean;
  from: string;
  username: string;
  password?: string | null;
  enabled: boolean;
}

/** Body of `POST /admin/email-settings/test`. */
export interface AdminEmailTestRequest {
  to: string;
}

/** `POST /admin/email-settings/test` answer. */
export interface AdminEmailTestResponse {
  ok: boolean;
  error: string | null;
}

/**
 * `GET /admin/oauth-providers` row (TASK-54): the saved OAuth login config
 * for one external provider, with the client secret masked (`hasSecret`);
 * the secret itself never leaves the backend. `callbackUrl` is the exact
 * URL to register in the provider's console, derived from PUBLIC_ORIGIN.
 */
export interface AdminOAuthProviderDto {
  provider: OAuthProviderId;
  clientId: string;
  enabled: boolean;
  hasSecret: boolean;
  callbackUrl: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

/**
 * `PUT /admin/oauth-providers/:provider`. `clientSecret` semantics mirror
 * the email settings password: `undefined` = keep the stored one, `null` =
 * clear it, a string = replace it.
 */
export interface AdminUpdateOAuthProviderRequest {
  clientId: string;
  clientSecret?: string | null;
  enabled: boolean;
}

/** Validation bounds for master-created accounts (mirrors the register DTO). */
export const ADMIN_PASSWORD_MIN = 8;
export const ADMIN_PASSWORD_MAX = 100;

/** `GET /admin/*` page size bounds. */
export const ADMIN_PAGE_LIMITS = { min: 1, max: 100, default: 50 } as const;

// ---------------------------------------------------------------------------
// Admin v2 (TASK-48): full Prisma coverage — every model browsable, every
// relation one click away, one generic listing endpoint, entity details and
// a cross-entity search for the omnibox.
// ---------------------------------------------------------------------------

/** Every entity the generic `GET /admin/entities/:entity` listing serves. */
export const ADMIN_ENTITIES = [
  "users",
  "boards",
  "boardMembers",
  "columns",
  "cards",
  "cardLinks",
  "labels",
  "cardLabels",
  "checklists",
  "checklistItems",
  "comments",
  "attachments",
  "activity",
  "commands",
  "sessions",
  "tokens",
  "admins",
  "audit",
] as const;

export type AdminEntity = (typeof ADMIN_ENTITIES)[number];

/** A row of `GET /admin/entities/columns` — a kanban column. */
export interface AdminColumnRowDto {
  id: string;
  /** `Column.boardId`. */
  boardId: string;
  boardTitle: string;
  title: string;
  wipLimit: number | null;
  position: number;
  /** Live cards in the column (soft-delete respected). */
  cardCount: number;
  deletedAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** A row of `GET /admin/entities/labels` — a board label. */
export interface AdminLabelRowDto {
  id: string;
  /** `Label.boardId`. */
  boardId: string;
  boardTitle: string;
  name: string;
  /** Palette color key. */
  color: string;
  position: number;
  /** Cards currently carrying the label (soft-delete respected). */
  cardCount: number;
  deletedAt: number | null;
  version: number;
}

/** A row of `GET /admin/entities/cardLabels` — the card↔label join. */
export interface AdminCardLabelRowDto {
  cardId: string;
  cardTitle: string;
  /** `Label.id`. */
  labelId: string;
  labelName: string;
  labelColor: string;
  /** `Card.column.boardId`. */
  boardId: string;
  boardTitle: string;
  position: number;
}

/** A row of `GET /admin/entities/checklists` — a card checklist. */
export interface AdminChecklistRowDto {
  id: string;
  /** `Checklist.cardId`. */
  cardId: string;
  cardTitle: string;
  /** `Card.column.boardId`. */
  boardId: string;
  boardTitle: string;
  title: string;
  position: number;
  /** Items on the checklist (soft-delete respected). */
  itemCount: number;
  doneCount: number;
  deletedAt: number | null;
  version: number;
}

/** A row of `GET /admin/entities/checklistItems`. */
export interface AdminChecklistItemRowDto {
  id: string;
  /** `ChecklistItem.checklistId`. */
  checklistId: string;
  checklistTitle: string;
  cardId: string;
  cardTitle: string;
  /** `Card.column.boardId`. */
  boardId: string;
  boardTitle: string;
  text: string;
  done: boolean;
  position: number;
  deletedAt: number | null;
  version: number;
}

/** A row of `GET /admin/entities/cardLinks` — directional card links. */
export interface AdminCardLinkRowDto {
  id: string;
  /** `CardLink.boardId`. */
  boardId: string;
  boardTitle: string;
  fromCardId: string;
  fromCardTitle: string;
  toCardId: string;
  toCardTitle: string;
  /** blocks | relates_to | duplicates. */
  type: string;
  position: number;
  deletedAt: number | null;
  createdAt: number;
}

/** A row of `GET /admin/entities/boardMembers` — a board membership. */
export interface AdminBoardMemberRowDto {
  id: string;
  /** `BoardMember.boardId`. */
  boardId: string;
  boardTitle: string;
  boardDeletedAt: number | null;
  /** `BoardMember.userId`. */
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  userDisabledAt: number | null;
  /** ADMIN | MEMBER | VIEWER. */
  role: string;
  expiresAt: number | null;
  /** `null` while the invitation is pending. */
  acceptedAt: number | null;
  invitedById: string | null;
  invitedByEmail: string | null;
  createdAt: number;
}

/** A row of `GET /admin/entities/attachments` — uploaded files. */
export interface AdminAttachmentRowDto {
  id: string;
  /** `Attachment.cardId`. */
  cardId: string;
  cardTitle: string;
  /** `Attachment.boardId`. */
  boardId: string;
  boardTitle: string;
  fileName: string;
  /** Server-generated blob name — never a filesystem path on the client. */
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedByEmail: string;
  /** TASK-50 video transcode state (none|pending|done|failed). */
  transcodeStatus: string;
  deletedAt: number | null;
  createdAt: number;
}

/** A row of `GET /admin/entities/activity` — membership + comment events. */
export interface AdminActivityRowDto {
  id: string;
  /** `Activity.boardId`. */
  boardId: string;
  boardTitle: string;
  cardId: string | null;
  cardTitle: string | null;
  /** member_invited | member_role_changed | member_removed | comment_added … */
  type: string;
  actorId: string;
  actorEmail: string;
  details: Record<string, unknown> | null;
  createdAt: number;
}

/** Row shape of every `GET /admin/entities/:entity` variant. */
export interface AdminEntityRowMap {
  users: AdminUserRowDto;
  boards: AdminBoardRowDto;
  boardMembers: AdminBoardMemberRowDto;
  columns: AdminColumnRowDto;
  cards: AdminCardRowDto;
  cardLinks: AdminCardLinkRowDto;
  labels: AdminLabelRowDto;
  cardLabels: AdminCardLabelRowDto;
  checklists: AdminChecklistRowDto;
  checklistItems: AdminChecklistItemRowDto;
  comments: AdminCommentRowDto;
  attachments: AdminAttachmentRowDto;
  activity: AdminActivityRowDto;
  commands: AdminCommandRowDto;
  sessions: AdminSessionRowDto;
  tokens: AdminTokenRowDto;
  admins: AdminMasterRowDto;
  audit: AdminAuditRowDto;
}

/** Membership line of `GET /admin/users/:id`. */
export interface AdminUserMembershipDto {
  id: string;
  boardId: string;
  boardTitle: string;
  boardDeletedAt: number | null;
  role: string;
  acceptedAt: number | null;
  expiresAt: number | null;
  invitedByEmail: string | null;
  createdAt: number;
}

/**
 * `GET /admin/users/:id` — the whole user graph a support agent needs:
 * profile, counters, memberships, derived created cards (from `ADD_CARD` /
 * `DUPLICATE_CARD` commands authored by the user), moderation surfaces.
 */
export interface AdminUserDetailDto {
  user: AdminUserRowDto;
  counters: {
    boards: number;
    cardsCreated: number;
    /** Cards where the user is the assignee (TASK-49). */
    cardsAssigned: number;
    comments: number;
    attachments: number;
    sessions: number;
    tokens: number;
    commands: number;
  };
  memberships: AdminUserMembershipDto[];
  createdCards: AdminCardRowDto[];
  /** Cards assigned to the user (TASK-49), live rows only. */
  assignedCards: AdminCardRowDto[];
  comments: AdminCommentRowDto[];
  attachments: AdminAttachmentRowDto[];
  sessions: AdminSessionRowDto[];
  tokens: AdminTokenRowDto[];
  recentCommands: AdminCommandRowDto[];
  recentActivity: AdminActivityRowDto[];
}

/** Checklist with its items inside `GET /admin/cards/:id`. */
export interface AdminCardChecklistDto {
  id: string;
  title: string;
  position: number;
  deletedAt: number | null;
  items: Array<{
    id: string;
    text: string;
    done: boolean;
    position: number;
    deletedAt: number | null;
  }>;
}

/** One directional link line of `GET /admin/cards/:id`. */
export interface AdminCardLinkEndDto {
  id: string;
  /** The card on the other end of the link. */
  otherCardId: string;
  otherCardTitle: string;
  type: string;
  deletedAt: number | null;
  createdAt: number;
}

/**
 * `GET /admin/cards/:id` — full card graph: meta, labels, checklists, links
 * (both directions), comments, attachments and a merged activity timeline
 * (Activity rows + commands whose `touches` include the card).
 */
export interface AdminCardDetailDto {
  card: AdminCardRowDto & {
    description: string | null;
    dueDate: number | null;
    priority: string | null;
    /** Display name of the assignee (TASK-49); `null` when unassigned. */
    assigneeDisplayName: string | null;
    coverType: string | null;
    coverValue: string | null;
    version: number;
    attachmentCount: number;
    /** Label of `Card.lastActorId`; `null` when untouched. */
    lastActorEmail: string | null;
  };
  labels: Array<{ id: string; name: string; color: string; position: number }>;
  checklists: AdminCardChecklistDto[];
  linksOut: AdminCardLinkEndDto[];
  linksIn: AdminCardLinkEndDto[];
  comments: AdminCommentRowDto[];
  attachments: AdminAttachmentRowDto[];
  timeline: Array<{
    id: string;
    /** "activity" (membership/comment feed) | "command" (board action). */
    kind: "activity" | "command";
    type: string;
    actorId: string;
    actorEmail: string;
    details: Record<string, unknown> | null;
    createdAt: number;
  }>;
  /**
   * Who created the card — `Card` has no creator column, so it is derived
   * from the first `ADD_CARD`/`DUPLICATE_CARD` command whose payload names
   * this card. `null` for rows imported before the command log (or cards
   * created by `IMPORT_BOARDS`).
   */
  createdBy: {
    actorId: string;
    actorEmail: string;
    at: number;
  } | null;
}

/** Board meta line of `GET /admin/boards/:id/meta`. */
export interface AdminBoardDetailDto {
  board: AdminBoardRowDto & {
    version: number;
    counts: {
      members: number;
      columns: number;
      cards: number;
      labels: number;
      links: number;
      comments: number;
      attachments: number;
      commands: number;
      activity: number;
    };
  };
  members: AdminBoardMemberRowDto[];
  columns: AdminColumnRowDto[];
  labels: AdminLabelRowDto[];
}

/** `GET /admin/search?q=` — grouped top matches for the omnibox. */
export interface AdminGlobalSearchDto {
  users: AdminUserRowDto[];
  boards: AdminBoardRowDto[];
  cards: AdminCardRowDto[];
  comments: AdminCommentRowDto[];
  attachments: AdminAttachmentRowDto[];
  labels: AdminLabelRowDto[];
}

/**
 * `GET /admin/throttle-settings` — the global API rate limit (requests per
 * minute, per client). Editable from the panel; until a saved row exists the
 * `THROTTLE_LIMIT` env default applies. Changing it takes effect on the next
 * request, without a restart.
 */
export interface AdminThrottleSettingsDto {
  limit: number;
  /** Where the active limit comes from: a saved row, or the env default. */
  source: "db" | "env";
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Body of `PUT /admin/throttle-settings`. */
export interface AdminUpdateThrottleSettingsRequest {
  limit: number;
}

/**
 * `GET /admin/traffic` — a live snapshot of the API request rate, sampled
 * once a second over a rolling 60-second window. The panel polls this to
 * render the "requests per minute" gauge while a demo runs.
 */
export interface AdminTrafficDto {
  /** Requests observed in the last 60 seconds. */
  lastMinute: number;
  /** Requests per second, oldest first (exactly 60 entries). */
  perSecond: number[];
  /** Requests rejected by the rate limiter in the last 60 seconds. */
  throttledLastMinute: number;
  /** The limit currently enforced (requests / minute). */
  limit: number;
  /** Unix ms when the snapshot was taken. */
  at: number;
}

/**
 * `GET /admin/demo` — state of the master-panel demo runner. The runner
 * provisions a throwaway population (demo users on the `@janosik.demo` domain,
 * columns, labels and cards) and, when running, advances the cards towards
 * "done". Every id it creates is recorded on the run, so `stop` deletes
 * exactly those rows — no name-based guessing.
 */
export interface AdminDemoStatusDto {
  running: boolean;
  boardId: string | null;
  /** ISO timestamp the current/last run started; `null` before the first. */
  startedAt: string | null;
  users: number;
  columns: number;
  labels: number;
  cards: number;
  /** Cards that reached the last column of the run so far. */
  cardsDone: number;
  /** A run's footprint still exists and `stop` would clean it (even if the
   * swarm already finished), so the panel keeps "Stop & clean up" enabled. */
  cleanupPending: boolean;
}

/** Body of `POST /admin/demo/start`. */
export interface AdminDemoStartRequest {
  /** Board to populate; a dedicated "Demo" board is created when omitted. */
  boardId?: string;
  /** Number of demo agents. */
  users?: number;
  /** Number of cards to seed (defaults to the agent count). */
  cards?: number;
  /** Let the agents act immediately; `false` seeds and waits. */
  run?: boolean;
}
