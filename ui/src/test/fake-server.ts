import {
  boardReducer,
  type AuthResponseDto,
  type AuthUserDto,
  type Board,
  type BoardAction,
  type BoardExportFile,
  type BoardInvitationDto,
  type BoardRole,
  type BoardSummary,
  type CommandRequest,
  type CommandResponse,
  type CommandSseEvent,
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
   * by passing `account.id`.
   */
  publishCommand(
    boardId: string,
    action: Record<string, unknown>,
    actorId: string = "user-2",
  ): number {
    const board = this.boards.get(boardId);
    if (board === undefined) throw new Error(`Unknown board ${boardId}`);
    const scoped = { ...action, boardId } as BoardAction;
    const after =
      boardReducer([structuredClone(board)], scoped, {
        withActivity: false,
      })[0] ?? board;
    this.boards.set(boardId, after);
    const seq = (this.seq.get(boardId) ?? 0) + 1;
    this.seq.set(boardId, seq);
    const event: CommandSseEvent = {
      type: "command",
      seq,
      action: scoped,
      actorId,
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

  private route(
    method: string,
    path: string,
    body: unknown,
    searchParams: URLSearchParams,
  ): Response {
    if (this.nextRequestFailure !== null) {
      const failure = this.nextRequestFailure;
      this.nextRequestFailure = null;
      return json(failure.status, failure.body);
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
        [...this.boards.values()].map((board) => this.toSummary(board)),
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

    const eventsMatch = /^\/api\/v1\/boards\/([^/]+)\/events$/.exec(path);
    if (eventsMatch && method === "GET") {
      return this.events(
        eventsMatch[1],
        Number(searchParams.get("since") ?? 0),
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
        for (const event of backlog) controller.enqueue(encodeEvent(event));
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
  private command(boardId: string, request: CommandRequest): Response {
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
    const seq = currentVersion + 1;
    this.seq.set(boardId, seq);
    const response: CommandResponse = { seq, versions };
    this.commands.set(request.commandId, response);
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
function encodeEvent(event: CommandSseEvent): Uint8Array {
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
