import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Observable } from "rxjs";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import {
  applyRateLimitHeaders,
  consumeBoardRateLimit,
  consumeRateLimit,
  mirrorStandardRateLimitHeaders,
  rateLimitException,
  rateLimitQueueException,
  type RateLimitDecision,
  type RateLimitedRequest,
} from "./rate-limit";
import {
  agentCommandQueueMs,
  agentSessionRateLimit,
  agentTokenRateLimit,
  boardRateLimit,
} from "@/config/rate-limit";
import {
  BoardCommandQueueAbortedError,
  BoardCommandQueueFullError,
  boardCommandQueueFullCount,
  enqueueBoardCommand,
  waitForBoardRateLimit,
  type BoardRateLimitWait,
} from "./board-rate-limit";
import { commandBodyBytes, commandRateLimitCost } from "./command-cost";

/** The request bits this interceptor reads after the guards have run. */
interface LimitedRequest extends Request, RateLimitedRequest {
  auth?: AuthPrincipal;
  agentSession?: AgentSessionContext;
  rateLimitSessionId?: string;
  boardMembership?: { boardId?: string };
}

/** A queue-full storm must not write one warn line per rejected command. */
const QUEUE_FULL_WARN_INTERVAL_MS = 10_000;

/**
 * TASK-166.10: agent-facing rate limits beyond the global per-principal
 * bucket.
 *
 * Runs after the route guards, so `req.auth`, the resolved agent session and
 * the board membership are all available without another DB read. It applies
 * two buckets to agent (PAT) traffic:
 *
 * - **session** — `agentSessionRateLimit()` per `agentSessionId`, so one
 *   runaway agent session cannot burn a whole board's budget;
 * - **board** — `boardRateLimit()` per `boardId`, shared by every PAT working
 *   on that board, so one noisy board cannot starve the node.
 *
 * Browser sessions deliberately keep the legacy per-user/IP throttler only:
 * the ADR promises that existing browser traffic is unchanged. The token's
 * own explicit `rateLimitPerMinute` is consumed earlier in `JwtAuthGuard`
 * (before scope checks); this interceptor never re-counts it. TASK-200.3 adds
 * a default token bucket for keys that carry no explicit limit, so raising the
 * global limit for a swarm does not let one key consume the whole board.
 *
 * The board bucket is a safety ceiling, not the per-agent budget. A command
 * over it waits briefly in a per-board FIFO queue (the bucket refills
 * continuously) and only then answers `503 rate_limited` with a real
 * `Retry-After`; other requests keep the immediate `429`.
 */
@Injectable()
export class AgentRateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AgentRateLimitInterceptor.name);
  private lastQueueFullWarnAt = 0;

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<LimitedRequest>();
    const response = http.getResponse<Response>();
    // The global throttler writes only `X-RateLimit-*`; mirror it so every
    // authenticated response also carries the standard names.
    mirrorStandardRateLimitHeaders(response);
    // A PAT is the only caller that gets agent buckets. Anonymous/public and
    // browser requests keep exactly the legacy global throttle.
    if (request.auth?.via !== "pat") return next.handle();
    let applied: RateLimitDecision | undefined;
    // TASK-200.3: one batch/plan request executes up to 100 commands, so the
    // agent budgets are charged by that work, not by the HTTP round-trip.
    const cost = commandRateLimitCost(request);

    const consume = (
      scope: "token" | "session",
      key: string,
      limit: number,
      message: string,
      weight: number = 1,
    ): void => {
      const decision = consumeRateLimit(
        scope,
        key,
        limit,
        undefined,
        undefined,
        weight,
      );
      request.rateLimit = decision;
      if (!decision.allowed) {
        request.rateLimited = true;
        applyRateLimitHeaders(response, decision);
        throw rateLimitException(decision, message);
      }
      // The response names the tightest bucket that actually counted.
      if (applied === undefined || decision.remaining < applied.remaining) {
        applied = decision;
      }
    };

    // TASK-200.3: an explicit per-token budget is consumed by `JwtAuthGuard`
    // with the same command cost, capped by the derived share. Only keys
    // without an explicit limit get their token bucket here.
    const tokenId = request.auth.apiTokenId;
    const explicitTokenLimit = request.auth.tokenScope?.rateLimitPerMinute;
    if (tokenId !== undefined && explicitTokenLimit == null) {
      consume(
        "token",
        tokenId,
        agentTokenRateLimit(),
        "Too many requests for this API token",
        cost,
      );
    }
    const sessionId = agentSessionIdOf(request);
    if (sessionId !== undefined) {
      consume(
        "session",
        sessionId,
        agentSessionRateLimit(),
        "Too many requests for this agent session",
        cost,
      );
    }
    const boardId = boardIdOf(request);
    if (boardId !== undefined) {
      const limit = boardRateLimit();
      const decision = consumeBoardRateLimit(
        boardId,
        limit,
        undefined,
        undefined,
        cost,
      );
      if (decision.allowed) {
        request.rateLimit = decision;
        if (applied === undefined || decision.remaining < applied.remaining) {
          applied = decision;
        }
      } else if (isQueueableCommand(request)) {
        // TASK-200.3: compute the deadline on arrival so time spent waiting
        // behind other commands counts against this request's budget. Normal
        // commands never enter the queue; only a refused one waits for enough
        // tokens for its whole (possibly batched) work.
        request.rateLimit = decision;
        const deadline = Date.now() + agentCommandQueueMs();
        const queuedAt = Date.now();
        const abort = new AbortController();
        const onAbort = (): void => abort.abort();
        request.once("aborted", onAbort);
        const onClose = (): void => {
          // `close` also fires after a normal finish; only a connection that
          // went away before the response completed cancels the waiter.
          if (!response.writableEnded) abort.abort();
        };
        response.once("close", onClose);
        let outcome: BoardRateLimitWait;
        try {
          outcome = await enqueueBoardCommand(
            boardId,
            () =>
              waitForBoardRateLimit(boardId, {
                limit,
                deadline,
                cost,
                signal: abort.signal,
              }),
            {
              signal: abort.signal,
              bytes: commandBodyBytes(request),
            },
          );
        } catch (error) {
          if (error instanceof BoardCommandQueueFullError) {
            const message =
              `board ${boardId}: command queue full (${error.reason}); ` +
              `depth ${error.depth}, bytes ${error.bytes}, ` +
              `rejections ${boardCommandQueueFullCount()}`;
            const now = Date.now();
            if (now - this.lastQueueFullWarnAt >= QUEUE_FULL_WARN_INTERVAL_MS) {
              this.lastQueueFullWarnAt = now;
              this.logger.warn(message);
            }
            request.rateLimited = true;
            request.rateLimit = decision;
            // The request never waited: the header is present on every
            // command 503 so a client sees an explicit zero.
            response.setHeader("X-RateLimit-Queued-Ms", 0);
            applyRateLimitHeaders(response, decision);
            throw rateLimitQueueException(
              decision,
              "The board command queue is full — retry the same command",
            );
          }
          if (error instanceof BoardCommandQueueAbortedError) {
            response.setHeader(
              "X-RateLimit-Queued-Ms",
              Math.max(0, Math.round(Date.now() - queuedAt)),
            );
            throw new HttpException(
              "The request was aborted before its command could be applied",
              HttpStatus.REQUEST_TIMEOUT,
            );
          }
          throw error;
        } finally {
          request.off("aborted", onAbort);
          response.off("close", onClose);
        }
        request.rateLimit = outcome.decision;
        // TASK-200.3: report the whole queue-chain wait, not just the time
        // this waiter spent after the earlier commands settled. A deadline or
        // budget failure still reports the time spent, including 0.
        const queuedMs = Math.max(0, Date.now() - queuedAt);
        response.setHeader("X-RateLimit-Queued-Ms", Math.round(queuedMs));
        if (!outcome.decision.allowed) {
          request.rateLimited = true;
          applyRateLimitHeaders(response, outcome.decision);
          throw rateLimitQueueException(
            outcome.decision,
            "The board is busy with agent traffic — retry the same command",
          );
        }
        if (
          applied === undefined ||
          outcome.decision.remaining < applied.remaining
        ) {
          applied = outcome.decision;
        }
      } else {
        request.rateLimit = decision;
        request.rateLimited = true;
        applyRateLimitHeaders(response, decision);
        throw rateLimitException(decision, "Too many requests for this board");
      }
    }
    if (applied !== undefined) {
      applyRateLimitHeaders(response, applied, { onlyIfTighter: true });
    }
    return next.handle();
  }
}

/** Only sessions whose ownership was checked by a guard may spend this budget. */
export function agentSessionIdOf(request: LimitedRequest): string | undefined {
  const resolved =
    request.agentSession?.id ??
    request.auth?.agentSessionId ??
    request.rateLimitSessionId;
  if (resolved !== undefined && resolved !== "") return resolved;
  return undefined;
}

/**
 * Board routes carry `:id`; card/comment/attachment routes resolve the board
 * in the guard and put it on `req.boardMembership`. Parsing the path covers a
 * board route whose guard answered 404/403 before setting membership.
 *
 * `/boards/import`, `/boards/ready` and `/boards/search` are account/workspace
 * routes declared before `:id`; they are not board ids for rate-limit or log
 * attribution.
 */
export function boardIdOf(request: LimitedRequest): string | undefined {
  if (request.boardMembership?.boardId !== undefined) {
    return request.boardMembership.boardId;
  }
  const match = /^\/api\/v1\/(?:admin\/)?boards\/([^/]+?)(?:\/|$)/.exec(
    pathOf(request),
  );
  const boardId = match?.[1];
  if (
    boardId === undefined ||
    boardId === "import" ||
    boardId === "ready" ||
    boardId === "search"
  ) {
    return undefined;
  }
  return boardId;
}

/**
 * TASK-200.3: the only routes allowed to queue for a board token. Command
 * writes are idempotent by `commandId` and already serialized per board by
 * the write service, so a short wait changes latency but not semantics.
 * Reads and every other write keep the immediate `429`.
 */
export function isQueueableCommand(request: {
  method?: string;
  originalUrl?: string;
  url?: string;
}): boolean {
  if ((request.method ?? "GET").toUpperCase() !== "POST") return false;
  return /^\/api\/v1\/boards\/[^/]+\/commands(?:\/batch)?\/?$/.test(
    pathOf(request),
  );
}

function pathOf(request: { originalUrl?: string; url?: string }): string {
  return (request.originalUrl ?? request.url ?? "").split("?")[0];
}
