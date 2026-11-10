import { describe, expect, it } from "vitest";

import { ApiError, describeError, errorStructuredContent } from "./errors.js";

describe("describeError", () => {
  it("points at the field of a 400 validation error", () => {
    const message = describeError(
      new ApiError(400, {
        field: "action.title",
        message: "must not be blank",
      }),
    );
    expect(message).toContain("action.title");
    expect(message).toContain("must not be blank");
  });

  it("explains a 401 as a token problem", () => {
    expect(describeError(new ApiError(401, {}))).toMatch(/API token/i);
  });

  it("explains a 403 as a role problem", () => {
    expect(describeError(new ApiError(403, {}))).toMatch(/permission/i);
  });

  it("explains scope_denied with the required preset and no blind retry", () => {
    const message = describeError(
      new ApiError(403, {
        code: "scope_denied",
        action: "DELETE_CARD",
        requiredScope: "worker",
        effectiveTokenScope: "observer",
      }),
    );
    expect(message).toContain("DELETE_CARD");
    expect(message).toContain("worker");
    expect(message).toContain("Do not retry");
  });

  it("explains a board-scoped token refused on another board", () => {
    const message = describeError(
      new ApiError(403, {
        code: "scope_denied",
        reason: "board_scope",
      }),
    );
    expect(message).toMatch(/different board/i);
    expect(message).toMatch(/Do not/);
  });

  it("explains a board-role scope denial without blaming the preset", () => {
    const message = describeError(
      new ApiError(403, {
        code: "scope_denied",
        requiredRoles: ["ADMIN"],
      }),
    );
    expect(message).toMatch(/board role/i);
    expect(message).toContain("ADMIN");
    expect(message).toMatch(/Do not/);
  });

  it("explains destructive_denied as a board-policy stop", () => {
    const message = describeError(
      new ApiError(403, {
        code: "destructive_denied",
        action: "DELETE_CARD",
        reason: "board_policy",
      }),
    );
    expect(message).toMatch(/policy blocks destructive/i);
    expect(message).toMatch(/human/i);
  });

  it("explains pat_forbidden as a session-only route", () => {
    expect(describeError(new ApiError(403, { code: "pat_forbidden" }))).toMatch(
      /session-only/i,
    );
  });

  it("explains approval_required and who can unblock it", () => {
    const message = describeError(
      new ApiError(409, {
        code: "approval_required",
        action: "DELETE_CARD",
      }),
    );
    expect(message).toMatch(/approval required/i);
    expect(message).toContain("DELETE_CARD");
    expect(message).toMatch(/human/i);
    expect(message).toMatch(/perform the action/i);
  });

  it("explains a wip conflict with the next step", () => {
    const message = describeError(new ApiError(409, { conflict: "wip" }));
    expect(message).toMatch(/limit/i);
    expect(message).toMatch(/retry/i);
  });

  it("reports the current version on a version conflict", () => {
    const message = describeError(
      new ApiError(409, { conflict: "version", currentVersion: 42 }),
    );
    expect(message).toContain("42");
  });

  it("explains a workflow conflict without inviting a blind retry", () => {
    const message = describeError(
      new ApiError(409, {
        conflict: "workflow",
        currentVersion: 5,
        workflow: {
          code: "transition_not_allowed",
          fromColumnId: "backlog",
          toColumnId: "done",
          allowedToColumnIds: ["doing"],
        },
      }),
    );
    expect(message).toContain("doing");
    expect(message).toContain("Do not retry");
  });

  it("names the failed workflow conditions on a condition conflict", () => {
    const message = describeError(
      new ApiError(409, {
        conflict: "workflow",
        workflow: {
          code: "condition_failed",
          fromColumnId: "review",
          toColumnId: "done",
          allowedToColumnIds: [],
          failedConditions: ["requireChecklistsDone"],
        },
      }),
    );
    expect(message).toContain("requireChecklistsDone");
    expect(message).toContain("not a bug");
  });

  it("turns a fetch failure into a reachability hint", () => {
    expect(describeError(new TypeError("fetch failed"))).toMatch(
      /could not reach/i,
    );
  });

  it("falls back to the message for a plain error", () => {
    expect(describeError(new Error("boom"))).toBe("Error: boom");
  });

  it("surfaces a REST error body's message on 404", () => {
    const message = describeError(
      new ApiError(404, {
        message: "No user with that email",
        statusCode: 404,
      }),
    );
    expect(message).toContain("No user with that email");
  });

  it("surfaces a REST error body's message on 409 without a conflict key", () => {
    const message = describeError(
      new ApiError(409, { message: "User already has a pending invitation" }),
    );
    expect(message).toContain("pending invitation");
  });

  it("shows the envelope code, retryable flag and requestId", () => {
    const message = describeError(
      new ApiError(429, {
        code: "rate_limited",
        message: "slow down",
        retryable: true,
        requestId: "req-42",
        retryAfter: 2,
      }),
    );
    expect(message).toContain("code: rate_limited");
    expect(message).toContain("retryable: true");
    expect(message).toContain("requestId: req-42");
    expect(message).toContain("2s");
  });

  it("explains an idempotency conflict without inviting a blind retry", () => {
    const message = describeError(
      new ApiError(409, {
        code: "idempotency_conflict",
        retryable: false,
        requestId: "req-43",
      }),
    );
    expect(message).toMatch(/Idempotency-Key/i);
    expect(message).toMatch(/fresh key/i);
  });

  it("adds approval id and expiry guidance when present", () => {
    const message = describeError(
      new ApiError(409, {
        code: "approval_required",
        approvalId: "apr-1",
        expiresAt: Date.UTC(2026, 10, 10, 12, 0, 0),
        retryable: false,
      }),
    );
    expect(message).toContain("apr-1");
    expect(message).toMatch(/Wait for a human/i);
  });
});

describe("errorStructuredContent", () => {
  it("copies the server envelope and marks the result as not ok", () => {
    expect(
      errorStructuredContent(
        new ApiError(409, {
          code: "version_conflict",
          message: "stale",
          retryable: false,
          requestId: "req-9",
          currentVersion: 12,
        }),
      ),
    ).toMatchObject({
      ok: false,
      status: 409,
      code: "version_conflict",
      retryable: false,
      requestId: "req-9",
      currentVersion: 12,
    });
  });

  it("gives a network failure a retryable code", () => {
    expect(errorStructuredContent(new TypeError("fetch failed"))).toMatchObject(
      {
        ok: false,
        retryable: true,
        code: "network_error",
      },
    );
  });
});
