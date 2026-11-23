import {
  Injectable,
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
import { enqueueBoardCommand, waitForBoardRateLimit } from "./board-rate-limit";

/** The request bits this interceptor reads after the guards have run. */
interface LimitedRequest extends Request, RateLimitedRequest {
  auth?: AuthPrincipal;
  agentSession?: AgentSessionContext;
  rateLimitSessionId?: string;
  boardMembership?: { boardId?: string };
}

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

    const consume = (
      scope: "token" | "session",
      key: string,
      limit: number,
      message: string,
    ): void => {
      const decision = consumeRateLimit(scope, key, limit);
      request.rateLimit = decision;
      if (!decision.allowed) {
        applyRateLimitHeaders(response, decision);
        throw rateLimitException(decision, message);
      }
      // The response names the tightest bucket that actually counted.
      if (applied === undefined || decision.remaining < applied.remaining) {
        applied = decision;
      }
    };

    // TASK-200.3: an explicit per-token budget was already consumed by
    // `JwtAuthGuard`; only keys without one get the default agent-token bucket.
    const tokenId = request.auth.apiTokenId;
    const explicitTokenLimit = request.auth.tokenScope?.rateLimitPerMinute;
    if (tokenId !== undefined && explicitTokenLimit == null) {
      consume(
        "token",
        tokenId,
        agentTokenRateLimit(),
        "Too many requests for this API token",
      );
    }
    const sessionId = agentSessionIdOf(request);
    if (sessionId !== undefined) {
      consume(
        "session",
        sessionId,
        agentSessionRateLimit(),
        "Too many requests for this agent session",
      );
    }
    const boardId = boardIdOf(request);
    if (boardId !== undefined) {
      const limit = boardRateLimit();
      const decision = consumeBoardRateLimit(boardId, limit);
      if (decision.allowed) {
        request.rateLimit = decision;
        if (applied === undefined || decision.remaining < applied.remaining) {
          applied = decision;
        }
      } else if (isQueueableCommand(request)) {
        // TASK-200.3: compute the deadline on arrival so time spent waiting
        // behind other commands counts against this request's budget. Normal
        // commands never enter the queue; only a refused one waits for the
        // next token.
        const deadline = Date.now() + agentCommandQueueMs();
        const outcome = await enqueueBoardCommand(boardId, () =>
          waitForBoardRateLimit(boardId, { limit, deadline }),
        );
        request.rateLimit = outcome.decision;
        if (!outcome.decision.allowed) {
          applyRateLimitHeaders(response, outcome.decision);
          throw rateLimitQueueException(
            outcome.decision,
            "The board is busy with agent traffic — retry the same command",
          );
        }
        if (outcome.waitedMs >= 1) {
          response.setHeader(
            "X-RateLimit-Queued-Ms",
            Math.round(outcome.waitedMs),
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
 */
export function boardIdOf(request: LimitedRequest): string | undefined {
  if (request.boardMembership?.boardId !== undefined) {
    return request.boardMembership.boardId;
  }
  const match = /^\/api\/v1\/(?:admin\/)?boards\/([^/]+?)(?:\/|$)/.exec(
    pathOf(request),
  );
  const boardId = match?.[1];
  // `/boards/import` is an account route, not a board id.
  return boardId === undefined || boardId === "import" ? undefined : boardId;
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
