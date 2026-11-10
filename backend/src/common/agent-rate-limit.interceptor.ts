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
  consumeRateLimit,
  mirrorStandardRateLimitHeaders,
  rateLimitException,
  type RateLimitedRequest,
} from "./rate-limit";
import { agentSessionRateLimit, boardRateLimit } from "@/config/rate-limit";

/** The request bits this interceptor reads after the guards have run. */
interface LimitedRequest extends Request, RateLimitedRequest {
  auth?: AuthPrincipal;
  agentSession?: AgentSessionContext;
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
 * (before scope checks); this interceptor never re-counts it.
 */
@Injectable()
export class AgentRateLimitInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
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
    let applied: ReturnType<typeof consumeRateLimit> | undefined;

    const consume = (
      scope: "session" | "board",
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
      consume(
        "board",
        boardId,
        boardRateLimit(),
        "Too many requests for this board",
      );
    }
    if (applied !== undefined) {
      applyRateLimitHeaders(response, applied, { onlyIfTighter: true });
    }
    return next.handle();
  }
}

/** `X-Agent-Session` (resolved by the guards), a path session, or SSE query. */
export function agentSessionIdOf(request: LimitedRequest): string | undefined {
  const resolved = request.agentSession?.id ?? request.auth?.agentSessionId;
  if (resolved !== undefined && resolved !== "") return resolved;
  const path = pathOf(request);
  if (/\/agent-sessions\/[^/]+(?:\/|$)/.test(path)) {
    const sessionId = request.params?.sessionId;
    if (typeof sessionId === "string" && sessionId !== "") return sessionId;
  }
  const query = request.originalUrl?.split("?")[1];
  if (path.endsWith("/events") && query !== undefined) {
    const session = new URLSearchParams(query).get("session");
    if (session !== null && session !== "") return session;
  }
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

function pathOf(request: LimitedRequest): string {
  return (request.originalUrl ?? request.url ?? "").split("?")[0];
}
