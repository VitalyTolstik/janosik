/**
 * HTTP client for a Janosik instance. Two transports under one roof:
 *
 * - the **command log** (`POST /boards/:id/commands`) — every content change
 *   (columns, cards, labels, checklists, links) travels as a `BoardAction`,
 *   the same reducer action the UI dispatches, with the idempotency key and
 *   clock stamped here so tools never touch those details;
 * - the **REST surface** — boards, members, comments, attachments, shares,
 *   activity and the caller's own account.
 *
 * Auth is a personal API token (`Bearer jnk_…`), which every guarded route
 * accepts alongside a session JWT (TASK-36.1).
 */

import type {
  ActivityFeedPage,
  AgentRunDto,
  AgentSessionDto,
  AgentSessionHeartbeatRequest,
  ApprovalDecisionRequest,
  ApprovalListQuery,
  ApprovalRequestDto,
  AttachmentDto,
  AuthMeResponseDto,
  BoardAction,
  BoardAggregate,
  BoardCardSearchResult,
  BoardEnvelope,
  BoardMemberDto,
  BoardReadyDto,
  BoardRole,
  BoardShareDto,
  BoardSummary,
  BoardsReadyDto,
  CardClaimIntentResponse,
  CardContextDto,
  CardIntentResponse,
  CardMoveIntentResponse,
  ClaimCardIntentRequest,
  CommentDto,
  CommentKind,
  CommentPage,
  CommandBatchRequest,
  CommandBatchResponse,
  CommandRequest,
  CommandResponse,
  CreateAgentSessionRequest,
  CreateApprovalRequest,
  CreateShareRequest,
  EndAgentSessionRequest,
  InviteMemberRequest,
  MoveCardIntentRequest,
  PatchCardIntentRequest,
  PlanApplyRequest,
  PlanApplyResponse,
  PlanPreviewDto,
  PlanRequest,
  RevertPreviewDto,
  RunDetailDto,
  RunListQuery,
  UpdateMemberRequest,
  UpdateShareRequest,
} from "@janosik/shared";
import type { Board } from "@janosik/shared";
import {
  READY_WORK_LIMIT_DEFAULT,
  READY_WORK_LIMIT_MAX,
  READY_WORK_WAIT_MAX_MS,
} from "@janosik/shared";
import {
  API_PREFIX,
  COMMAND_RETRIES,
  COMMAND_RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
} from "./constants.js";
import {
  ApiError,
  NoChangeError,
  RATE_LIMIT_MAX_ATTEMPTS,
  isRateLimited,
  isTransientNetworkError,
  parseRetryAfter,
  rateLimitDelayMs,
} from "./errors.js";
import { newCommandId, newIdempotencyKey } from "./ids.js";

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
   * TASK-166.5: the approval that authorizes this exact plan. Sent as
   * `X-Approval-Id`; omit it and a destructive call answers
   * `409 approval_required` with the created request id.
   */
  approvalId?: string;
  /**
   * TASK-166.4: optional REST-level `Idempotency-Key`. Honoured by the
   * server for `duplicate_card`; other commands are already idempotent by
   * `commandId`.
   */
  idempotencyKey?: string;
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
  /**
   * TASK-166.5: approval for this batch. All items must name the same
   * approval; the header authorizes the whole batch.
   */
  approvalId?: string;
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
  /** Override the JSON request budget (long-polls hold up to 60 s). */
  timeoutMs?: number;
  /** Disable the one-shot network retry (a long-poll has its own deadline). */
  retry?: boolean;
  /**
   * Disable the generic 429/503 rate-limit retry so a caller with its own
   * deadline (a ready long-poll) can bound every pause against it.
   */
  rateLimitRetry?: boolean;
  /** TASK-166.5: send `X-Approval-Id` with a lifecycle REST operation. */
  approvalId?: string;
  /** Extra request headers (`Idempotency-Key`, TASK-166.4). */
  headers?: Record<string, string>;
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

/** Optional bounds for one ready/work long-poll request. */
export interface ReadyWorkQuery {
  /** Cards to return, 1–100 (default 30). */
  limit?: number;
  /** Server-side hold in ms, 0–60 000; 0 is a snapshot. */
  waitMs?: number;
  /** The board `seq` from the previous answer (long-poll cursor). */
  since?: number;
  /** HTTP budget for this call, when the caller has its own deadline. */
  timeoutMs?: number;
}

/** Extra budget on top of a server-side hold before the HTTP call fails. */
const READY_POLL_GRACE_MS = 10_000;

export class JanosikClient {
  /**
   * TASK-166: active agent sessions, keyed by board. A session belongs to one
   * board, so the header is only attached to that board's requests; starting
   * a session on board B must not invalidate the run already open on board A.
   */
  private readonly agentSessions = new Map<string, string>();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  /** The session attached to requests for `boardId`, if any. */
  agentSessionFor(boardId: string): string | null {
    return this.agentSessions.get(boardId) ?? null;
  }

  /**
   * Low-level request; throws {@link ApiError} on any non-2xx response.
   *
   * Two independent retry budgets:
   * - a GET that fails on the network is retried once (reads are safe to
   *   repeat); a write only when it carries an `Idempotency-Key`, so the
   *   server replays the first result instead of applying the body twice;
   * - TASK-200.3: a `429`/`503 rate_limited` is retried up to
   *   {@link RATE_LIMIT_MAX_ATTEMPTS} in total, honouring `Retry-After` and
   *   adding jittered exponential backoff. A rate-limit refusal happens before
   *   the handler, so repeating the same body is safe even for an unkeyed
   *   write; command bodies additionally keep their `commandId`.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const keyedWrite =
      options.headers?.["Idempotency-Key"] !== undefined &&
      (options.method ?? "GET") !== "GET";
    const networkAttempts =
      options.retry === false
        ? 1
        : (options.method ?? "GET") === "GET" || keyedWrite
          ? 2
          : 1;
    let networkAttempt = 0;
    let rateLimitAttempt = 0;
    for (;;) {
      try {
        return await this.send<T>(path, options);
      } catch (error) {
        if (
          options.rateLimitRetry !== false &&
          isRateLimited(error) &&
          rateLimitAttempt < RATE_LIMIT_MAX_ATTEMPTS - 1
        ) {
          rateLimitAttempt += 1;
          await pause(rateLimitDelayMs(error, rateLimitAttempt));
          continue;
        }
        const retryable =
          isTransientNetworkError(error) ||
          // A gateway timeout/response loss after the write reached the
          // server: safe only because the same Idempotency-Key is resent.
          (keyedWrite &&
            error instanceof ApiError &&
            (error.status === 502 || error.status === 504));
        networkAttempt += 1;
        if (networkAttempt >= networkAttempts || !retryable) throw error;
      }
    }
  }

  private async send<T>(path: string, options: RequestOptions): Promise<T> {
    const {
      method = "GET",
      body,
      query,
      form,
      raw,
      timeoutMs,
      approvalId,
      headers: extra,
    } = options;
    const url = `${this.baseUrl}${API_PREFIX}${path}${buildQuery(query)}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      ...extra,
    };
    if (approvalId !== undefined) headers["X-Approval-Id"] = approvalId;
    let boardId = boardIdOfPath(path);
    // Card/comment/attachment IDs do not encode their board. Resolve it via
    // the server's access guard whenever sessions exist; never guess from a
    // different open board or silently drop a session on lookup failure.
    if (boardId === null && method !== "GET" && this.agentSessions.size > 0) {
      const match =
        /^\/(cards|comments|attachments)\/([^/]+)(?:\/comments|\/attachments)?$/.exec(
          path,
        );
      if (match) {
        const context = await this.request<{ boardId: string }>(
          `/${match[1]}/${match[2]}/board-context`,
        );
        if (typeof context.boardId !== "string" || context.boardId === "") {
          throw new Error(
            "The server did not resolve the resource's board context",
          );
        }
        boardId = context.boardId;
      }
    }
    const agentSessionId =
      boardId === null ? undefined : this.agentSessions.get(boardId);
    if (agentSessionId !== undefined) {
      headers["X-Agent-Session"] = agentSessionId;
    }
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
      timeoutMs ?? (form || raw ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
    );
    const response = await fetch(url, {
      method,
      headers,
      body: payload,
      signal,
    });

    if (!response.ok) {
      throw new ApiError(
        response.status,
        await readBody(response),
        parseRetryAfter(response.headers.get("retry-after")),
      );
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
      opts.approvalId,
      opts.idempotencyKey,
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
   * Returns the batch run id and one {@link CommandResponse} per command, in order. A command
   * whose `commandId` was already applied returns its stored result. No
   * {@link NoChangeError} is raised: a batched field that is already set is
   * not a failure.
   */
  async commandBatch(
    boardId: string,
    items: BatchCommandItem[],
  ): Promise<CommandBatchResponse> {
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
    const approvalId = items.find(
      (item) => item.approvalId !== undefined,
    )?.approvalId;
    return this.sendCommand<CommandBatchResponse>(
      apiPath`/boards/${boardId}/commands/batch`,
      request,
      approvalId,
    );
  }

  // --- Targeted card intents (TASK-200.7) -------------------------------

  /**
   * One card's small context: the card, its column/index, column names, done
   * columns, workflow and current versions. Never a board aggregate, so a
   * move can run its Definition-of-Done check and an update can compare the
   * description without downloading every card.
   */
  getCardContext(boardId: string, cardId: string): Promise<CardContextDto> {
    return this.request(apiPath`/boards/${boardId}/cards/${cardId}/context`);
  }

  /** Claim or release a card without reading the board. */
  async claimCard(
    boardId: string,
    cardId: string,
    body: ClaimCardIntentRequest = {},
    approvalId?: string,
  ): Promise<CardClaimIntentResponse> {
    const response = await this.sendCommand<CardClaimIntentResponse>(
      apiPath`/boards/${boardId}/cards/${cardId}/claim`,
      body,
      approvalId,
    );
    assertIntentChanged(response, "CLAIM_CARD");
    return response;
  }

  /** Move a card; the server resolves the source column and both indexes. */
  async moveCard(
    boardId: string,
    cardId: string,
    body: MoveCardIntentRequest = {},
    approvalId?: string,
  ): Promise<CardMoveIntentResponse> {
    const response = await this.sendCommand<CardMoveIntentResponse>(
      apiPath`/boards/${boardId}/cards/${cardId}/move`,
      body,
      approvalId,
    );
    assertIntentChanged(response, "MOVE_CARD");
    return response;
  }

  /** Patch the card's title/description with `UPDATE_CARD` semantics. */
  async patchCard(
    boardId: string,
    cardId: string,
    body: PatchCardIntentRequest,
    approvalId?: string,
  ): Promise<CardIntentResponse> {
    const response = await this.sendCommand<CardIntentResponse>(
      apiPath`/boards/${boardId}/cards/${cardId}`,
      body,
      approvalId,
      undefined,
      "PATCH",
    );
    assertIntentChanged(response, "UPDATE_CARD");
    return response;
  }

  /**
   * POST/PATCH a command body with the shared retry policy. The body is built
   * once by the caller, so a network failure or timeout is retried with the
   * *same* `commandId`s — if the first attempt did commit, the server answers
   * the retry with the stored results instead of applying it twice.
   */
  private async sendCommand<T>(
    path: string,
    body: unknown,
    approvalId?: string,
    idempotencyKey?: string,
    method: "POST" | "PATCH" = "POST",
  ): Promise<T> {
    const headers = idempotencyHeaders(idempotencyKey);
    let networkAttempt = 0;
    let rateLimitAttempt = 0;
    for (;;) {
      try {
        return await this.send<T>(path, {
          method,
          body,
          ...(approvalId !== undefined ? { approvalId } : {}),
          ...(headers !== undefined ? { headers } : {}),
        });
      } catch (error) {
        // TASK-200.3: a 429 / queued 503 rejected the command before it was
        // applied, so the same body (and its `commandId`) can be resent.
        if (
          isRateLimited(error) &&
          rateLimitAttempt < RATE_LIMIT_MAX_ATTEMPTS - 1
        ) {
          rateLimitAttempt += 1;
          await pause(rateLimitDelayMs(error, rateLimitAttempt));
          continue;
        }
        if (
          !isTransientNetworkError(error) ||
          networkAttempt >= COMMAND_RETRIES
        ) {
          throw error;
        }
        networkAttempt += 1;
        // Back off a little: a busy board needs a moment to drain.
        await pause(COMMAND_RETRY_DELAY_MS * networkAttempt);
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
    build: (board: Board) =>
      | {
          action?: CommandAction;
          result: R;
          approvalId?: string;
          commandId?: string;
        }
      | null
      | Promise<{
          action?: CommandAction;
          result: R;
          approvalId?: string;
          commandId?: string;
        } | null>,
    attempts = 3,
    expectedVersion?: number,
    prefetched?: { board: Board; seq: number },
  ): Promise<{ result: R; response?: CommandResponse } | null> {
    const maxAttempts = expectedVersion !== undefined ? 1 : attempts;
    for (let attempt = 1; ; attempt += 1) {
      const { board, seq } =
        attempt === 1 && prefetched
          ? prefetched
          : await this.getBoardWithSeq(boardId);
      const plan = await build(board);
      if (plan === null) return null;
      if (plan.action === undefined) return { result: plan.result };
      try {
        const response = await this.command(boardId, plan.action, {
          ifMatch: expectedVersion ?? seq,
          ...(plan.commandId !== undefined
            ? { commandId: plan.commandId }
            : {}),
          ...(plan.approvalId !== undefined
            ? { approvalId: plan.approvalId }
            : {}),
        });
        return { result: plan.result, response };
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

  createBoard(
    title: string,
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<BoardAggregate> {
    const headers = idempotencyHeaders(idempotencyKey);
    return this.request("/boards", {
      method: "POST",
      body: { title },
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  importBoards(
    envelope: BoardEnvelope,
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<BoardAggregate[]> {
    const headers = idempotencyHeaders(idempotencyKey);
    return this.request("/boards/import", {
      method: "POST",
      body: envelope,
      ...(headers !== undefined ? { headers } : {}),
    });
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
    const seqHeader = response.headers.get("x-board-seq");
    const seq =
      seqHeader !== null && /^\d+$/.test(seqHeader) ? Number(seqHeader) : NaN;
    if (!Number.isSafeInteger(seq)) {
      throw new Error(
        "The instance did not report the board's version (X-Board-Seq). " +
          "Upgrade the Janosik server.",
      );
    }
    return { board, seq };
  }

  /**
   * TASK-200.2 ready/work summary for one board. `waitMs > 0` holds the HTTP
   * request on the server until a relevant command or the timeout; a timeout
   * answers `204` and resolves to `undefined`. The request budget is the hold
   * plus a grace period, and the generic network retry is off so one tool
   * deadline never turns into two back-to-back holds.
   */
  getBoardReady(
    boardId: string,
    options: ReadyWorkQuery = {},
  ): Promise<BoardReadyDto | undefined> {
    const limit = Math.min(
      Math.max(1, Math.trunc(options.limit ?? READY_WORK_LIMIT_DEFAULT)),
      READY_WORK_LIMIT_MAX,
    );
    const wait = Math.min(
      Math.max(0, Math.trunc(options.waitMs ?? 0)),
      READY_WORK_WAIT_MAX_MS,
    );
    const timeoutMs =
      options.timeoutMs ?? (wait > 0 ? wait + READY_POLL_GRACE_MS : undefined);
    // A caller with its own deadline (a held poll, or an explicit HTTP budget
    // such as timeoutMs:0) owns every retry pause. A deadline-less list
    // snapshot keeps the normal GET network/429/503 retries.
    const callerDeadline = wait > 0 || options.timeoutMs !== undefined;
    return this.request<BoardReadyDto | undefined>(
      apiPath`/boards/${boardId}/ready`,
      {
        query: {
          limit,
          ...(wait > 0 ? { wait } : {}),
          ...(options.since !== undefined ? { since: options.since } : {}),
        },
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(callerDeadline ? { retry: false, rateLimitRetry: false } : {}),
      },
    );
  }

  /**
   * TASK-200.2 cross-board ready snapshot. One request answers for every
   * accessible board without the per-board fan-out `listBoards` + `getBoard`
   * used before. `retry`/`rateLimitRetry`/`timeoutMs` let a caller with a
   * deadline run its own bounded retry loop.
   */
  listReadyWork(
    limit: number = READY_WORK_LIMIT_DEFAULT,
    options: {
      retry?: boolean;
      rateLimitRetry?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<BoardsReadyDto> {
    const bounded = Math.min(
      Math.max(1, Math.trunc(limit)),
      READY_WORK_LIMIT_MAX,
    );
    return this.request<BoardsReadyDto>("/boards/ready", {
      query: { limit: bounded },
      ...(options.retry !== undefined ? { retry: options.retry } : {}),
      ...(options.rateLimitRetry !== undefined
        ? { rateLimitRetry: options.rateLimitRetry }
        : {}),
      ...(options.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
    });
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

  deleteBoard(id: string, approvalId?: string): Promise<{ status: "ok" }> {
    return this.request(apiPath`/boards/${id}`, {
      method: "DELETE",
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
  }

  // --- Members -----------------------------------------------------------

  listMembers(boardId: string): Promise<BoardMemberDto[]> {
    return this.request(apiPath`/boards/${boardId}/members`);
  }

  inviteMember(
    boardId: string,
    dto: InviteMemberRequest,
    approvalId?: string,
  ): Promise<BoardMemberDto> {
    return this.request(apiPath`/boards/${boardId}/members`, {
      method: "POST",
      body: dto,
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
  }

  updateMember(
    boardId: string,
    userId: string,
    dto: UpdateMemberRequest,
    approvalId?: string,
  ): Promise<BoardMemberDto> {
    return this.request(apiPath`/boards/${boardId}/members/${userId}`, {
      method: "PATCH",
      body: dto,
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
  }

  removeMember(
    boardId: string,
    userId: string,
    approvalId?: string,
  ): Promise<{ status: "ok" }> {
    return this.request(apiPath`/boards/${boardId}/members/${userId}`, {
      method: "DELETE",
      ...(approvalId !== undefined ? { approvalId } : {}),
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
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<CommentDto> {
    const headers = idempotencyHeaders(idempotencyKey);
    return this.request(apiPath`/cards/${cardId}/comments`, {
      method: "POST",
      body: { text, ...(kind ? { kind } : {}) },
      ...(headers !== undefined ? { headers } : {}),
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
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<AttachmentDto> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(data)], { type: mimeType }),
      fileName,
    );
    const headers = idempotencyHeaders(idempotencyKey);
    return this.request(apiPath`/cards/${cardId}/attachments`, {
      method: "POST",
      form,
      ...(headers !== undefined ? { headers } : {}),
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

  deleteAttachment(id: string, approvalId?: string): Promise<{ status: "ok" }> {
    return this.request(apiPath`/attachments/${id}`, {
      method: "DELETE",
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
  }

  // --- Shares ------------------------------------------------------------

  listShares(boardId: string): Promise<BoardShareDto[]> {
    return this.request(apiPath`/boards/${boardId}/shares`);
  }

  createShare(
    boardId: string,
    dto: CreateShareRequest,
    approvalId?: string,
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<BoardShareDto> {
    const headers = idempotencyHeaders(idempotencyKey);
    return this.request(apiPath`/boards/${boardId}/shares`, {
      method: "POST",
      body: dto,
      ...(approvalId !== undefined ? { approvalId } : {}),
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  updateShare(
    boardId: string,
    shareId: string,
    dto: UpdateShareRequest,
    approvalId?: string,
  ): Promise<BoardShareDto> {
    return this.request(apiPath`/boards/${boardId}/shares/${shareId}`, {
      method: "PATCH",
      body: dto,
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
  }

  refreshShare(boardId: string, shareId: string): Promise<BoardShareDto> {
    return this.request(apiPath`/boards/${boardId}/shares/${shareId}/refresh`, {
      method: "POST",
    });
  }

  revokeShare(
    boardId: string,
    shareId: string,
    approvalId?: string,
  ): Promise<BoardShareDto> {
    return this.request(apiPath`/boards/${boardId}/shares/${shareId}`, {
      method: "DELETE",
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
  }

  // --- Agent sessions (TASK-166.1) --------------------------------------

  /** Start a session and attach it to later requests for this board only. */
  async startSession(
    boardId: string,
    body: CreateAgentSessionRequest = {},
  ): Promise<AgentSessionDto> {
    // Keep the previous board session if this request fails; replace it only
    // after the server accepted the start.
    const session = await this.request<AgentSessionDto>(
      apiPath`/boards/${boardId}/agent-sessions`,
      { method: "POST", body },
    );
    this.agentSessions.set(boardId, session.id);
    return session;
  }

  heartbeat(
    boardId: string,
    sessionId: string,
    body: AgentSessionHeartbeatRequest = {},
  ): Promise<AgentSessionDto> {
    return this.request(
      apiPath`/boards/${boardId}/agent-sessions/${sessionId}/heartbeat`,
      { method: "POST", body },
    );
  }

  /** End a session; a successful end detaches it from that board. */
  async endSession(
    boardId: string,
    sessionId: string,
    body: EndAgentSessionRequest = {},
  ): Promise<AgentSessionDto> {
    const session = await this.request<AgentSessionDto>(
      apiPath`/boards/${boardId}/agent-sessions/${sessionId}/end`,
      { method: "POST", body },
    );
    if (this.agentSessions.get(boardId) === session.id) {
      this.agentSessions.delete(boardId);
    }
    return session;
  }

  // --- Approvals (TASK-166.5) --------------------------------------------

  requestApproval(
    boardId: string,
    body: CreateApprovalRequest,
  ): Promise<ApprovalRequestDto> {
    return this.request(apiPath`/boards/${boardId}/approvals`, {
      method: "POST",
      body,
    });
  }

  listApprovals(
    boardId: string,
    query: ApprovalListQuery = {},
  ): Promise<ApprovalRequestDto[]> {
    return this.request(apiPath`/boards/${boardId}/approvals`, {
      query: {
        status: query.status,
        kind: query.kind,
        cardId: query.cardId,
        limit: query.limit,
      },
    });
  }

  getApproval(
    boardId: string,
    approvalId: string,
  ): Promise<ApprovalRequestDto> {
    return this.request(apiPath`/boards/${boardId}/approvals/${approvalId}`);
  }

  cancelApproval(
    boardId: string,
    approvalId: string,
  ): Promise<ApprovalRequestDto> {
    return this.request(
      apiPath`/boards/${boardId}/approvals/${approvalId}/cancel`,
      { method: "POST" },
    );
  }

  /**
   * Session-only on the server. Kept on the client for completeness (a
   * future browser-backed transport), but the MCP tool is not registered:
   * an agent must never approve its own request.
   */
  decideApproval(
    boardId: string,
    approvalId: string,
    body: ApprovalDecisionRequest,
  ): Promise<ApprovalRequestDto> {
    return this.request(
      apiPath`/boards/${boardId}/approvals/${approvalId}/decision`,
      { method: "POST", body },
    );
  }

  // --- Runs (TASK-166.7) -------------------------------------------------

  listRuns(boardId: string, query: RunListQuery = {}): Promise<AgentRunDto[]> {
    return this.request(apiPath`/boards/${boardId}/runs`, {
      query: {
        status: query.status,
        kind: query.kind,
        apiTokenId: query.apiTokenId,
        agentSessionId: query.agentSessionId,
        clientRunId: query.clientRunId,
        limit: query.limit,
        cursor: query.cursor,
      },
    });
  }

  getRun(boardId: string, runId: string): Promise<RunDetailDto> {
    return this.request(apiPath`/boards/${boardId}/runs/${runId}`);
  }

  /**
   * Dry-run only: applying a rollback is human-only on the server (D17), so
   * the MCP client deliberately exposes no revert method.
   */
  previewRunRevert(boardId: string, runId: string): Promise<RevertPreviewDto> {
    return this.request(
      apiPath`/boards/${boardId}/runs/${runId}/revert/preview`,
      { method: "POST", body: {} },
    );
  }

  // --- Plans (TASK-166.8) ------------------------------------------------

  /**
   * Dry-run a plan: the server validates the commands, replays the reducer
   * and returns the canonical `planHash`, diff, warnings and conflicts.
   * Writes nothing.
   */
  planChanges(boardId: string, body: PlanRequest): Promise<PlanPreviewDto> {
    return this.request(apiPath`/boards/${boardId}/plans`, {
      method: "POST",
      body,
    });
  }

  /**
   * Apply the exact commands from a preview. The body is passed through
   * unchanged (no `at`/`boardId` stamping) so the server recomputes the same
   * `planHash`; a retry after a timeout reuses the same `commandId`s.
   */
  applyPlan(
    boardId: string,
    body: PlanApplyRequest,
    approvalId?: string,
  ): Promise<PlanApplyResponse> {
    return this.sendCommand<PlanApplyResponse>(
      apiPath`/boards/${boardId}/plans/apply`,
      body,
      approvalId,
    );
  }

  // --- Account -----------------------------------------------------------

  whoami(): Promise<AuthMeResponseDto> {
    return this.request("/auth/me");
  }
}

/**
 * Extract the board id from an API path (`/boards/:id/...`) so an agent
 * session is attached only to the board it belongs to. Returns null for
 * non-board routes (`/auth/me`, `/users/...`).
 */
function boardIdOfPath(path: string): string | null {
  const match = /^\/boards\/([^/]+)(?:\/|$)/.exec(path);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * TASK-200.7: a targeted intent that applied no change (same position, same
 * description, a lapsed claim already clear) is an error, exactly like the
 * command-log path. A stored replay carries its original `versions`.
 */
function assertIntentChanged(
  response: { versions: Record<string, number> },
  actionType: string,
): void {
  if (Object.keys(response.versions).length === 0) {
    throw new NoChangeError(actionType);
  }
}

/** Extra headers for a REST idempotent write, or `undefined` when absent. */
function idempotencyHeaders(
  key: string | undefined,
): Record<string, string> | undefined {
  return key !== undefined && key !== ""
    ? { "Idempotency-Key": key }
    : undefined;
}

/** Sleep helper shared by the retry policies. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
