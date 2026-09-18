import {
  boardReducer,
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
  type MembershipChange,
  type MembershipSseEvent,
  type PresenceSseEvent,
  type PresenceUser,
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
  displayName: string;
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
  };
  refreshValid = true;
  /** Caller's role per board summary (`GET /boards`) — drives VIEWER tests. */
  role: BoardRole = "ADMIN";
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
  private boardCounter = 0;

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
  ): number {
    const board = this.boards.get(boardId);
    if (board === undefined) throw new Error(`Unknown board ${boardId}`);
    const scoped = { ...action, boardId } as BoardAction;
    const after =
      boardReducer([structuredClone(board)], scoped, {
        withActivity: false,
      })[0] ?? board;
    this.boards.set(boardId, after);
    return this.recordEvent(boardId, scoped, actorId, touches);
  }

  /** Append one committed event to the log and push it to open streams. */
  private recordEvent(
    boardId: string,
    action: BoardAction,
    actorId: string,
    touches: string[],
  ): number {
    const seq = (this.seq.get(boardId) ?? 0) + 1;
    this.seq.set(boardId, seq);
    const event: CommandSseEvent = {
      type: "command",
      seq,
      action,
      actorId,
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
      return json(200, this.session());
    }
    if (path === "/api/v1/auth/logout" && method === "POST") {
      return json(200, { status: "ok" });
    }
    if (path === "/api/v1/auth/me" && method === "GET") {
      return json(200, this.publicUser());
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

    const commandMatch = /^\/api\/v1\/boards\/([^/]+)\/commands$/.exec(path);
    if (commandMatch && method === "POST") {
      return this.command(commandMatch[1], body as CommandRequest);
    }
    return json(404, { message: `No route for ${method} ${path}` });
  }

  /** `GET /boards/:id/events` — backlog from `since`, then live frames. */
  private events(boardId: string, since: number): Response {
    const backlog = (this.eventLog.get(boardId) ?? []).filter(
      (event) => event.seq > since,
    );
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // The real server's connection handshake: the command backlog first,
        // then the current presence roster (TASK-36).
        for (const event of backlog) controller.enqueue(encodeEvent(event));
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

    const action = request.action as BoardAction;
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
      role: this.role,
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
