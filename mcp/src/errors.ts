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
  conflict?: "version" | "wip" | "id" | "workflow";
  currentVersion?: number;
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
  const body = asRecord(error.body);
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
        return (
          `Error: approval required${action}. This destructive action is ` +
          "refused until a human approves it; nothing was applied. The approval " +
          "request API ships in 166.5, so until then do not retry the same " +
          "call: ask a human to perform the action in the browser, or use a " +
          "token explicitly marked trusted CI when the board allows it."
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
      const detail = restMessage(body);
      return detail
        ? `Error: ${detail}.`
        : "Error: the change conflicted with the current board state.";
    }
    case 413:
      return "Error: the file is too large for the attachment limit.";
    case 429:
      return "Error: rate limit exceeded. Wait a moment and retry.";
    case 503:
      return isBoardBusy(error)
        ? "Error: the board is busy with other writers. Wait a moment and retry."
        : "Error: the Janosik instance is unavailable. Retry shortly.";
    default: {
      const detail = restMessage(body);
      return detail
        ? `Error: the API responded with status ${error.status}: ${detail}.`
        : `Error: the API responded with status ${error.status}.`;
    }
  }
}
