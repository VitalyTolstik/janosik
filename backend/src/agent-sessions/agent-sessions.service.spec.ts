import type { AgentSession } from "@prisma/client";
import { AGENT_SESSION_STALE_MS } from "@janosik/shared";
import {
  AgentSessionsService,
  toAgentSessionDto,
} from "./agent-sessions.service";

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
    lastHeartbeatPublishedAt: null,
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

describe("heartbeat SSE (TASK-180.4 M27)", () => {
  function service(session: AgentSession) {
    const prisma = {
      agentSession: {
        findUnique: jest.fn(async () => session),
        updateMany: jest.fn(
          async ({ data }: { data: Partial<AgentSession> }) => {
            Object.assign(session, data);
            return { count: 1 };
          },
        ),
      },
      board: {
        findUnique: jest.fn(async () => ({ agentsPausedAt: null })),
      },
      apiToken: {
        findUnique: jest.fn(async () => ({
          name: "CI",
          individualPausedAt: null,
          stopAllPausedAt: null,
        })),
      },
      card: { findFirst: jest.fn(async () => ({ id: "card-1" })) },
    };
    const realtime = { publish: jest.fn() };
    const service = new AgentSessionsService(
      prisma as never,
      {} as never,
      realtime as never,
    );
    return { service, realtime, prisma };
  }

  const principal = {
    via: "pat",
    apiTokenId: "token-1",
    apiTokenName: "CI",
    tokenIdentity: { paused: false },
  };

  it("publishes one throttled session frame after an overdue heartbeat", async () => {
    const { service: sessions, realtime } = service(
      row({ lastHeartbeatAt: new Date(Date.now() - 61_000) }),
    );
    await sessions.heartbeat(
      "board-1",
      "sess-1",
      "user-1",
      principal as never,
      {},
    );

    expect(realtime.publish).toHaveBeenCalledWith(
      "board-1",
      expect.objectContaining({
        type: "agent",
        op: "heartbeat",
        sessionId: "sess-1",
        scope: "session",
      }),
    );
  });

  it("publishes at 0 and 61 seconds with a heartbeat at 30 seconds", async () => {
    jest.useFakeTimers();
    try {
      const { service: sessions, realtime } = service(row());
      const start = Date.now();
      for (const [elapsed, frames] of [
        [0, 1],
        [30_000, 1],
        [61_000, 2],
      ]) {
        jest.setSystemTime(start + elapsed);
        await sessions.heartbeat(
          "board-1",
          "sess-1",
          "user-1",
          principal as never,
          {},
        );
        expect(realtime.publish).toHaveBeenCalledTimes(frames);
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not publish for a heartbeat inside the throttle window", async () => {
    const { service: sessions, realtime } = service(
      row({ lastHeartbeatPublishedAt: new Date(Date.now() - 10_000) }),
    );
    await sessions.heartbeat(
      "board-1",
      "sess-1",
      "user-1",
      principal as never,
      {},
    );

    expect(realtime.publish).not.toHaveBeenCalled();
  });
});

describe("board pause SSE (TASK-166.14)", () => {
  const board = {
    agentsPausedAt: null as Date | null,
    agentsPausedBy: null as string | null,
    agentsPauseReason: null as string | null,
  };

  function service(current: typeof board) {
    const update = jest.fn(
      async ({ data }: { data: Partial<typeof board> }) => ({
        ...current,
        ...data,
      }),
    );
    const tx = {
      board: {
        findUniqueOrThrow: jest.fn(async () => current),
        update,
      },
      activity: { create: jest.fn(async () => undefined) },
    };
    const prisma = {
      board: { findFirst: jest.fn(async () => ({ id: "board-1" })) },
    };
    const boardWrite = {
      run: jest.fn(
        async (
          _boardId: string,
          fn: (transaction: typeof tx) => Promise<unknown>,
        ) => fn(tx),
      ),
    };
    const realtime = { publish: jest.fn() };
    const service = new AgentSessionsService(
      prisma as never,
      boardWrite as never,
      realtime as never,
    );
    return { service, realtime, update };
  }

  it("publishes a board-scoped paused frame after the transaction", async () => {
    const { service: sessions, realtime } = service({ ...board });
    const result = await sessions.pauseBoard("board-1", "user-1", "freeze");

    expect(result.paused).toBe(true);
    expect(result.reason).toBe("freeze");
    expect(realtime.publish).toHaveBeenCalledWith(
      "board-1",
      expect.objectContaining({
        type: "agent",
        op: "paused",
        scope: "board",
      }),
    );
  });

  it("does not publish when the board is already paused", async () => {
    const { service: sessions, realtime } = service({
      agentsPausedAt: new Date(1_000),
      agentsPausedBy: "user-2",
      agentsPauseReason: "already",
    });
    await sessions.pauseBoard("board-1", "user-1", "again");
    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it("publishes a resumed frame only after an actual resume", async () => {
    const { service: sessions, realtime } = service({
      agentsPausedAt: new Date(1_000),
      agentsPausedBy: "user-2",
      agentsPauseReason: "freeze",
    });
    const result = await sessions.resumeBoard("board-1", "user-1", "done");

    expect(result.paused).toBe(false);
    expect(realtime.publish).toHaveBeenCalledWith(
      "board-1",
      expect.objectContaining({
        type: "agent",
        op: "resumed",
        scope: "board",
      }),
    );
  });
});
