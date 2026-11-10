import { Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import { env } from "@/config/env";
import type { OperationKind, RequestActorType } from "./traffic.service";
import { TrafficService } from "./traffic.service";
import { REQUEST_ID_HEADER } from "./request-context";
import type { RateLimitedRequest, RateLimitScope } from "./rate-limit";

/** A request/operation log entry — only identity fields, never content. */
export interface RequestLogEntry {
  event: "request";
  requestId: string;
  method: string;
  /** Sanitized path: no query string, no public-share token. */
  path: string;
  status: number;
  durationMs: number;
  actorType: RequestActorType;
  actorId?: string;
  boardId?: string;
  apiTokenId?: string;
  agentSessionId?: string;
  runId?: string;
  approvalId?: string;
  operation?: OperationKind;
  rateLimit?: {
    scope: RateLimitScope;
    limit: number;
    remaining: number;
    resetAt: number;
  };
}

/** Request shape the log reads; attribution is filled by the guards. */
export interface LoggedRequest extends Request, RateLimitedRequest {
  auth?: AuthPrincipal;
  agentSession?: AgentSessionContext;
  boardMembership?: { boardId?: string };
  user?: { id?: string };
}

const MAX_RECENT = 200;
const SHARE_TOKEN_PATH = /(\/share\/)[^/?#]+/;
const BOARD_PATH = /^\/api\/v1\/(?:admin\/)?boards\/([^/]+?)(?:\/|$)/;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Public share tokens are credentials: keep them out of every log line. */
export function sanitizeRequestPath(raw: string): string {
  const path = (raw.split("?")[0] ?? "").split("#")[0] ?? "";
  return path.replace(SHARE_TOKEN_PATH, "$1[redacted]");
}

/** Path/method/status → operation counter; bodies are never inspected. */
export function operationOf(
  method: string,
  path: string,
  status: number,
): OperationKind | undefined {
  if (status < 200 || status >= 400) return undefined;
  const upper = method.toUpperCase();
  if (upper !== "POST") return undefined;
  if (/\/approvals\/[^/]+\/decision\/?$/.test(path)) {
    return "approval_decided";
  }
  if (/\/approvals\/?$/.test(path)) return "approval_created";
  if (
    /\/(?:agents|agent-sessions\/[^/]+)\/(?:resume|resume-all)\/?$/.test(path)
  ) {
    return "agent_resumed";
  }
  if (
    /\/(?:agents|agent-sessions\/[^/]+)\/(?:pause|pause-all)\/?$/.test(path)
  ) {
    return "agent_paused";
  }
  if (/\/runs\/[^/]+\/revert\/?$/.test(path)) return "run_reverted";
  if (/\/commands\/batch\/?$/.test(path) || /\/plans\/apply\/?$/.test(path)) {
    return "run_applied";
  }
  return undefined;
}

/**
 * Build the one structured entry for a finished request.
 *
 * Only the fields below are copied; the builder never reads headers other
 * than our own correlation id, never reads the body and never records a
 * comment, card title or file name. `apiTokenId`/`agentSessionId`/`runId` are
 * opaque server ids, not credentials.
 */
export function buildRequestLogEntry(
  request: LoggedRequest,
  response: Response,
  startedAt: number,
  at: number = Date.now(),
): RequestLogEntry {
  const path = sanitizeRequestPath(request.originalUrl ?? request.url ?? "");
  const auth = request.auth;
  const isAdmin = /^\/api\/v1\/admin(?:\/|$)/.test(path);
  const userId = request.user?.id;
  const actorType: RequestActorType = isAdmin
    ? "admin"
    : auth?.via === "pat"
      ? "agent"
      : userId !== undefined
        ? "human"
        : "anonymous";

  const sessionId =
    request.agentSession?.id ??
    auth?.agentSessionId ??
    stringParam(request.params?.sessionId) ??
    querySession(request.originalUrl ?? request.url);
  const pathBoardId = BOARD_PATH.exec(path)?.[1];
  const boardId =
    request.boardMembership?.boardId ??
    (pathBoardId === "import" ? undefined : pathBoardId);
  const runId =
    headerValue(response.getHeader("X-Run-Id")) ??
    stringParam(request.params?.runId);

  const entry: RequestLogEntry = {
    event: "request",
    requestId: headerValue(response.getHeader(REQUEST_ID_HEADER)) ?? "",
    method: (request.method ?? "GET").toUpperCase(),
    path,
    status: response.statusCode,
    durationMs: Math.max(0, at - startedAt),
    actorType,
  };
  if (userId !== undefined) entry.actorId = userId;
  if (boardId !== undefined) entry.boardId = boardId;
  if (auth?.apiTokenId !== undefined) entry.apiTokenId = auth.apiTokenId;
  if (sessionId !== undefined) entry.agentSessionId = sessionId;
  if (runId !== undefined) entry.runId = runId;
  if (stringParam(request.params?.approvalId) !== undefined) {
    entry.approvalId = stringParam(request.params?.approvalId);
  }
  const operation = operationOf(entry.method, path, entry.status);
  if (operation !== undefined) entry.operation = operation;
  if (request.rateLimit !== undefined) {
    entry.rateLimit = {
      scope: request.rateLimit.scope,
      limit: request.rateLimit.limit,
      remaining: request.rateLimit.remaining,
      resetAt: request.rateLimit.resetAt,
    };
  }
  return entry;
}

/** JSON line for the process log; `undefined` fields disappear. */
export function toRequestLogLine(entry: RequestLogEntry): string {
  return JSON.stringify(entry);
}

/**
 * TASK-166.10: bounded in-memory ring of recent structured request entries.
 *
 * The ring exists so ops/tests can inspect exactly what was logged without
 * scraping stdout, and so the metrics service and the log share one object
 * shape. Writing to stdout is skipped under `NODE_ENV=test` to keep the e2e
 * output readable; the ring still records every entry.
 */
@Injectable()
export class RequestLogService {
  private readonly logger = new Logger("HttpRequest");
  private readonly recent: RequestLogEntry[] = [];

  constructor(private readonly traffic: TrafficService) {}

  record(entry: RequestLogEntry): void {
    this.recent.push(entry);
    if (this.recent.length > MAX_RECENT) this.recent.shift();
    this.traffic.recordCompleted({
      at: Date.now(),
      status: entry.status,
      durationMs: entry.durationMs,
      actorType: entry.actorType,
      write: WRITE_METHODS.has(entry.method),
      ...(entry.rateLimit !== undefined
        ? {
            rateLimit: {
              scope: entry.rateLimit.scope,
              limit: entry.rateLimit.limit,
              remaining: entry.rateLimit.remaining,
              resetAt: entry.rateLimit.resetAt,
            },
          }
        : {}),
      ...(entry.operation !== undefined ? { operation: entry.operation } : {}),
    });
    if (env.NODE_ENV !== "test") {
      this.logger.log(toRequestLogLine(entry));
    }
  }

  /** Newest-last copy for tests and a future ops reader. */
  recentEntries(): RequestLogEntry[] {
    return this.recent.map((entry) => ({ ...entry }));
  }

  /** Test hook: forget the ring (metrics keep their own rolling windows). */
  clear(): void {
    this.recent.length = 0;
  }
}

function headerValue(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function querySession(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const path = url.split("?")[0] ?? "";
  if (!path.endsWith("/events")) return undefined;
  const query = url.split("?")[1];
  if (query === undefined) return undefined;
  const session = new URLSearchParams(query).get("session");
  return session !== null && session !== "" ? session : undefined;
}
