import type { Response } from "express";
import {
  buildRequestLogEntry,
  operationOf,
  sanitizeRequestPath,
  toRequestLogLine,
  type LoggedRequest,
} from "./request-log";

function response(
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const values = new Map(Object.entries(headers));
  return {
    statusCode: status,
    getHeader: (name: string) => values.get(name),
  } as unknown as Response;
}

function request(overrides: Partial<LoggedRequest> = {}): LoggedRequest {
  return {
    method: "GET",
    originalUrl: "/api/v1/boards/board-1?token=secret",
    params: {},
    headers: {},
    ...overrides,
  } as unknown as LoggedRequest;
}

describe("sanitizeRequestPath (TASK-166.10)", () => {
  it("drops the query string", () => {
    expect(sanitizeRequestPath("/api/v1/boards/b1?since=1&apiTokenId=t1")).toBe(
      "/api/v1/boards/b1",
    );
  });

  it("redacts a public share token", () => {
    expect(sanitizeRequestPath("/api/v1/share/super-secret-token")).toBe(
      "/api/v1/share/[redacted]",
    );
    expect(
      sanitizeRequestPath("/api/v1/share/super-secret-token/events?since=4"),
    ).toBe("/api/v1/share/[redacted]/events");
  });
});

describe("operationOf", () => {
  it.each([
    ["POST", "/api/v1/boards/b1/approvals", 201, "approval_created"],
    [
      "POST",
      "/api/v1/boards/b1/approvals/a1/decision",
      200,
      "approval_decided",
    ],
    ["POST", "/api/v1/boards/b1/agents/pause", 200, "agent_paused"],
    ["POST", "/api/v1/agents/resume-all", 200, "agent_resumed"],
    ["POST", "/api/v1/boards/b1/commands/batch", 200, "run_applied"],
    ["POST", "/api/v1/boards/b1/plans/apply", 200, "run_applied"],
    ["POST", "/api/v1/boards/b1/runs/r1/revert", 200, "run_reverted"],
  ])("classifies %s %s", (method, path, status, expected) => {
    expect(operationOf(method, path, status)).toBe(expected);
  });

  it("ignores reads and failures", () => {
    expect(operationOf("GET", "/api/v1/boards/b1/approvals", 200)).toBe(
      undefined,
    );
    expect(operationOf("POST", "/api/v1/boards/b1/approvals", 403)).toBe(
      undefined,
    );
  });
});

describe("buildRequestLogEntry", () => {
  it("carries attribution and no request content", () => {
    const entry = buildRequestLogEntry(
      request({
        method: "POST",
        originalUrl: "/api/v1/boards/board-1/commands?token=leak",
        params: { id: "board-1" },
        auth: {
          via: "pat",
          apiTokenId: "token-1",
          apiTokenName: "ci",
          agentSessionId: "session-1",
        },
        agentSession: { id: "session-1" } as never,
        boardMembership: { boardId: "board-1" },
        user: { id: "user-1" },
        body: { action: { title: "Top secret card" } },
        headers: { authorization: "Bearer jnk_super-secret" },
        rateLimit: {
          scope: "token",
          allowed: true,
          limit: 10,
          remaining: 9,
          resetAt: 1_700_000_060_000,
          retryAfter: 60,
        },
      }),
      response(200, { "x-request-id": "req-1" }),
      1_700_000_000_000,
      1_700_000_000_012,
    );

    expect(entry).toMatchObject({
      event: "request",
      requestId: "req-1",
      method: "POST",
      path: "/api/v1/boards/board-1/commands",
      status: 200,
      durationMs: 12,
      actorType: "agent",
      actorId: "user-1",
      boardId: "board-1",
      apiTokenId: "token-1",
      agentSessionId: "session-1",
      rateLimit: { scope: "token", limit: 10, remaining: 9 },
    });

    const line = toRequestLogLine(entry);
    expect(line).not.toContain("Top secret card");
    expect(line).not.toContain("jnk_super-secret");
    expect(line).not.toContain("leak");
    expect(JSON.parse(line)).toEqual(entry);
  });

  it("keeps a public share token out of the line", () => {
    const entry = buildRequestLogEntry(
      request({ originalUrl: "/api/v1/share/secret-token" }),
      response(404),
      Date.now(),
    );
    expect(entry.path).toBe("/api/v1/share/[redacted]");
    expect(toRequestLogLine(entry)).not.toContain("secret-token");
  });

  it("does not mistake the import route for a board id", () => {
    const entry = buildRequestLogEntry(
      request({
        method: "POST",
        originalUrl: "/api/v1/boards/import",
        user: { id: "user-1" },
      }),
      response(201),
      Date.now(),
    );
    expect(entry.boardId).toBeUndefined();
  });

  it("marks admin and anonymous callers without inventing ids", () => {
    const admin = buildRequestLogEntry(
      request({
        originalUrl: "/api/v1/admin/metrics",
        user: { id: "admin-1" },
      }),
      response(200),
      Date.now(),
    );
    expect(admin).toMatchObject({ actorType: "admin", actorId: "admin-1" });
    expect(admin.apiTokenId).toBeUndefined();

    const anonymous = buildRequestLogEntry(
      request({ originalUrl: "/api/v1/health" }),
      response(200),
      Date.now(),
    );
    expect(anonymous.actorType).toBe("anonymous");
    expect(anonymous.actorId).toBeUndefined();
  });
});
