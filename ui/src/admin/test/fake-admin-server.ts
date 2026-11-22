import {
  ADMIN_FILTER_OPTION_LIMITS,
  boardReducer,
  CARD_PRIORITIES,
  completeness,
  COVER_COLORS,
  COVER_GRADIENTS,
  DEFAULT_CARD_PRIORITY,
  EMAIL_SMTP_PRESETS,
  EMAIL_SMTP_TEST_PRESETS,
  isCardLinkType,
  LIMITS,
  OAUTH_PROVIDER_IDS,
} from "@janosik/shared";
import type {
  BoardAction,
  BoardAggregate,
  CardLinkType,
  AdminActivityRowDto,
  AdminAttachmentRowDto,
  AdminAuditRowDto,
  AdminBoardRowDto,
  AdminCardChecklistDto,
  AdminCardLinkRowDto,
  AdminCardRowDto,
  AdminChecklistRowDto,
  AdminCommandRowDto,
  AdminCommentRowDto,
  AdminColumnRowDto,
  AdminLabelRowDto,
  AdminDemoStartRequest,
  AdminDemoStatusDto,
  AdminEmailSettingsDto,
  AdminFilterOptionDto,
  AdminShareRowDto,
  AdminEmailTestResponse,
  AdminMasterRowDto,
  AdminMetricsDto,
  AdminOAuthProviderDto,
  AdminRole,
  AdminSessionRowDto,
  AdminThrottleSettingsDto,
  AdminTokenRowDto,
  AdminTrafficDto,
  AdminUpdateEmailSettingsRequest,
  AdminUpdateOAuthProviderRequest,
  AdminUpdateThrottleSettingsRequest,
  AdminUserRowDto,
  AdminBoardMemberRowDto,
  AdminUserMembershipDto,
  AdminAnnouncementDto,
  AdminAnnouncementTranslationDto,
  AdminEmailTemplateDto,
  AdminFeatureFlagDto,
  AdminObservabilityDto,
  AdminOpsSettingsDto,
  AdminRetentionDto,
  AdminSecurityDto,
} from "@janosik/shared";
import { dueStatus } from "@/utils/due-date";

/**
 * In-memory admin API for component tests (TASK-36): implements just enough
 * of `/admin/*` to drive the panel end to end, records every request and
 * lets a test fail the next request of a given path.
 */

interface FakeAdmin {
  id: string;
  email: string;
  displayName: string | null;
  role: AdminRole;
  createdAt: number;
  lastLoginAt: number | null;
}

/** One directional link row persisted by the fake command endpoint. */
export interface FakeCardLink {
  id: string;
  boardId: string;
  fromCardId: string;
  toCardId: string;
  type: CardLinkType;
  deletedAt: number | null;
  createdAt: number;
}

export interface FakeAdminState {
  admins: FakeAdmin[];
  users: AdminUserRowDto[];
  boards: AdminBoardRowDto[];
  commands: (AdminCommandRowDto & { touches?: string[] })[];
  audit: AdminAuditRowDto[];
  cards: AdminCardRowDto[];
  sessions: AdminSessionRowDto[];
  tokens: AdminTokenRowDto[];
  comments: AdminCommentRowDto[];
  attachments: AdminAttachmentRowDto[];
  activity: AdminActivityRowDto[];
  /** User-detail membership rows (TASK-176.4 inviter links). */
  memberships: AdminUserMembershipDto[];
  /** Last actor per card id, served by the card-detail DTO. */
  cardLastActors: Record<string, { id: string; email: string | null }>;
  /** Description per card id, updated by admin UPDATE_CARD commands. */
  cardDescriptions: Record<string, string | null>;
  /** Cover per card id, updated by admin SET_CARD_COVER commands. */
  cardCovers: Record<string, { type: string; value: string } | null>;
  /** Attached label ids per card id, updated by SET_CARD_LABEL. */
  cardLabelIds: Record<string, string[]>;
  /** Checklists per card id, including soft-deleted rows. */
  cardChecklists: Record<string, AdminCardChecklistDto[]>;
  /** Directional card links, including soft-deleted rows. */
  cardLinks: FakeCardLink[];
  /** Aggregate served to the board content editor; grown by commands. */
  contentBoard: BoardAggregate | null;
}

const now = 1_760_000_000_000;

/** Stable JSON for the fake's idempotency fingerprint check. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function emptyAdminState(): FakeAdminState {
  return {
    admins: [],
    users: [],
    boards: [],
    commands: [],
    audit: [],
    cards: [],
    sessions: [],
    tokens: [],
    comments: [],
    attachments: [],
    activity: [],
    memberships: [],
    cardLastActors: {},
    cardDescriptions: {},
    cardCovers: {},
    cardLabelIds: {},
    cardChecklists: {},
    cardLinks: [],
    contentBoard: null,
  };
}

export function adminChecklist(
  overrides: Partial<AdminCardChecklistDto> = {},
): AdminCardChecklistDto {
  return {
    id: "checklist-1",
    title: "Checklist",
    position: 0,
    deletedAt: null,
    items: [],
    ...overrides,
  };
}

export function adminCardLink(
  overrides: Partial<FakeCardLink> = {},
): FakeCardLink {
  return {
    id: "link-1",
    boardId: "b-1",
    fromCardId: "card-1",
    toCardId: "card-2",
    type: "relates_to",
    deletedAt: null,
    createdAt: now,
    ...overrides,
  };
}

export function contentBoard(
  overrides: Partial<BoardAggregate> = {},
): BoardAggregate {
  return {
    id: "b-1",
    title: "Roadmap",
    columns: [],
    cards: {},
    labels: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function adminCard(
  overrides: Partial<AdminCardRowDto> = {},
): AdminCardRowDto {
  return {
    id: "card-1",
    title: "Moderate me",
    boardId: "b-1",
    boardTitle: "Roadmap",
    columnId: "col-1",
    columnTitle: "Backlog",
    commentIds: ["comment-1"],
    createdAt: now,
    updatedAt: now,
    priority: null,
    dueDate: null,
    assigneeId: null,
    assigneeEmail: null,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

export function adminSession(
  overrides: Partial<AdminSessionRowDto> = {},
): AdminSessionRowDto {
  return {
    id: "session-1",
    userId: "u-1",
    userEmail: "member@example.com",
    createdAt: now,
    expiresAt: now + 86_400_000,
    revokedAt: null,
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0",
    ...overrides,
  };
}

export function adminToken(
  overrides: Partial<AdminTokenRowDto> = {},
): AdminTokenRowDto {
  return {
    id: "token-1",
    userId: "u-1",
    userEmail: "member@example.com",
    name: "CI",
    createdAt: now,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

export function adminComment(
  overrides: Partial<AdminCommentRowDto> = {},
): AdminCommentRowDto {
  return {
    id: "comment-1",
    cardId: "card-1",
    cardTitle: "Moderate me",
    authorId: "u-1",
    authorEmail: "member@example.com",
    text: "Looks good",
    kind: "note",
    createdAt: now,
    updatedAt: now,
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

export function adminAttachment(
  overrides: Partial<AdminAttachmentRowDto> = {},
): AdminAttachmentRowDto {
  return {
    id: "attachment-1",
    cardId: "card-1",
    cardTitle: "Moderate me",
    boardId: "b-1",
    boardTitle: "Roadmap",
    fileName: "file.png",
    storedName: "stored-file.png",
    mimeType: "image/png",
    sizeBytes: 128,
    uploadedById: "u-1",
    uploadedByEmail: "member@example.com",
    transcodeStatus: "none",
    isInline: false,
    descriptionDetached: false,
    deletedAt: null,
    createdAt: now,
    ...overrides,
  };
}

export function adminActivity(
  overrides: Partial<AdminActivityRowDto> = {},
): AdminActivityRowDto {
  return {
    id: "activity-1",
    boardId: "board-1",
    boardTitle: "Support board",
    cardId: "card-1",
    cardTitle: "Moderate me",
    type: "comment_added",
    actorId: "u-1",
    actorEmail: "member@example.com",
    details: { commentId: "comment-1", text: "Looks good" },
    createdAt: now,
    ...overrides,
  };
}

export function adminUser(
  overrides: Partial<AdminUserRowDto> = {},
): AdminUserRowDto {
  return {
    id: "u-1",
    email: "member@example.com",
    displayName: "Member",
    createdAt: now,
    disabledAt: null,
    emailVerifiedAt: now,
    ...overrides,
  };
}

export function adminMaster(
  overrides: Partial<AdminMasterRowDto> = {},
): AdminMasterRowDto {
  return {
    id: "master-2",
    email: "operator@example.com",
    displayName: "Operator",
    role: "OPERATOR",
    disabledAt: null,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: now,
    failedLogins: 0,
    ...overrides,
  };
}

export function adminBoard(
  overrides: Partial<AdminBoardRowDto> = {},
): AdminBoardRowDto {
  return {
    id: "b-1",
    title: "Roadmap",
    userId: "u-1",
    ownerEmail: "member@example.com",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

export function boardMember(
  overrides: Partial<AdminBoardMemberRowDto> = {},
): AdminBoardMemberRowDto {
  return {
    id: "member-1",
    boardId: "b-1",
    boardTitle: "Roadmap",
    boardDeletedAt: null,
    userId: "u-1",
    userEmail: "member@example.com",
    userDisplayName: "Member",
    userDisabledAt: null,
    role: "MEMBER",
    expiresAt: null,
    acceptedAt: now,
    invitedById: null,
    invitedByEmail: null,
    createdAt: now,
    ...overrides,
  };
}

export function adminLabel(
  overrides: Partial<AdminLabelRowDto> = {},
): AdminLabelRowDto {
  return {
    id: "label-1",
    boardId: "b-1",
    boardTitle: "Roadmap",
    name: "Label",
    color: "red",
    position: 0,
    cardCount: 0,
    deletedAt: null,
    version: 0,
    ...overrides,
  };
}

export function adminMembership(
  overrides: Partial<AdminUserMembershipDto> = {},
): AdminUserMembershipDto {
  return {
    id: "membership-1",
    boardId: "b-1",
    boardTitle: "Roadmap",
    boardDeletedAt: null,
    role: "MEMBER",
    acceptedAt: now,
    expiresAt: null,
    invitedById: null,
    invitedByEmail: null,
    createdAt: now,
    ...overrides,
  };
}

export class FakeAdminServer {
  state: FakeAdminState;
  requests: Array<{
    method: string;
    path: string;
    body: unknown;
    query: URLSearchParams;
  }> = [];
  /** Paths whose next call answers 500 once (matched via `includes`). */
  failNext: string[] = [];
  /** Hold the next board command until this promise resolves (race tests). */
  holdCommands?: Promise<void>;
  /** Paths whose next call answers with an explicit status once. */
  failNextStatuses: Array<{
    path: string;
    status: number;
    body?: Record<string, unknown>;
  }> = [];
  /** Hold the next matching request until the promise resolves (race tests). */
  holds: Array<{ match: string; promise: Promise<void> }> = [];
  /** When set, the refresh endpoint answers as if no cookie existed. */
  sessionAlive = true;
  /**
   * TASK-65: when set, `/admin/auth/login` requires this exact `totpCode`
   * (and rejects a missing/wrong one with `code: "totp_required"`).
   */
  loginTotpCode: string | null = null;
  loginIpDenied = false;
  /**
   * Role of the session the fake serves. `listMasters`-style endpoints
   * answer 403 unless it is OWNER, mirroring the server guard.
   */
  sessionRole: AdminRole = "OWNER";
  /** Extra master rows returned by `GET /admin/admins` (besides the owner). */
  masters: AdminMasterRowDto[] = [];
  masterAllowlists: Record<string, string | null> = {};
  /** Saved mail transport settings (TASK-52); bootstrapped to log mode. */
  emailSettings: AdminEmailSettingsDto = {
    provider: "custom",
    host: "",
    port: 587,
    secure: false,
    from: "",
    username: "",
    enabled: false,
    hasPassword: false,
    source: "none",
    active: false,
    lastTestAt: null,
    lastTestOk: null,
    lastError: null,
    updatedBy: null,
    updatedAt: null,
    webViewer: null,
  };

  /** Saved OAuth provider settings (TASK-54); bootstrapped unconfigured. */
  oauthProviders: AdminOAuthProviderDto[] = OAUTH_PROVIDER_IDS.map(
    (provider) => ({
      provider,
      clientId: "",
      enabled: false,
      hasSecret: false,
      callbackUrl: `http://app.test/api/v1/auth/oauth/${provider}/callback`,
      updatedBy: null,
      updatedAt: null,
    }),
  );

  /** Global rate limit (TASK-57); starts on the env default. */
  throttleSettings: AdminThrottleSettingsDto = {
    limit: 300,
    source: "env",
    updatedBy: null,
    updatedAt: null,
  };

  /** Demo runner snapshot (TASK-57). */
  private readonly idleDemoStatus: AdminDemoStatusDto = {
    running: false,
    boardId: null,
    startedAt: null,
    users: 0,
    columns: 0,
    labels: 0,
    cards: 0,
    cardsDone: 0,
    cleanupPending: false,
    shareToken: null,
  };
  demoStatus = { ...this.idleDemoStatus };

  /** Public shares (TASK-58). */
  shares: AdminShareRowDto[] = [];

  /** Feature flags (TASK-61). */
  flags: AdminFeatureFlagDto[] = [
    {
      key: "registration_open",
      label: "Open registration",
      description: "Allow anyone to create a new account.",
      enabled: true,
      overrides: 0,
      envDefault: true,
      updatedBy: null,
      updatedAt: null,
    },
  ];

  /** Operational settings (TASK-61). */
  ops: AdminOpsSettingsDto = {
    maintenanceMode: false,
    maintenanceMessage: null,
    perUserRateLimit: null,
    retentionDays: null,
    maintenanceIntervalMinutes: 0,
    digestIntervalHours: 0,
    reminderLeadHours: 0,
    queuesDashboard: false,
    updatedBy: null,
    updatedAt: null,
  };

  /** Announcements (TASK-62). */
  announcements: AdminAnnouncementDto[] = [];

  /** Editable mail templates (TASK-62). */
  emailTemplates: AdminEmailTemplateDto[] = [
    {
      key: "verification_code",
      label: "Email verification code",
      subject: "Janosik: confirmation code {{code}}",
      bodyHtml: "<p>Code: {{code}} ({{minutes}} min)</p>",
      placeholders: ["code", "minutes"],
      custom: false,
      updatedBy: null,
      updatedAt: null,
    },
  ];

  /** Security posture (TASK-65). */
  security: AdminSecurityDto = {
    totpEnabled: false,
    ipAllowlist: null,
    alerts: [],
  };

  /** Retention/compliance snapshot (TASK-63). */
  retention: AdminRetentionDto = {
    retentionDays: null,
    purgeable: { cards: 0, comments: 0, attachments: 0, columns: 0 },
    backups: {
      mode: "unconfigured",
      location: null,
      automatic: false,
      lastBackupAt: null,
      verified: false,
    },
  };

  /**
   * QA review: simulated soft-deleted rows by age in days. When non-empty,
   * `/admin/retention` derives `purgeable.cards` from the requested window and
   * the purge endpoint really removes only rows older than that window.
   */
  retentionDeletedAges: number[] = [];

  /** Observability snapshot (TASK-64). */
  observability: AdminObservabilityDto = {
    version: "0.1.0",
    nodeEnv: "test",
    uptimeSec: 42,
    deploy: { startedAt: now, commit: null },
    database: { sizeBytes: 1024, sizePretty: "1.0 KB", tables: [] },
    jobs: {
      transcode: { pending: 0, done: 0, failed: 0 },
      demo: { running: false, boardId: null },
      realtime: { boards: 0, clients: 0 },
      queues: [
        {
          name: "broadcast",
          pending: 0,
          processed: 0,
          failed: 0,
          backend: "memory" as const,
        },
      ],
    },
    health: [{ name: "database", ok: true, detail: "ok" }],
  };

  /** Board members keyed by boardId (TASK-60 moderation tests). */
  boardMembers: Record<string, AdminBoardMemberRowDto[]> = {};
  /** Board-detail columns/labels keyed by boardId (TASK-176.6 links). */
  boardColumns: Record<string, AdminColumnRowDto[]> = {};
  boardLabels: Record<string, AdminLabelRowDto[]> = {};

  /** Totp enrollment secret echoed by `POST /admin/security/totp`. */
  totpSecret = "JBSWY3DPEHPK3PXP";

  /**
   * The caller's address as the server sees it: an allowlist that leaves
   * it out is refused with `400`, like the real lock-out guard.
   */
  callerIp: string | null = null;

  constructor(state: FakeAdminState = emptyAdminState()) {
    this.state = state;
    this.state.admins = [
      {
        id: "master-1",
        email: "master@example.com",
        displayName: "Master",
        role: "OWNER",
        createdAt: now,
        lastLoginAt: now,
      },
    ];
  }

  get fetchImpl(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input.toString(),
        "http://api.test",
      );
      const path = url.pathname.replace(/^\/api\/v1/, "");
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      this.requests.push({ method, path, body, query: url.searchParams });

      const hold = this.holdCommands;
      this.holdCommands = undefined;
      if (hold) await hold;

      const pathHold = this.holds.find((candidate) =>
        path.includes(candidate.match),
      );
      if (pathHold) {
        this.holds = this.holds.filter((item) => item !== pathHold);
        await pathHold.promise;
      }

      const failure = this.failNext.find((candidate) =>
        path.includes(candidate),
      );
      if (failure) {
        this.failNext = this.failNext.filter((item) => item !== failure);
        return this.json({ message: "boom" }, 500);
      }
      const statusFailure = this.failNextStatuses.find((candidate) =>
        path.includes(candidate.path),
      );
      if (statusFailure) {
        this.failNextStatuses = this.failNextStatuses.filter(
          (item) => item !== statusFailure,
        );
        return this.json(
          statusFailure.body ?? { message: "denied" },
          statusFailure.status,
        );
      }

      return this.route(method, path, body, url);
    }) as typeof fetch;
  }

  /** Principal matching the configured session role. */
  private principal(): FakeAdmin {
    const admin = this.state.admins[0];
    if (this.sessionRole === "OPERATOR") {
      return { ...admin, role: "OPERATOR", email: "operator@example.com" };
    }
    return admin;
  }

  private route(
    method: string,
    path: string,
    body: unknown,
    url: URL,
  ): Response {
    const admin = this.principal();
    const jsonBody = body as Record<string, unknown> | undefined;

    if (path === "/admin/auth/refresh") {
      if (!this.sessionAlive) return this.json({ message: "no" }, 401);
      return this.json({ accessToken: "token-1", admin });
    }
    if (path === "/admin/auth/login") {
      if (jsonBody?.password !== "secret pass") {
        return this.json({ message: "Invalid credentials" }, 401);
      }
      if (this.loginIpDenied) {
        return this.json(
          {
            message: "Sign-in from this IP is not allowed",
            code: "ip_not_allowed",
          },
          403,
        );
      }
      // TASK-65: when a code is required, the password alone is not enough —
      // mirrors the backend's `code: "totp_required"` signal.
      if (
        this.loginTotpCode !== null &&
        jsonBody?.totpCode !== this.loginTotpCode
      ) {
        return this.json(
          {
            message: "A valid two-factor code is required",
            code: "totp_required",
          },
          401,
        );
      }
      return this.json({ accessToken: "token-1", admin });
    }
    if (path === "/admin/auth/logout") return this.json({ status: "ok" });
    if (path === "/admin/auth/me") return this.json(admin);

    if (path === "/admin/metrics") return this.json(this.metrics());

    if (path === "/admin/admins" && method === "GET") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const roster: AdminMasterRowDto[] = [
        {
          id: admin.id,
          email: admin.email,
          displayName: admin.displayName,
          role: admin.role,
          disabledAt: null,
          lockedUntil: null,
          lastLoginAt: admin.lastLoginAt,
          createdAt: admin.createdAt,
          failedLogins: 0,
        },
        ...this.masters,
      ];
      return this.json({
        items: roster,
        total: roster.length,
        limit: 50,
        offset: 0,
      });
    }
    if (path === "/admin/admins" && method === "POST") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const email = String(jsonBody?.email ?? "");
      if (
        this.masters.some((master) => master.email === email) ||
        email === admin.email
      ) {
        return this.json({ message: "Master account already exists" }, 409);
      }
      const created = adminMaster({
        id: `master-${this.masters.length + 3}`,
        email,
        displayName: (jsonBody?.displayName as string | null) ?? null,
        role: (jsonBody?.role as AdminRole | undefined) ?? "OPERATOR",
      });
      this.masters = [created, ...this.masters];
      return this.json(
        { admin: created, temporaryPassword: "one-time-master-pass" },
        201,
      );
    }
    const masterAllowlist = path.match(
      /^\/admin\/masters\/([^/]+)\/allowlist$/,
    );
    if (masterAllowlist) {
      if (this.sessionRole !== "OWNER")
        return this.json({ message: "Owner rights are required" }, 403);
      const id = decodeURIComponent(masterAllowlist[1]);
      if (id !== admin.id && !this.masters.some((master) => master.id === id))
        return this.json({ message: "Master not found" }, 404);
      if (method === "PUT") {
        this.masterAllowlists[id] = jsonBody?.ipAllowlist as string | null;
      }
      return this.json({ ipAllowlist: this.masterAllowlists[id] ?? null });
    }
    const masterPatch = path.match(/^\/admin\/admins\/([^/]+)$/);
    if (masterPatch && method === "PATCH") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const master = this.masters.find((item) => item.id === masterPatch[1]);
      if (!master)
        return this.json({ message: "Master account not found" }, 404);
      if (jsonBody?.disabled !== undefined) {
        master.disabledAt = jsonBody.disabled ? now : null;
      }
      if (jsonBody?.unlock === true) {
        master.lockedUntil = null;
        master.failedLogins = 0;
      }
      return this.json(master);
    }
    const masterReset = path.match(
      /^\/admin\/admins\/([^/]+)\/password\/reset$/,
    );
    if (masterReset && method === "POST") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const master = this.masters.find((item) => item.id === masterReset[1]);
      if (!master)
        return this.json({ message: "Master account not found" }, 404);
      return this.json(
        { admin: master, temporaryPassword: "reset-one-time-pass" },
        201,
      );
    }
    const masterSessions = path.match(
      /^\/admin\/admins\/([^/]+)\/sessions\/revoke$/,
    );
    if (masterSessions && method === "POST") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const master = this.masters.find((item) => item.id === masterSessions[1]);
      return this.json({ revoked: master ? 1 : 0 }, 201);
    }

    if (path === "/admin/users" && method === "GET") {
      return this.json(this.page(this.state.users, url));
    }
    if (path === "/admin/users" && method === "POST") {
      const email = String(jsonBody?.email ?? "");
      if (this.state.users.some((user) => user.email === email)) {
        return this.json({ message: "Email is already registered" }, 409);
      }
      const created = adminUser({
        id: `u-${this.state.users.length + 1}`,
        email,
        displayName: (jsonBody?.displayName as string | null) ?? null,
      });
      this.state.users = [created, ...this.state.users];
      return this.json(
        {
          user: created,
          temporaryPassword: jsonBody?.password ? null : "generated-pass-123",
        },
        201,
      );
    }
    const userPatch = path.match(/^\/admin\/users\/([^/]+)$/);
    if (userPatch && method === "PATCH") {
      if (
        this.sessionRole !== "OWNER" &&
        (jsonBody?.email !== undefined || jsonBody?.emailVerified !== undefined)
      ) {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const user = this.state.users.find((item) => item.id === userPatch[1]);
      if (!user) return this.json({ message: "User not found" }, 404);
      if (jsonBody?.disabled !== undefined) {
        user.disabledAt = jsonBody.disabled ? now : null;
      }
      if (jsonBody?.email !== undefined) {
        const next = String(jsonBody.email).trim().toLowerCase();
        if (
          this.state.users.some(
            (item) => item.id !== user.id && item.email === next,
          )
        ) {
          return this.json({ message: "Email is already registered" }, 409);
        }
        user.email = next;
        // TASK-51: the master override revokes every session of the user.
        this.revokeSessionsOf(user.id);
      }
      if (jsonBody?.displayName !== undefined) {
        user.displayName = String(jsonBody.displayName);
      }
      return this.json(user);
    }
    const sessions = path.match(/^\/admin\/users\/([^/]+)\/sessions\/revoke$/);
    if (sessions && method === "POST") {
      const revoked = this.revokeSessionsOf(sessions[1]);
      return this.json({ revoked }, 201);
    }
    const tokens = path.match(/^\/admin\/users\/([^/]+)\/tokens\/revoke$/);
    if (tokens && method === "POST") {
      const owned = this.state.tokens.filter(
        (item) => item.userId === tokens[1] && item.revokedAt === null,
      );
      for (const token of owned) token.revokedAt = now;
      return this.json({ revoked: owned.length }, 201);
    }

    if (path === "/admin/boards" && method === "GET") {
      return this.json(this.page(this.state.boards, url));
    }
    if (path === "/admin/boards" && method === "POST") {
      const owner = String(jsonBody?.ownerEmail ?? "");
      if (!this.state.users.some((user) => user.email === owner)) {
        return this.json({ message: "Owner not found" }, 404);
      }
      const created = adminBoard({
        id: `b-${this.state.boards.length + 1}`,
        title: String(jsonBody?.title ?? ""),
        userId:
          this.state.users.find((user) => user.email === owner)?.id ?? null,
        ownerEmail: owner,
      });
      this.state.boards = [created, ...this.state.boards];
      return this.json(created, 201);
    }
    const archive = path.match(
      /^\/admin\/boards\/([^/]+)\/(archive|unarchive)$/,
    );
    if (archive && method === "POST") {
      const board = this.state.boards.find((item) => item.id === archive[1]);
      if (!board) return this.json({ message: "Board not found" }, 404);
      board.archivedAt = archive[2] === "archive" ? now : null;
      return this.json(board, 201);
    }
    const boardDelete = path.match(/^\/admin\/boards\/([^/]+)$/);
    if (boardDelete && method === "DELETE") {
      const board = this.state.boards.find(
        (item) => item.id === boardDelete[1],
      );
      if (board) board.deletedAt = now;
      return this.json({ status: "ok" });
    }

    const boardContent = path.match(/^\/admin\/boards\/([^/]+)\/content$/);
    if (boardContent && method === "GET") {
      const board = this.state.contentBoard ?? contentBoard();
      return this.json({ ...board, id: boardContent[1] });
    }
    const boardCommand = path.match(/^\/admin\/boards\/([^/]+)\/commands$/);
    if (boardCommand && method === "POST") {
      const action = (jsonBody?.action ?? {}) as BoardAction;
      const actionCardId = (action as { cardId?: string }).cardId;
      const requestedCommandId =
        typeof jsonBody?.commandId === "string" && jsonBody.commandId !== ""
          ? jsonBody.commandId
          : undefined;
      // Idempotent replay: the backend returns the stored result before any
      // fresh-command precondition runs, so a retry after a delete still
      // succeeds and never creates a second audit row.
      const replay =
        requestedCommandId === undefined
          ? undefined
          : this.state.commands.find(
              (command) => command.id === requestedCommandId,
            );
      if (replay !== undefined) {
        if (
          replay.boardId !== boardCommand[1] ||
          canonicalJson(replay.payload) !== canonicalJson(jsonBody?.action)
        ) {
          return this.json(
            { message: "commandId already used with a different payload" },
            409,
          );
        }
        return this.json({ seq: replay.seq, versions: {} });
      }

      const relationError = this.relationGuard(boardCommand[1], action);
      if (relationError !== null) {
        return this.json(relationError.body, relationError.status);
      }

      const cardActionTypes = new Set<string>([
        "UPDATE_CARD",
        "MOVE_CARD",
        "SET_CARD_ASSIGN",
        "SET_CARD_DUE_DATE",
        "SET_CARD_PRIORITY",
        "SET_CARD_COVER",
        "SET_CARD_LABEL",
      ]);
      if (
        cardActionTypes.has(action.type) &&
        typeof actionCardId === "string"
      ) {
        const target = this.state.cards.find(
          (card) => card.id === actionCardId,
        );
        if (
          target === undefined ||
          target.deletedAt !== null ||
          target.boardId !== boardCommand[1]
        ) {
          return this.json({ message: "Card not found" }, 404);
        }
        if (action.type === "MOVE_CARD" && target.archivedAt !== null) {
          return this.json({ message: "Archived cards cannot be moved" }, 409);
        }
        if (action.type === "SET_CARD_ASSIGN") {
          const assigneeId = (action as { assigneeId?: string | null })
            .assigneeId;
          if (assigneeId !== null && assigneeId !== undefined) {
            const member = (this.boardMembers[boardCommand[1]] ?? []).find(
              (entry) =>
                entry.userId === assigneeId &&
                entry.acceptedAt !== null &&
                (entry.expiresAt === null || entry.expiresAt > now),
            );
            if (member === undefined) {
              return this.json(
                {
                  message: "Assignee must be an active board member",
                  field: "action.assigneeId",
                },
                400,
              );
            }
          }
        }
        if (action.type === "SET_CARD_LABEL") {
          const labelId = (action as { labelId?: unknown }).labelId;
          const on = (action as { on?: unknown }).on;
          if (typeof labelId !== "string" || labelId.trim() === "") {
            return this.json({ message: "Label id is required" }, 400);
          }
          if (typeof on !== "boolean") {
            return this.json({ message: "on must be a boolean" }, 400);
          }
          const liveLabels = (this.boardLabels[boardCommand[1]] ?? []).filter(
            (entry) => entry.deletedAt === null,
          );
          const label = liveLabels.find((entry) => entry.id === labelId);
          if (label === undefined) {
            return this.json({ message: "Label not found" }, 404);
          }
          // The cap counts live labels only, like the real board aggregate.
          const liveIds = new Set(liveLabels.map((entry) => entry.id));
          const selected = (this.state.cardLabelIds[actionCardId] ?? []).filter(
            (id) => liveIds.has(id),
          );
          if (
            on &&
            !selected.includes(labelId) &&
            selected.length >= LIMITS.labelsPerCard
          ) {
            return this.json(
              {
                message: "Too many labels on the card",
                conflict: "wip",
                currentVersion: 0,
              },
              409,
            );
          }
        }
        if (action.type === "UPDATE_CARD") {
          const title = (action as { title?: unknown }).title;
          if (
            title !== undefined &&
            title !== null &&
            (typeof title !== "string" || title.length > LIMITS.cardTitle)
          ) {
            return this.json({ message: "Invalid card title" }, 400);
          }
        }
        if (action.type === "SET_CARD_PRIORITY") {
          const priority = (action as { priority?: unknown }).priority;
          if (
            typeof priority !== "string" ||
            !(CARD_PRIORITIES as readonly string[]).includes(priority)
          ) {
            return this.json({ message: "Invalid priority" }, 400);
          }
        }
        if (action.type === "SET_CARD_DUE_DATE") {
          const dueDate = (action as { dueDate?: unknown }).dueDate;
          if (
            dueDate !== undefined &&
            dueDate !== null &&
            (typeof dueDate !== "number" ||
              !Number.isFinite(dueDate) ||
              Math.abs(dueDate) > 8.64e15)
          ) {
            return this.json({ message: "Invalid due date" }, 400);
          }
        }
        if (action.type === "SET_CARD_COVER") {
          const cover = (action as { cover?: unknown }).cover;
          if (cover !== undefined && cover !== null) {
            const record =
              typeof cover === "object"
                ? (cover as { type?: unknown; value?: unknown })
                : null;
            const valid =
              record !== null &&
              ((record.type === "color" &&
                (COVER_COLORS as readonly unknown[]).includes(record.value)) ||
                (record.type === "gradient" &&
                  (COVER_GRADIENTS as readonly unknown[]).includes(
                    record.value,
                  )));
            if (!valid) {
              return this.json({ message: "Invalid cover" }, 400);
            }
          }
        }
      }
      const current = this.state.contentBoard ?? contentBoard();
      try {
        const next = boardReducer([current], {
          ...(action as BoardAction & { at?: number }),
          boardId: current.id,
          at: (action as { at?: number }).at ?? Date.now(),
        } as BoardAction);
        this.state.contentBoard = next[0];
      } catch (error) {
        return this.json({ message: String(error) }, 400);
      }

      const board = this.state.contentBoard ?? current;
      this.applyRelationState(action);
      if (action.type === "ADD_CARD") {
        const newCardId = (action as { newCardId?: string }).newCardId;
        const aggregateCard =
          newCardId === undefined ? undefined : board.cards[newCardId];
        const column =
          newCardId === undefined
            ? undefined
            : board.columns.find((entry) => entry.cardIds.includes(newCardId));
        if (
          newCardId !== undefined &&
          aggregateCard !== undefined &&
          column !== undefined &&
          !this.state.cards.some((card) => card.id === newCardId)
        ) {
          this.state.cards.push(
            adminCard({
              id: newCardId,
              title: aggregateCard.title,
              boardId: boardCommand[1],
              boardTitle: board.title,
              columnId: column.id,
              columnTitle: column.title,
              commentIds: [],
            }),
          );
        }
      }
      const cardId = (action as { cardId?: string }).cardId;
      if (typeof cardId === "string") {
        const aggregateCard = board.cards[cardId];
        const row = this.state.cards.find((card) => card.id === cardId);
        if (row) {
          if (aggregateCard) {
            row.title = aggregateCard.title;
            const column = board.columns.find((entry) =>
              entry.cardIds.includes(cardId),
            );
            if (column) {
              row.columnId = column.id;
              row.columnTitle = column.title;
            }
          }
          if (action.type === "UPDATE_CARD") {
            if (typeof (action as { title?: string }).title === "string") {
              row.title = (action as { title: string }).title;
            }
            if (
              "description" in (action as unknown as Record<string, unknown>)
            ) {
              this.state.cardDescriptions[cardId] =
                aggregateCard?.description ??
                (action as { description?: string }).description ??
                null;
            }
          }
          if (action.type === "SET_CARD_ASSIGN") {
            const assigneeId = (action as { assigneeId?: string | null })
              .assigneeId;
            row.assigneeId = assigneeId ?? null;
            const member = (this.boardMembers[row.boardId] ?? []).find(
              (entry) => entry.userId === assigneeId,
            );
            row.assigneeEmail = member?.userEmail ?? null;
          }
          if (action.type === "SET_CARD_DUE_DATE") {
            const dueDate = (action as { dueDate?: number }).dueDate;
            row.dueDate = typeof dueDate === "number" ? dueDate : null;
          }
          if (action.type === "SET_CARD_PRIORITY") {
            const priority = (action as { priority?: string }).priority;
            row.priority =
              typeof priority === "string" && priority !== "medium"
                ? priority
                : null;
          }
          if (action.type === "SET_CARD_COVER") {
            const cover = (
              action as {
                cover?: { type: string; value: string };
              }
            ).cover;
            this.state.cardCovers[cardId] = cover ?? null;
          }
          if (action.type === "SET_CARD_LABEL") {
            const labelId = (action as { labelId?: string }).labelId;
            const on = (action as { on?: boolean }).on === true;
            if (typeof labelId === "string") {
              const labels = new Set(this.state.cardLabelIds[cardId] ?? []);
              if (on) labels.add(labelId);
              else labels.delete(labelId);
              this.state.cardLabelIds[cardId] = [...labels];
            }
          }
        }
      }

      // TASK-176.10: a master-issued command adds one correlated audit row.
      const commandId =
        requestedCommandId ?? `command-${this.state.commands.length + 1}`;
      const seq =
        this.state.commands.reduce(
          (max, command) => Math.max(max, command.seq),
          0,
        ) + 1;
      const createdAt = now + this.state.commands.length + 1;
      const boardRow = this.state.boards.find(
        (entry) => entry.id === boardCommand[1],
      );
      const actorId = boardRow?.userId ?? "u-1";
      const actorEmail = boardRow?.ownerEmail ?? "member@example.com";
      const auditId = `audit-${commandId}`;
      this.state.commands = [
        {
          id: commandId,
          boardId: boardCommand[1],
          boardTitle: board.title,
          actorId,
          actorEmail,
          type: action.type,
          seq,
          createdAt,
          payload: action as unknown as Record<string, unknown>,
          touches: [
            "cardId" in action && `card:${action.cardId}`,
            "columnId" in action && `column:${action.columnId}`,
            "toColumnId" in action && `column:${action.toColumnId}`,
          ].filter((touch): touch is string => Boolean(touch)),
          auditId,
        },
        ...this.state.commands,
      ];
      this.state.audit = [
        {
          id: auditId,
          adminId: admin.id,
          adminEmail: admin.email,
          action: "board.command",
          targetType: "board",
          targetId: boardCommand[1],
          targetExists: true,
          details: {
            commandId,
            masterId: admin.id,
            masterEmail: admin.email,
            title: board.title,
            type: action.type,
            actorEmail,
            seq,
          },
          createdAt,
        },
        ...this.state.audit,
      ];
      return this.json({ seq, versions: {} });
    }

    if (path === "/admin/cards" && method === "GET") {
      return this.json(this.page(this.state.cards, url));
    }
    if (path === "/admin/filter-options" && method === "GET") {
      return this.filterOptions(url.searchParams);
    }
    const cardArchive = path.match(
      /^\/admin\/cards\/([^/]+)\/(archive|unarchive)$/,
    );
    if (cardArchive && method === "POST") {
      const card = this.state.cards.find((item) => item.id === cardArchive[1]);
      if (!card) return this.json({ message: "Card not found" }, 404);
      card.archivedAt = cardArchive[2] === "archive" ? now : null;
      return this.json({ status: "ok" }, 201);
    }
    const cardDelete = path.match(/^\/admin\/cards\/([^/]+)$/);
    if (cardDelete && method === "DELETE") {
      const card = this.state.cards.find((item) => item.id === cardDelete[1]);
      if (card) card.deletedAt = now;
      return this.json({ status: "ok" });
    }

    if (path === "/admin/sessions" && method === "GET") {
      return this.json(
        this.page(
          this.state.sessions.filter(
            (item) => item.revokedAt === null && item.expiresAt > now,
          ),
          url,
        ),
      );
    }
    const sessionRevoke = path.match(/^\/admin\/sessions\/([^/]+)\/revoke$/);
    if (sessionRevoke && method === "POST") {
      const session = this.state.sessions.find(
        (item) => item.id === sessionRevoke[1],
      );
      const revoked =
        session !== undefined && session.revokedAt === null ? 1 : 0;
      if (session) session.revokedAt = now;
      return this.json({ revoked }, 201);
    }

    if (path === "/admin/tokens" && method === "GET") {
      return this.json(this.page(this.state.tokens, url));
    }
    const tokenRevoke = path.match(/^\/admin\/tokens\/([^/]+)\/revoke$/);
    if (tokenRevoke && method === "POST") {
      const token = this.state.tokens.find(
        (item) => item.id === tokenRevoke[1],
      );
      const revoked = token !== undefined && token.revokedAt === null ? 1 : 0;
      if (token) token.revokedAt = now;
      return this.json({ revoked }, 201);
    }

    if (path === "/admin/comments" && method === "GET") {
      return this.json(this.page(this.state.comments, url));
    }
    const commentDelete = path.match(/^\/admin\/comments\/([^/]+)$/);
    if (commentDelete && method === "DELETE") {
      const comment = this.state.comments.find(
        (item) => item.id === commentDelete[1],
      );
      if (comment) comment.deletedAt = now;
      return this.json({ status: "ok" });
    }

    if (path === "/admin/commands") {
      return this.json(this.page(this.state.commands, url, "id"));
    }
    if (path === "/admin/audit") {
      return this.json(this.page(this.state.audit, url, "details"));
    }

    // Email service settings (TASK-52): view for any signed-in master,
    // edit/probe owner-only, mirroring the real backend.
    if (path === "/admin/email-settings" && method === "GET") {
      return this.json(this.emailSettings);
    }
    if (path === "/admin/email-settings" && method === "PUT") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const input = (jsonBody ??
        {}) as Partial<AdminUpdateEmailSettingsRequest>;
      // Mirror the real backend: preset providers carry their fixed
      // connection settings, `custom` takes the client's host/port/secure,
      // and the `mailpit` sandbox is anonymous (no credentials).
      const preset = [...EMAIL_SMTP_PRESETS, ...EMAIL_SMTP_TEST_PRESETS].find(
        (item) => item.id === input.provider,
      );
      const custom = preset !== undefined && preset.id === "custom";
      const sandbox = preset !== undefined && preset.id === "mailpit";
      this.emailSettings = {
        ...this.emailSettings,
        provider: preset?.id ?? this.emailSettings.provider,
        host: custom
          ? (input.host ?? this.emailSettings.host)
          : (preset?.host ?? this.emailSettings.host),
        port: custom
          ? (input.port ?? this.emailSettings.port)
          : (preset?.port ?? this.emailSettings.port),
        secure: custom
          ? (input.secure ?? this.emailSettings.secure)
          : (preset?.secure ?? this.emailSettings.secure),
        from:
          sandbox && (input.from ?? "") === ""
            ? "Janosik <no-reply@janosik.local>"
            : (input.from ?? this.emailSettings.from),
        username: sandbox
          ? ""
          : (input.username ?? this.emailSettings.username),
        enabled: input.enabled ?? this.emailSettings.enabled,
        hasPassword: sandbox
          ? false
          : input.password !== undefined
            ? input.password !== null
            : this.emailSettings.hasPassword,
        source: "db",
        active: input.enabled ?? false,
        updatedBy: this.principal().email,
        updatedAt: new Date(now).toISOString(),
        webViewer: sandbox ? { url: "http://localhost:8025" } : null,
      };
      return this.json(this.emailSettings);
    }
    // OAuth provider settings (TASK-54): view for any signed-in master,
    // edit owner-only, mirroring the real backend.
    if (path === "/admin/oauth-providers" && method === "GET") {
      return this.json(this.oauthProviders);
    }
    if (path.startsWith("/admin/oauth-providers/") && method === "PUT") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const provider = path.slice("/admin/oauth-providers/".length);
      if (!OAUTH_PROVIDER_IDS.includes(provider as never)) {
        return this.json({ message: "Unknown OAuth provider" }, 400);
      }
      const input = (jsonBody ??
        {}) as Partial<AdminUpdateOAuthProviderRequest>;
      if ((input.clientId ?? "").trim() === "") {
        return this.json({ message: "Client ID is required" }, 400);
      }
      const previous = this.oauthProviders.find(
        (row) => row.provider === provider,
      );
      if (
        (input.enabled ?? false) &&
        !previous?.hasSecret &&
        input.clientSecret === undefined
      ) {
        return this.json(
          { message: "Client secret is required to enable the provider" },
          400,
        );
      }
      const saved: AdminOAuthProviderDto = {
        provider: provider as AdminOAuthProviderDto["provider"],
        clientId: input.clientId ?? "",
        enabled: input.enabled ?? false,
        hasSecret:
          input.clientSecret === undefined
            ? (previous?.hasSecret ?? false)
            : input.clientSecret !== null,
        callbackUrl: `http://app.test/api/v1/auth/oauth/${provider}/callback`,
        updatedBy: this.principal().email,
        updatedAt: new Date(now).toISOString(),
      };
      this.oauthProviders = this.oauthProviders.map((row) =>
        row.provider === provider ? saved : row,
      );
      return this.json(saved);
    }

    if (path === "/admin/email-settings/test" && method === "POST") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      return this.json({
        ok: true,
        error: null,
      } satisfies AdminEmailTestResponse);
    }

    // Rate limit & traffic (TASK-57): view for any master, edit owner-only.
    if (path === "/admin/throttle-settings" && method === "GET") {
      return this.json(this.throttleSettings);
    }
    if (path === "/admin/throttle-settings" && method === "PUT") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const input = (jsonBody ??
        {}) as Partial<AdminUpdateThrottleSettingsRequest>;
      const limit = input.limit;
      if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
        return this.json({ message: "limit must be >= 1" }, 400);
      }
      this.throttleSettings = {
        limit,
        source: "db",
        updatedBy: this.principal().email,
        updatedAt: new Date(now).toISOString(),
      };
      return this.json(this.throttleSettings);
    }
    if (path === "/admin/traffic" && method === "GET") {
      const perSecond: number[] = Array.from({ length: 60 }, (_, index) =>
        index >= 55 ? 3 : 0,
      );
      return this.json({
        lastMinute: perSecond.reduce<number>((sum, count) => sum + count, 0),
        perSecond,
        throttledLastMinute: 0,
        limit: this.throttleSettings.limit,
        at: now,
      } satisfies AdminTrafficDto);
    }

    // Demo runner (TASK-57): view for any master, start/stop owner-only.
    if (path === "/admin/demo" && method === "GET") {
      return this.json(this.demoStatus);
    }
    if (path === "/admin/demo/start" && method === "POST") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const input = (jsonBody ?? {}) as Partial<AdminDemoStartRequest>;
      const users = input.users ?? 20;
      const cards = input.cards ?? users;
      this.demoStatus = {
        running: true,
        boardId: input.boardId ?? "demo-board",
        startedAt: new Date(now).toISOString(),
        users: users + 1,
        columns: 5,
        labels: 5,
        cards,
        cardsDone: 0,
        cleanupPending: true,
        shareToken: "demo-live-token",
      };
      return this.json(this.demoStatus, 201);
    }
    if (path === "/admin/demo/stop" && method === "POST") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      this.demoStatus = { ...this.idleDemoStatus };
      return this.json(this.demoStatus, 201);
    }

    // Public shares (TASK-58): listing for any master, revoke for any master.
    if (path === "/admin/shares" && method === "GET") {
      return this.json({
        items: this.shares,
        total: this.shares.length,
        limit: 100,
        offset: 0,
      });
    }
    const shareRevoke = path.match(/^\/admin\/shares\/([^/]+)\/revoke$/);
    if (shareRevoke && method === "POST") {
      const id = decodeURIComponent(shareRevoke[1] ?? "");
      const row = this.shares.find((item) => item.id === id);
      if (!row) return this.json({ message: "Share not found" }, 404);
      row.revokedAt = now;
      return this.json(row, 201);
    }

    // ------------------------------------------ user support (TASK-59)
    const userById = (id: string) =>
      this.state.users.find((user) => user.id === decodeURIComponent(id));

    const resendVerify = path.match(
      /^\/admin\/users\/([^/]+)\/verification\/resend$/,
    );
    if (resendVerify && method === "POST") {
      const user = userById(resendVerify[1] ?? "");
      if (!user) return this.json({ message: "User not found" }, 404);
      if (user.emailVerifiedAt !== null) {
        return this.json({ message: "Email is already verified" }, 409);
      }
      return this.json(
        { ok: true, expiresAt: now + 900_000, delivered: true },
        201,
      );
    }

    const resetPwd = path.match(/^\/admin\/users\/([^/]+)\/password\/reset$/);
    if (resetPwd && method === "POST") {
      const user = userById(resetPwd[1] ?? "");
      if (!user) return this.json({ message: "User not found" }, 404);
      return this.json({ user, temporaryPassword: "Temp-pass-123" }, 201);
    }

    const promote = path.match(/^\/admin\/users\/([^/]+)\/promote$/);
    if (promote && method === "POST") {
      const user = userById(promote[1] ?? "");
      if (!user) return this.json({ message: "User not found" }, 404);
      return this.json(
        {
          admin: adminMaster({
            email: user.email,
            displayName: user.displayName,
          }),
          temporaryPassword: "Temp-pass-123",
        },
        201,
      );
    }

    const impersonate = path.match(/^\/admin\/users\/([^/]+)\/impersonate$/);
    if (impersonate && method === "POST") {
      const user = userById(impersonate[1] ?? "");
      if (!user) return this.json({ message: "User not found" }, 404);
      return this.json(
        {
          accessToken: "impersonation-token",
          expiresAt: now + 900_000,
          user: user.email
            ? { id: user.id, email: user.email, displayName: user.displayName }
            : { id: user.id, email: "", displayName: user.displayName },
        },
        201,
      );
    }

    const exportUser = path.match(/^\/admin\/users\/([^/]+)\/export$/);
    if (exportUser && method === "GET") {
      const user = userById(exportUser[1] ?? "");
      if (!user) return this.json({ message: "User not found" }, 404);
      return this.json({
        generatedAt: now,
        filename: `janosik-user-${user.id}.json`,
        data: { user },
      });
    }
    if (exportUser && method === "POST") {
      const user = userById(exportUser[1] ?? "");
      if (!user) return this.json({ message: "User not found" }, 404);
      return this.json(
        {
          id: "export-1",
          userId: user.id,
          userEmail: user.email,
          status: "ready",
          filename: `janosik-user-${user.id}.json`,
          sizeBytes: 128,
          error: null,
          createdAt: now,
          expiresAt: now + 86_400_000,
        },
        201,
      );
    }

    const deleteUser = path.match(/^\/admin\/users\/([^/]+)$/);
    if (deleteUser && method === "DELETE") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      const id = decodeURIComponent(deleteUser[1] ?? "");
      this.state.users = this.state.users.filter((user) => user.id !== id);
      return this.json({ status: "ok" });
    }

    const demote = path.match(/^\/admin\/admins\/([^/]+)$/);
    if (demote && method === "DELETE") {
      if (this.sessionRole !== "OWNER") {
        return this.json({ message: "Owner rights are required" }, 403);
      }
      return this.json({ status: "ok" });
    }

    // -------------------------------------------- membership (TASK-60)
    const boardMembers = (boardId: string) =>
      (this.boardMembers[boardId] ??= []);

    const addMember = path.match(/^\/admin\/boards\/([^/]+)\/members$/);
    if (addMember && method === "POST") {
      const payload = jsonBody as { email?: string; role?: string };
      boardMembers(decodeURIComponent(addMember[1] ?? "")).push(
        boardMember({
          boardId: decodeURIComponent(addMember[1] ?? ""),
          userId: `user-${payload.email ?? "new"}`,
          userEmail: payload.email ?? "new@example.com",
          role: payload.role ?? "MEMBER",
        }),
      );
      return this.json({ status: "ok" }, 201);
    }

    const memberOne = path.match(
      /^\/admin\/boards\/([^/]+)\/members\/([^/]+)$/,
    );
    if (memberOne && method === "PATCH") {
      return this.json({ status: "ok" });
    }
    if (memberOne && method === "DELETE") {
      return this.json({ status: "ok" });
    }

    const transfer = path.match(/^\/admin\/boards\/([^/]+)\/owner$/);
    if (transfer && method === "POST") {
      return this.json({ status: "ok" }, 201);
    }

    const deleteAttachment = path.match(/^\/admin\/attachments\/([^/]+)$/);
    if (deleteAttachment && method === "DELETE") {
      const file = this.state.attachments.find(
        (item) => item.id === deleteAttachment[1],
      );
      if (file) file.deletedAt = now;
      return this.json({ status: "ok" });
    }

    const restore = path.match(
      /^\/admin\/entities\/([a-zA-Z]+)\/([^/]+)\/restore$/,
    );
    if (restore && method === "POST") {
      return this.json({ status: "ok" }, 201);
    }

    const bulk = path.match(/^\/admin\/entities\/([a-zA-Z]+)\/bulk$/);
    if (bulk && method === "POST") {
      const payload = jsonBody as { ids?: string[] };
      return this.json({ affected: payload.ids?.length ?? 0 }, 201);
    }

    // ----------------------------------------------- flags + ops (TASK-61)
    if (path === "/admin/flags" && method === "GET") {
      return this.json(this.flags);
    }
    const flagOne = path.match(/^\/admin\/flags\/([^/]+)$/);
    if (flagOne && method === "PATCH") {
      const key = decodeURIComponent(flagOne[1] ?? "");
      const payload = jsonBody as { enabled?: boolean };
      const flag = this.flags.find((entry) => entry.key === key);
      if (!flag) return this.json({ message: "Unknown flag" }, 404);
      if (payload.enabled !== undefined) flag.enabled = payload.enabled;
      flag.updatedAt = now;
      flag.updatedBy = "master@example.com";
      return this.json(flag);
    }
    if (path === "/admin/ops" && method === "GET") {
      return this.json(this.ops);
    }
    if (path === "/admin/ops" && method === "PUT") {
      const payload = jsonBody as Partial<AdminOpsSettingsDto>;
      this.ops = {
        ...this.ops,
        ...payload,
        updatedBy: "master@example.com",
        updatedAt: now,
      };
      return this.json(this.ops);
    }

    // -------------------------------------------------------- comms (TASK-62)
    if (path === "/admin/announcements" && method === "GET") {
      return this.json(this.announcements);
    }
    if (path === "/admin/announcements" && method === "POST") {
      const payload = jsonBody as {
        title?: string;
        body?: string;
        sourceLocale?: "en" | "ru";
        fallbackPolicy?: AdminAnnouncementDto["fallbackPolicy"];
        translations?: Partial<
          Record<"en" | "ru", { title: string; body: string } | null>
        >;
        level?: string;
        audience?: "all" | "segment";
        segment?: string | null;
        sendEmail?: boolean;
        active?: boolean;
        startsAt?: number | null;
        endsAt?: number | null;
      };
      const sourceLocale = payload.sourceLocale ?? "en";
      const rawTranslations: Partial<
        Record<"en" | "ru", { title: string; body: string } | null>
      > =
        payload.translations ??
        (payload.title !== undefined && payload.body !== undefined
          ? {
              [sourceLocale]: {
                title: payload.title,
                body: payload.body,
              },
            }
          : {});
      const translations: AdminAnnouncementTranslationDto[] = (
        ["en", "ru"] as const
      ).flatMap((locale) => {
        const value = rawTranslations[locale];
        if (!value) return [];
        return [
          {
            locale,
            title: value.title,
            body: value.body,
            origin: "human" as const,
            translatedFrom: locale === sourceLocale ? null : sourceLocale,
            sourceUpdatedAt: null,
            reviewedAt: now,
            updatedAt: now,
            updatedBy: "master@example.com",
          },
        ];
      });
      const primary =
        translations.find((entry) => entry.locale === sourceLocale) ??
        translations[0];
      const created: AdminAnnouncementDto = {
        id: `ann-${this.announcements.length + 1}`,
        title: primary?.title ?? "",
        body: primary?.body ?? "",
        sourceLocale,
        fallbackPolicy:
          payload.fallbackPolicy ??
          (payload.translations ? "require_all" : "allow_fallback"),
        translations,
        completeness: completeness(translations),
        level: (payload.level as AdminAnnouncementDto["level"]) ?? "info",
        audience: payload.audience ?? "all",
        segment: payload.segment ?? null,
        active: payload.active ?? true,
        sendEmail: payload.sendEmail ?? false,
        emailSentAt:
          payload.active !== false && payload.sendEmail === true ? now : null,
        startsAt: payload.startsAt ?? null,
        endsAt: payload.endsAt ?? null,
        version: 1,
        createdBy: "master@example.com",
        createdAt: now,
        updatedAt: now,
      };
      this.announcements.push(created);
      return this.json(created, 201);
    }
    const annOne = path.match(/^\/admin\/announcements\/([^/]+)$/);
    if (annOne && method === "PATCH") {
      const id = decodeURIComponent(annOne[1] ?? "");
      const row = this.announcements.find((entry) => entry.id === id);
      if (!row) return this.json({ message: "Not found" }, 404);
      const payload = jsonBody as {
        sourceLocale?: "en" | "ru" | null;
        fallbackPolicy?: AdminAnnouncementDto["fallbackPolicy"];
        translations?: Partial<
          Record<"en" | "ru", { title: string; body: string } | null>
        >;
        title?: string;
        body?: string;
        level?: AdminAnnouncementDto["level"];
        audience?: AdminAnnouncementDto["audience"];
        segment?: string | null;
        active?: boolean;
        sendEmail?: boolean;
        startsAt?: number | null;
        endsAt?: number | null;
        version?: number;
      };
      if (payload.version !== undefined && payload.version !== row.version) {
        return this.json(
          {
            message: "The announcement was changed by someone else",
            conflict: "version",
            currentVersion: row.version,
          },
          409,
        );
      }
      const wasActive = row.active;
      const translations = new Map(
        row.translations.map((translation) => [
          translation.locale,
          translation,
        ]),
      );
      for (const [locale, value] of Object.entries(
        payload.translations ?? {},
      )) {
        if (locale !== "en" && locale !== "ru") continue;
        if (value === null) {
          translations.delete(locale);
        } else {
          translations.set(locale, {
            locale,
            title: value.title,
            body: value.body,
            origin: "human",
            translatedFrom:
              locale === row.sourceLocale ? null : row.sourceLocale,
            sourceUpdatedAt: null,
            reviewedAt: now,
            updatedAt: now,
            updatedBy: "master@example.com",
          });
        }
      }
      if (
        payload.title !== undefined &&
        payload.body !== undefined &&
        payload.translations == null
      ) {
        const locale = payload.sourceLocale ?? row.sourceLocale ?? "en";
        translations.set(locale, {
          locale,
          title: payload.title,
          body: payload.body,
          origin: "human",
          translatedFrom: null,
          sourceUpdatedAt: null,
          reviewedAt: now,
          updatedAt: now,
          updatedBy: "master@example.com",
        });
      }
      const nextTranslations = [...translations.values()];
      const nextActive = payload.active ?? row.active;
      const nextSendEmail = payload.sendEmail ?? row.sendEmail;
      const queued =
        !wasActive && nextActive && nextSendEmail && row.emailSentAt === null;
      const primary =
        nextTranslations.find(
          (entry) =>
            entry.locale === (payload.sourceLocale ?? row.sourceLocale),
        ) ?? nextTranslations[0];
      Object.assign(row, {
        ...payload,
        title: primary?.title ?? "",
        body: primary?.body ?? "",
        sourceLocale:
          payload.sourceLocale === undefined
            ? row.sourceLocale
            : payload.sourceLocale,
        translations: nextTranslations,
        completeness: completeness(nextTranslations),
        active: nextActive,
        sendEmail: nextSendEmail,
        emailSentAt: queued ? now : row.emailSentAt,
        version: row.version + 1,
        updatedAt: now,
      });
      return this.json(row);
    }
    if (annOne && method === "DELETE") {
      const id = decodeURIComponent(annOne[1] ?? "");
      this.announcements = this.announcements.filter((e) => e.id !== id);
      return this.json({ status: "ok" });
    }
    if (path === "/admin/email/send" && method === "POST") {
      return this.json({ ok: true, error: null }, 201);
    }
    if (path === "/admin/email-templates" && method === "GET") {
      return this.json(this.emailTemplates);
    }
    const tplOne = path.match(/^\/admin\/email-templates\/([^/]+)$/);
    if (tplOne && method === "PUT") {
      const key = decodeURIComponent(tplOne[1] ?? "");
      const payload = jsonBody as { subject?: string; bodyHtml?: string };
      const row = this.emailTemplates.find((entry) => entry.key === key) ?? {
        key,
        label: key,
        subject: "",
        bodyHtml: "",
        placeholders: ["code", "minutes"],
        custom: false,
        updatedBy: null,
        updatedAt: null,
      };
      row.subject = payload.subject ?? "";
      row.bodyHtml = payload.bodyHtml ?? "";
      row.custom = true;
      row.updatedAt = now;
      return this.json(row);
    }
    if (tplOne && method === "DELETE") {
      const key = decodeURIComponent(tplOne[1] ?? "");
      const row = this.emailTemplates.find((entry) => entry.key === key);
      if (row) {
        row.custom = false;
        row.updatedBy = null;
        row.updatedAt = null;
      }
      return this.json(row ?? { message: "Not found" }, row ? 200 : 404);
    }

    // ---------------------------------------------- data/compliance (TASK-63)
    if (path === "/admin/retention" && method === "GET") {
      const requested = Number(url.searchParams.get("retentionDays"));
      const days =
        Number.isFinite(requested) && requested > 0
          ? requested
          : (this.ops.retentionDays ?? 30);
      const purgeable =
        this.retentionDeletedAges.length > 0
          ? {
              ...this.retention.purgeable,
              cards: this.retentionDeletedAges.filter((age) => age > days)
                .length,
            }
          : this.retention.purgeable;
      return this.json({
        ...this.retention,
        retentionDays: days,
        purgeable,
      });
    }
    if (path === "/admin/retention/purge" && method === "POST") {
      const requested = Number(
        (jsonBody as { retentionDays?: number } | null)?.retentionDays ??
          this.ops.retentionDays ??
          30,
      );
      const before = this.retentionDeletedAges.length;
      this.retentionDeletedAges = this.retentionDeletedAges.filter(
        (age) => age <= requested,
      );
      return this.json(
        { affected: before - this.retentionDeletedAges.length },
        201,
      );
    }
    if (path === "/admin/maintenance/run" && method === "POST") {
      const job = (jsonBody as { job?: string } | null)?.job ?? "all";
      return this.json({
        queued: false,
        results: [{ job, removed: 2 }],
      });
    }
    if (path === "/admin/queue-ticket" && method === "POST") {
      return this.json({ ok: true });
    }
    if (path === "/admin/exports" && method === "GET") {
      return this.json([]);
    }
    const exportDownload = path.match(/^\/admin\/exports\/([^/]+)\/download$/);
    if (exportDownload && method === "GET") {
      return this.json({ export: exportDownload[1] });
    }

    // ---------------------------------------------- observability (TASK-64)
    if (path === "/admin/observability" && method === "GET") {
      return this.json(this.observability);
    }

    // --------------------------------------------------- security (TASK-65)
    if (path === "/admin/security" && method === "GET") {
      return this.json(this.security);
    }
    if (path === "/admin/security/totp" && method === "POST") {
      if (this.security.totpEnabled) {
        const payload = jsonBody as { password?: string; totpCode?: string };
        if (
          payload.password !== "master correct horse battery" &&
          payload.totpCode !== "123456"
        ) {
          return this.json(
            {
              message: "A current code or password is required",
              code: "totp_proof_required",
            },
            401,
          );
        }
      }
      return this.json(
        {
          secret: this.totpSecret,
          otpauthUrl: `otpauth://totp/Janosik:master@example.com?secret=${this.totpSecret}&issuer=Janosik`,
          setupToken: "fake-totp-setup-token",
        },
        201,
      );
    }
    if (path === "/admin/security/totp/verify" && method === "POST") {
      const payload = jsonBody as { code?: string; setupToken?: string };
      if (payload.setupToken !== "fake-totp-setup-token") {
        return this.json(
          { message: "Enrollment token is invalid", code: "setup_stale" },
          400,
        );
      }
      if (payload.code !== "123456") {
        return this.json({ message: "Invalid code" }, 401);
      }
      const replaced = this.security.totpEnabled;
      this.security = { ...this.security, totpEnabled: true };
      return this.json({ totpEnabled: true, replaced });
    }
    if (path === "/admin/security" && method === "PUT") {
      const payload = jsonBody as {
        ipAllowlist?: string | null;
        totpEnabled?: boolean;
      };
      if (
        this.callerIp !== null &&
        payload.ipAllowlist &&
        !payload.ipAllowlist.includes(this.callerIp)
      ) {
        return this.json(
          {
            message: `The allowlist must include your current address (${this.callerIp})`,
          },
          400,
        );
      }
      if (payload.ipAllowlist !== undefined) {
        this.security = { ...this.security, ipAllowlist: payload.ipAllowlist };
      }
      if (payload.totpEnabled === false) {
        this.security = { ...this.security, totpEnabled: false };
      }
      return this.json(this.security);
    }

    // Admin v2 (TASK-48): generic entity listing mirrors the real backend's
    // `GET /admin/entities/:entity` (same rows the typed endpoints return).
    const entity = path.match(/^\/admin\/entities\/([a-zA-Z]+)$/);
    if (entity && method === "GET") {
      const map: Record<string, unknown[]> = {
        users: this.state.users,
        boards: this.state.boards,
        cards: this.state.cards,
        columns: Object.values(this.boardColumns).flat(),
        labels: Object.values(this.boardLabels).flat(),
        checklists: this.checklistRows(),
        cardLinks: this.linkRows(),
        comments: this.state.comments,
        attachments: this.state.attachments,
        sessions: this.state.sessions.filter(
          (item) => item.revokedAt === null && item.expiresAt > now,
        ),
        tokens: this.state.tokens,
        commands: this.state.commands,
        audit: this.state.audit,
        activity: this.state.activity,
        announcements: this.announcements,
      };
      const commandMatch =
        entity[1] === "commands"
          ? "id"
          : entity[1] === "audit"
            ? "details"
            : "auto";
      return this.json(this.page(map[entity[1]] ?? [], url, commandMatch));
    }
    const userDetail = path.match(/^\/admin\/users\/([^/]+)\/detail$/);
    if (userDetail && method === "GET") {
      const user = this.state.users.find((item) => item.id === userDetail[1]);
      if (!user) return this.json({ message: "User not found" }, 404);
      return this.json(this.userDetail(user, url));
    }
    const cardDetail = path.match(/^\/admin\/cards\/([^/]+)\/detail$/);
    if (cardDetail && method === "GET") {
      const card = this.state.cards.find((item) => item.id === cardDetail[1]);
      if (!card) return this.json({ message: "Card not found" }, 404);
      return this.json(this.cardDetail(card, url));
    }
    const boardMeta = path.match(/^\/admin\/boards\/([^/]+)\/meta$/);
    if (boardMeta && method === "GET") {
      const board = this.state.boards.find((item) => item.id === boardMeta[1]);
      if (!board) return this.json({ message: "Board not found" }, 404);
      return this.json({
        board: {
          ...board,
          version: 0,
          counts: {
            members: 0,
            columns: 0,
            cards: 0,
            labels: 0,
            links: 0,
            comments: 0,
            attachments: 0,
            commands: 0,
            activity: 0,
          },
        },
        members: this.boardMembers[board.id] ?? [],
        columns: this.boardColumns[board.id] ?? [],
        labels: this.boardLabels[board.id] ?? [],
        workflowSummary: {
          present: false,
          enabled: false,
          transitions: 0,
          activeTransitions: 0,
          initialColumnId: null,
          doneColumnIds: [],
        },
      });
    }

    return this.json({ message: `no route for ${method} ${path}` }, 404);
  }

  /** Revoke every active session of a user; returns how many were live. */
  private revokeSessionsOf(userId: string): number {
    const owned = this.state.sessions.filter((item) => item.userId === userId);
    this.state.sessions = this.state.sessions.filter(
      (item) => item.userId !== userId,
    );
    return owned.length;
  }

  private metrics(): AdminMetricsDto {
    return {
      users: { total: this.state.users.length, last7d: 1, disabled: 0 },
      boards: { active: this.state.boards.length, archived: 0, deleted: 0 },
      cards: { active: 5, archived: 0 },
      commands: { last24h: 3, last7d: 9 },
      comments: { total: 2 },
      sessions: { active: this.state.sessions.length },
      admins: { total: this.state.admins.length },
      runtime: {
        version: "0.1.0-test",
        uptimeSec: 42,
        nodeEnv: "test",
        databaseLatencyMs: 3,
      },
      registrationsByDay: Array.from({ length: 14 }, (_, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, "0")}`,
        count: index % 3,
      })),
      commandsByDay: Array.from({ length: 14 }, (_, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, "0")}`,
        count: index % 2,
      })),
    };
  }

  private relationGuard(
    boardId: string,
    action: BoardAction,
  ): { status: number; body: Record<string, unknown> } | null {
    const relationTypes = new Set<string>([
      "ADD_CHECKLIST",
      "RENAME_CHECKLIST",
      "DELETE_CHECKLIST",
      "ADD_CHECKLIST_ITEM",
      "SET_CHECKLIST_ITEM_DONE",
      "RENAME_CHECKLIST_ITEM",
      "DELETE_CHECKLIST_ITEM",
      "ADD_CARD_LINK",
      "REMOVE_CARD_LINK",
    ]);
    if (!relationTypes.has(action.type)) return null;
    const relation = action as BoardAction & {
      cardId: string;
      checklistId?: string;
      itemId?: string;
      newChecklistId?: string;
      newItemId?: string;
      title?: string;
      text?: string;
      linkId?: string;
      targetCardId?: string;
      linkType?: CardLinkType;
    };
    const invalid = (
      field: string,
      message: string,
    ): { status: number; body: Record<string, unknown> } => ({
      status: 400,
      body: { message, field },
    });
    if (action.type === "ADD_CHECKLIST" || action.type === "RENAME_CHECKLIST") {
      const title = relation.title?.trim() ?? "";
      if (title === "" || title.length > LIMITS.checklistTitle) {
        return invalid(
          "action.title",
          `Checklist title must be 1-${LIMITS.checklistTitle} characters`,
        );
      }
    }
    if (
      action.type === "ADD_CHECKLIST_ITEM" ||
      action.type === "RENAME_CHECKLIST_ITEM"
    ) {
      const text = relation.text?.trim() ?? "";
      if (text === "" || text.length > LIMITS.checklistItem) {
        return invalid(
          "action.text",
          `Checklist item text must be 1-${LIMITS.checklistItem} characters`,
        );
      }
    }
    if (
      (action.type === "ADD_CARD_LINK" || action.type === "REMOVE_CARD_LINK") &&
      !isCardLinkType(relation.linkType)
    ) {
      return invalid("action.linkType", "Unknown card link type");
    }
    const card = this.state.cards.find((entry) => entry.id === relation.cardId);
    if (
      card === undefined ||
      card.deletedAt !== null ||
      card.boardId !== boardId
    ) {
      return {
        status: 404,
        body: { message: "Card not found", field: "action.cardId" },
      };
    }

    const checklists = this.state.cardChecklists[relation.cardId] ?? [];
    const checklist =
      relation.checklistId === undefined
        ? undefined
        : checklists.find((entry) => entry.id === relation.checklistId);
    const requireChecklist = (): {
      status: number;
      body: Record<string, unknown>;
    } | null =>
      checklist === undefined || checklist.deletedAt !== null
        ? {
            status: 404,
            body: {
              message: "Checklist not found",
              field: "action.checklistId",
            },
          }
        : null;

    const allChecklists = Object.values(this.state.cardChecklists).flat();
    const allItems = allChecklists.flatMap((entry) => entry.items);
    const idConflict = (
      field: string,
    ): {
      status: number;
      body: Record<string, unknown>;
    } => ({
      status: 409,
      body: {
        message: "Entity id is already used",
        field,
        code: "id_conflict",
        conflict: "id",
      },
    });

    switch (action.type) {
      case "ADD_CHECKLIST": {
        const existing = allChecklists.find(
          (entry) => entry.id === relation.newChecklistId,
        );
        if (
          existing !== undefined &&
          (existing.deletedAt === null ||
            !checklists.some((entry) => entry.id === existing.id))
        ) {
          return idConflict("action.newChecklistId");
        }
        if (
          checklists.filter((entry) => entry.deletedAt === null).length >=
          LIMITS.checklistsPerCard
        ) {
          return {
            status: 409,
            body: {
              message: "Too many checklists on the card",
              conflict: "wip",
              currentVersion: 0,
            },
          };
        }
        return null;
      }
      case "RENAME_CHECKLIST":
      case "DELETE_CHECKLIST":
        return requireChecklist();
      case "ADD_CHECKLIST_ITEM": {
        const missing = requireChecklist();
        if (missing !== null) return missing;
        const existing = allItems.find(
          (entry) => entry.id === relation.newItemId,
        );
        if (
          existing !== undefined &&
          (existing.deletedAt === null ||
            !(checklist?.items ?? []).some((entry) => entry.id === existing.id))
        ) {
          return idConflict("action.newItemId");
        }
        if (
          (checklist?.items ?? []).filter((entry) => entry.deletedAt === null)
            .length >= LIMITS.itemsPerChecklist
        ) {
          return {
            status: 409,
            body: {
              message: "Too many items in the checklist",
              conflict: "wip",
              currentVersion: 0,
            },
          };
        }
        return null;
      }
      case "SET_CHECKLIST_ITEM_DONE":
      case "RENAME_CHECKLIST_ITEM":
      case "DELETE_CHECKLIST_ITEM": {
        const missing = requireChecklist();
        if (missing !== null) return missing;
        const item = checklist?.items.find(
          (entry) => entry.id === relation.itemId,
        );
        if (item === undefined || item.deletedAt !== null) {
          return {
            status: 404,
            body: {
              message: "Checklist item not found",
              field: "action.itemId",
            },
          };
        }
        return null;
      }
      case "ADD_CARD_LINK": {
        const existing = this.state.cardLinks.find(
          (entry) => entry.id === relation.linkId,
        );
        if (
          existing !== undefined &&
          (existing.boardId !== boardId ||
            existing.fromCardId !== relation.cardId ||
            existing.deletedAt === null)
        ) {
          return idConflict("action.linkId");
        }
        const target = this.state.cards.find(
          (entry) => entry.id === relation.targetCardId,
        );
        if (
          target === undefined ||
          target.deletedAt !== null ||
          target.boardId !== boardId
        ) {
          return {
            status: 404,
            body: {
              message: "Target card not found",
              field: "action.targetCardId",
            },
          };
        }
        if (target.id === relation.cardId) {
          return {
            status: 400,
            body: {
              message: "A card cannot link to itself",
              field: "action.targetCardId",
              code: "link_self",
            },
          };
        }
        const liveLinks = this.state.cardLinks.filter(
          (entry) => entry.boardId === boardId && entry.deletedAt === null,
        );
        const pairKey =
          relation.cardId < target.id
            ? `${relation.cardId}|${target.id}`
            : `${target.id}|${relation.cardId}`;
        if (
          liveLinks.some((entry) => {
            const key =
              entry.fromCardId < entry.toCardId
                ? `${entry.fromCardId}|${entry.toCardId}`
                : `${entry.toCardId}|${entry.fromCardId}`;
            return key === pairKey;
          })
        ) {
          return {
            status: 409,
            body: {
              message: "Cards are already linked",
              field: "action.targetCardId",
              code: "link_pair_exists",
            },
          };
        }
        if (relation.linkType === "blocks") {
          const liveCardIds = new Set(
            this.state.cards
              .filter(
                (entry) =>
                  entry.boardId === boardId && entry.deletedAt === null,
              )
              .map((entry) => entry.id),
          );
          const adjacency = new Map<string, string[]>();
          for (const link of liveLinks) {
            if (
              link.type !== "blocks" ||
              !liveCardIds.has(link.fromCardId) ||
              !liveCardIds.has(link.toCardId)
            ) {
              continue;
            }
            const next = adjacency.get(link.fromCardId) ?? [];
            next.push(link.toCardId);
            adjacency.set(link.fromCardId, next);
          }
          const seen = new Set<string>([target.id]);
          const stack = [target.id];
          while (stack.length > 0) {
            const current = stack.pop() as string;
            for (const next of adjacency.get(current) ?? []) {
              if (next === relation.cardId) {
                return {
                  status: 409,
                  body: {
                    message: "That blocking link would create a cycle",
                    field: "action.targetCardId",
                    code: "link_cycle",
                  },
                };
              }
              if (seen.has(next)) continue;
              seen.add(next);
              stack.push(next);
            }
          }
        }
        if (
          liveLinks.filter((entry) => entry.fromCardId === relation.cardId)
            .length >= LIMITS.linksPerCard
        ) {
          return {
            status: 409,
            body: {
              message: "Too many outgoing links on the card",
              field: "action.linkId",
              code: "link_cap",
              conflict: "wip",
              currentVersion: 0,
            },
          };
        }
        return null;
      }
      case "REMOVE_CARD_LINK": {
        const link = this.state.cardLinks.find(
          (entry) => entry.id === relation.linkId,
        );
        if (
          link === undefined ||
          link.deletedAt !== null ||
          link.boardId !== boardId ||
          link.fromCardId !== relation.cardId
        ) {
          return {
            status: 404,
            body: {
              message: "Card link not found",
              field: "action.linkId",
            },
          };
        }
        if (
          link.toCardId !== relation.targetCardId ||
          link.type !== relation.linkType
        ) {
          return {
            status: 409,
            body: {
              message: "Link row does not match the requested relation",
              field: "action.linkId",
              code: "link_mismatch",
            },
          };
        }
        return null;
      }
      default:
        return null;
    }
  }

  private applyRelationState(action: BoardAction): void {
    const relation = action as BoardAction & {
      cardId: string;
      checklistId?: string;
      itemId?: string;
      newChecklistId?: string;
      newItemId?: string;
      title?: string;
      text?: string;
      done?: boolean;
      linkId?: string;
      targetCardId?: string;
      linkType?: CardLinkType;
    };
    const checklists = this.state.cardChecklists[relation.cardId] ?? [];
    const checklist =
      relation.checklistId === undefined
        ? undefined
        : checklists.find((entry) => entry.id === relation.checklistId);
    switch (action.type) {
      case "ADD_CHECKLIST": {
        const existing = checklists.find(
          (entry) => entry.id === relation.newChecklistId,
        );
        if (existing !== undefined) {
          existing.title = relation.title ?? existing.title;
          existing.deletedAt = null;
          return;
        }
        checklists.push({
          id: relation.newChecklistId ?? `checklist-${now}`,
          title: relation.title ?? "",
          position: checklists.filter((entry) => entry.deletedAt === null)
            .length,
          deletedAt: null,
          items: [],
        });
        this.state.cardChecklists[relation.cardId] = checklists;
        return;
      }
      case "RENAME_CHECKLIST": {
        if (checklist !== undefined) checklist.title = relation.title ?? "";
        return;
      }
      case "DELETE_CHECKLIST": {
        if (checklist !== undefined) {
          checklist.deletedAt = now;
          for (const item of checklist.items) {
            if (item.deletedAt === null) item.deletedAt = now;
          }
        }
        return;
      }
      case "ADD_CHECKLIST_ITEM": {
        if (checklist === undefined) return;
        const existing = checklist.items.find(
          (entry) => entry.id === relation.newItemId,
        );
        if (existing !== undefined) {
          existing.text = relation.text ?? existing.text;
          existing.done = false;
          existing.deletedAt = null;
          return;
        }
        checklist.items.push({
          id: relation.newItemId ?? `item-${now}`,
          text: relation.text ?? "",
          done: false,
          position: checklist.items.filter((entry) => entry.deletedAt === null)
            .length,
          deletedAt: null,
        });
        return;
      }
      case "SET_CHECKLIST_ITEM_DONE": {
        const item = checklist?.items.find(
          (entry) => entry.id === relation.itemId,
        );
        if (item !== undefined) item.done = relation.done === true;
        return;
      }
      case "RENAME_CHECKLIST_ITEM": {
        const item = checklist?.items.find(
          (entry) => entry.id === relation.itemId,
        );
        if (item !== undefined) item.text = relation.text ?? item.text;
        return;
      }
      case "DELETE_CHECKLIST_ITEM": {
        const item = checklist?.items.find(
          (entry) => entry.id === relation.itemId,
        );
        if (item !== undefined) item.deletedAt = now;
        return;
      }
      case "ADD_CARD_LINK": {
        const existing = this.state.cardLinks.find(
          (entry) => entry.id === relation.linkId,
        );
        if (existing !== undefined) {
          existing.fromCardId = relation.cardId;
          existing.toCardId = relation.targetCardId ?? existing.toCardId;
          existing.type = relation.linkType ?? existing.type;
          existing.deletedAt = null;
          return;
        }
        this.state.cardLinks.push({
          id: relation.linkId ?? `link-${now}`,
          boardId:
            this.state.cards.find((entry) => entry.id === relation.cardId)
              ?.boardId ?? "b-1",
          fromCardId: relation.cardId,
          toCardId: relation.targetCardId ?? "",
          type: relation.linkType ?? "relates_to",
          deletedAt: null,
          createdAt: now,
        });
        return;
      }
      case "REMOVE_CARD_LINK": {
        const link = this.state.cardLinks.find(
          (entry) => entry.id === relation.linkId,
        );
        if (link !== undefined) link.deletedAt = now;
        return;
      }
      default:
        return;
    }
  }

  /** Mirror of the paged `/admin/cards/:id/detail` contract (TASK-176.3). */
  private cardDetail(card: AdminCardRowDto, url: URL) {
    const section = url.searchParams.get("section");
    const requestedOffset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";
    const anchor = url.searchParams.get("anchor");
    const wants = (key: string) => section === null || section === key;

    const newest = <T extends { createdAt: number; id: string }>(rows: T[]) =>
      [...rows].sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      );
    const comments = newest(
      this.state.comments.filter((comment) => comment.cardId === card.id),
    );
    const liveComments = comments.filter(
      (comment) => comment.deletedAt === null,
    );
    const attachments = newest(
      this.state.attachments.filter((file) => file.cardId === card.id),
    );
    const liveAttachments = attachments.filter(
      (file) => file.deletedAt === null,
    );
    const activity = this.state.activity.filter(
      (entry) => entry.cardId === card.id,
    );
    const commands = this.state.commands.filter((command) => {
      const payload = command.payload as Record<string, unknown> | null;
      return payload?.cardId === card.id || payload?.newCardId === card.id;
    });
    const timeline = [
      ...activity.map((entry) => ({
        id: entry.id,
        kind: "activity" as const,
        type: entry.type,
        actorId: entry.actorId,
        actorEmail: entry.actorEmail,
        auditId: null,
        details: entry.details,
        createdAt: entry.createdAt,
      })),
      ...commands.map((command) => ({
        id: command.id,
        kind: "command" as const,
        type: command.type,
        actorId: command.actorId,
        actorEmail: command.actorEmail,
        auditId: command.auditId ?? null,
        details: command.payload,
        createdAt: command.createdAt,
      })),
    ].sort((a, b) => b.createdAt - a.createdAt);

    const anchorComment =
      anchor === null
        ? undefined
        : comments.find((comment) => comment.id === anchor);
    const anchorAttachment =
      anchor === null
        ? undefined
        : attachments.find((file) => file.id === anchor);
    const includeDeletedComments =
      includeDeleted || anchorComment !== undefined;
    const includeDeletedAttachments =
      includeDeleted || anchorAttachment !== undefined;
    const visibleComments = includeDeletedComments ? comments : liveComments;
    const visibleAttachments = includeDeletedAttachments
      ? attachments
      : liveAttachments;
    const centre = (index: number) =>
      Math.max(0, index - Math.floor(limit / 2));
    const commentsOffset =
      anchorComment === undefined
        ? requestedOffset
        : centre(visibleComments.indexOf(anchorComment));
    const attachmentsOffset =
      anchorAttachment === undefined
        ? requestedOffset
        : centre(visibleAttachments.indexOf(anchorAttachment));
    const slice = <T>(items: T[], start: number) =>
      items.slice(start, start + limit);
    const win = (
      offset: number,
      total: number,
      loaded: number,
      included: boolean,
      anchorId: string | null = null,
    ) => ({
      offset,
      limit,
      total,
      hasMore: offset + loaded < total,
      includeDeleted: included,
      anchor: anchorId,
    });

    const cover = this.state.cardCovers[card.id] ?? null;
    const cardLabelIds = this.state.cardLabelIds[card.id] ?? [];
    const assignee = (this.boardMembers[card.boardId] ?? []).find(
      (member) => member.userId === card.assigneeId,
    );
    return {
      card: {
        ...card,
        description: this.state.cardDescriptions[card.id] ?? null,
        dueDate: card.dueDate,
        priority: card.priority,
        assigneeDisplayName: assignee?.userDisplayName ?? null,
        coverType: cover?.type ?? null,
        coverValue: cover?.value ?? null,
        version: 0,
        attachmentCount: liveAttachments.length,
        lastActorId: this.state.cardLastActors[card.id]?.id ?? null,
        lastActorEmail: this.state.cardLastActors[card.id]?.email ?? null,
        commentIds: liveComments.map((comment) => comment.id),
      },
      labels: (this.boardLabels[card.boardId] ?? [])
        .filter(
          (label) =>
            cardLabelIds.includes(label.id) && label.deletedAt === null,
        )
        .map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color,
          position: label.position,
        })),
      checklists: (this.state.cardChecklists[card.id] ?? []).map(
        (checklist) => ({
          ...checklist,
          items: checklist.items.map((item) => ({ ...item })),
        }),
      ),
      linksOut: this.state.cardLinks
        .filter((link) => link.fromCardId === card.id)
        .map((link) => {
          const other = this.state.cards.find(
            (entry) => entry.id === link.toCardId,
          );
          return {
            id: link.id,
            otherCardId: link.toCardId,
            otherCardTitle: other?.title ?? "Deleted card",
            otherCardDeleted: other === undefined || other.deletedAt !== null,
            type: link.type,
            deletedAt: link.deletedAt,
            createdAt: link.createdAt,
          };
        }),
      linksIn: this.state.cardLinks
        .filter((link) => link.toCardId === card.id)
        .map((link) => {
          const other = this.state.cards.find(
            (entry) => entry.id === link.fromCardId,
          );
          return {
            id: link.id,
            otherCardId: link.fromCardId,
            otherCardTitle: other?.title ?? "Deleted card",
            otherCardDeleted: other === undefined || other.deletedAt !== null,
            type: link.type,
            deletedAt: link.deletedAt,
            createdAt: link.createdAt,
          };
        }),
      windows: {
        comments: win(
          commentsOffset,
          visibleComments.length,
          wants("comments") ? slice(visibleComments, commentsOffset).length : 0,
          includeDeletedComments,
          anchorComment?.id ?? null,
        ),
        attachments: win(
          attachmentsOffset,
          visibleAttachments.length,
          wants("attachments")
            ? slice(visibleAttachments, attachmentsOffset).length
            : 0,
          includeDeletedAttachments,
          anchorAttachment?.id ?? null,
        ),
        timeline: win(
          requestedOffset,
          timeline.length,
          wants("timeline") ? slice(timeline, requestedOffset).length : 0,
          false,
        ),
      },
      hidden: {
        comments: comments.length - liveComments.length,
        attachments: attachments.length - liveAttachments.length,
      },
      comments: wants("comments") ? slice(visibleComments, commentsOffset) : [],
      attachments: wants("attachments")
        ? slice(visibleAttachments, attachmentsOffset)
        : [],
      timeline: wants("timeline") ? slice(timeline, requestedOffset) : [],
      createdBy: null,
    };
  }

  /** Mirror of the paged `/admin/users/:id/detail` contract (TASK-176.3). */
  private userDetail(user: AdminUserRowDto, url: URL) {
    const section = url.searchParams.get("section");
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 25);
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";
    const window = (
      total: number,
      loaded: number,
      included = false,
      anchor: string | null = null,
    ) => ({
      offset,
      limit,
      total,
      hasMore: offset + loaded < total,
      includeDeleted: included,
      anchor,
    });

    const newest = <T extends { createdAt: number; id: string }>(rows: T[]) =>
      [...rows].sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      );
    const comments = newest(
      this.state.comments.filter((comment) => comment.authorId === user.id),
    );
    const liveComments = comments.filter(
      (comment) => comment.deletedAt === null,
    );
    const sessions = newest(
      this.state.sessions.filter((session) => session.userId === user.id),
    );
    const liveSessions = sessions.filter(
      (session) => session.revokedAt === null && session.expiresAt > now,
    );
    const tokens = newest(
      this.state.tokens.filter((token) => token.userId === user.id),
    );
    const liveTokens = tokens.filter((token) => token.revokedAt === null);
    const commands = [...this.state.commands]
      .filter((command) => command.actorId === user.id)
      .sort((a, b) => b.seq - a.seq);
    const activity = newest(
      this.state.activity.filter((entry) => entry.actorId === user.id),
    );
    const createdCards = this.state.cards;
    const assignedCards = this.state.cards.filter(
      (card) => card.assigneeId === user.id,
    );
    const wants = (key: string) => section === null || section === key;
    const slice = <T>(items: T[]) =>
      wants(section ?? "") ? items.slice(offset, offset + limit) : ([] as T[]);

    const visibleComments = includeDeleted ? comments : liveComments;
    const visibleSessions = includeDeleted ? sessions : liveSessions;
    const visibleTokens = includeDeleted ? tokens : liveTokens;

    return {
      user,
      counters: {
        boards: 0,
        cardsCreated: createdCards.length,
        cardsAssigned: assignedCards.length,
        comments: liveComments.length,
        attachments: 0,
        sessions: liveSessions.length,
        tokens: liveTokens.length,
        commands: commands.length,
      },
      windows: {
        memberships: window(
          this.state.memberships.length,
          this.state.memberships.length,
        ),
        cards: window(createdCards.length, slice(createdCards).length),
        assignedCards: window(
          assignedCards.length,
          slice(assignedCards).length,
        ),
        comments: window(
          visibleComments.length,
          slice(visibleComments).length,
          includeDeleted,
        ),
        attachments: window(0, 0, includeDeleted),
        sessions: window(
          visibleSessions.length,
          slice(visibleSessions).length,
          includeDeleted,
        ),
        tokens: window(
          visibleTokens.length,
          slice(visibleTokens).length,
          includeDeleted,
        ),
        commands: window(commands.length, slice(commands).length),
        activity: window(activity.length, slice(activity).length),
      },
      hidden: {
        comments: comments.length - liveComments.length,
        attachments: 0,
        sessions: sessions.length - liveSessions.length,
        tokens: tokens.length - liveTokens.length,
      },
      memberships: this.state.memberships,
      createdCards: slice(createdCards),
      assignedCards: slice(assignedCards),
      comments: slice(visibleComments),
      attachments: [],
      sessions: slice(visibleSessions),
      tokens: slice(visibleTokens),
      recentCommands: slice(commands),
      recentActivity: slice(activity),
    };
  }

  private checklistRows(): AdminChecklistRowDto[] {
    return this.state.cards.flatMap((card) =>
      (this.state.cardChecklists[card.id] ?? []).map((checklist) => {
        const items = checklist.items.filter((item) => item.deletedAt === null);
        return {
          id: checklist.id,
          title: checklist.title,
          position: checklist.position,
          deletedAt: checklist.deletedAt,
          cardId: card.id,
          cardTitle: card.title,
          boardId: card.boardId,
          boardTitle: card.boardTitle,
          itemCount: items.length,
          doneCount: items.filter((item) => item.done).length,
          version: 0,
        };
      }),
    );
  }

  private linkRows(): AdminCardLinkRowDto[] {
    return this.state.cardLinks.map((link, position) => ({
      ...link,
      position,
      boardTitle:
        this.state.boards.find((board) => board.id === link.boardId)?.title ??
        "",
      fromCardTitle:
        this.state.cards.find((card) => card.id === link.fromCardId)?.title ??
        "",
      toCardTitle:
        this.state.cards.find((card) => card.id === link.toCardId)?.title ?? "",
    }));
  }

  private page<T>(
    items: T[],
    url: URL,
    commandMatch: "id" | "details" | "auto" = "auto",
  ): {
    items: T[];
    total: number;
    limit: number;
    offset: number;
  } {
    const search = url.searchParams.get("search")?.toLowerCase();
    const boardId = url.searchParams.get("boardId");
    const columnId = url.searchParams.get("columnId");
    const cardId = url.searchParams.get("cardId");
    const entity = url.pathname.split("/").at(-1);
    const cards = url.pathname.endsWith("/cards");
    const comments = url.pathname.endsWith("/comments");
    const attachments = url.pathname.endsWith("/attachments");
    const { searchParams } = url;
    const status = searchParams.get("status");
    const verified = searchParams.get("verified");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const adminMemberId = searchParams.get("adminMemberId");
    const types = searchParams.getAll("type");
    const commands = entity === "commands";
    const activity = entity === "activity";
    const audit = entity === "audit";
    const eventList = commands || activity || audit;
    const actorIds = searchParams.getAll(audit ? "adminId" : "actorId");
    const actions = searchParams.getAll("action");
    const targetTypes = searchParams.getAll("targetType");
    const targetId = searchParams.get("targetId");
    const links = entity === "cardLinks";
    const boardContent =
      entity === "columns" ||
      entity === "labels" ||
      entity === "checklists" ||
      links;
    const currentTime = Date.now();
    const matchesCard = cards
      ? this.cardFacets(url.searchParams, currentTime)
      : null;
    const commandId = url.searchParams.get("commandId");
    const filtered = items.filter((item) => {
      const record = item as Record<string, unknown>;
      const parent =
        comments || attachments || activity
          ? this.state.cards.find((card) => card.id === record.cardId)
          : undefined;
      if (
        boardId &&
        (comments ? parent?.boardId : record.boardId) !== boardId &&
        record.id !== boardId
      ) {
        return false;
      }
      const touches = record.touches as string[] | undefined;
      if (
        columnId &&
        (commands
          ? !touches?.includes(`column:${columnId}`)
          : (parent?.columnId ?? record.columnId) !== columnId)
      )
        return false;
      if (
        cardId &&
        (commands
          ? !touches?.includes(`card:${cardId}`)
          : links
            ? record.fromCardId !== cardId && record.toCardId !== cardId
            : record.cardId !== cardId && record.id !== cardId)
      ) {
        return false;
      }
      if (
        (links || commands || activity) &&
        types.length &&
        !types.includes(String(record.type))
      )
        return false;
      if (eventList) {
        if (
          actorIds.length &&
          !actorIds.includes(String(record[audit ? "adminId" : "actorId"]))
        )
          return false;
        if (from !== null && Number(record.createdAt) < Number(from))
          return false;
        if (to !== null && Number(record.createdAt) > Number(to)) return false;
      }
      if (audit) {
        if (actions.length && !actions.includes(String(record.action)))
          return false;
        if (
          targetTypes.length &&
          !targetTypes.includes(String(record.targetType))
        )
          return false;
        if (targetId !== null && record.targetId !== targetId) return false;
      }
      if (activity) {
        const labelId = searchParams.get("labelId");
        if (
          labelId &&
          !this.state.cardLabelIds[String(record.cardId)]?.includes(labelId)
        )
          return false;
      }
      if (entity === "users") {
        if (
          verified !== null &&
          (record.emailVerifiedAt !== null) !== (verified === "true")
        )
          return false;
        if (from && Number(record.createdAt) < Number(from)) return false;
        if (to && Number(record.createdAt) > Number(to)) return false;
        if (status === "active" && record.disabledAt !== null) return false;
        if (status === "disabled" && record.disabledAt === null) return false;
      }
      if (entity === "boards") {
        if (
          adminMemberId &&
          !this.boardMembers[String(record.id)]?.some(
            (member) =>
              member.userId === adminMemberId &&
              member.role === "ADMIN" &&
              member.acceptedAt !== null,
          )
        )
          return false;
        if (
          status === "active" &&
          (record.deletedAt !== null || record.archivedAt !== null)
        )
          return false;
        if (
          status === "archived" &&
          (record.deletedAt !== null || record.archivedAt === null)
        )
          return false;
      }
      if (boardContent && status === "active" && record.deletedAt !== null)
        return false;
      if (
        (boardContent || entity === "boards") &&
        status === "deleted" &&
        record.deletedAt === null
      )
        return false;
      if (matchesCard && !matchesCard(item as AdminCardRowDto)) return false;
      if (comments || attachments) {
        const labelId = searchParams.get("labelId");
        if (
          labelId &&
          !this.state.cardLabelIds[String(record.cardId)]?.includes(labelId)
        )
          return false;
        const person = searchParams.get(comments ? "authorId" : "uploadedById");
        if (person && record[comments ? "authorId" : "uploadedById"] !== person)
          return false;
        const kinds = searchParams.getAll("kind");
        if (kinds.length && !kinds.includes(String(record.kind))) return false;
        const mime = searchParams.get("mime");
        if (mime && mime !== attachmentMimeFamily(String(record.mimeType)))
          return false;
        const transcode = searchParams.get("transcode");
        if (transcode && record.transcodeStatus !== transcode) return false;
        if (from !== null && Number(record.createdAt) < Number(from))
          return false;
        if (to !== null && Number(record.createdAt) > Number(to)) return false;
        if (status === "active" && record.deletedAt !== null) return false;
        if (status === "deleted" && record.deletedAt === null) return false;
      }
      if (commandId) {
        const details = record.details as Record<string, unknown> | null;
        const matched =
          commandMatch === "details"
            ? record.action === "board.command" &&
              details?.commandId === commandId
            : commandMatch === "id"
              ? record.id === commandId
              : details?.commandId === commandId || record.id === commandId;
        if (!matched) return false;
      }
      return search
        ? JSON.stringify(item).toLowerCase().includes(search)
        : true;
    });
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  }

  private cardFacets(params: URLSearchParams, currentTime: number) {
    const labels = params.getAll("labelId");
    const labelMatch = params.get("labelMatch");
    const assignees = params.getAll("assigneeId");
    const unassigned = params.get("unassigned") === "true";
    const priorities = params.getAll("priority");
    const due = params.get("due");
    const hasAttachments = params.get("hasAttachments");
    const from = params.get("from");
    const to = params.get("to");
    const status = params.get("status");

    return (card: AdminCardRowDto) => {
      const cardLabels = this.state.cardLabelIds[card.id] ?? [];
      const matchesLabel = (id: string) => cardLabels.includes(id);
      if (
        labels.length &&
        !(labelMatch === "all"
          ? labels.every(matchesLabel)
          : labels.some(matchesLabel))
      )
        return false;
      if (assignees.length || unassigned) {
        if (
          card.assigneeId === null
            ? !unassigned
            : !assignees.includes(card.assigneeId)
        )
          return false;
      }
      if (
        priorities.length &&
        !priorities.includes(card.priority ?? DEFAULT_CARD_PRIORITY)
      )
        return false;
      if (due === "none" && card.dueDate !== null) return false;
      if (due === "overdue" || due === "soon") {
        if (
          card.dueDate === null ||
          dueStatus(card.dueDate, currentTime) !== due
        )
          return false;
      }
      if (hasAttachments !== null) {
        const hasFiles = this.state.attachments.some(
          (row) =>
            row.cardId === card.id &&
            row.deletedAt === null &&
            !row.isInline &&
            !row.descriptionDetached,
        );
        if (hasFiles !== (hasAttachments === "true")) return false;
      }
      if (from && card.createdAt < Number(from)) return false;
      if (to && card.createdAt > Number(to)) return false;
      if (status === "deleted") return card.deletedAt !== null;
      if (status === "archived")
        return card.deletedAt === null && card.archivedAt !== null;
      if (status === "active")
        return card.deletedAt === null && card.archivedAt === null;
      return true;
    };
  }

  private filterOptions(params: URLSearchParams): Response {
    const type = params.get("type");
    const stateOf = (row: {
      deletedAt: number | null;
      archivedAt?: number | null;
    }) =>
      row.deletedAt !== null
        ? "deleted"
        : row.archivedAt != null
          ? "archived"
          : "active";
    let options: AdminFilterOptionDto[];
    const bareOption = (id: string, label = id): AdminFilterOptionDto => ({
      id,
      label,
      sublabel: null,
      state: null,
      boardId: null,
      columnId: null,
    });
    const codes = (values: (string | null)[]) =>
      [...new Set(values)].flatMap((value) =>
        value === null ? [] : [bareOption(value)],
      );
    switch (type) {
      case "board":
        options = this.state.boards.map((row) => ({
          id: row.id,
          label: row.title,
          sublabel: null,
          state: stateOf(row),
          boardId: null,
          columnId: null,
        }));
        break;
      case "column":
        options = Object.values(this.boardColumns)
          .flat()
          .map((row) => ({
            id: row.id,
            label: row.title,
            sublabel: row.boardTitle,
            state: stateOf(row),
            boardId: row.boardId,
            columnId: null,
          }));
        break;
      case "label":
        options = Object.values(this.boardLabels)
          .flat()
          .map((row) => ({
            id: row.id,
            label: row.name,
            sublabel: row.boardTitle,
            state: stateOf(row),
            boardId: row.boardId,
            columnId: null,
            color: row.color,
          }));
        break;
      case "card":
        options = this.state.cards.map((row) => ({
          id: row.id,
          label: row.title,
          sublabel: `${row.boardTitle} / ${row.columnTitle}`,
          state: stateOf(row),
          boardId: row.boardId,
          columnId: row.columnId,
        }));
        break;
      case "user":
        options = this.state.users.map((row) => ({
          id: row.id,
          label: row.displayName?.trim() || row.email,
          sublabel: row.displayName?.trim() ? row.email : null,
          state: row.disabledAt === null ? "active" : "disabled",
          boardId: null,
          columnId: null,
        }));
        break;
      case "auditActor": {
        const actors = new Map<string, AdminFilterOptionDto>();
        const newest = [...this.state.audit].sort(
          (left, right) =>
            right.createdAt - left.createdAt || right.id.localeCompare(left.id),
        );
        for (const row of newest) {
          if (row.adminId && row.adminEmail && !actors.has(row.adminId))
            actors.set(row.adminId, bareOption(row.adminId, row.adminEmail));
        }
        options = [...actors.values()];
        break;
      }
      case "action":
        options = codes(this.state.audit.map(({ action }) => action));
        break;
      case "targetType":
        options = codes(this.state.audit.map(({ targetType }) => targetType));
        break;
      case "commandType":
        options = codes(this.state.commands.map(({ type }) => type));
        break;
      case "activityType":
        options = codes(this.state.activity.map(({ type }) => type));
        break;
      default:
        return this.json({ message: "Unknown lookup type" }, 400);
    }
    const ids = params.getAll("ids");
    if (ids.length > 0) {
      const items = options.filter(({ id }) => ids.includes(id));
      return this.json({
        items,
        missing: ids.filter((id) => !items.some((item) => item.id === id)),
        hasMore: false,
      });
    }
    const boardId = params.get("boardId");
    const query = params.get("q")?.trim() ?? "";
    const search = query.toLowerCase();
    const limit = Number(
      params.get("limit") ?? ADMIN_FILTER_OPTION_LIMITS.default,
    );
    if (
      !Number.isInteger(limit) ||
      limit < ADMIN_FILTER_OPTION_LIMITS.min ||
      limit > ADMIN_FILTER_OPTION_LIMITS.max
    )
      return this.json({ message: "Invalid lookup limit" }, 400);
    const matches = options.filter(
      ({ id, label, sublabel, boardId: parent }) =>
        (!boardId ||
          !["column", "card", "label"].includes(type) ||
          parent === boardId) &&
        (label.toLowerCase().includes(search) ||
          sublabel?.toLowerCase().includes(search) ||
          id.toLowerCase().includes(search)),
    );
    matches.sort(
      (a, b) =>
        Number(b.id === query) - Number(a.id === query) ||
        a.label.localeCompare(b.label) ||
        a.id.localeCompare(b.id),
    );
    return this.json({
      items: matches.slice(0, limit),
      missing: [],
      hasMore: matches.length > limit,
    });
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function attachmentMimeFamily(raw: string) {
  const mime = raw.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  if (
    mime.startsWith("text/") ||
    mime.startsWith("application/vnd.openxmlformats-officedocument.") ||
    [
      "application/rtf",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
    ].includes(mime)
  )
    return "document";
  return "other";
}
