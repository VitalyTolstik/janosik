import {
  boardReducer,
  validateBoardAction,
  type ActivityFeedEntry,
  type ActivitySseEvent,
  type AuthResponseDto,
  type AuthUserDto,
  type Board,
  type BoardAction,
  type BoardExportFile,
  type BoardInvitationDto,
  type BoardMemberDto,
  type BoardRole,
  type BoardSummary,
  type BoardSseEvent,
  type CommandRequest,
  type CommandResponse,
  type CommandSseEvent,
  type CommentDto,
  type CreateUserTokenRequest,
  type CreateUserTokenResponse,
  type MembershipChange,
  type MembershipSseEvent,
  type PresenceSseEvent,
  type PresenceUser,
  type ResyncSseEvent,
  type UpdateProfileRequest,
  type UserAvatarColor,
  type UserTokenDto,
} from "@janosik/shared";

/**
 * In-memory stand-in for the NestJS API (TASK-29 UI tests).
 *
 * It replays the very same `boardReducer` the client and the backend use,
 * stores commands idempotently by `commandId`, keeps per-entity versions and
 * honors `ifMatchVersions` — enough of the real contract to exercise
 * hydration, the command queue, rollbacks, the focus refetch and the undo
 * conflict policy without a database. `fetch`-shaped: pass `server.handle`
 * to `vi.stubGlobal("fetch", ...)`.
 */

interface FakeAccount {
  id: string;
  email: string;
  password: string;
  displayName: string | null;
  avatarColor: UserAvatarColor | null;
  createdAt: number;
}

/** A recorded request, for assertions about what the client actually sent. */
export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

/** `touch` fields of an action, mapped onto the version keys. */
const TOUCH_FIELDS: ReadonlyArray<[field: string, prefix: string]> = [
  ["cardId", "card"],
  ["newCardId", "card"],
  ["columnId", "column"],
  ["newColumnId", "column"],
  ["labelId", "label"],
  ["checklistId", "checklist"],
  ["itemId", "checklistItem"],
  ["newItemId", "checklistItem"],
];

/** `Command.touches`-shaped labels for an action plus the board itself. */
export function touchesOf(boardId: string, action: unknown): string[] {
  const labels = new Set<string>([`board:${boardId}`]);
  for (const [field, prefix] of TOUCH_FIELDS) {
    const value = (action as unknown as Record<string, unknown>)[field];
    if (typeof value === "string") labels.add(`${prefix}:${value}`);
  }
  return [...labels];
}

export class FakeServer {
  readonly requests: RecordedRequest[] = [];
  readonly boards = new Map<string, Board>();
  readonly account: FakeAccount = {
    id: "user-1",
    email: "admin@example.com",
    password: "password123",
    displayName: "Admin",
    avatarColor: null,
    createdAt: Date.UTC(2026, 0, 15, 12, 0, 0),
  };
  /** Personal API tokens of the account (TASK-36.1). */
  readonly apiTokens: UserTokenDto[] = [];
  refreshValid = true;
  /** Email-change (TASK-51) knobs the tests control. */
  emailChangeCode = "123456";
  takenEmails: string[] = ["taken@example.com"];
  private pendingEmail: string | null = null;
  /**
   * Registration verification (TASK-53) knobs: `unverifiedEmail` makes
   * register/login hand out an unconfirmed account (default keeps every
   * other test on the verified path); `emailVerifyCode` is the code the
   * verify route accepts.
   */
  unverifiedEmail = false;
  emailVerifyCode = "123456";
  /** Live flag the verify route flips; tests may set it directly. */
  emailVerified = true;
  /**
   * `impersonatedBy` of `GET /auth/me` (U-8): the master id when the token
   * in use is a view-as one, `null` for a normal session.
   */
  impersonatedBy: string | null = null;
  /** Caller's role per board summary (`GET /boards`) — drives VIEWER tests. */
  role: BoardRole = "ADMIN";
  /** Per-board role overrides (mixed-role switcher lists, TASK-36.2). */
  readonly roles = new Map<string, BoardRole>();
  /** Pending invitations of the signed-in user (`GET /invitations`). */
  readonly invitations: BoardInvitationDto[] = [];
  /** Roster every newly opened events stream reports (TASK-36). */
  initialPresence: PresenceUser[] = [];
  /** Presence heartbeats the client sent (`POST /boards/:id/presence`). */
  readonly presencePings: string[] = [];
  /** Boards whose membership was revoked: hidden and refused (TASK-36). */
  readonly revoked = new Set<string>();
  /** `GET /boards/:id/members` answers (TASK-36). */
  readonly membersByBoard = new Map<string, BoardMemberDto[]>();
  /** `GET /cards/:id/comments` storage, newest-first (TASK-37). */
  readonly commentsByCard = new Map<string, CommentDto[]>();
  /** `GET /cards/:id/activity` pages, newest-first (TASK-37). */
  readonly activityByCard = new Map<string, ActivityFeedEntry[]>();

  /** Committed events per board — the SSE catch-up log (TASK-30). */
  private readonly eventLog = new Map<string, CommandSseEvent[]>();
  /** Open `GET /boards/:id/events` streams to push live frames into. */
  private readonly eventStreams = new Map<
    string,
    Set<ReadableStreamDefaultController<Uint8Array>>
  >();

  private readonly commands = new Map<string, CommandResponse>();
  private readonly versions = new Map<string, Map<string, number>>();
  private readonly seq = new Map<string, number>();
  private nextFailure: { status: number; body: unknown } | null = null;
  private nextRequestFailure: { status: number; body: unknown } | null = null;
  /** Held command response (`holdNextCommand`) — the in-flight window. */
  private commandGate: Promise<void> | null = null;
  /**
   * Held command *commit* (`holdNextCommandBeforeCommit`): the request is in
   * flight but the server has not written it yet — a foreign command
   * published meanwhile gets the lower seq, exactly like a concurrent agent.
   */
  private commitGate: Promise<void> | null = null;
  /**
   * Whether events carry the issuing client's `commandId` (the current
   * server contract). `false` mimics an older server for fallback tests.
   */
  emitCommandIds = true;
  /**
   * Catch-up cap of `GET /events`: a gap larger than this is not replayed —
   * the stream sends `resync` instead (the backend's truncated delta).
   */
  maxCatchUp = Number.POSITIVE_INFINITY;
  private foreignCommandCounter = 0;
  private boardCounter = 0;
  /** Id counter of `POST /cards/:id/comments` (TASK-37). */
  private commentCounter = 0;

  constructor(seed: Board[] = []) {
    for (const board of seed) this.seed(board);
  }

  seed(board: Board): void {
    this.boards.set(board.id, structuredClone(board));
  }

  /** Make the next command answer with this error once (rollback tests). */
  failNextCommand(status: number, body: unknown): void {
    this.nextFailure = { status, body };
  }

  /** Make the next request of any kind answer with this error once. */
  failNextRequest(status: number, body: unknown): void {
    this.nextRequestFailure = { status, body };
  }

  /** Simulate a foreign writer (no command row): replace the board. */
  overwriteBoard(boardId: string, mutate: (board: Board) => Board): void {
    const board = this.boards.get(boardId);
    if (board) this.boards.set(boardId, mutate(structuredClone(board)));
  }

  /** Simulate a foreign writer bumping one entity's version. */
  bumpVersion(boardId: string, key: string): void {
    const map = this.versions.get(boardId) ?? new Map<string, number>();
    map.set(key, (map.get(key) ?? 0) + 1);
    this.versions.set(boardId, map);
  }

  versionOf(boardId: string, key: string): number | undefined {
    return this.versions.get(boardId)?.get(key);
  }

  handle = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input.toString(),
      "http://api.test",
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    this.requests.push({ method, path: url.pathname, body });

    return this.route(method, url.pathname, body, url.searchParams);
  };

  /** The board's current seq — the stream baseline (`X-Board-Seq`). */
  seqOf(boardId: string): number {
    return this.seq.get(boardId) ?? 0;
  }

  /**
   * Commit a command from someone else: apply it to the fake board, bump the
   * seq, record it for catch-up and push it to every open stream. The
   * default actor is *not* the signed-in account — an own echo is published
   * by passing `account.id`, and `command()` below does the same for the
   * commands this client sends, exactly like the production server.
   */
  publishCommand(
    boardId: string,
    action: Record<string, unknown>,
    actorId: string = "user-2",
    touches: string[] = touchesOf(boardId, action),
    commandId: string = `foreign-${++this.foreignCommandCounter}`,
  ): number {
    const board = this.boards.get(boardId);
    if (board === undefined) throw new Error(`Unknown board ${boardId}`);
    const scoped = { ...action, boardId } as BoardAction;
    const after =
      boardReducer([structuredClone(board)], scoped, {
        withActivity: false,
      })[0] ?? board;
    this.boards.set(boardId, after);
    return this.recordEvent(boardId, scoped, actorId, touches, commandId);
  }

  /** Append one committed event to the log and push it to open streams. */
  private recordEvent(
    boardId: string,
    action: BoardAction,
    actorId: string,
    touches: string[],
    commandId: string,
  ): number {
    const seq = (this.seq.get(boardId) ?? 0) + 1;
    this.seq.set(boardId, seq);
    const event: CommandSseEvent = {
      type: "command",
      seq,
      action,
      actorId,
      ...(this.emitCommandIds ? { commandId } : {}),
      touches,
    };
    const log = this.eventLog.get(boardId) ?? [];
    log.push(event);
    this.eventLog.set(boardId, log);
    const frame = encodeEvent(event);
    for (const controller of this.eventStreams.get(boardId) ?? []) {
      try {
        controller.enqueue(frame);
      } catch {
        /* the stream was cancelled — the next connect catches up */
      }
    }
    return seq;
  }

  /** Push a presence roster to every open stream of the board (TASK-36). */
  publishPresence(boardId: string, users: PresenceUser[]): void {
    const event: PresenceSseEvent = { type: "presence", users };
    const frame = encodeEvent(event);
    for (const controller of this.eventStreams.get(boardId) ?? []) {
      try {
        controller.enqueue(frame);
      } catch {
        /* the stream was cancelled */
      }
    }
  }

  /**
   * Revoke the caller's membership (TASK-36): the board leaves `GET /boards`
   * and every board-scoped route answers 403, like `MembershipGuard` does.
   * `publishMembership` delivers the live frame the server sends.
   */
  revokeMembership(boardId: string): void {
    this.revoked.add(boardId);
  }

  /** Push one membership frame to every open stream of the board (TASK-36). */
  publishMembership(
    boardId: string,
    userId: string,
    change: MembershipChange,
  ): void {
    const event: MembershipSseEvent = {
      type: "membership",
      boardId,
      userId,
      change,
    };
    const frame = encodeEvent(event);
    for (const controller of this.eventStreams.get(boardId) ?? []) {
      try {
        controller.enqueue(frame);
      } catch {
        /* the stream was cancelled */
      }
    }
  }

  /** Push one activity frame (a comment) to the board's streams (TASK-37). */
  publishActivity(boardId: string, event: ActivitySseEvent): void {
    const frame = encodeEvent(event);
    for (const controller of this.eventStreams.get(boardId) ?? []) {
      try {
        controller.enqueue(frame);
      } catch {
        /* the stream was cancelled */
      }
    }
  }

  /** Seed a card's comment thread, newest-first (TASK-37). */
  seedComments(cardId: string, comments: CommentDto[]): void {
    this.commentsByCard.set(
      cardId,
      comments.map((comment) => structuredClone(comment)),
    );
  }

  /** Seed a card's history page, newest-first (TASK-37). */
  seedActivity(cardId: string, entries: ActivityFeedEntry[]): void {
    this.activityByCard.set(
      cardId,
      entries.map((entry) => structuredClone(entry)),
    );
  }

  /**
   * Whether a `GET /boards/:id/events` stream is currently open. Tests wait
   * on this instead of sleeping a fixed time, so a live-frame assertion is
   * deterministic however busy the machine is.
   */
  hasEventStream(boardId: string): boolean {
    return (this.eventStreams.get(boardId)?.size ?? 0) > 0;
  }

  /** Close every open stream of the board (simulates a dropped SSE). */
  closeEvents(boardId: string): void {
    for (const controller of this.eventStreams.get(boardId) ?? []) {
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    }
    this.eventStreams.delete(boardId);
  }

  /**
   * Hold the next command response open and return its release. While held
   * the client stays busy — the window in which the bridge must defer
   * streamed events instead of applying them out of order.
   */
  /**
   * Hold the next command *before* it is committed and return its release:
   * anything published meanwhile is ordered before it (lower seq) — the
   * "agent commits while my drag is in flight" race (U-1, U-7).
   */
  holdNextCommandBeforeCommit(): () => void {
    let release: (() => void) | null = null;
    this.commitGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.commitGate = null;
      release?.();
    };
  }

  /** Push a `resync` frame to every open stream of the board. */
  publishResync(boardId: string): void {
    const event: ResyncSseEvent = { type: "resync" };
    const frame = encodeEvent(event);
    for (const controller of this.eventStreams.get(boardId) ?? []) {
      try {
        controller.enqueue(frame);
      } catch {
        /* the stream was cancelled */
      }
    }
  }

  holdNextCommand(): () => void {
    let release: (() => void) | null = null;
    this.commandGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.commandGate = null;
      release?.();
    };
  }

  private route(
    method: string,
    path: string,
    body: unknown,
    searchParams: URLSearchParams,
  ): Response | Promise<Response> {
    if (this.nextRequestFailure !== null) {
      const failure = this.nextRequestFailure;
      this.nextRequestFailure = null;
      return json(failure.status, failure.body);
    }
    // A revoked membership refuses every board-scoped route, like the real
    // `MembershipGuard` (TASK-36). `GET /boards` filters the board out below.
    const revoked = /^\/api\/v1\/boards\/([^/]+)\//.exec(path);
    if (revoked !== null && this.revoked.has(revoked[1])) {
      return json(403, { message: "No access to this board" });
    }
    if (path === "/api/v1/auth/refresh" && method === "POST") {
      return this.refreshValid
        ? json(200, this.session())
        : json(401, { message: "Unauthorized" });
    }
    if (path === "/api/v1/auth/login" && method === "POST") {
      const { email, password } = (body ?? {}) as Record<string, string>;
      return email === this.account.email && password === this.account.password
        ? json(200, this.session())
        : json(401, { message: "Invalid credentials" });
    }
    if (path === "/api/v1/auth/register" && method === "POST") {
      this.emailVerified = !this.unverifiedEmail;
      return json(200, this.session());
    }
    if (path === "/api/v1/auth/logout" && method === "POST") {
      return json(200, { status: "ok" });
    }
    // Registration verification (TASK-53): the code route activates the
    // account, the resend route mimics the email dispatch.
    if (path === "/api/v1/auth/verify-email" && method === "POST") {
      const { code } = (body ?? {}) as Record<string, string>;
      if (this.emailVerified || code !== this.emailVerifyCode) {
        return json(400, { message: "Invalid verification code" });
      }
      this.emailVerified = true;
      return json(200, { user: this.publicUser() });
    }
    if (path === "/api/v1/auth/verify-email/resend" && method === "POST") {
      if (this.emailVerified) {
        return json(400, { message: "Email is already verified" });
      }
      return json(200, { expiresAt: Date.now() + 15 * 60 * 1000 });
    }
    if (path === "/api/v1/auth/me" && method === "GET") {
      return json(200, {
        ...this.publicUser(),
        impersonatedBy: this.impersonatedBy,
      });
    }
    if (path === "/api/v1/auth/password" && method === "POST") {
      const { currentPassword, newPassword } = (body ?? {}) as {
        currentPassword?: string;
        newPassword?: string;
      };
      if (currentPassword !== this.account.password) {
        return json(401, { message: "Current password is incorrect" });
      }
      this.account.password = newPassword ?? this.account.password;
      return json(200, { status: "ok" });
    }
    // Email change (TASK-51): password proof, then a code against the new
    // address. The test controls the code via `emailChangeCode`.
    if (path === "/api/v1/auth/email/change/request" && method === "POST") {
      const { newEmail, currentPassword } = (body ?? {}) as Record<
        string,
        string
      >;
      if (currentPassword !== this.account.password) {
        return json(401, { message: "Current password is incorrect" });
      }
      if (newEmail === this.account.email) {
        return json(400, {
          message: "New email must differ from the current one",
        });
      }
      if (this.takenEmails.includes(newEmail)) {
        return json(409, { message: "Email is already registered" });
      }
      this.pendingEmail = newEmail;
      return json(200, { expiresAt: Date.now() + 15 * 60 * 1000 });
    }
    if (path === "/api/v1/auth/email/change/confirm" && method === "POST") {
      const { code } = (body ?? {}) as Record<string, string>;
      if (this.pendingEmail === null || code !== this.emailChangeCode) {
        return json(400, { message: "Invalid verification code" });
      }
      this.account.email = this.pendingEmail;
      this.pendingEmail = null;
      return json(200, this.session());
    }
    if (path === "/api/v1/users/me" && method === "PATCH") {
      const patch = (body ?? {}) as UpdateProfileRequest;
      if (patch.displayName !== undefined) {
        this.account.displayName = patch.displayName;
      }
      if (patch.avatarColor !== undefined) {
        this.account.avatarColor = patch.avatarColor;
      }
      return json(200, this.publicUser());
    }
    if (path === "/api/v1/users/me/tokens" && method === "GET") {
      return json(200, structuredClone(this.apiTokens));
    }
    if (path === "/api/v1/users/me/tokens" && method === "POST") {
      const request = (body ?? {}) as CreateUserTokenRequest;
      const apiToken: UserTokenDto = {
        id: `token-${this.apiTokens.length + 1}`,
        name: request.name,
        createdAt: Date.now(),
        lastUsedAt: null,
        expiresAt:
          request.expiresAt == null
            ? null
            : new Date(request.expiresAt).getTime(),
        revokedAt: null,
      };
      this.apiTokens.unshift(apiToken);
      const response: CreateUserTokenResponse = {
        token: `jnk_fake-token-${this.apiTokens.length}`,
        apiToken: structuredClone(apiToken),
      };
      return json(201, response);
    }
    const tokenMatch = /^\/api\/v1\/users\/me\/tokens\/([^/]+)$/.exec(path);
    if (tokenMatch && method === "DELETE") {
      const token = this.apiTokens.find((item) => item.id === tokenMatch[1]);
      if (token === undefined) {
        return json(404, { message: "API token not found" });
      }
      token.revokedAt = Date.now();
      return json(200, { status: "ok" });
    }
    if (path === "/api/v1/boards" && method === "GET") {
      return json(
        200,
        [...this.boards.values()]
          .filter((board) => !this.revoked.has(board.id))
          .map((board) => this.toSummary(board)),
      );
    }
    if (path === "/api/v1/boards" && method === "POST") {
      const { title } = (body ?? {}) as { title?: string };
      const board = emptyBoard(`board-${++this.boardCounter}a`, title ?? "");
      this.seed(board);
      return json(201, structuredClone(board));
    }
    if (path === "/api/v1/boards/import" && method === "POST") {
      const envelope = body as BoardExportFile;
      const imported: Board[] = [];
      for (const board of envelope.boards ?? []) {
        // Like the backend, import mints fresh ids; references follow.
        const clone = structuredClone(board);
        clone.id = `board-${++this.boardCounter}b`;
        this.seed(clone);
        imported.push(structuredClone(clone));
      }
      return json(201, imported);
    }

    const presenceMatch = /^\/api\/v1\/boards\/([^/]+)\/presence$/.exec(path);
    if (presenceMatch && method === "POST") {
      const { clientId } = (body ?? {}) as { clientId?: string };
      if (typeof clientId === "string") this.presencePings.push(clientId);
      return new Response(null, { status: 204 });
    }
    const eventsMatch = /^\/api\/v1\/boards\/([^/]+)\/events$/.exec(path);
    if (eventsMatch && method === "GET") {
      return this.events(
        eventsMatch[1],
        Number(searchParams.get("since") ?? 0),
      );
    }
    const membersMatch = /^\/api\/v1\/boards\/([^/]+)\/members$/.exec(path);
    if (membersMatch && method === "GET") {
      return json(
        200,
        structuredClone(this.membersByBoard.get(membersMatch[1]) ?? []),
      );
    }
    // Non-enumerating invite: every address (unknown, known, already
    // pending) gets the same masked 201 — only an accepted member is a 409.
    if (membersMatch && method === "POST") {
      const { email = "", role = "MEMBER" } = (body ?? {}) as {
        email?: string;
        role?: BoardRole;
      };
      const address = email.trim().toLowerCase();
      const members = this.membersByBoard.get(membersMatch[1]) ?? [];
      if (members.some((member) => member.email.toLowerCase() === address)) {
        return json(409, { message: "User is already a board member" });
      }
      const masked: BoardMemberDto = {
        userId: "",
        displayName: null,
        email: address,
        role,
        expiresAt: null,
        avatarColor: null,
        avatarPath: null,
      };
      return json(201, masked);
    }
    const boardMatch = /^\/api\/v1\/boards\/([^/]+)$/.exec(path);
    if (boardMatch) {
      const boardId = boardMatch[1];
      if (method === "GET") {
        const board = this.boards.get(boardId);
        return board
          ? json(200, structuredClone(board), {
              "X-Board-Seq": String(this.seqOf(boardId)),
            })
          : json(404, { message: "Board not found" });
      }
      if (method === "DELETE") {
        this.boards.delete(boardId);
        return json(200, { status: "ok" });
      }
    }
    if (path === "/api/v1/invitations" && method === "GET") {
      return json(200, structuredClone(this.invitations));
    }
    const invitationMatch =
      /^\/api\/v1\/invitations\/([^/]+)\/(accept|decline)$/.exec(path);
    if (invitationMatch && method === "POST") {
      const index = this.invitations.findIndex(
        (row) => row.id === invitationMatch[1],
      );
      if (index === -1) return json(404, { message: "Invitation not found" });
      this.invitations.splice(index, 1);
      return json(200, { status: "ok" });
    }

    const commentsMatch = /^\/api\/v1\/cards\/([^/]+)\/comments$/.exec(path);
    if (commentsMatch !== null) {
      const cardId = commentsMatch[1];
      if (method === "GET") {
        return json(
          200,
          this.pageOf(this.commentsByCard.get(cardId) ?? [], searchParams),
        );
      }
      if (method === "POST") {
        const { text } = (body ?? {}) as { text?: string };
        const comment: CommentDto = {
          id: `comment-${++this.commentCounter}`,
          cardId,
          authorId: this.account.id,
          text: text ?? "",
          createdAt: Date.now(),
        };
        const list = this.commentsByCard.get(cardId) ?? [];
        list.unshift(comment);
        this.commentsByCard.set(cardId, list);
        return json(201, structuredClone(comment));
      }
    }
    const deleteCommentMatch = /^\/api\/v1\/comments\/([^/]+)$/.exec(path);
    if (deleteCommentMatch !== null && method === "DELETE") {
      for (const list of this.commentsByCard.values()) {
        const index = list.findIndex(
          (comment) => comment.id === deleteCommentMatch[1],
        );
        if (index !== -1) {
          list.splice(index, 1);
          return json(200, { status: "ok" });
        }
      }
      return json(404, { message: "Comment not found" });
    }
    const cardActivityMatch = /^\/api\/v1\/cards\/([^/]+)\/activity$/.exec(
      path,
    );
    if (cardActivityMatch !== null && method === "GET") {
      return json(
        200,
        this.pageOf(
          this.activityByCard.get(cardActivityMatch[1]) ?? [],
          searchParams,
        ),
      );
    }

    const commandMatch = /^\/api\/v1\/boards\/([^/]+)\/commands$/.exec(path);
    if (commandMatch && method === "POST") {
      return this.command(commandMatch[1], body as CommandRequest);
    }
    return json(404, { message: `No route for ${method} ${path}` });
  }

  /**
   * Cursor pagination for the TASK-37 feeds: `cursor` is the next index, the
   * page size is `limit` (default 50, max 100) — newest-first like production.
   */
  private pageOf<T>(
    items: readonly T[],
    searchParams: URLSearchParams,
  ): { items: T[]; nextCursor: string | null } {
    const limitRaw = Number(searchParams.get("limit") ?? 50);
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;
    const startRaw = Number(searchParams.get("cursor") ?? 0);
    const start = Number.isInteger(startRaw) && startRaw > 0 ? startRaw : 0;
    const page = items.slice(start, start + limit);
    const end = start + page.length;
    return {
      items: structuredClone([...page]),
      nextCursor: end < items.length ? String(end) : null,
    };
  }

  /** `GET /boards/:id/events` — backlog from `since`, then live frames. */
  private events(boardId: string, since: number): Response {
    const backlog = (this.eventLog.get(boardId) ?? []).filter(
      (event) => event.seq > since,
    );
    const truncated = backlog.length > this.maxCatchUp;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // The real server's connection handshake: the command backlog first
        // (or `resync` when the gap is past the catch-up cap), then the
        // current presence roster (TASK-36).
        if (truncated) {
          controller.enqueue(encodeEvent({ type: "resync" }));
        } else {
          for (const event of backlog) controller.enqueue(encodeEvent(event));
        }
        if (this.initialPresence.length > 0) {
          controller.enqueue(
            encodeEvent({ type: "presence", users: this.initialPresence }),
          );
        }
        const streams = this.eventStreams.get(boardId) ?? new Set();
        streams.add(controller);
        this.eventStreams.set(boardId, streams);
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  /** Apply one command like the backend: reducer + versions + idempotency. */
  private async command(
    boardId: string,
    request: CommandRequest,
  ): Promise<Response> {
    if (this.nextFailure !== null) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      return json(failure.status, failure.body);
    }
    const stored = this.commands.get(request.commandId);
    if (stored !== undefined) return json(200, stored);
    if (this.commitGate !== null) await this.commitGate;

    // The real server's boundary check (S-3 slipped through because this
    // fake never ran it): a malformed action is a 400 with the field path,
    // and only the validated action is applied and echoed.
    const validation = validateBoardAction(request.action);
    if (!validation.ok) {
      return json(400, {
        message: `Invalid command (${validation.field}): ${validation.message}`,
        field: validation.field,
      });
    }

    const board = this.boards.get(boardId);
    if (board === undefined) return json(404, { message: "Board not found" });

    const currentVersion = this.seq.get(boardId) ?? 0;
    for (const [key, expected] of Object.entries(
      request.ifMatchVersions ?? {},
    )) {
      if (this.versionOf(boardId, key) !== expected) {
        return json(409, { conflict: "version", currentVersion });
      }
    }

    const action = validation.action;
    const after =
      boardReducer(
        [structuredClone(board)],
        { ...action, boardId } as BoardAction,
        {
          withActivity: false,
        },
      )[0] ?? board;
    this.boards.set(boardId, after);
    const versions = this.bumpTouched(boardId, action);
    // Committed commands are echoed to every open stream before the HTTP
    // response — own echoes included, exactly like the production server.
    const seq = this.recordEvent(
      boardId,
      { ...action, boardId } as BoardAction,
      this.account.id,
      touchesOf(boardId, action),
      request.commandId,
    );
    const response: CommandResponse = { seq, versions };
    this.commands.set(request.commandId, response);
    if (this.commandGate !== null) await this.commandGate;
    return json(200, response);
  }

  private bumpTouched(
    boardId: string,
    action: BoardAction,
  ): Record<string, number> {
    const record = action as unknown as Record<string, unknown>;
    const keys = new Set<string>();
    for (const [field, prefix] of TOUCH_FIELDS) {
      const value = record[field];
      if (typeof value === "string") keys.add(`${prefix}:${value}`);
    }
    if (keys.size === 0) keys.add(`board:${boardId}`);
    const map = this.versions.get(boardId) ?? new Map<string, number>();
    for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1);
    this.versions.set(boardId, map);
    return Object.fromEntries(map);
  }

  private publicUser(): AuthUserDto {
    return {
      id: this.account.id,
      email: this.account.email,
      displayName: this.account.displayName,
      avatarColor: this.account.avatarColor,
      avatarPath: null,
      createdAt: this.account.createdAt,
      emailVerifiedAt: this.emailVerified ? this.account.createdAt : null,
    };
  }

  private toSummary(board: Board): BoardSummary {
    return {
      id: board.id,
      title: board.title,
      ...(board.archivedAt !== undefined
        ? { archivedAt: board.archivedAt }
        : {}),
      counters: {
        cards: Object.keys(board.cards).length,
        columns: board.columns.length,
      },
      role: this.roles.get(board.id) ?? this.role,
    };
  }

  private session(): AuthResponseDto {
    return { accessToken: "access-token-1", user: this.publicUser() };
  }
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** One `data:` frame, exactly like Nest's `@Sse` serializer writes it. */
function encodeEvent(event: BoardSseEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function emptyBoard(id: string, title: string): Board {
  return {
    id,
    title,
    columns: [],
    cards: {},
    labels: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}
