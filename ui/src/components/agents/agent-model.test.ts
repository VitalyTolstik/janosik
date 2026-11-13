import { describe, expect, it } from "vitest";

import {
  EMPTY_AGENT_FILTER,
  agentStatusTone,
  compactAge,
  groupAgents,
  heartbeatAge,
  isLiveSession,
  latestLiveSession,
  matchesAgentFilter,
  readAgentFilter,
  readAgentGroup,
  type AgentSessionRow,
} from "@/components/agents/agent-model";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

function row(overrides: Partial<AgentSessionRow> = {}): AgentSessionRow {
  return {
    id: "session-1",
    userId: "user-1",
    apiTokenId: "token-1",
    boardId: "board-1",
    name: "Nightly triage",
    clientName: "mcp",
    model: "gpt-5",
    status: "active",
    currentCardId: "card-1",
    currentRunId: "run-1",
    startedAt: NOW - 60_000,
    lastHeartbeatAt: NOW - 5_000,
    stale: false,
    paused: false,
    pausedAt: null,
    pausedBy: null,
    pausedReason: null,
    pauseScope: null,
    endedAt: null,
    endReason: null,
    summary: null,
    boardTitle: "Launch",
    boardRole: "ADMIN",
    cardTitle: "Ship it",
    tokenName: "QA agent",
    isOwnToken: true,
    ...overrides,
  };
}

describe("agent session filters", () => {
  it("matches board, token, status and search", () => {
    const session = row();
    expect(matchesAgentFilter(session, EMPTY_AGENT_FILTER, NOW)).toBe(true);
    expect(
      matchesAgentFilter(
        session,
        { ...EMPTY_AGENT_FILTER, board: "other" },
        NOW,
      ),
    ).toBe(false);
    expect(
      matchesAgentFilter(
        session,
        { ...EMPTY_AGENT_FILTER, token: "other" },
        NOW,
      ),
    ).toBe(false);
    expect(
      matchesAgentFilter(
        session,
        { ...EMPTY_AGENT_FILTER, status: "completed" },
        NOW,
      ),
    ).toBe(false);
    expect(
      matchesAgentFilter(
        session,
        { ...EMPTY_AGENT_FILTER, query: "ship" },
        NOW,
      ),
    ).toBe(true);
    expect(
      matchesAgentFilter(
        session,
        { ...EMPTY_AGENT_FILTER, query: "no such" },
        NOW,
      ),
    ).toBe(false);
  });

  it("separates live, stale and historical sessions", () => {
    const live = row();
    const stale = row({
      id: "session-2",
      stale: true,
      lastHeartbeatAt: NOW - 1,
    });
    const ended = row({
      id: "session-3",
      status: "completed",
      endedAt: NOW - 1_000,
    });
    expect(isLiveSession(live)).toBe(true);
    expect(isLiveSession(ended)).toBe(false);
    expect(
      matchesAgentFilter(ended, { ...EMPTY_AGENT_FILTER, status: "live" }, NOW),
    ).toBe(false);
    expect(
      matchesAgentFilter(
        stale,
        { ...EMPTY_AGENT_FILTER, status: "stale" },
        NOW,
      ),
    ).toBe(true);
  });

  it("applies the last-seen window to the heartbeat or the end time", () => {
    const recent = row();
    const old = row({ id: "old", lastHeartbeatAt: NOW - 8 * 24 * 3_600_000 });
    expect(
      matchesAgentFilter(old, { ...EMPTY_AGENT_FILTER, time: "7d" }, NOW),
    ).toBe(false);
    expect(
      matchesAgentFilter(recent, { ...EMPTY_AGENT_FILTER, time: "24h" }, NOW),
    ).toBe(true);
  });

  it("reads the filter from the URL and ignores unknown values", () => {
    const params = new URLSearchParams(
      "board=b-1&token=t-1&status=stale&time=7d&q=night",
    );
    expect(readAgentFilter(params)).toEqual({
      board: "b-1",
      token: "t-1",
      status: "stale",
      time: "7d",
      query: "night",
    });
    expect(
      readAgentFilter(new URLSearchParams("status=nope&time=ever")),
    ).toEqual(EMPTY_AGENT_FILTER);
  });

  it("reads the board-first/token grouping switch and preserves the default", () => {
    expect(readAgentGroup(new URLSearchParams())).toBe("board");
    expect(readAgentGroup(new URLSearchParams("group=board"))).toBe("board");
    expect(readAgentGroup(new URLSearchParams("group=token"))).toBe("token");
    expect(readAgentGroup(new URLSearchParams("group=nope"))).toBe("board");
  });
});

describe("session liveness helpers", () => {
  it("formats compact heartbeat ages without inventing a lifecycle status", () => {
    expect(compactAge(0)).toBe("0s");
    expect(compactAge(12_000)).toBe("12s");
    expect(compactAge(6 * 60_000)).toBe("6m");
    expect(compactAge(3 * 3_600_000)).toBe("3h");
    expect(compactAge(2 * 24 * 3_600_000)).toBe("2d");
    expect(heartbeatAge(row({ lastHeartbeatAt: NOW - 5_000 }), NOW)).toBe(
      5_000,
    );
    expect(heartbeatAge(row({ lastHeartbeatAt: NOW + 5_000 }), NOW)).toBe(0);
  });

  it("maps only the six real lifecycle statuses to tones", () => {
    expect(agentStatusTone("active")).toBe("ok");
    expect(agentStatusTone("waiting_approval")).toBe("warn");
    expect(agentStatusTone("failed")).toBe("bad");
    expect(agentStatusTone("completed")).toBe("primary");
    expect(agentStatusTone("idle")).toBe("muted");
    expect(agentStatusTone("cancelled")).toBe("muted");
  });
});

describe("agent grouping", () => {
  it("keeps two tokens of one account as two agents", () => {
    const groups = groupAgents([
      row({ id: "a", apiTokenId: "token-a", tokenName: "QA agent" }),
      row({
        id: "b",
        apiTokenId: "token-b",
        tokenName: "Docs agent",
        lastHeartbeatAt: NOW - 60_000,
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.name).sort()).toEqual([
      "Docs agent",
      "QA agent",
    ]);
  });

  it("counts live and waiting sessions per token", () => {
    const groups = groupAgents([
      row({ id: "a", status: "active" }),
      row({ id: "b", status: "waiting_approval", lastHeartbeatAt: NOW - 20 }),
      row({
        id: "c",
        status: "completed",
        endedAt: NOW - 10,
        lastHeartbeatAt: NOW - 10,
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].liveCount).toBe(2);
    expect(groups[0].waitingCount).toBe(1);
    expect(groups[0].rows).toHaveLength(3);
    expect(latestLiveSession(groups[0])?.id).toBe("b");
  });

  it("falls back to the session name when the token name is private", () => {
    const groups = groupAgents([
      row({ tokenName: null, name: "Nightly triage" }),
    ]);
    expect(groups[0].name).toBe("Nightly triage");
  });
});
