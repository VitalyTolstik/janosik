import type { AgentSession } from "@prisma/client";
import { AGENT_SESSION_STALE_MS } from "@janosik/shared";
import { toAgentSessionDto } from "./agent-sessions.service";

function row(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "sess-1",
    userId: "user-1",
    apiTokenId: "token-1",
    boardId: "board-1",
    name: "run",
    clientName: null,
    model: null,
    status: "active",
    currentCardId: null,
    currentRunId: null,
    startedAt: new Date(1_000),
    lastHeartbeatAt: new Date(2_000),
    endedAt: null,
    endReason: null,
    pausedAt: null,
    pausedBy: null,
    pausedReason: null,
    summary: null,
    ...overrides,
  };
}

describe("toAgentSessionDto", () => {
  it("computes stale after five minutes without a heartbeat", () => {
    const now = 2_000 + AGENT_SESSION_STALE_MS;
    expect(
      toAgentSessionDto(row(), { tokenPaused: false, boardPausedAt: null }, now)
        .stale,
    ).toBe(false);
    expect(
      toAgentSessionDto(
        row(),
        { tokenPaused: false, boardPausedAt: null },
        now + 1,
      ).stale,
    ).toBe(true);
  });

  it("never marks a terminal session stale and hides its pause overlay", () => {
    const dto = toAgentSessionDto(
      row({
        status: "completed",
        endedAt: new Date(3_000),
        pausedAt: new Date(2_500),
        pausedBy: "admin-1",
        pausedReason: "hold",
      }),
      { tokenPaused: true, boardPausedAt: new Date(4_000) },
      10 * 60 * 1000,
    );
    expect(dto.stale).toBe(false);
    expect(dto.status).toBe("completed");
    expect(dto.endedAt).toBe(3_000);
    expect(dto.paused).toBe(false);
    expect(dto.pausedAt).toBeNull();
    expect(dto.pausedBy).toBeNull();
    expect(dto.pausedReason).toBeNull();
    expect(dto.pauseScope).toBeNull();
  });

  it("orders pause scopes token → board → session", () => {
    expect(
      toAgentSessionDto(
        row({ pausedAt: new Date(5_000) }),
        { tokenPaused: true, boardPausedAt: new Date(4_000) },
        10_000,
      ).pauseScope,
    ).toBe("token");
    expect(
      toAgentSessionDto(
        row({ pausedAt: new Date(5_000) }),
        { tokenPaused: false, boardPausedAt: new Date(4_000) },
        10_000,
      ).pauseScope,
    ).toBe("board");
    const sessionOnly = toAgentSessionDto(
      row({ pausedAt: new Date(5_000) }),
      { tokenPaused: false, boardPausedAt: null },
      10_000,
    );
    expect(sessionOnly.pauseScope).toBe("session");
    expect(sessionOnly.paused).toBe(true);
    expect(sessionOnly.pausedAt).toBe(5_000);
  });

  it("degrades an unknown stored status to active", () => {
    expect(
      toAgentSessionDto(
        row({ status: "future-status" }),
        { tokenPaused: false, boardPausedAt: null },
        3_000,
      ).status,
    ).toBe("active");
  });
});
