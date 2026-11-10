/**
 * Errors from the Janosik API and their translation into messages an agent
 * can act on: every failure names the cause and the next step (the MCP
 * best-practice rule that error text must guide, not just report).
 */

/** A non-2xx response from the API, carrying the parsed body when present. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = "ApiError";
  }
}

/**
 * A command the server accepted but applied as a no-op: the reducer found
 * nothing to change (an id that is not on the board, or the value was
 * already set). Surfaced as an error so an agent never reads "done" for a
 * write that did nothing.
 */
export class NoChangeError extends Error {
  constructor(readonly actionType: string) {
    super(`${actionType} changed nothing`);
    this.name = "NoChangeError";
  }
}

/**
 * A failure worth retrying: the request never got an HTTP answer (connection
 * refused/reset, DNS hiccup) or timed out.
 */
export function isTransientNetworkError(error: unknown): boolean {
  // The board's write lock timed out: the transaction rolled back, so the
  // same command can be sent again.
  if (error instanceof ApiError) return isBoardBusy(error);
  if (error instanceof NoChangeError) return false;
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(
    error.message,
  );
}

/** `503 {code: "board_write_timeout"}`: the board is too busy right now. */
function isBoardBusy(error: ApiError): boolean {
  return (
    error.status === 503 && asRecord(error.body).code === "board_write_timeout"
  );
}

/** The shape of a `409` conflict body (`ConflictError` in `@janosik/shared`). */
interface ConflictBody {
  code?: string;
  conflict?: "version" | "wip" | "id" | "workflow";
  currentVersion?: number;
  allowedToColumnIds?: string[];
  workflow?: {
    code?: string;
    fromColumnId?: string | null;
    toColumnId?: string;
    allowedToColumnIds?: string[];
    failedConditions?: string[];
  };
}

/** The shape of a `400` validation body. */
interface ValidationBody {
  field?: string;
  message?: string | string[];
}

/** TASK-166 scope/destructive errors carry a machine-readable code. */
interface ScopedErrorBody {
  code?: string;
  action?: string;
  requiredScope?: string;
  effectiveTokenScope?: string;
  requiredRoles?: string[];
  reason?: string;
  approvalId?: string;
  planHash?: string;
  expiresAt?: number;
  status?: string;
  runId?: string | null;
  retryable?: boolean;
  requestId?: string;
  limit?: number;
  retryAfter?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The human message from a Nest error body (`{statusCode, message, error}`).
 * Used as a fallback for REST failures, where the body is more specific than
 * the status alone (e.g. "User already has a pending invitation").
 */
function restMessage(body: Record<string, unknown>): string | undefined {
  const message = body.message;
  if (typeof message === "string" && message.trim() !== "") return message;
  if (Array.isArray(message) && message.length > 0) return message.join("; ");
  return undefined;
}

/**
 * Turn any thrown value into a single actionable line for the tool result.
 * Never leaks internals; always says what to do next.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return describeApiError(error);
  }
  if (error instanceof NoChangeError) {
    return (
      `Error: nothing changed (${error.actionType}). An id may not exist on ` +
      "this board, or the value was already set. Re-read the board with " +
      "janosik_get_board and check the ids."
    );
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError") {
      return (
        "Error: the Janosik instance did not answer in time. It may be " +
        "overloaded; retry shortly."
      );
    }
    // A fetch failure surfaces as a generic TypeError ("fetch failed").
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(error.message)) {
      return (
        "Error: could not reach the Janosik instance. Check that " +
        "JANOSIK_URL is correct and the server is running."
      );
    }
    return `Error: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}

function describeWorkflowConflict(details: ConflictBody["workflow"]): string {
  const code = details?.code ?? "transition_not_allowed";
  const allowed = details?.allowedToColumnIds ?? [];
  const allowedText =
    allowed.length > 0
      ? ` Allowed destinations from here: ${allowed.join(", ")}.`
      : " No other destination is allowed from this card's current column.";
  const target = details?.toColumnId ? ` to column ${details.toColumnId}` : "";
  if (code === "role_not_allowed") {
    return (
      `Error: the board's workflow does not allow your role to move this card` +
      `${target}.${allowedText} Do not retry the same destination; ask a board ` +
      "ADMIN to make the transition, or choose an allowed column."
    );
  }
  if (code === "condition_failed") {
    const failed = details?.failedConditions?.join(", ") ?? "unknown";
    return (
      `Error: the board's workflow blocked this move${target} because card ` +
      `conditions are not met: ${failed}. This is a rule, not a bug — satisfy ` +
      "the conditions (assignee, due date, description or checklists), then " +
      `retry.${allowedText} Do not clear the contract to bypass it.`
    );
  }
  return (
    `Error: the board's workflow does not allow this move${target}.` +
    `${allowedText} Do not retry the same toColumnId; choose an allowed ` +
    "column or leave the card in place and report the blocker."
  );
}

function describeApiError(error: ApiError): string {
  return withErrorMeta(describeApiErrorBody(error), asRecord(error.body));
}

/**
 * TASK-166.4: the machine-readable half of an error. The REST envelope is
 * already a JSON object, so an MCP client receives it under
 * `structuredContent` with `ok: false` and branches on `code`, `retryable`
 * and `requestId` instead of parsing the human sentence.
 */
export function errorStructuredContent(
  error: unknown,
): Record<string, unknown> {
  if (error instanceof ApiError) {
    const body = asRecord(error.body);
    return {
      ok: false,
      status: error.status,
      ...body,
      ...(typeof body.message !== "string" && error.message
        ? { message: error.message }
        : {}),
    };
  }
  if (error instanceof NoChangeError) {
    return {
      ok: false,
      code: "no_change",
      retryable: false,
      message: `${error.actionType} changed nothing`,
    };
  }
  if (error instanceof Error) {
    if (isTransientNetworkError(error)) {
      return {
        ok: false,
        code: "network_error",
        retryable: true,
        message: error.message,
      };
    }
    return {
      ok: false,
      code: "internal_error",
      retryable: false,
      message: error.message,
    };
  }
  return { ok: false, code: "internal_error", retryable: false };
}

/** Append `code`, `retryable` and `requestId` so every error names its cause. */
function withErrorMeta(message: string, body: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof body.code === "string" && body.code !== "") {
    parts.push(`code: ${body.code}`);
  }
  if (typeof body.retryable === "boolean") {
    parts.push(`retryable: ${body.retryable}`);
  }
  if (typeof body.requestId === "string" && body.requestId !== "") {
    parts.push(`requestId: ${body.requestId}`);
  }
  return parts.length > 0 ? `${message}\n(${parts.join(", ")})` : message;
}

function describeApiErrorBody(error: ApiError): string {
  const body = asRecord(error.body);
  const code = typeof body.code === "string" ? body.code : undefined;
  if (code === "idempotency_conflict") {
    return (
      "Error: this Idempotency-Key was already used with a different request " +
      "body. Do not reuse the key for a new intent — re-read the board and " +
      "send the new write with a fresh key."
    );
  }
  if (code === "idempotency_in_progress") {
    return (
      "Error: a request with this Idempotency-Key is still running. Wait a " +
      "moment and retry the same call; do not change the body or the key."
    );
  }
  if (code === "agent_paused") {
    return (
      "Error: agents are paused for this session, token or board. Stop — " +
      "paused. Do not retry until a human resumes the agent; report the " +
      "blocker instead of looking for another route."
    );
  }
  if (code === "agent_session_closed" || code === "agent_session_invalid") {
    return (
      "Error: the agent session is closed or does not belong to this token " +
      "and board. Start a new session with janosik_start_session, then retry."
    );
  }
  if (code === "pat_required") {
    return (
      "Error: this route needs a personal API token session, not a browser " +
      "session. Use the key configured for this MCP server."
    );
  }
  if (code === "approval_expired") {
    return (
      "Error: the approval expired before it was used. Request a new approval " +
      "with janosik_request_approval; do not retry with the expired id."
    );
  }
  if (code === "approval_rejected" || code === "approval_cancelled") {
    return (
      "Error: a human rejected or cancelled this approval. Stop; do not retry " +
      "the same write unless a new approval is requested and granted."
    );
  }
  if (code === "approval_consumed") {
    return (
      "Error: this approval was already applied and consumed by a run. Do " +
      "not apply it again; re-read the board to see the committed result."
    );
  }
  if (code === "approval_mismatch") {
    return (
      "Error: the approval does not match this plan (planHash mismatch). " +
      "Re-read the plan and request a new approval; do not reuse this id."
    );
  }
  if (code === "run_conflict" || code === "run_expired") {
    return (
      "Error: the run cannot be reverted in its current state. Re-read the " +
      "run and the board; do not retry the same revert blindly."
    );
  }
  switch (error.status) {
    case 400: {
      const { field, message } = body as ValidationBody;
      const detail = Array.isArray(message)
        ? message.join("; ")
        : (message ?? "invalid request");
      return field
        ? `Error: the command was rejected at ${field}: ${detail}.`
        : `Error: the request was rejected: ${detail}.`;
    }
    case 401:
      return (
        "Error: not authenticated. The API token is missing, revoked or " +
        "expired — create a fresh key in Account → API keys and update " +
        "JANOSIK_TOKEN."
      );
    case 403: {
      const scoped = body as ScopedErrorBody;
      if (scoped.code === "scope_denied") {
        if (scoped.reason === "board_scope") {
          return (
            "Error: this API token is scoped to a different board. Do not " +
            "retry it here; use a token created for this board."
          );
        }
        if (scoped.requiredRoles !== undefined) {
          return (
            "Error: permission denied — this action needs a board role you do " +
            `not hold (requires ${scoped.requiredRoles.join(" or ")}). Do not ` +
            "retry with the same user; ask a board ADMIN to perform it."
          );
        }
        const action = scoped.action ? ` ${scoped.action}` : " this action";
        return (
          `Error: permission denied — the API token cannot perform${action} ` +
          `(requires the ${scoped.requiredScope ?? "higher"} preset, token is ` +
          `${scoped.effectiveTokenScope ?? "lower"}). Do not retry with the ` +
          "same token; use a token with the required preset, or ask the board " +
          "owner to perform it."
        );
      }
      if (scoped.code === "destructive_denied") {
        return (
          "Error: this board's policy blocks destructive actions for agents " +
          '(destructive: "deny"). Do not retry or look for a workaround; a ' +
          "human must perform this action."
        );
      }
      if (scoped.code === "approval_owner_mismatch") {
        return (
          "Error: this approval belongs to another API token or agent " +
          "session. Do not retry it with this token; create a fresh request " +
          "with janosik_request_approval."
        );
      }
      if (scoped.code === "pat_forbidden") {
        return (
          "Error: this route is session-only and a personal API token cannot " +
          "use it. Sign in with a browser to manage keys, profile, " +
          "invitations or account data."
        );
      }
      if (scoped.code === "pat_read_only") {
        return (
          "Error: this API token is read-only. Create a read/write token " +
          "(or a higher scope preset) to change the board."
        );
      }
      const detail = restMessage(body);
      return (
        `Error: permission denied${detail ? `: ${detail}` : ""}. This action ` +
        "needs a board role you do not hold (editing needs MEMBER, member " +
        "management needs ADMIN)."
      );
    }
    case 404: {
      const detail = restMessage(body);
      return detail
        ? `Error: not found: ${detail}.`
        : "Error: not found. Check the board or card id — it may belong to " +
            "another account or have been deleted.";
    }
    case 409: {
      const scoped = body as ScopedErrorBody;
      if (scoped.code === "approval_required") {
        const action = scoped.action ? ` (${scoped.action})` : "";
        const next =
          scoped.approvalId !== undefined
            ? ` The request is ${scoped.approvalId}; wait with ` +
              "janosik_wait_for_decision" +
              (scoped.expiresAt !== undefined
                ? ` (expires ${new Date(scoped.expiresAt).toISOString()})`
                : "") +
              ", then repeat the same plan with that approvalId."
            : " Ask a human to approve it in the browser.";
        return (
          `Error: approval required${action}. Nothing was applied.${next} ` +
          "Do not retry the destructive call without an approved approvalId."
        );
      }
      if (scoped.code === "approval_expired") {
        return (
          "Error: the approval expired before it could be applied. Nothing " +
          "was applied. Request a fresh approval with " +
          "janosik_request_approval; do not reuse the old plan."
        );
      }
      if (scoped.code === "approval_mismatch") {
        return (
          "Error: the plan does not match the approved planHash. The approval " +
          "stays approved but cannot authorize a different plan; repeat the " +
          "exact plan (same command ids and fields) or request a new approval."
        );
      }
      if (scoped.code === "approval_consumed") {
        return (
          "Error: this approval was already applied" +
          (scoped.runId ? ` by run ${scoped.runId}` : "") +
          ". Do not retry it; re-read the board to confirm the result."
        );
      }
      if (scoped.code === "approval_not_pending") {
        return (
          `Error: the approval is ${scoped.status ?? "not pending"}, so it ` +
          "cannot be decided or applied. Read it with janosik_get_approval " +
          "and request a new one if the work is still needed."
        );
      }
      if (scoped.code === "approval_rejected") {
        return (
          "Error: a human rejected this approval. Nothing was applied. Do not " +
          "retry the same plan; ask the human why before requesting another."
        );
      }
      if (scoped.code === "approval_cancelled") {
        return (
          "Error: this approval was cancelled. Nothing was applied. Request a " +
          "new approval if the work is still needed."
        );
      }
      if (scoped.code === "limit_exceeded") {
        const limit =
          scoped.limit !== undefined ? ` (limit ${scoped.limit})` : "";
        return (
          `Error: the change would break a limit${limit}. Free a slot or ` +
          "choose another destination first, then retry."
        );
      }
      const { conflict, currentVersion, workflow } = body as ConflictBody;
      if (conflict === "workflow") {
        return describeWorkflowConflict(workflow);
      }
      if (conflict === "wip") {
        return (
          "Error: the change would break a limit (WIP or a collection cap). " +
          "Move or free a slot first, then retry."
        );
      }
      if (conflict === "version") {
        return (
          `Error: the board changed since you read it` +
          (currentVersion !== undefined
            ? ` (now at version ${currentVersion})`
            : "") +
          ". Re-read the board and retry."
        );
      }
      if (conflict === "id") {
        return (
          "Error: an id in the command already belongs to another board. " +
          "Re-read the board and retry with fresh ids."
        );
      }
      if (scoped.code === "version_conflict") {
        return (
          "Error: the board changed since you read it" +
          (currentVersion !== undefined
            ? ` (now at version ${currentVersion})`
            : "") +
          ". Re-read the board and retry."
        );
      }
      const detail = restMessage(body);
      return detail
        ? `Error: ${detail}.`
        : "Error: the change conflicted with the current board state.";
    }
    case 413:
      return typeof body.limit === "number"
        ? `Error: the payload is over the ${body.limit}-byte limit. Reduce it and retry; repeating the same body cannot succeed.`
        : "Error: the file is too large for the attachment limit. Reduce it and retry.";
    case 429: {
      const retryAfter =
        typeof body.retryAfter === "number"
          ? ` Retry after about ${body.retryAfter}s.`
          : " Wait a moment and retry.";
      return `Error: rate limit exceeded.${retryAfter}`;
    }
    case 503:
      return isBoardBusy(error)
        ? "Error: the board is busy with other writers. Wait a moment and retry the same request."
        : "Error: the Janosik instance is unavailable. Retry shortly; if it persists, report the requestId.";
    default: {
      const detail = restMessage(body);
      return detail
        ? `Error: the API responded with status ${error.status}: ${detail}.`
        : `Error: the API responded with status ${error.status}.`;
    }
  }
}
