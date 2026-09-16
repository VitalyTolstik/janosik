import { boardReducer } from "@janosik/shared";
import type {
  BoardAction,
  BoardAggregate,
  AdminAuditRowDto,
  AdminBoardRowDto,
  AdminCardRowDto,
  AdminCommandRowDto,
  AdminCommentRowDto,
  AdminMasterRowDto,
  AdminMetricsDto,
  AdminRole,
  AdminSessionRowDto,
  AdminTokenRowDto,
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
    columnTitle: "Backlog",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    comments: 1,
    ...overrides,
  };
}

export function adminSession(
  overrides: Partial<AdminSessionRowDto> = {},
): AdminSessionRowDto {
  return {
    id: "session-1",
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
    boardTitle: "Roadmap",
    authorEmail: "member@example.com",
    text: "Looks good",
    createdAt: now,
    deletedAt: null,
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
    boards: 1,
    sessions: 2,
    apiTokens: 0,
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
    sessions: 1,
    ...overrides,
  };
}

export function adminBoard(
  overrides: Partial<AdminBoardRowDto> = {},
): AdminBoardRowDto {
  return {
    id: "b-1",
    title: "Roadmap",
    ownerEmail: "member@example.com",
    members: 2,
    columns: 3,
    cards: 5,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

export class FakeAdminServer {
  state: FakeAdminState;
  requests: Array<{ method: string; path: string; body: unknown }> = [];
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
      this.requests.push({ method, path, body });

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
          sessions: 1,
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
        sessions: 0,
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
        if (jsonBody.disabled) master.sessions = 0;
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
      master.sessions = 0;
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
      const revoked = master?.sessions ?? 0;
      if (master) master.sessions = 0;
      return this.json({ revoked }, 201);
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
        boards: 0,
        sessions: 0,
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
        if (jsonBody.disabled) user.sessions = 0;
      }
      return this.json(user);
    }
    const sessions = path.match(/^\/admin\/users\/([^/]+)\/sessions\/revoke$/);
    if (sessions && method === "POST") {
      const user = this.state.users.find((item) => item.id === sessions[1]);
      const revoked = user?.sessions ?? 0;
      if (user) user.sessions = 0;
      return this.json({ revoked }, 201);
    }
    const tokens = path.match(/^\/admin\/users\/([^/]+)\/tokens\/revoke$/);
    if (tokens && method === "POST") {
      const user = this.state.users.find((item) => item.id === tokens[1]);
      const revoked = user?.apiTokens ?? 0;
      if (user) user.apiTokens = 0;
      return this.json({ revoked }, 201);
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
        ownerEmail: owner,
        members: 1,
        columns: 0,
        cards: 0,
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

    return this.json({ message: `no route for ${method} ${path}` }, 404);
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
