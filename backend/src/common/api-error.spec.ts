import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import { apiErrorEnvelope, translateException } from "./api-error";

/**
 * TASK-166.4 contract: the envelope's stable code/retryable/requestId/
 * currentVersion fields, legacy conflict compatibility, and the guarantee
 * that an unexpected 500 never leaks its message.
 */
describe("apiErrorEnvelope", () => {
  it("normalizes class-validator messages into one human string", () => {
    const body = apiErrorEnvelope(
      400,
      {
        statusCode: 400,
        message: ["title must not be empty", "title must be longer than 1"],
        error: "Bad Request",
      },
      "req-1",
    );
    expect(body).toMatchObject({
      code: "validation_failed",
      message: "title must not be empty; title must be longer than 1",
      retryable: false,
      requestId: "req-1",
      currentVersion: null,
      statusCode: 400,
      details: {
        messages: ["title must not be empty", "title must be longer than 1"],
      },
    });
  });

  it("keeps the legacy conflict shape and derives version_conflict", () => {
    const body = apiErrorEnvelope(
      409,
      { conflict: "version", currentVersion: 42 },
      "req-2",
    );
    expect(body).toMatchObject({
      code: "version_conflict",
      conflict: "version",
      currentVersion: 42,
      retryable: false,
      requestId: "req-2",
    });
  });

  it("promotes workflow destinations and keeps the workflow details", () => {
    const body = apiErrorEnvelope(
      409,
      {
        conflict: "workflow",
        currentVersion: 7,
        workflow: {
          code: "role_not_allowed",
          fromColumnId: "todo",
          toColumnId: "done",
          allowedToColumnIds: ["doing"],
          requiredRoles: ["ADMIN"],
        },
      },
      "req-3",
    );
    expect(body.code).toBe("workflow_conflict");
    expect(body.allowedToColumnIds).toEqual(["doing"]);
    expect(body.workflow?.allowedToColumnIds).toEqual(["doing"]);
  });

  it("marks only transient statuses/codes retryable", () => {
    expect(apiErrorEnvelope(400, {}, "r").retryable).toBe(false);
    expect(apiErrorEnvelope(403, {}, "r").retryable).toBe(false);
    expect(apiErrorEnvelope(404, {}, "r").retryable).toBe(false);
    expect(apiErrorEnvelope(429, {}, "r").retryable).toBe(true);
    expect(apiErrorEnvelope(503, {}, "r").retryable).toBe(true);
    expect(
      apiErrorEnvelope(409, { code: "idempotency_in_progress" }, "r").retryable,
    ).toBe(true);
    expect(
      apiErrorEnvelope(409, { code: "idempotency_conflict" }, "r").retryable,
    ).toBe(false);
  });

  it("preserves an explicit field, limit and currentVersion", () => {
    const body = apiErrorEnvelope(
      413,
      {
        code: "payload_too_large",
        message: "too big",
        field: "file",
        limit: 1024,
        retryable: false,
      },
      "req-4",
    );
    expect(body).toMatchObject({
      code: "payload_too_large",
      field: "file",
      limit: 1024,
      currentVersion: null,
      statusCode: 413,
    });
  });

  it("maps an unexpected exception to a safe internal error", () => {
    const { status, body } = translateException(
      new Error("connection string postgres://user:secret@db"),
      "req-5",
    );
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body).toMatchObject({
      code: "internal_error",
      message: "An unexpected error occurred",
      retryable: false,
      requestId: "req-5",
      currentVersion: null,
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("keeps a body-parser client error a 400 without echoing the body", () => {
    const parserError = Object.assign(
      new SyntaxError(
        'Unexpected token } in JSON at position 1: {"x":"secret"}',
      ),
      { status: 400, type: "entity.parse.failed" },
    );
    const { status, body } = translateException(parserError, "req-6");
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: "validation_failed",
      message: "Malformed or invalid request body",
      retryable: false,
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("promotes announcement missingLocales for the admin editor", () => {
    const body = apiErrorEnvelope(
      400,
      {
        message: "Both languages are required",
        code: "announcement_translations_incomplete",
        missingLocales: ["en"],
      },
      "req-8",
    );
    expect(body).toMatchObject({
      code: "announcement_translations_incomplete",
      missingLocales: ["en"],
      retryable: false,
    });
    expect(body.details?.missingLocales).toBeUndefined();
  });

  it("keeps route-specific extras in details", () => {
    const body = apiErrorEnvelope(
      503,
      { status: "down", db: "down", redis: "disabled" },
      "req-7",
    );
    expect(body).toMatchObject({
      code: "service_unavailable",
      retryable: true,
      details: { status: "down", db: "down", redis: "disabled" },
    });
  });

  it("wraps explicit Nest exceptions without losing their status", () => {
    expect(
      translateException(new ForbiddenException("nope"), "r").body,
    ).toMatchObject({ code: "forbidden", message: "nope", statusCode: 403 });
    expect(
      translateException(
        new ConflictException({ code: "approval_required" }),
        "r",
      ).body,
    ).toMatchObject({
      code: "approval_required",
      message: "Conflict",
      retryable: false,
    });
    expect(
      translateException(new ServiceUnavailableException("busy"), "r").body,
    ).toMatchObject({
      code: "service_unavailable",
      retryable: true,
      statusCode: 503,
    });
    expect(
      translateException(
        new BadRequestException({ message: "bad", field: "title" }),
        "r",
      ).body,
    ).toMatchObject({
      code: "validation_failed",
      field: "title",
      retryable: false,
    });
  });
});
