import { describe, expect, it } from "vitest";

import { ApiError, describeError } from "./errors.js";

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
});
