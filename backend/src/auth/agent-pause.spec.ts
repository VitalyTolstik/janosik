import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  agentPausedError,
  assertAgentCanWriteInTransaction,
  assertAgentNotPaused,
  assertTokenNotPaused,
  isPauseExemptPath,
  resolveAgentPause,
  type AgentPauseStamp,
} from "./agent-pause";
import type { AuthPrincipal } from "./auth-principal";

const at = (iso: string): Date => new Date(iso);

const pat = (overrides: Partial<AuthPrincipal> = {}): AuthPrincipal => ({
  via: "pat",
  apiTokenId: "token-1",
  tokenIdentity: {
    id: "token-1",
    name: "agent",
    scopePreset: "worker",
    trustedCi: false,
    effectiveTokenScope: "worker",
    boardId: null,
    readOnly: false,
    rateLimitPerMinute: null,
    individualPausedAt: null,
    stopAllPausedAt: null,
    paused: false,
  },
  ...overrides,
});

function responseOf(error: unknown): Record<string, unknown> {
  return (error as ForbiddenException).getResponse() as Record<string, unknown>;
}

describe("agent pause precedence", () => {
  it("token pause wins over board and session", () => {
    const pause = resolveAgentPause({
      tokenIndividualPausedAt: at("2026-11-10T10:00:00Z"),
      boardPausedAt: at("2026-11-10T11:00:00Z"),
      sessionPausedAt: at("2026-11-10T12:00:00Z"),
    });
    expect(pause).toEqual({
      scope: "token",
      at: at("2026-11-10T10:00:00Z").getTime(),
    });
  });

  it("uses the latest of the two token pause sources", () => {
    expect(
      resolveAgentPause({
        tokenIndividualPausedAt: at("2026-11-10T10:00:00Z"),
        tokenStopAllPausedAt: at("2026-11-10T11:00:00Z"),
      }),
    ).toEqual({
      scope: "token",
      at: at("2026-11-10T11:00:00Z").getTime(),
    });
  });

  it("falls back to board, then session, then null", () => {
    expect(
      resolveAgentPause({
        boardPausedAt: at("2026-11-10T11:00:00Z"),
        sessionPausedAt: at("2026-11-10T12:00:00Z"),
      }),
    ).toEqual({
      scope: "board",
      at: at("2026-11-10T11:00:00Z").getTime(),
    });
    expect(
      resolveAgentPause({
        sessionPausedAt: at("2026-11-10T12:00:00Z"),
      }),
    ).toEqual({
      scope: "session",
      at: at("2026-11-10T12:00:00Z").getTime(),
    });
    expect(resolveAgentPause({})).toBeNull();
  });

  it("returns the machine-readable 403 shape", () => {
    const pause: AgentPauseStamp = { scope: "board", at: 123 };
    const error = agentPausedError(pause);
    expect(error.getStatus()).toBe(403);
    expect(responseOf(error)).toMatchObject({
      code: "agent_paused",
      retryable: false,
      pauseScope: "board",
      scope: "board",
      pausedAt: 123,
    });
  });

  it("allows a non-paused or human caller through", () => {
    expect(() => assertAgentNotPaused({})).not.toThrow();
    expect(() =>
      assertTokenNotPaused(undefined, "POST", "/api/v1/boards/b/commands"),
    ).not.toThrow();
  });
});

describe("request boundary pause checks", () => {
  it("blocks a paused token on a write but not on a read", () => {
    const identity = pat().tokenIdentity;
    expect(() =>
      assertTokenNotPaused(
        { ...identity!, individualPausedAt: 1, paused: true },
        "POST",
        "/api/v1/boards/b/commands",
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertTokenNotPaused(
        { ...identity!, individualPausedAt: 1, paused: true },
        "GET",
        "/api/v1/boards/b/commands",
      ),
    ).not.toThrow();
  });

  it("exempts heartbeat/end and human pause controls", () => {
    for (const path of [
      "/api/v1/boards/b/agent-sessions/s/heartbeat",
      "/api/v1/boards/b/agent-sessions/s/end",
      "/api/v1/boards/b/agent-sessions/s/pause",
      "/api/v1/boards/b/agents/pause",
      "/api/v1/agents/pause-all",
      "/api/v1/users/me/tokens/t/pause",
    ]) {
      expect(isPauseExemptPath(path)).toBe(true);
    }
    expect(isPauseExemptPath("/api/v1/boards/b/commands")).toBe(false);
  });
});

describe("in-transaction write gate", () => {
  function tokenRow(overrides: Record<string, unknown> = {}) {
    return {
      individualPausedAt: null,
      stopAllPausedAt: null,
      revokedAt: null,
      expiresAt: null,
      user: { disabledAt: null },
      ...overrides,
    };
  }

  function sessionRow(overrides: Record<string, unknown> = {}) {
    return {
      pausedAt: null,
      endedAt: null,
      status: "active",
      boardId: "board-1",
      apiTokenId: "token-1",
      ...overrides,
    };
  }

  function txWith(
    token: unknown,
    board: unknown,
    session: unknown = null,
  ): Prisma.TransactionClient {
    return {
      apiToken: { findUnique: jest.fn().mockResolvedValue(token) },
      board: { findUnique: jest.fn().mockResolvedValue(board) },
      agentSession: { findUnique: jest.fn().mockResolvedValue(session) },
    } as unknown as Prisma.TransactionClient;
  }

  it("refuses when the board pause committed before the second read", async () => {
    await expect(
      assertAgentCanWriteInTransaction(
        txWith(tokenRow(), { agentsPausedAt: at("2026-11-10T10:00:00Z") }),
        "board-1",
        pat(),
        null,
      ),
    ).rejects.toMatchObject({
      response: { code: "agent_paused", pauseScope: "board" },
    });
  });

  it("refuses a session pause only when the request names that session", async () => {
    const tx = txWith(
      tokenRow(),
      { agentsPausedAt: null },
      sessionRow({ pausedAt: at("2026-11-10T10:00:00Z") }),
    );
    await expect(
      assertAgentCanWriteInTransaction(tx, "board-1", pat(), "session-1"),
    ).rejects.toMatchObject({
      response: { code: "agent_paused", pauseScope: "session" },
    });
    await expect(
      assertAgentCanWriteInTransaction(tx, "board-1", pat(), null),
    ).resolves.toBeUndefined();
  });

  it("refuses a revoked, expired or disabled token", async () => {
    for (const token of [
      tokenRow({ revokedAt: new Date() }),
      tokenRow({ expiresAt: new Date(Date.now() - 1_000) }),
      tokenRow({ user: { disabledAt: new Date() } }),
      null,
    ]) {
      await expect(
        assertAgentCanWriteInTransaction(
          txWith(token, { agentsPausedAt: null }),
          "board-1",
          pat(),
          null,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it("refuses a session ended or terminal before the second read", async () => {
    for (const session of [
      sessionRow({ endedAt: new Date() }),
      sessionRow({ status: "completed" }),
      sessionRow({ status: "cancelled" }),
    ]) {
      await expect(
        assertAgentCanWriteInTransaction(
          txWith(tokenRow(), { agentsPausedAt: null }, session),
          "board-1",
          pat(),
          "session-1",
        ),
      ).rejects.toMatchObject({
        response: { code: "agent_session_closed", sessionId: "session-1" },
      });
    }
  });

  it("refuses a session from another board or token", async () => {
    await expect(
      assertAgentCanWriteInTransaction(
        txWith(
          tokenRow(),
          { agentsPausedAt: null },
          sessionRow({ boardId: "board-2" }),
        ),
        "board-1",
        pat(),
        "session-1",
      ),
    ).rejects.toMatchObject({
      response: { code: "agent_session_invalid" },
    });
    await expect(
      assertAgentCanWriteInTransaction(
        txWith(
          tokenRow(),
          { agentsPausedAt: null },
          sessionRow({ apiTokenId: "token-2" }),
        ),
        "board-1",
        pat(),
        "session-1",
      ),
    ).rejects.toMatchObject({
      response: { code: "agent_session_invalid" },
    });
  });
});
