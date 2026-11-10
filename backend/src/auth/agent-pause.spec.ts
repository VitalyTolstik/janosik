import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  agentPausedError,
  assertAgentNotPaused,
  assertAgentNotPausedInTransaction,
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

describe("in-transaction pause read", () => {
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
      assertAgentNotPausedInTransaction(
        txWith(
          { individualPausedAt: null, stopAllPausedAt: null },
          { agentsPausedAt: at("2026-11-10T10:00:00Z") },
        ),
        "board-1",
        pat(),
        null,
      ),
    ).rejects.toMatchObject({
      response: { code: "agent_paused", pauseScope: "board" },
    });
  });

  it("refuses a session pause only when the request names that session", async () => {
    const pausedSession = { pausedAt: at("2026-11-10T10:00:00Z") };
    const tx = txWith(
      { individualPausedAt: null, stopAllPausedAt: null },
      { agentsPausedAt: null },
      pausedSession,
    );
    await expect(
      assertAgentNotPausedInTransaction(tx, "board-1", pat(), "session-1"),
    ).rejects.toMatchObject({
      response: { code: "agent_paused", pauseScope: "session" },
    });
    await expect(
      assertAgentNotPausedInTransaction(tx, "board-1", pat(), null),
    ).resolves.toBeUndefined();
  });
});
