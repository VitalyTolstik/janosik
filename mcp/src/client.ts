/**
 * HTTP client for a Janosik instance. Two transports under one roof:
 *
 * - the **command log** (`POST /boards/:id/commands`) — every content change
 *   (columns, cards, labels, checklists, links) travels as a `BoardAction`,
 *   the same reducer action the UI dispatches, with the idempotency key and
 *   clock stamped here so tools never touch those details;
 * - the **REST surface** — boards, members, comments, attachments, shares,
 *   activity, invitations and the caller's own account.
 *
 * Auth is a personal API token (`Bearer jnk_…`), which every guarded route
 * accepts alongside a session JWT (TASK-36.1).
 */

import type {
  ActivityFeedPage,
  AttachmentDto,
  AuthUserDto,
  BoardAction,
  BoardAggregate,
  BoardCardSearchResult,
  BoardEnvelope,
  BoardInvitationDto,
  BoardMemberDto,
  BoardRole,
  BoardShareDto,
  BoardSummary,
  CommentDto,
  CommentKind,
  CommentPage,
  CommandBatchRequest,
  CommandBatchResponse,
  CommandRequest,
  CommandResponse,
  CreateShareRequest,
  CreateUserTokenRequest,
  CreateUserTokenResponse,
  InviteMemberRequest,
  UpdateMemberRequest,
  UpdateProfileRequest,
  UpdateShareRequest,
  UserTokenDto,
} from "@janosik/shared";
import type { Board } from "@janosik/shared";
import {
  API_PREFIX,
  COMMAND_RETRIES,
  COMMAND_RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
} from "./constants.js";
import { ApiError, NoChangeError, isTransientNetworkError } from "./errors.js";
import { newCommandId } from "./ids.js";

/** `Omit` that distributes over a union, so each action keeps its own shape. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * A reducer action as the tools build it: `at` and `boardId` are stamped
 * here. Typed against the shared `BoardAction` union, so a tool that sends a
 * misspelt or missing field fails to compile instead of failing at the API.
 */
export type CommandAction = DistributiveOmit<BoardAction, "at" | "boardId">;

/** Optimistic-concurrency preconditions a command may carry. */
export interface CommandOptions {
  ifMatch?: number;
  ifMatchVersions?: Record<string, number>;
  /**
   * Pin the idempotency key (TASK-157, E14). A create tool passes the
   * client-supplied entity id here, so re-issuing the same call (an agent
   * retry) reuses the key and the server returns the first result instead of
   * minting a duplicate.
   */
  commandId?: string;
  /**
   * Accept a command the server applied as a no-op. By default an empty
   * `versions` map (nothing changed: an unknown id, or the value was already
   * set) is reported as a {@link NoChangeError}, so an agent never reads
   * "done" for a write that did nothing.
   */
  allowNoChange?: boolean;
}

/**
 * One command of a batch (TASK-160): the action plus its own preconditions.
 * A batch shares one board lock and one aggregate load, so a create and its
 * follow-up field commands travel together in one round-trip. Preconditions
 * are checked at each command's own point in the batch — pin the board
 * version on the *first* command only.
 */
export interface BatchCommandItem {
  action: CommandAction;
  ifMatch?: number;
  ifMatchVersions?: Record<string, number>;
  /**
   * Pin this command's idempotency key. A create tool passes the
   * client-supplied entity id here, so a retried batch reuses the key and the
   * server returns the first result instead of minting a duplicate.
   */
  commandId?: string;
}

/**
 * Tagged template for API paths: every interpolated value is a single,
 * percent-encoded path segment. An id such as `../boards/x?` can then never
 * re-target a request to another route.
 */
export function apiPath(
  strings: TemplateStringsArray,
  ...values: Array<string | number>
): string {
  return strings.reduce(
    (out, part, index) =>
      index < values.length
        ? out + part + encodeURIComponent(String(values[index]))
        : out + part,
    "",
  );
}

/** One downloaded attachment blob. */
export interface DownloadedFile {
  bytes: Buffer;
  contentType: string;
  fileName: string | null;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Send `body` as `multipart/form-data` (used by attachment upload). */
  form?: FormData;
  /** Return the raw response instead of parsed JSON (used by download). */
  raw?: boolean;
}

function buildQuery(query?: Record<string, string | number | undefined>) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export class JanosikClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  /**
   * Low-level request; throws {@link ApiError} on any non-2xx response. A
   * GET that fails on the network is retried once — reads are safe to repeat.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const attempts = (options.method ?? "GET") === "GET" ? 2 : 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.send<T>(path, options);
      } catch (error) {
        if (attempt >= attempts || !isTransientNetworkError(error)) throw error;
      }
    }
  }

  private async send<T>(path: string, options: RequestOptions): Promise<T> {
    const { method = "GET", body, query, form, raw } = options;
    const url = `${this.baseUrl}${API_PREFIX}${path}${buildQuery(query)}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    let payload: string | FormData | undefined;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    // A hung instance must not hang the tool call (and the agent) forever.
    // Blob transfers (upload, download) get a longer budget than JSON calls.
    const signal = AbortSignal.timeout(
      form || raw ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    );
    const response = await fetch(url, {
      method,
      headers,
      body: payload,
      signal,
    });

    if (!response.ok) {
      throw new ApiError(response.status, await readBody(response));
    }
    if (raw) {
      return response as unknown as T;
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // --- Command log -------------------------------------------------------

  /**
   * Apply one `BoardAction`. Stamps the board id, the command clock (`at`) and
   * an idempotency key; passes `ifMatch`/`ifMatchVersions` through when a
   * caller wants optimistic-concurrency checking.
   *
   * The request is built once, so a network failure or timeout is retried
   * with the *same* `commandId`: if the first attempt did commit, the server
   * answers the retry with the stored result instead of applying it twice.
   */
  async command(
    boardId: string,
    action: CommandAction,
    opts: CommandOptions = {},
  ): Promise<CommandResponse> {
    const request: CommandRequest = {
      commandId: opts.commandId ?? newCommandId(),
      action: { ...action, boardId, at: Date.now() } as BoardAction,
      ...(opts.ifMatch !== undefined ? { ifMatch: opts.ifMatch } : {}),
      ...(opts.ifMatchVersions
        ? { ifMatchVersions: opts.ifMatchVersions }
        : {}),
    };
    const response = await this.sendCommand<CommandResponse>(
      apiPath`/boards/${boardId}/commands`,
      request,
    );
    // A committed change always bumps the board version, so an empty map
    // means the reducer found nothing to do.
    if (!opts.allowNoChange && Object.keys(response.versions).length === 0) {
      throw new NoChangeError(action.type);
    }
    return response;
  }

  /**
   * Apply several commands to one board in a single request (TASK-160). The
   * server runs them in one transaction under the board's write lock, so a
   * create plus its field commands cost one round-trip and one lock instead
   * of one per command. All-or-nothing: a failure on any command rolls the
   * whole batch back, so a retry after a failure cannot leave a half-made
   * entity behind.
   *
   * Returns one {@link CommandResponse} per command, in order. A command
   * whose `commandId` was already applied returns its stored result. No
   * {@link NoChangeError} is raised: a batched field that is already set is
   * not a failure.
   */
  async commandBatch(
    boardId: string,
    items: BatchCommandItem[],
  ): Promise<CommandResponse[]> {
    const request: CommandBatchRequest = {
      commands: items.map((item) => ({
        commandId: item.commandId ?? newCommandId(),
        action: { ...item.action, boardId, at: Date.now() } as BoardAction,
        ...(item.ifMatch !== undefined ? { ifMatch: item.ifMatch } : {}),
        ...(item.ifMatchVersions
          ? { ifMatchVersions: item.ifMatchVersions }
          : {}),
      })),
    };
    const response = await this.sendCommand<CommandBatchResponse>(
      apiPath`/boards/${boardId}/commands/batch`,
      request,
    );
    return response.results;
  }

  /**
   * POST a command body with the shared retry policy. The body is built once
   * by the caller, so a network failure or timeout is retried with the *same*
   * `commandId`s — if the first attempt did commit, the server answers the
   * retry with the stored results instead of applying it twice.
   */
  private async sendCommand<T>(path: string, body: unknown): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.send<T>(path, { method: "POST", body });
      } catch (error) {
        if (attempt >= COMMAND_RETRIES || !isTransientNetworkError(error)) {
          throw error;
        }
        // Back off a little: a busy board needs a moment to drain.
        await new Promise((resolve) =>
          setTimeout(resolve, COMMAND_RETRY_DELAY_MS * (attempt + 1)),
        );
      }
    }
  }

  /**
   * Read a board, build a command from that read and send it with
   * `ifMatch` = the read's seq, so the write applies only to the state it was
   * computed from. A concurrent writer answers `409 version`; the board is
   * then re-read and the command rebuilt, up to `attempts` times.
   *
   * `build` returns `null` when the read shows the command cannot apply (an
   * unknown card or column), or a plan without an `action` to stop with a
   * result and send nothing (a failed compare-and-set).
   *
   * `expectedVersion` (TASK-157, D9) pins the write to a board version the
   * caller saw: when set, the command carries it as `ifMatch` and is sent
   * exactly once — a mismatch is a version conflict the caller must resolve
   * by re-reading, not a retry.
   *
   * `prefetched` (TASK-154) lets a caller that already read the board hand
   * that snapshot in: the first attempt then reuses it instead of issuing
   * another `GET`. A version conflict still re-reads, so correctness is
   * unchanged — only the common (no-conflict) path loses one round-trip.
   */
  async commandOnFreshBoard<R>(
    boardId: string,
    build: (board: Board) => { action?: CommandAction; result: R } | null,
    attempts = 3,
    expectedVersion?: number,
    prefetched?: { board: Board; seq: number },
  ): Promise<R | null> {
    const maxAttempts = expectedVersion !== undefined ? 1 : attempts;
    for (let attempt = 1; ; attempt += 1) {
      const { board, seq } =
        attempt === 1 && prefetched
          ? prefetched
          : await this.getBoardWithSeq(boardId);
      const plan = build(board);
      if (plan === null) return null;
      if (plan.action === undefined) return plan.result;
      try {
        await this.command(boardId, plan.action, {
          ifMatch: expectedVersion ?? seq,
        });
        return plan.result;
      } catch (error) {
        const stale =
          error instanceof ApiError &&
          error.status === 409 &&
          (error.body as { conflict?: string } | undefined)?.conflict ===
            "version";
        if (!stale || attempt >= maxAttempts) throw error;
      }
    }
  }

  // --- Boards ------------------------------------------------------------

  listBoards(): Promise<BoardSummary[]> {
    return this.request("/boards");
  }

  createBoard(title: string): Promise<BoardAggregate> {
    return this.request("/boards", { method: "POST", body: { title } });
  }

  importBoards(envelope: BoardEnvelope): Promise<BoardAggregate[]> {
    return this.request("/boards/import", { method: "POST", body: envelope });
  }

  getBoard(id: string): Promise<BoardAggregate> {
    return this.request(apiPath`/boards/${id}`);
  }

  /** The board plus the command `seq` it reflects (`X-Board-Seq`). */
  async getBoardWithSeq(
    id: string,
  ): Promise<{ board: BoardAggregate; seq: number }> {
    const response = await this.request<Response>(apiPath`/boards/${id}`, {
      raw: true,
    });
    const board = (await response.json()) as BoardAggregate;
    const seq = Number(response.headers.get("x-board-seq"));
    if (!Number.isInteger(seq)) {
      throw new Error(
        "The instance did not report the board's version (X-Board-Seq). " +
          "Upgrade the Janosik server.",
      );
    }
    return { board, seq };
  }

  /**
   * Card ids on a board whose title, description, a checklist item or a
   * comment contains `query` (TASK-157, D11) — the only way to reach comment
   * text, which is not part of the board aggregate.
   */
  searchBoardCards(
    boardId: string,
    query: string,
  ): Promise<BoardCardSearchResult> {
    return this.request(apiPath`/boards/${boardId}/search`, {
      query: { q: query },
    });
  }

  exportBoard(id: string): Promise<BoardEnvelope> {
    return this.request(apiPath`/boards/${id}/export`);
  }

  deleteBoard(id: string): Promise<{ status: "ok" }> {
    return this.request(apiPath`/boards/${id}`, { method: "DELETE" });
  }

  // --- Members & invitations --------------------------------------------

  listMembers(boardId: string): Promise<BoardMemberDto[]> {
    return this.request(apiPath`/boards/${boardId}/members`);
  }

  inviteMember(
    boardId: string,
    dto: InviteMemberRequest,
  ): Promise<BoardMemberDto> {
    return this.request(apiPath`/boards/${boardId}/members`, {
      method: "POST",
      body: dto,
    });
  }

  updateMember(
    boardId: string,
    userId: string,
    dto: UpdateMemberRequest,
  ): Promise<BoardMemberDto> {
    return this.request(apiPath`/boards/${boardId}/members/${userId}`, {
      method: "PATCH",
      body: dto,
    });
  }

  removeMember(boardId: string, userId: string): Promise<{ status: "ok" }> {
    return this.request(apiPath`/boards/${boardId}/members/${userId}`, {
      method: "DELETE",
    });
  }

  listInvitations(): Promise<BoardInvitationDto[]> {
    return this.request("/invitations");
  }

  // Both accept and decline answer `200` with an empty body (the backend
  // returns `void`), so the result is intentionally ignored.
  acceptInvitation(id: string): Promise<void> {
    return this.request(apiPath`/invitations/${id}/accept`, { method: "POST" });
  }

  declineInvitation(id: string): Promise<void> {
    return this.request(apiPath`/invitations/${id}/decline`, {
      method: "POST",
    });
  }

  // --- Comments ----------------------------------------------------------

  listComments(
    cardId: string,
    cursor?: string,
    limit?: number,
    kind?: CommentKind,
  ): Promise<CommentPage> {
    return this.request(apiPath`/cards/${cardId}/comments`, {
      query: { cursor, limit, kind },
    });
  }

  addComment(
    cardId: string,
    text: string,
    kind?: CommentKind,
  ): Promise<CommentDto> {
    return this.request(apiPath`/cards/${cardId}/comments`, {
      method: "POST",
      body: { text, ...(kind ? { kind } : {}) },
    });
  }

  deleteComment(commentId: string): Promise<{ status: "ok" }> {
    return this.request(apiPath`/comments/${commentId}`, { method: "DELETE" });
  }

  // --- Activity ----------------------------------------------------------

  boardActivity(
    boardId: string,
    cursor?: string,
    limit?: number,
  ): Promise<ActivityFeedPage> {
    return this.request(apiPath`/boards/${boardId}/activity`, {
      query: { cursor, limit },
    });
  }

  cardActivity(
    cardId: string,
    cursor?: string,
    limit?: number,
  ): Promise<ActivityFeedPage> {
    return this.request(apiPath`/cards/${cardId}/activity`, {
      query: { cursor, limit },
    });
  }

  // --- Attachments -------------------------------------------------------

  listAttachments(cardId: string): Promise<AttachmentDto[]> {
    return this.request(apiPath`/cards/${cardId}/attachments`);
  }

  async uploadAttachment(
    cardId: string,
    fileName: string,
    mimeType: string,
    data: Buffer,
  ): Promise<AttachmentDto> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(data)], { type: mimeType }),
      fileName,
    );
    return this.request(apiPath`/cards/${cardId}/attachments`, {
      method: "POST",
      form,
    });
  }

  async downloadAttachment(id: string): Promise<DownloadedFile> {
    const response = await this.request<Response>(
      apiPath`/attachments/${id}/content`,
      { raw: true },
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      bytes: buffer,
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      fileName: parseFileName(response.headers.get("content-disposition")),
    };
  }

  deleteAttachment(id: string): Promise<{ status: "ok" }> {
    return this.request(apiPath`/attachments/${id}`, { method: "DELETE" });
  }

  // --- Shares ------------------------------------------------------------

  listShares(boardId: string): Promise<BoardShareDto[]> {
    return this.request(apiPath`/boards/${boardId}/shares`);
  }

  createShare(
    boardId: string,
    dto: CreateShareRequest,
  ): Promise<BoardShareDto> {
    return this.request(apiPath`/boards/${boardId}/shares`, {
      method: "POST",
      body: dto,
    });
  }

  updateShare(
    boardId: string,
    shareId: string,
    dto: UpdateShareRequest,
  ): Promise<BoardShareDto> {
    return this.request(apiPath`/boards/${boardId}/shares/${shareId}`, {
      method: "PATCH",
      body: dto,
    });
  }

  refreshShare(boardId: string, shareId: string): Promise<BoardShareDto> {
    return this.request(apiPath`/boards/${boardId}/shares/${shareId}/refresh`, {
      method: "POST",
    });
  }

  revokeShare(boardId: string, shareId: string): Promise<BoardShareDto> {
    return this.request(apiPath`/boards/${boardId}/shares/${shareId}`, {
      method: "DELETE",
    });
  }

  // --- Account -----------------------------------------------------------

  whoami(): Promise<AuthUserDto> {
    return this.request("/auth/me");
  }

  updateProfile(dto: UpdateProfileRequest): Promise<AuthUserDto> {
    return this.request("/users/me", { method: "PATCH", body: dto });
  }

  listTokens(): Promise<UserTokenDto[]> {
    return this.request("/users/me/tokens");
  }

  createToken(dto: CreateUserTokenRequest): Promise<CreateUserTokenResponse> {
    return this.request("/users/me/tokens", { method: "POST", body: dto });
  }

  revokeToken(id: string): Promise<{ status: "ok" }> {
    return this.request(apiPath`/users/me/tokens/${id}`, { method: "DELETE" });
  }
}

/** Read a JSON error body, tolerating an empty or non-JSON response. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Pull the filename out of a `Content-Disposition` header, if present. */
function parseFileName(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

/** Board role values, re-exported for tool schemas. */
export type { BoardRole };
