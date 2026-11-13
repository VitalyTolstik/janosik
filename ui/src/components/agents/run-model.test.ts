import { describe, expect, it } from "vitest";

import {
  EMPTY_RUN_FILTER,
  groupRunsByDay,
  hasRunFilter,
  readRunFilter,
  runBoardRole,
  runFrom,
  runLink,
  runTime,
  writeRunFilter,
  type AgentRunFilter,
} from "@/components/agents/run-model";

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    boardId: "board-1",
    apiTokenId: null,
    agentSessionId: null,
    actorId: "user-1",
    kind: "batch" as const,
    status: "applied" as const,
    clientRunId: null,
    planHash: null,
    approvalId: null,
    commandCount: 1,
    firstSeq: 1,
    lastSeq: 1,
    revertsRunId: null,
    createdAt: NOW,
    appliedAt: NOW,
    revertedAt: null,
    ...overrides,
  };
}

describe("run filters", () => {
  it("reads the URL contract and keeps the old ?token= alias", () => {
    const filter = readRunFilter(
      new URLSearchParams(
        "board=board-1&status=reverted&kind=plan&time=7d&agent=token-1&session=session-1",
      ),
    );
    expect(filter).toEqual({
      board: "board-1",
      status: "reverted",
      kind: "plan",
      token: "token-1",
      session: "session-1",
      time: "7d",
    });
    expect(readRunFilter(new URLSearchParams("token=legacy-token")).token).toBe(
      "legacy-token",
    );
  });

  it("ignores values from another section instead of rendering a broken filter", () => {
    expect(
      readRunFilter(new URLSearchParams("status=active&kind=unknown&time=1h")),
    ).toEqual(EMPTY_RUN_FILTER);
  });

  it("writes defaults out of the URL and removes the old alias", () => {
    const params = new URLSearchParams("token=legacy&status=failed");
    const next: AgentRunFilter = {
      board: "board-2",
      status: "applied",
      kind: "single",
      token: "token-2",
      session: "session-2",
      time: "any",
    };
    writeRunFilter(params, next);
    expect(params.get("board")).toBe("board-2");
    expect(params.get("status")).toBe("applied");
    expect(params.get("kind")).toBe("single");
    expect(params.get("agent")).toBe("token-2");
    expect(params.get("session")).toBe("session-2");
    expect(params.get("time")).toBeNull();
    expect(params.get("token")).toBeNull();

    writeRunFilter(params, EMPTY_RUN_FILTER);
    expect(params.toString()).toBe("");
  });

  it("computes the time window and detects an active filter", () => {
    expect(runFrom("any", NOW)).toBeUndefined();
    expect(runFrom("24h", NOW)).toBe(NOW - 24 * 60 * 60 * 1000);
    expect(hasRunFilter(EMPTY_RUN_FILTER)).toBe(false);
    expect(hasRunFilter({ ...EMPTY_RUN_FILTER, kind: "plan" })).toBe(true);
  });

  it("always puts the board into a run deep link", () => {
    expect(runLink("board-1", "run-9")).toBe(
      "/agents?section=runs&board=board-1&run=run-9",
    );
  });

  it("groups by local day newest-first and orders by apply time", () => {
    const today = run({ id: "today", createdAt: NOW, appliedAt: NOW });
    const yesterday = run({
      id: "yesterday",
      createdAt: NOW - 24 * 60 * 60 * 1000,
      appliedAt: NOW - 24 * 60 * 60 * 1000,
    });
    expect(runTime(yesterday)).toBe(yesterday.appliedAt);
    const groups = groupRunsByDay([yesterday, today]);
    expect(groups.map((group) => group.rows.map((row) => row.id))).toEqual([
      ["today"],
      ["yesterday"],
    ]);
  });

  it("treats an unknown board as no role", () => {
    expect(
      runBoardRole(
        [{ id: "board-1", title: "Launch", role: "ADMIN" }],
        "board-1",
      ),
    ).toBe("ADMIN");
    expect(runBoardRole([], "board-1")).toBeUndefined();
  });
});
