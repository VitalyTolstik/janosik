import { HttpException, HttpStatus } from "@nestjs/common";
import type {
  ApiErrorCode,
  ApiErrorEnvelope,
  CommandConflict,
  WorkflowConflictDetails,
} from "@janosik/shared";
import { currentRequestId } from "./request-context";

/**
 * TASK-166.4: the single translation from a thrown exception to the public
 * error envelope (ADR §8). Everything a client may branch on lives here, so
 * a controller can keep throwing an ordinary Nest exception and still answer
 * `{ code, message, retryable, requestId, currentVersion, … }`.
 *
 * The rules that matter:
 * - an explicit `code` on the exception body always wins (scope, approvals,
 *   idempotency, limits);
 * - otherwise the HTTP status and the legacy `conflict` category map to the
 *   stable code table;
 * - `retryable` is true only for transient conditions (429, 503, timeouts,
 *   an idempotent request still in progress), never for 4xx validation;
 * - a 5xx from an unknown exception never leaks its message or stack.
 */

/** Result of translating one exception: HTTP status plus the public body. */
export interface TranslatedError {
  status: number;
  body: ApiErrorEnvelope;
}

/** A body or error that was already sent must not be rewritten. */
const RETRYABLE_STATUS = new Set([
  HttpStatus.REQUEST_TIMEOUT,
  HttpStatus.TOO_MANY_REQUESTS,
  HttpStatus.SERVICE_UNAVAILABLE,
]);

const RETRYABLE_CODES = new Set<string>([
  "idempotency_in_progress",
  "rate_limited",
  "board_write_timeout",
  "service_unavailable",
]);

/** Status → code fallback. Explicit body codes are preferred. */
const STATUS_CODE: Record<number, ApiErrorCode> = {
  [HttpStatus.BAD_REQUEST]: "validation_failed",
  [HttpStatus.UNAUTHORIZED]: "unauthorized",
  [HttpStatus.FORBIDDEN]: "forbidden",
  [HttpStatus.NOT_FOUND]: "not_found",
  [HttpStatus.METHOD_NOT_ALLOWED]: "method_not_allowed",
  [HttpStatus.CONFLICT]: "conflict",
  [HttpStatus.GONE]: "gone",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "payload_too_large",
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: "unsupported_media_type",
  [HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE]: "range_not_satisfiable",
  [HttpStatus.TOO_MANY_REQUESTS]: "rate_limited",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "internal_error",
  [HttpStatus.BAD_GATEWAY]: "service_unavailable",
  [HttpStatus.SERVICE_UNAVAILABLE]: "service_unavailable",
  [HttpStatus.GATEWAY_TIMEOUT]: "service_unavailable",
};

/** A conflict category (legacy `conflict`) → the matching stable code. */
const CONFLICT_CODE: Record<CommandConflict, ApiErrorCode> = {
  version: "version_conflict",
  wip: "limit_exceeded",
  id: "id_conflict",
  workflow: "workflow_conflict",
};

/** Human fallback when an exception body carries no `message`. */
const STATUS_MESSAGE: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "Bad Request",
  [HttpStatus.UNAUTHORIZED]: "Unauthorized",
  [HttpStatus.FORBIDDEN]: "Forbidden",
  [HttpStatus.NOT_FOUND]: "Not Found",
  [HttpStatus.METHOD_NOT_ALLOWED]: "Method Not Allowed",
  [HttpStatus.CONFLICT]: "Conflict",
  [HttpStatus.GONE]: "Gone",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "Payload Too Large",
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: "Unsupported Media Type",
  [HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE]: "Range Not Satisfiable",
  [HttpStatus.TOO_MANY_REQUESTS]: "Too Many Requests",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "Internal Server Error",
  [HttpStatus.BAD_GATEWAY]: "Bad Gateway",
  [HttpStatus.SERVICE_UNAVAILABLE]: "Service Unavailable",
  [HttpStatus.GATEWAY_TIMEOUT]: "Gateway Timeout",
};

/** Keys the envelope promotes to a documented field or deliberately drops. */
const RESERVED_BODY_KEYS = new Set([
  "code",
  "message",
  "statusCode",
  "error",
  "retryable",
  "requestId",
  "currentVersion",
  "field",
  "details",
  "conflict",
  "workflow",
  "allowedToColumnIds",
  "missingLocales",
  "limit",
  "current",
  "key",
  "retryAfter",
  "resource",
  "requiredScope",
  "effectiveTokenScope",
  "requiredRoles",
  "approvalId",
  "planHash",
  "expectedPlanHash",
  "actualPlanHash",
  "expiresAt",
  "action",
  "reason",
  "pauseScope",
  "scope",
  "pausedAt",
  "runId",
]);

type RawBody = Record<string, unknown>;

function asRecord(value: unknown): RawBody | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawBody)
    : undefined;
}

function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  // Express body-parser (and a few libraries) throw plain errors carrying a
  // numeric status. A malformed JSON body is a client error, not a 500.
  if (typeof exception === "object" && exception !== null) {
    const candidate = exception as { status?: unknown; statusCode?: unknown };
    const status = candidate.status ?? candidate.statusCode;
    if (typeof status === "number" && status >= 400 && status < 600) {
      return status;
    }
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

/** The exception body when it is an object; `undefined` for a string body. */
function bodyOf(exception: unknown): RawBody | undefined {
  if (!(exception instanceof HttpException)) return undefined;
  return asRecord(exception.getResponse());
}

function isConflict(value: unknown): value is CommandConflict {
  return (
    value === "version" ||
    value === "wip" ||
    value === "id" ||
    value === "workflow"
  );
}

function messageOf(exception: unknown, status: number): string {
  // An unexpected server error must never leak its internals, and a parser
  // error may echo a fragment of the body.
  if (!(exception instanceof HttpException)) {
    if (status >= 500) return "An unexpected error occurred";
    return status === HttpStatus.BAD_REQUEST
      ? "Malformed or invalid request body"
      : "Request failed";
  }
  const raw = exception.getResponse();
  let message: string | undefined;
  if (typeof raw === "string") {
    message = raw;
  } else {
    const value = asRecord(raw)?.message;
    if (typeof value === "string") message = value;
    else if (Array.isArray(value) && value.length > 0) {
      message = value.map((item) => String(item)).join("; ");
    }
  }
  if (
    (message === undefined || message.trim() === "") &&
    exception instanceof Error
  ) {
    message = exception.message;
  }
  return sanitizeMessage(message, status);
}

/** A throttler exception's default text is not a human message. */
function sanitizeMessage(message: string | undefined, status: number): string {
  if (message !== undefined && message.trim() !== "") {
    return status === HttpStatus.TOO_MANY_REQUESTS &&
      /^ThrottlerException\b/i.test(message)
      ? "Too many requests"
      : message;
  }
  return status >= 500 ? "An unexpected error occurred" : "Request failed";
}

function codeOf(status: number, body: RawBody | undefined): ApiErrorCode {
  const explicit = body?.code;
  if (typeof explicit === "string" && explicit.trim() !== "") return explicit;
  const conflict = body?.conflict;
  if (status === HttpStatus.CONFLICT && isConflict(conflict)) {
    return CONFLICT_CODE[conflict];
  }
  return STATUS_CODE[status] ?? "internal_error";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function workflowOf(value: unknown): WorkflowConflictDetails | undefined {
  const workflow = asRecord(value);
  if (workflow === undefined) return undefined;
  if (
    workflow.code !== "transition_not_allowed" &&
    workflow.code !== "role_not_allowed" &&
    workflow.code !== "condition_failed"
  ) {
    return undefined;
  }
  return value as WorkflowConflictDetails;
}

/** Build the public envelope from a status, an optional raw body and the id. */
export function apiErrorEnvelope(
  status: number,
  rawBody: unknown,
  requestId: string = currentRequestId() ?? "",
): ApiErrorEnvelope {
  const body = asRecord(rawBody);
  const code = codeOf(status, body);
  const rawMessage = body?.message;
  const message =
    typeof rawMessage === "string" && rawMessage.trim() !== ""
      ? rawMessage
      : Array.isArray(rawMessage) && rawMessage.length > 0
        ? rawMessage.map((item) => String(item)).join("; ")
        : (STATUS_MESSAGE[status] ??
          (status >= 500 ? "An unexpected error occurred" : `HTTP ${status}`));
  const messages =
    Array.isArray(rawMessage) && rawMessage.length > 0
      ? rawMessage.map((item) => String(item))
      : undefined;
  const workflow = workflowOf(body?.workflow);
  const conflict = isConflict(body?.conflict) ? body.conflict : undefined;
  const retryAfter =
    numberField(body?.retryAfter) ??
    (code === "idempotency_in_progress" ? 1 : undefined) ??
    (status === HttpStatus.TOO_MANY_REQUESTS ? 1 : undefined);
  const explicitRetryable = body?.retryable;
  const retryable =
    typeof explicitRetryable === "boolean"
      ? explicitRetryable
      : RETRYABLE_STATUS.has(status) || RETRYABLE_CODES.has(code);
  const allowedToColumnIds =
    stringArray(body?.allowedToColumnIds) ??
    stringArray(workflow?.allowedToColumnIds);
  const missingLocales = stringArray(body?.missingLocales);
  const explicitDetails = asRecord(body?.details);
  const extras = Object.fromEntries(
    Object.entries(body ?? {}).filter(([key]) => !RESERVED_BODY_KEYS.has(key)),
  );
  const details =
    explicitDetails !== undefined || Object.keys(extras).length > 0
      ? { ...(explicitDetails ?? {}), ...extras }
      : undefined;

  return {
    code,
    message,
    retryable,
    requestId,
    currentVersion: numberOrNull(body?.currentVersion),
    statusCode: status,
    ...(stringField(body?.field) !== undefined
      ? { field: stringField(body?.field) as string }
      : {}),
    ...(details !== undefined || messages !== undefined
      ? {
          details: {
            ...(details ?? {}),
            ...(messages !== undefined ? { messages } : {}),
          },
        }
      : {}),
    ...(conflict !== undefined ? { conflict } : {}),
    ...(workflow !== undefined ? { workflow } : {}),
    ...(allowedToColumnIds !== undefined ? { allowedToColumnIds } : {}),
    ...(missingLocales !== undefined ? { missingLocales } : {}),
    ...(numberField(body?.limit) !== undefined
      ? { limit: numberField(body?.limit) as number }
      : {}),
    ...(numberField(body?.current) !== undefined
      ? { current: numberField(body?.current) as number }
      : {}),
    ...(stringField(body?.key) !== undefined
      ? { key: stringField(body?.key) as string }
      : {}),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(stringField(body?.resource) !== undefined
      ? { resource: stringField(body?.resource) as string }
      : {}),
    ...(stringField(body?.requiredScope) !== undefined
      ? {
          requiredScope: stringField(body?.requiredScope) as NonNullable<
            ApiErrorEnvelope["requiredScope"]
          >,
        }
      : {}),
    ...(stringField(body?.effectiveTokenScope) !== undefined
      ? {
          effectiveTokenScope: stringField(
            body?.effectiveTokenScope,
          ) as NonNullable<ApiErrorEnvelope["effectiveTokenScope"]>,
        }
      : {}),
    ...(stringArray(body?.requiredRoles) !== undefined
      ? { requiredRoles: stringArray(body?.requiredRoles) }
      : {}),
    ...(stringField(body?.approvalId) !== undefined
      ? { approvalId: stringField(body?.approvalId) as string }
      : {}),
    ...(stringField(body?.planHash) !== undefined
      ? { planHash: stringField(body?.planHash) as string }
      : {}),
    ...(stringField(body?.expectedPlanHash) !== undefined
      ? {
          expectedPlanHash: stringField(body?.expectedPlanHash) as string,
        }
      : {}),
    ...(stringField(body?.actualPlanHash) !== undefined
      ? { actualPlanHash: stringField(body?.actualPlanHash) as string }
      : {}),
    ...(numberField(body?.expiresAt) !== undefined
      ? { expiresAt: numberField(body?.expiresAt) as number }
      : {}),
    ...(stringField(body?.action) !== undefined
      ? { action: stringField(body?.action) as string }
      : {}),
    ...(stringField(body?.reason) !== undefined
      ? { reason: stringField(body?.reason) as string }
      : {}),
    ...(stringField(body?.pauseScope) !== undefined
      ? { pauseScope: stringField(body?.pauseScope) as string }
      : {}),
    ...(stringField(body?.scope) !== undefined
      ? { scope: stringField(body?.scope) as string }
      : {}),
    ...(numberField(body?.pausedAt) !== undefined
      ? { pausedAt: numberField(body?.pausedAt) as number }
      : {}),
    ...(stringField(body?.status) !== undefined &&
    (code.startsWith("approval_") || code.startsWith("run_"))
      ? { status: stringField(body?.status) as string }
      : {}),
    ...(body?.runId === null
      ? { runId: null }
      : stringField(body?.runId) !== undefined
        ? { runId: stringField(body?.runId) as string }
        : {}),
  };
}

/** Translate any thrown value into the status and envelope to send. */
export function translateException(
  exception: unknown,
  requestId: string = currentRequestId() ?? "",
): TranslatedError {
  const status = statusOf(exception);
  const body = bodyOf(exception);
  if (body !== undefined) {
    return { status, body: apiErrorEnvelope(status, body, requestId) };
  }
  return {
    status,
    body: apiErrorEnvelope(
      status,
      { message: messageOf(exception, status) },
      requestId,
    ),
  };
}
