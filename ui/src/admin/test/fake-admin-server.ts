import {
  boardReducer,
  EMAIL_SMTP_PRESETS,
  EMAIL_SMTP_TEST_PRESETS,
  OAUTH_PROVIDER_IDS,
} from "@janosik/shared";
import type {
  BoardAction,
  BoardAggregate,
  AdminActivityRowDto,
  AdminAuditRowDto,
  AdminBoardRowDto,
  AdminCardRowDto,
  AdminCommandRowDto,
  AdminCommentRowDto,
  AdminEmailSettingsDto,
  AdminEmailTestResponse,
  AdminMasterRowDto,
  AdminMetricsDto,
  AdminOAuthProviderDto,
  AdminRole,
  AdminSessionRowDto,
  AdminTokenRowDto,
  AdminUpdateEmailSettingsRequest,
  AdminUpdateOAuthProviderRequest,
  AdminUserRowDto,
} from "@janosik/shared";

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

export interface FakeAdminState {
  admins: FakeAdmin[];
  users: AdminUserRowDto[];
  boards: AdminBoardRowDto[];
  commands: AdminCommandRowDto[];
  audit: AdminAuditRowDto[];
  cards: AdminCardRowDto[];
  sessions: AdminSessionRowDto[];
  tokens: AdminTokenRowDto[];
  comments: AdminCommentRowDto[];
  activity: AdminActivityRowDto[];
  /** Aggregate served to the board content editor; grown by commands. */
  contentBoard: BoardAggregate | null;
}

const now = 1_760_000_000_000;

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
    activity: [],
    contentBoard: null,
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
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
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
  /** When set, the refresh endpoint answers as if no cookie existed. */
  sessionAlive = true;
  /**
   * Role of the session the fake serves. `listMasters`-style endpoints
   * answer 403 unless it is OWNER, mirroring the server guard.
   */
  sessionRole: AdminRole = "OWNER";
  /** Extra master rows returned by `GET /admin/admins` (besides the owner). */
  masters: AdminMasterRowDto[] = [];
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

      const failure = this.failNext.find((candidate) =>
        path.includes(candidate),
      );
      if (failure) {
        this.failNext = this.failNext.filter((item) => item !== failure);
        return this.json({ message: "boom" }, 500);
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
      return this.json({ seq: 1, versions: {} });
    }

    if (path === "/admin/cards" && method === "GET") {
      return this.json(this.page(this.state.cards, url));
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
      return this.json(this.page(this.state.sessions, url));
    }
    const sessionRevoke = path.match(/^\/admin\/sessions\/([^/]+)\/revoke$/);
    if (sessionRevoke && method === "POST") {
      const found = this.state.sessions.some(
        (item) => item.id === sessionRevoke[1],
      );
      this.state.sessions = this.state.sessions.filter(
        (item) => item.id !== sessionRevoke[1],
      );
      return this.json({ revoked: found ? 1 : 0 }, 201);
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
      return this.json(this.page(this.state.commands, url));
    }
    if (path === "/admin/audit") {
      return this.json(this.page(this.state.audit, url));
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
      // and the `ethereal` sandbox mints its own credentials.
      const preset = [...EMAIL_SMTP_PRESETS, ...EMAIL_SMTP_TEST_PRESETS].find(
        (item) => item.id === input.provider,
      );
      const custom = preset !== undefined && preset.id === "custom";
      const sandbox = preset !== undefined && preset.id === "ethereal";
      const sandboxUser =
        this.emailSettings.source === "db" &&
        this.emailSettings.provider === "ethereal" &&
        this.emailSettings.username !== ""
          ? this.emailSettings.username
          : "sandbox-1@ethereal.email";
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
            ? `Janosik <${sandboxUser}>`
            : (input.from ?? this.emailSettings.from),
        username: sandbox
          ? sandboxUser
          : (input.username ?? this.emailSettings.username),
        enabled: input.enabled ?? this.emailSettings.enabled,
        hasPassword: sandbox
          ? true
          : input.password !== undefined
            ? input.password !== null
            : this.emailSettings.hasPassword,
        source: "db",
        active: input.enabled ?? false,
        updatedBy: this.principal().email,
        updatedAt: new Date(now).toISOString(),
        webViewer:
          sandbox && this.sessionRole === "OWNER"
            ? {
                url: "https://ethereal.email",
                user: sandboxUser,
                pass: "generated-pass",
              }
            : null,
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

    // Admin v2 (TASK-48): generic entity listing mirrors the real backend's
    // `GET /admin/entities/:entity` (same rows the typed endpoints return).
    const entity = path.match(/^\/admin\/entities\/([a-zA-Z]+)$/);
    if (entity && method === "GET") {
      const map: Record<string, unknown[]> = {
        users: this.state.users,
        boards: this.state.boards,
        cards: this.state.cards,
        comments: this.state.comments,
        sessions: this.state.sessions,
        tokens: this.state.tokens,
        commands: this.state.commands,
        audit: this.state.audit,
        activity: this.state.activity,
      };
      return this.json(this.page(map[entity[1]] ?? [], url));
    }
    const userDetail = path.match(/^\/admin\/users\/([^/]+)\/detail$/);
    if (userDetail && method === "GET") {
      const user = this.state.users.find((item) => item.id === userDetail[1]);
      if (!user) return this.json({ message: "User not found" }, 404);
      return this.json({
        user,
        counters: {
          boards: 0,
          cardsCreated: 0,
          cardsAssigned: 0,
          comments: 0,
          attachments: 0,
          sessions: 0,
          tokens: 0,
          commands: 0,
        },
        memberships: [],
        createdCards: [],
        assignedCards: [],
        comments: [],
        attachments: [],
        sessions: [],
        tokens: [],
        recentCommands: [],
        recentActivity: [],
      });
    }
    const cardDetail = path.match(/^\/admin\/cards\/([^/]+)\/detail$/);
    if (cardDetail && method === "GET") {
      const card = this.state.cards.find((item) => item.id === cardDetail[1]);
      if (!card) return this.json({ message: "Card not found" }, 404);
      return this.json({
        card: {
          ...card,
          description: null,
          dueDate: null,
          priority: null,
          assigneeDisplayName: null,
          coverType: null,
          coverValue: null,
          version: 0,
          attachmentCount: 0,
          lastActorEmail: null,
        },
        labels: [],
        checklists: [],
        linksOut: [],
        linksIn: [],
        comments: [],
        attachments: [],
        timeline: [],
        createdBy: null,
      });
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
        members: [],
        columns: [],
        labels: [],
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

  private page<T>(
    items: T[],
    url: URL,
  ): {
    items: T[];
    total: number;
    limit: number;
    offset: number;
  } {
    const search = url.searchParams.get("search")?.toLowerCase();
    const filtered = search
      ? items.filter((item) =>
          JSON.stringify(item).toLowerCase().includes(search),
        )
      : items;
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
