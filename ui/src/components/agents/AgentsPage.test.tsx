import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionDto,
  BoardAction,
  BoardSummary,
  RevertPreviewDto,
  RunDetailDto,
  RunSummaryDto,
} from "@janosik/shared";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { overviewItem, overviewResponse } from "@/test/agents-overview";

const hoisted = vi.hoisted(() => ({
  listBoards: vi.fn(),
  listTokens: vi.fn(),
  me: vi.fn(),
  listAgentSessions: vi.fn(),
  pauseAgentSession: vi.fn(),
  resumeAgentSession: vi.fn(),
  endAgentSession: vi.fn(),
  agentsOverview: vi.fn(),
  listApprovals: vi.fn(),
  getApproval: vi.fn(),
  decideApproval: vi.fn(),
  cancelApproval: vi.fn(),
  getBoard: vi.fn(),
  listMembers: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  previewRunRevert: vi.fn(),
  revertRun: vi.fn(),
}));

vi.mock("@/api/client", () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly body: unknown,
      message?: string,
    ) {
      super(message ?? `HTTP ${status}`);
      this.name = "ApiError";
    }
    get offline(): boolean {
      return this.status === 0;
    }
  }
  return {
    ApiError,
    isApiEnabled: () => true,
    api: {
      listBoards: hoisted.listBoards,
      listTokens: hoisted.listTokens,
      me: hoisted.me,
      listAgentSessions: hoisted.listAgentSessions,
      pauseAgentSession: hoisted.pauseAgentSession,
      resumeAgentSession: hoisted.resumeAgentSession,
      endAgentSession: hoisted.endAgentSession,
      agentsOverview: hoisted.agentsOverview,
      listApprovals: hoisted.listApprovals,
      getApproval: hoisted.getApproval,
      decideApproval: hoisted.decideApproval,
      cancelApproval: hoisted.cancelApproval,
      getBoard: hoisted.getBoard,
      listMembers: hoisted.listMembers,
      listRuns: hoisted.listRuns,
      getRun: hoisted.getRun,
      previewRunRevert: hoisted.previewRunRevert,
      revertRun: hoisted.revertRun,
    },
  };
});

vi.mock("@/store/BoardContext", () => ({
  useBoard: () => ({ boards: [] }),
}));

vi.mock("@/components/agents/use-agent-events", () => ({
  useAgentSessionEvents: () => {},
}));

import { AgentsPage } from "@/components/agents/AgentsPage";

const BOARDS: BoardSummary[] = [
  {
    id: "board-1",
    title: "Launch",
    counters: { cards: 0, columns: 0 },
    role: "ADMIN",
  },
  {
    id: "board-2",
    title: "Docs",
    counters: { cards: 0, columns: 0 },
    role: "MEMBER",
  },
];

function session(overrides: Partial<AgentSessionDto> = {}): AgentSessionDto {
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
    startedAt: Date.now() - 60_000,
    lastHeartbeatAt: Date.now() - 5_000,
    stale: false,
    paused: false,
    pausedAt: null,
    pausedBy: null,
    pausedReason: null,
    pauseScope: null,
    endedAt: null,
    endReason: null,
    summary: null,
    ...overrides,
  };
}

function approval(
  overrides: Partial<import("@janosik/shared").ApprovalRequestDto> = {},
): import("@janosik/shared").ApprovalRequestDto {
  return {
    id: "approval-1",
    boardId: "board-1",
    cardId: "card-1",
    requestedBy: "user-1",
    requestedByTokenId: "token-1",
    agentSessionId: "session-1",
    kind: "destructive",
    actionType: "DELETE_CARD",
    summary: "Delete card “Card claim visibility”",
    risk: "medium",
    planHash:
      "da83a7614519e38b98dfa916c737f3a7e8a40c74328962e486487fdd511a0eb1",
    status: "pending",
    expiresAt: Date.now() + 30 * 60_000,
    decidedBy: null,
    decidedAt: null,
    decisionComment: null,
    runId: null,
    consumedAt: null,
    createdAt: Date.now() - 5 * 60_000,
    plan: {
      schemaVersion: 1,
      boardId: "board-1",
      commands: [
        {
          commandId: "command-1",
          action: { type: "DELETE_CARD", cardId: "card-1" },
        },
      ],
    },
    ...overrides,
  };
}

function run(overrides: Partial<RunSummaryDto> = {}): RunSummaryDto {
  return {
    id: "run-1",
    boardId: "board-1",
    apiTokenId: "token-1",
    agentSessionId: "session-1",
    actorId: "user-1",
    kind: "batch",
    status: "applied",
    clientRunId: "client-1",
    planHash: "a".repeat(64),
    approvalId: null,
    commandCount: 2,
    firstSeq: 1,
    lastSeq: 2,
    revertsRunId: null,
    createdAt: Date.now() - 60_000,
    appliedAt: Date.now() - 59_000,
    revertedAt: null,
    ...overrides,
  };
}

function runDetail(overrides: Partial<RunSummaryDto> = {}): RunDetailDto {
  return {
    run: run(overrides),
    commands: [
      {
        seq: 1,
        action: {
          type: "DELETE_CARD",
          boardId: "board-1",
          cardId: "card-1",
          at: 1,
        } as unknown as BoardAction,
        actorId: "user-1",
        actorType: "agent",
        commandId: "command-1",
        touches: ["card:card-1"],
        runId: "run-1",
        agentName: "QA agent",
      },
    ],
    preimages: {
      "command-1": { schemaVersion: 1, entities: [] },
    },
  };
}

function revertPreview(
  overrides: Partial<RevertPreviewDto> = {},
): RevertPreviewDto {
  return {
    dryRun: true,
    run: run(),
    conflicts: [],
    canRevert: true,
    diff: { "card:card-1": { title: "Card claim visibility" } },
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.search}</span>;
}

function renderPage(path = "/agents") {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AgentsPage />
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listBoards.mockResolvedValue(BOARDS);
  hoisted.listTokens.mockResolvedValue([
    { id: "token-1", name: "QA agent" },
    { id: "token-2", name: "Docs agent" },
  ]);
  hoisted.me.mockResolvedValue({ id: "user-1", token: null });
  hoisted.agentsOverview.mockResolvedValue(overviewResponse([]));
  hoisted.listApprovals.mockResolvedValue([]);
  hoisted.getApproval.mockResolvedValue(approval());
  hoisted.decideApproval.mockResolvedValue(approval({ status: "rejected" }));
  hoisted.cancelApproval.mockResolvedValue(approval({ status: "cancelled" }));
  hoisted.getBoard.mockResolvedValue({
    id: "board-1",
    title: "Launch",
    columns: [],
    cards: {
      "card-1": {
        id: "card-1",
        title: "Card claim visibility",
        description: "",
        labelIds: [],
        checklists: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  });
  hoisted.listMembers.mockResolvedValue([
    {
      userId: "user-1",
      displayName: "UX Agent Audit",
      email: "ux@example.com",
      role: "ADMIN",
      expiresAt: null,
      avatarColor: null,
      avatarPath: null,
    },
  ]);
  hoisted.listRuns.mockResolvedValue([]);
  hoisted.getRun.mockResolvedValue(runDetail());
  hoisted.previewRunRevert.mockResolvedValue(revertPreview());
  hoisted.revertRun.mockResolvedValue(runDetail({ status: "reverted" }));
  hoisted.listAgentSessions.mockImplementation((boardId: string) =>
    Promise.resolve(
      boardId === "board-1"
        ? [
            session(),
            session({
              id: "session-2",
              status: "completed",
              endedAt: Date.now() - 1_000,
              lastHeartbeatAt: Date.now() - 1_100,
            }),
          ]
        : [
            session({
              id: "session-3",
              apiTokenId: "token-2",
              boardId: "board-2",
              name: "Docs pass",
              status: "waiting_approval",
              currentCardId: null,
              currentRunId: null,
            }),
          ],
    ),
  );
});

describe("AgentsPage", () => {
  it("warns and retains the last known sessions when one board fails", async () => {
    renderPage("/agents?section=sessions");
    expect(await screen.findByText("Docs agent")).toBeInTheDocument();
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-2"
        ? Promise.reject({ status: 503 })
        : Promise.resolve([session()]),
    );
    await userEvent.click(screen.getByTestId("agents-refresh"));
    expect(await screen.findByTestId("agents-error")).toHaveTextContent(
      "may be out of date",
    );
    expect(screen.getByText("Docs agent")).toBeInTheDocument();
    expect(screen.getAllByText("QA agent").length).toBeGreaterThan(0);
    expect(screen.getByText("Data may be out of date")).toBeInTheDocument();
    expect(screen.getByTestId("agents-updated")).toHaveTextContent(
      "incomplete",
    );
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      Promise.resolve(boardId === "board-1" ? [session()] : []),
    );
    await userEvent.click(screen.getByTestId("agents-retry"));
    await waitFor(() =>
      expect(screen.queryByTestId("agents-error")).toBeNull(),
    );
    expect(screen.queryByText("Docs agent")).toBeNull();
  });
  it("shows the scoped session count in the rail", async () => {
    renderPage("/agents?section=attention");

    const sessionsCount = await screen.findByTestId("agents-count-sessions");
    expect(sessionsCount).toHaveTextContent("3");
    expect(screen.queryByTestId("agents-count-attention")).toBeNull();
  });

  it("explains approvals to a member and never requests them", async () => {
    renderPage("/agents?board=board-2");

    expect(await screen.findByTestId("agents-member-note")).toHaveTextContent(
      "Approvals are handled by board admins.",
    );
    expect(screen.queryByTestId("agents-attention-clear")).toBeNull();
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(hoisted.agentsOverview).not.toHaveBeenCalled();
    expect(hoisted.listApprovals).not.toHaveBeenCalled();
  });

  it("never opens an approval detail from a member deep link", async () => {
    renderPage("/agents?section=attention&board=board-2&approval=approval-1");

    expect(await screen.findByTestId("agents-member-note")).toBeVisible();
    expect(hoisted.getApproval).not.toHaveBeenCalled();
    expect(hoisted.agentsOverview).not.toHaveBeenCalled();
    expect(hoisted.listApprovals).not.toHaveBeenCalled();
    expect(screen.queryByTestId("agents-approval-detail")).toBeNull();
  });

  it("shows the runs empty state and clear-all action", async () => {
    renderPage("/agents?section=runs");

    expect(await screen.findByTestId("agents-runs-empty")).toHaveTextContent(
      "No runs yet",
    );
    expect(screen.getByTestId("agents-runs-clear-all")).toBeInTheDocument();
    expect(screen.getByTestId("agents-runs-clear-all").className).toContain(
      "h-7",
    );
    expect(screen.getByTestId("agents-runs-clear-all").className).toContain(
      "font-[650]",
    );
    expect(screen.getByTestId("agents-runs-empty-clear").className).toContain(
      "h-7",
    );
    expect(screen.getByTestId("agents-runs-empty-clear").className).toContain(
      "text-[11px]",
    );
    const rollback = screen.getByRole("link", {
      name: "How rollback works",
    });
    expect(rollback.className).toContain("text-muted-foreground");
    expect(rollback.className).toContain("text-[11px]");
  });

  it("reads run filters from the URL, sends them to the API and clears them", async () => {
    hoisted.listRuns.mockResolvedValue([run()]);
    renderPage(
      "/agents?section=runs&board=board-1&status=applied&kind=batch&time=24h&agent=token-1&session=session-1",
    );

    expect(
      await screen.findByTestId("agents-run-row-run-1"),
    ).toBeInTheDocument();
    expect(hoisted.listRuns).toHaveBeenCalledWith(
      "board-1",
      expect.objectContaining({
        status: "applied",
        kind: "batch",
        apiTokenId: "token-1",
        agentSessionId: "session-1",
        from: expect.any(Number),
      }),
    );
    expect(screen.getByTestId("agents-run-filter-status")).toHaveTextContent(
      "Applied",
    );
    expect(screen.getByTestId("agents-run-filter-kind")).toHaveTextContent(
      "Batch",
    );
    expect(screen.getByTestId("agents-run-filter-time")).toHaveTextContent(
      "Last 24 hours",
    );
    expect(screen.getByTestId("agents-run-filter-token")).toHaveTextContent(
      "QA agent",
    );
    expect(screen.getByTestId("agents-run-filter-session")).toHaveTextContent(
      "Nightly triage",
    );
    expect(
      screen.queryByTestId("agents-run-filter-board"),
    ).not.toBeInTheDocument();
    const initialUrl = new URLSearchParams(
      screen.getByTestId("location").textContent ?? "",
    );
    expect(initialUrl.get("section")).toBe("runs");
    expect(initialUrl.get("board")).toBe("board-1");
    expect(initialUrl.get("status")).toBe("applied");
    expect(initialUrl.get("agent")).toBe("token-1");

    await userEvent.click(screen.getByTestId("agents-runs-clear-all"));
    await waitFor(() => {
      const last = hoisted.listRuns.mock.calls.at(-1)?.[1] as
        Record<string, unknown> | undefined;
      expect(last).not.toHaveProperty("status");
      expect(last).not.toHaveProperty("kind");
      expect(last).not.toHaveProperty("from");
      expect(last).not.toHaveProperty("apiTokenId");
      expect(last).not.toHaveProperty("agentSessionId");
      const cleared = new URLSearchParams(
        screen.getByTestId("location").textContent ?? "",
      );
      expect(cleared.get("status")).toBeNull();
      expect(cleared.get("kind")).toBeNull();
      expect(cleared.get("time")).toBeNull();
      expect(cleared.get("agent")).toBeNull();
      expect(cleared.get("session")).toBeNull();
      expect(cleared.get("board")).toBe("board-1");
    });
  });

  it("shows a loaded total and appends the next runs page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      run({
        id: `run-${index}`,
        createdAt: Date.now() - index * 1000,
        appliedAt: Date.now() - index * 1000,
      }),
    );
    hoisted.listRuns.mockImplementation(
      (boardId: string, query?: { cursor?: string }) =>
        boardId !== "board-1"
          ? Promise.resolve([])
          : Promise.resolve(
              query?.cursor === undefined
                ? firstPage
                : [run({ id: "run-old", createdAt: 1, appliedAt: 1 })],
            ),
    );
    renderPage("/agents?section=runs");

    const total = await screen.findByTestId("agents-runs-total");
    await waitFor(() => expect(total).toHaveTextContent("100 runs"));
    expect(total).toHaveAttribute("data-has-more", "true");
    await userEvent.click(screen.getByTestId("agents-runs-more"));

    await waitFor(() => expect(total).toHaveTextContent("101 runs"));
    expect(hoisted.listRuns).toHaveBeenLastCalledWith(
      "board-1",
      expect.objectContaining({ cursor: "run-99" }),
    );
  });

  it("keeps the auto-selected run when a refresh prepends its revert run", async () => {
    const revertRun = run({
      id: "run-revert",
      kind: "revert",
      revertsRunId: "run-1",
      createdAt: Date.now(),
      appliedAt: Date.now(),
    });
    hoisted.listRuns.mockResolvedValue([run()]);
    hoisted.getRun.mockImplementation((_boardId: string, runId: string) =>
      Promise.resolve(
        runDetail({
          id: runId,
          kind: runId === "run-revert" ? "revert" : "batch",
        }),
      ),
    );
    hoisted.previewRunRevert.mockResolvedValue(revertPreview());
    renderPage("/agents?section=runs");

    expect(await screen.findByTestId("agent-run-detail")).toHaveAttribute(
      "data-run-id",
      "run-1",
    );
    hoisted.listRuns.mockResolvedValue([revertRun, run()]);
    await userEvent.click(screen.getByTestId("agents-refresh"));

    expect(
      await screen.findByTestId("agents-run-row-run-revert"),
    ).toBeVisible();
    expect(screen.getByTestId("agent-run-detail")).toHaveAttribute(
      "data-run-id",
      "run-1",
    );
  });

  it("opens a board-scoped run deep link and copies a link with ?board=", async () => {
    hoisted.listRuns.mockResolvedValue([run()]);
    renderPage("/agents?section=runs&board=board-1&run=run-1");

    expect(await screen.findByTestId("agent-run-detail")).toBeVisible();
    expect(hoisted.getRun).toHaveBeenCalledWith("board-1", "run-1");
    expect(screen.getByTestId("agent-run-copy-link")).toHaveAttribute(
      "data-copy-url",
      "/agents?section=runs&board=board-1&run=run-1",
    );
    await userEvent.click(screen.getByTestId("agent-run-open-session"));
    expect(
      await screen.findByTestId("agents-session-detail-hint"),
    ).toBeVisible();
  });

  it("requires a board for a run deep link", async () => {
    renderPage("/agents?section=runs&run=run-1");
    expect(await screen.findByTestId("agents-missing-scope")).toHaveTextContent(
      "Approval and run links must include a board.",
    );
  });

  it("requires a board for an approval deep link", async () => {
    renderPage("/agents?section=attention&approval=approval-1");
    expect(await screen.findByTestId("agents-missing-scope")).toHaveTextContent(
      "Approval and run links must include a board.",
    );
  });

  it("keeps rollback read-only on a board where the caller is a member", async () => {
    const memberRun = run({ id: "run-2", boardId: "board-2" });
    hoisted.listRuns.mockResolvedValue([memberRun]);
    hoisted.getRun.mockResolvedValue(
      runDetail({ id: "run-2", boardId: "board-2" }),
    );
    renderPage("/agents?section=runs&board=board-2&run=run-2");

    expect(await screen.findByTestId("agent-run-detail")).toBeVisible();
    expect(screen.getByTestId("agent-run-admin-only-note")).toBeVisible();
    expect(screen.queryByTestId("agent-run-revert-apply")).toBeNull();
    expect(screen.queryByTestId("agent-run-preimages")).toBeNull();
    expect(screen.queryByTestId("agent-run-diff")).toBeNull();
  });

  it("shows the unknown-board recovery for a revoked run board", async () => {
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-1"
        ? Promise.reject({ status: 403 })
        : Promise.resolve([]),
    );
    hoisted.listRuns.mockResolvedValue([run()]);
    renderPage("/agents?section=runs&board=board-1&run=run-1");

    expect(await screen.findByTestId("agents-unknown-board")).toBeVisible();
    expect(screen.queryByTestId("agent-run-detail")).toBeNull();
  });

  it("links an approval run and session with ?board=", async () => {
    const row = approval({ runId: "run-1" });
    hoisted.listApprovals.mockResolvedValue([row]);
    hoisted.getApproval.mockResolvedValue(row);
    renderPage("/agents?section=attention&board=board-1&approval=approval-1");

    expect(await screen.findByTestId("approval-run-link")).toHaveAttribute(
      "href",
      "/agents?board=board-1&section=runs&run=run-1",
    );
    expect(await screen.findByTestId("approval-session-link")).toHaveAttribute(
      "href",
      "/agents?board=board-1&section=sessions&session=session-1",
    );
  });

  it("shows pending approvals in the rail and board scope", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );
    renderPage("/agents?section=attention");

    expect(
      await screen.findByTestId("agents-count-attention"),
    ).toHaveTextContent("1");
    expect(
      await screen.findByTestId("agents-approval-approval-1"),
    ).toHaveTextContent("Delete card");
    expect(hoisted.listApprovals).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("agents-filter-board"));
    expect(
      screen.getByTestId("agents-filter-board-option-board-1"),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId("agents-filter-board-option-board-2"),
    ).not.toHaveTextContent(/\d/);
  });

  it("uses the selected board scope and its exact count, not All boards", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()], {
        boardId: "board-1",
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );
    renderPage("/agents?section=attention&board=board-1");

    expect(
      await screen.findByTestId("agents-count-attention"),
    ).toHaveTextContent("1");
    expect(hoisted.agentsOverview).toHaveBeenCalledWith({
      section: "approvals",
      boardId: "board-1",
      limit: 100,
    });
    await userEvent.click(screen.getByTestId("agents-filter-board"));
    expect(
      screen.getByTestId("agents-filter-board-option-all"),
    ).toHaveTextContent("1");
  });

  it("counts only ADMIN boards in All scope and ignores member boards", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 1, "board-2": 7 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );
    renderPage("/agents?section=attention");

    expect(
      await screen.findByTestId("agents-count-attention"),
    ).toHaveTextContent("1");
    expect(hoisted.agentsOverview).toHaveBeenCalledWith({
      section: "approvals",
      limit: 100,
    });
    await userEvent.click(screen.getByTestId("agents-filter-board"));
    expect(
      screen.getByTestId("agents-filter-board-option-all"),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId("agents-filter-board-option-board-2"),
    ).not.toHaveTextContent(/\d/);
  });

  it("renders 99+ for large exact counts", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 150 },
        pendingTotal: 150,
        totalApprovals: 150,
        total: 150,
      }),
    );
    renderPage("/agents?section=attention");

    expect(
      await screen.findByTestId("agents-count-attention"),
    ).toHaveTextContent("99+");
    await userEvent.click(screen.getByTestId("agents-filter-board"));
    expect(
      screen.getByTestId("agents-filter-board-option-all"),
    ).toHaveTextContent("99+");
    expect(
      screen.getByTestId("agents-filter-board-option-board-1"),
    ).toHaveTextContent("99+");
  });

  it("renders an unknown count as unknown and retries a network failure", async () => {
    hoisted.agentsOverview.mockRejectedValueOnce({ status: 0 });
    renderPage("/agents?section=attention");

    const error = await screen.findByTestId("agents-approvals-error");
    expect(screen.queryByTestId("agents-count-attention")).toBeNull();
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );
    await userEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByTestId("agents-count-attention"),
    ).toHaveTextContent("1");
  });

  it("drops data on a confirmed 403 without a Retry trap", async () => {
    hoisted.agentsOverview.mockRejectedValueOnce({ status: 403 });
    renderPage("/agents?section=attention");

    await waitFor(() =>
      expect(hoisted.agentsOverview).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId("agents-approvals-error")).toBeNull();
    expect(screen.queryByTestId("agents-count-attention")).toBeNull();
  });

  it("keeps the last count but marks it stale after a failed refresh", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );
    renderPage("/agents?section=attention");

    expect(
      await screen.findByTestId("agents-count-attention"),
    ).toHaveTextContent("1");
    hoisted.agentsOverview.mockRejectedValueOnce({ status: 503 });
    await userEvent.click(screen.getByTestId("agents-refresh"));

    expect(
      await screen.findByTestId("agents-approvals-error"),
    ).toBeInTheDocument();
    const count = screen.getByTestId("agents-count-attention");
    expect(count).toHaveTextContent("1");
    expect(count).toHaveAttribute("data-state", "stale");
  });

  it("opens an approval plan and requires a rejection reason", async () => {
    const row = approval();
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem({ planHash: row.planHash })], {
        boardId: "board-1",
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );
    hoisted.getApproval.mockResolvedValue(row);
    renderPage("/agents?section=attention&board=board-1&approval=approval-1");

    expect(await screen.findByTestId("agents-approval-detail")).toBeVisible();
    expect(await screen.findByTestId("approval-plan-hash")).toHaveTextContent(
      row.planHash.slice(0, 44),
    );
    await userEvent.click(screen.getByTestId("approval-reject"));
    expect(screen.getByTestId("approval-confirm")).toBeDisabled();
    await userEvent.type(screen.getByTestId("approval-comment"), "Not now");
    expect(screen.getByTestId("approval-confirm")).toBeEnabled();
    await userEvent.click(screen.getByTestId("approval-confirm"));
    await waitFor(() =>
      expect(hoisted.decideApproval).toHaveBeenCalledWith(
        "board-1",
        "approval-1",
        {
          decision: "reject",
          planHash: row.planHash,
          comment: "Not now",
        },
      ),
    );
  });

  it("shows All clear when only decided approvals remain", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse(
        [
          overviewItem({
            status: "rejected",
            storedStatus: "rejected",
            decisionComment: "No",
          }),
        ],
        {
          boards: BOARDS,
          pendingByBoard: { "board-1": 0 },
          pendingTotal: 0,
          totalApprovals: 1,
        },
      ),
    );
    renderPage("/agents?section=attention");

    await waitFor(() =>
      expect(screen.getByTestId("agents-attention-clear")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("agents-approval-list")).toBeNull();
  });

  it("filters approvals by needs, decided and all with true counts", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse(
        [
          overviewItem(),
          overviewItem({
            id: "approval-2",
            status: "rejected",
            storedStatus: "rejected",
            summary: "Rejected request",
            decisionComment: "No",
          }),
        ],
        {
          boards: BOARDS,
          pendingByBoard: { "board-1": 1 },
          pendingTotal: 1,
          totalApprovals: 2,
        },
      ),
    );
    renderPage("/agents?section=attention");

    const list = await screen.findByTestId("agents-approval-list");
    expect(list).toHaveTextContent("Delete card");
    expect(list).not.toHaveTextContent("Rejected request");
    expect(
      screen.getByTestId("agents-approvals-filter-needs"),
    ).toHaveTextContent("1");
    await userEvent.click(
      screen.getByTestId("agents-approvals-filter-decided"),
    );
    expect(await screen.findByTestId("agents-approval-list")).toHaveTextContent(
      "Rejected request",
    );
    expect(
      screen.getByTestId("agents-approvals-filter-decided"),
    ).toHaveTextContent("1");
  });

  it("quick-rejects an approval with a required reason", async () => {
    const row = approval();
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem({ planHash: row.planHash })], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );
    renderPage("/agents?section=attention");

    await userEvent.click(
      await screen.findByTestId("agents-approval-reject-approval-1"),
    );
    expect(await screen.findByTestId("agents-approval-detail")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTestId("agents-approval-detail")).toHaveTextContent(
        "Reason for rejection",
      ),
    );
    expect(screen.getByTestId("approval-confirm")).toBeDisabled();
    await userEvent.type(
      screen.getByTestId("approval-comment"),
      "Not this card",
    );
    await userEvent.click(screen.getByTestId("approval-confirm"));
    await waitFor(() =>
      expect(hoisted.decideApproval).toHaveBeenCalledWith(
        "board-1",
        "approval-1",
        {
          decision: "reject",
          planHash: row.planHash,
          comment: "Not this card",
        },
      ),
    );
  });

  it("shows an expired approval without decision controls", async () => {
    const expired = approval({ expiresAt: Date.now() - 1_000 });
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse(
        [
          overviewItem({
            status: "expired",
            storedStatus: "pending",
            expiresAt: expired.expiresAt,
          }),
        ],
        {
          boardId: "board-1",
          boards: BOARDS,
          pendingByBoard: { "board-1": 0 },
          pendingTotal: 0,
          totalApprovals: 1,
        },
      ),
    );
    hoisted.getApproval.mockResolvedValue(expired);
    renderPage("/agents?section=attention&board=board-1&approval=approval-1");

    expect(await screen.findByTestId("agents-approval-detail")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTestId("agents-approval-detail")).toHaveTextContent(
        "Expired",
      ),
    );
    expect(screen.queryByTestId("approval-approve")).toBeNull();
    expect(screen.queryByTestId("approval-reject")).toBeNull();
  });

  it("groups sessions board-first and shows the board, status and heartbeat", async () => {
    renderPage("/agents?section=sessions");

    expect(
      await screen.findByTestId("agents-session-list"),
    ).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^agent-session-row-/);
    expect(rows).toHaveLength(3);
    const qa = rows.find((row) => row.textContent?.includes("QA agent"))!;
    const docs = rows.find((row) => row.textContent?.includes("Docs agent"))!;
    expect(qa).toHaveTextContent("Launch");
    expect(docs).toHaveTextContent("Docs");
    expect(screen.getAllByTestId("agent-heartbeat").length).toBeGreaterThan(0);
    expect(
      screen.getByTestId("agents-board-group-board-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("agents-board-group-board-2"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agents-group-meta-board-1").className).toContain(
      "ml-auto",
    );
    const banner = screen.getByTestId("agents-sessions-heartbeat-note");
    const toggle = screen.getByTestId("agents-session-group-toggle");
    expect(
      banner.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("filters by status from the URL without a round-trip", async () => {
    renderPage("/agents?section=sessions&status=completed");

    expect(
      await screen.findByTestId("agents-session-list"),
    ).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^agent-session-row-/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("QA agent");
    expect(rows[0]).toHaveTextContent("Completed");
  });

  it("groups by token and keeps the old ?token= filter link working", async () => {
    renderPage("/agents?section=sessions&group=token&token=token-2");

    expect(
      await screen.findByTestId("agents-session-list"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("agents-token-group-token-2"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("agents-token-group-token-1")).toBeNull();
    expect(screen.getAllByTestId(/^agent-session-row-/)).toHaveLength(1);
    expect(screen.getByTestId("agents-session-group-token")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("agents-session-group-board")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reads the canonical ?agent= token filter", async () => {
    renderPage("/agents?section=sessions&agent=token-2");

    expect(
      await screen.findByTestId("agents-session-list"),
    ).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^agent-session-row-/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Docs pass");
  });

  it("normalises a token-filter change to the canonical ?agent=", async () => {
    renderPage("/agents?section=sessions");
    await screen.findByTestId("agents-session-list");

    await userEvent.click(screen.getByTestId("agents-filter-token"));
    await userEvent.click(
      screen.getByTestId("agents-filter-token-option-token-2"),
    );

    await waitFor(() => {
      const search = screen.getByTestId("location").textContent ?? "";
      expect(search).toContain("agent=token-2");
      expect(search).not.toContain("token=token-2");
    });
  });

  it("keeps ?q= and applies the ?time= window from a shared URL", async () => {
    const monthAgo = Date.now() - 30 * 24 * 60 * 60_000;
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      Promise.resolve(
        boardId === "board-1"
          ? [
              session(),
              session({
                id: "session-old",
                name: "Nightly archive",
                lastHeartbeatAt: monthAgo,
                startedAt: monthAgo,
              }),
            ]
          : [],
      ),
    );
    renderPage("/agents?section=sessions&q=Nightly&time=24h");

    expect(await screen.findByTestId("agents-search")).toHaveValue("Nightly");
    expect(
      await screen.findByTestId("agent-session-row-session-1"),
    ).toBeVisible();
    // `session-old` matches the search text but falls outside the 24h
    // heartbeat window, so it proves the time filter is applied.
    expect(screen.queryByTestId("agent-session-row-session-old")).toBeNull();
    expect(screen.queryByTestId("agent-session-row-session-3")).toBeNull();
  });

  it("shows the filtered empty state and clears it", async () => {
    renderPage("/agents?section=sessions&status=failed");

    expect(
      await screen.findByTestId("agents-filtered-empty"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agents-clear-filters"));
    expect(
      await screen.findByTestId("agents-session-list"),
    ).toBeInTheDocument();
  });

  it("shows the sessions empty state when no agent has ever run", async () => {
    hoisted.listAgentSessions.mockResolvedValue([]);
    renderPage("/agents?section=sessions");

    expect(await screen.findByTestId("agents-empty")).toBeInTheDocument();
    expect(screen.getByTestId("agents-empty")).toHaveTextContent(
      "No agent sessions yet",
    );
    expect(screen.queryByTestId("agents-sessions-heartbeat-note")).toBeNull();
    expect(screen.queryByTestId("agents-session-group-toggle")).toBeNull();
    expect(screen.getByText("No agent sessions yet").className).toContain(
      "font-[650]",
    );
    expect(
      screen.getByText("No agent sessions yet").previousElementSibling
        ?.className,
    ).toContain("h-[38px]");
    expect(screen.getByTestId("agents-detail-create-key")).toBeInTheDocument();
    expect(screen.getByTestId("agents-detail-create-key").className).toContain(
      "agent-primary-strong",
    );
  });

  it("does not resurrect a deleted session from a deep link", async () => {
    renderPage("/agents?section=sessions&session=cmwdw8dnb00cyidjoyper0ppj");

    const missing = await screen.findByTestId("agents-session-detail-missing");
    expect(missing).toHaveTextContent("Session unavailable");
    expect(
      screen.getByText(
        "This session is no longer in the current scope. Clear the selection and choose another session.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agents-clear-selection")).toBeInTheDocument();
  });

  it("surfaces a failure and retries it", async () => {
    hoisted.listAgentSessions.mockRejectedValue({ status: 0 });
    renderPage("/agents?section=sessions");

    expect(await screen.findByTestId("agents-error")).toBeInTheDocument();
    expect(screen.getByTestId("agents-error")).toHaveTextContent(
      "Could not load agent sessions",
    );
    expect(screen.getByTestId("agents-load-error")).toBeInTheDocument();

    hoisted.listAgentSessions.mockResolvedValue([session()]);
    await userEvent.click(screen.getByTestId("agents-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("agents-session-list")).toBeInTheDocument(),
    );
  });
  it("defaults to Attention, switches sections, and preserves board scope", async () => {
    renderPage("/agents?board=board-1");
    await waitFor(() =>
      expect(screen.getByTestId("agents-attention-clear")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("agents-section-attention")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await userEvent.click(screen.getByTestId("agents-section-sessions"));
    expect(await screen.findByTestId("agents-session-list")).toHaveTextContent(
      "QA agent",
    );
    expect(
      screen.getByText(
        "Grouped by board. Heartbeat is a liveness signal, not a lifecycle status.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Docs agent")).toBeNull();
    await userEvent.click(screen.getByTestId("agents-section-runs"));
    expect(
      screen.getByText(
        "What agents changed, with a way back. History is grouped by day.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("agents-runs-empty")).toHaveTextContent(
      "No runs yet",
    );
  });

  it("removes rows when a board confirms access was revoked", async () => {
    renderPage("/agents?section=sessions");
    expect(await screen.findByText("Docs agent")).toBeInTheDocument();
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-2"
        ? Promise.reject({ status: 403 })
        : Promise.resolve([session()]),
    );
    await userEvent.click(screen.getByTestId("agents-refresh"));
    await waitFor(() => expect(screen.queryByText("Docs agent")).toBeNull());
    expect(screen.getAllByText("QA agent").length).toBeGreaterThan(0);
    expect(screen.getByTestId("agents-updated")).toHaveTextContent(
      "incomplete",
    );
  });

  it("offers recovery for an unknown board and scoped deep links", async () => {
    renderPage("/agents?section=sessions&board=unknown");
    expect(
      await screen.findByTestId("agents-unknown-board"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByTestId("agents-unknown-board")).getByRole("button", {
        name: "All boards",
      }),
    );
    expect(
      await screen.findByTestId("agents-session-list"),
    ).toBeInTheDocument();
  });

  it("offers API keys and documentation when there are no sessions", async () => {
    hoisted.listAgentSessions.mockResolvedValue([]);
    const open = vi.fn();
    window.addEventListener("janosik:open-api-keys", open);
    renderPage("/agents?section=sessions");
    await userEvent.click(
      await screen.findByRole("button", { name: "Create API key" }),
    );
    expect(open).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Read docs" })).toHaveAttribute(
      "href",
      expect.stringContaining("docs/"),
    );
    window.removeEventListener("janosik:open-api-keys", open);
  });
  it("honors session links and clears a missing selection", async () => {
    renderPage("/agents?section=sessions&board=board-1&session=missing");
    expect(await screen.findByTestId("agents-session-list")).toHaveTextContent(
      "QA agent",
    );
    expect(
      await screen.findByTestId("agents-session-detail-missing"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear selection" }),
    );
    expect(await screen.findByTestId("agents-session-list")).toHaveTextContent(
      "QA agent",
    );
    expect(screen.queryByTestId("agents-session-detail-missing")).toBeNull();
  });

  it("keeps the real lifecycle and renders heartbeat separately", async () => {
    const now = Date.now();
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      Promise.resolve(
        boardId !== "board-1"
          ? []
          : [
              session({
                id: "active-stale",
                status: "active",
                stale: true,
                lastHeartbeatAt: now - 6 * 60_000,
              }),
              session({ id: "idle", status: "idle", name: "Idle session" }),
              session({
                id: "waiting",
                status: "waiting_approval",
                name: "Waiting session",
              }),
              session({
                id: "completed",
                status: "completed",
                name: "Completed session",
                endedAt: now - 1_000,
              }),
              session({
                id: "failed",
                status: "failed",
                name: "Failed session",
                endedAt: now - 1_000,
              }),
              session({
                id: "cancelled",
                status: "cancelled",
                name: "Cancelled session",
                endedAt: now - 1_000,
              }),
            ],
      ),
    );
    renderPage("/agents?section=sessions&board=board-1");

    const list = await screen.findByTestId("agents-session-list");
    for (const status of [
      "active",
      "idle",
      "waiting_approval",
      "completed",
      "failed",
      "cancelled",
    ]) {
      expect(
        within(list).getByTestId(`agent-status-${status}`),
      ).toBeInTheDocument();
    }
    const staleRow = screen.getByTestId("agent-session-row-active-stale");
    expect(
      within(staleRow).getByTestId("agent-status-active"),
    ).toHaveTextContent("Active");
    expect(within(staleRow).queryByText("Stale")).toBeNull();
    const heartbeat = within(staleRow).getByTestId("agent-heartbeat");
    expect(heartbeat).toHaveAttribute("data-stale", "true");
    expect(heartbeat).toHaveTextContent("No heartbeat · 6m");
    expect(screen.queryByTestId("agent-stale-badge")).toBeNull();
    expect(screen.queryByText("Stale")).toBeNull();
  });

  it("pauses, resumes and ends a session with confirm and busy/error states", async () => {
    hoisted.pauseAgentSession.mockResolvedValue(
      session({
        paused: true,
        pausedAt: Date.now(),
        pausedBy: "user-1",
        pausedReason: "Review",
        pauseScope: "session",
      }),
    );
    hoisted.resumeAgentSession.mockResolvedValue(session());
    hoisted.endAgentSession.mockResolvedValue(
      session({
        status: "completed",
        endedAt: Date.now(),
        endReason: "completed",
      }),
    );
    renderPage("/agents?section=sessions&board=board-1&session=session-1");

    expect(
      await screen.findByTestId("agents-session-detail-hint"),
    ).toHaveTextContent("Agent writes are allowed");
    expect(screen.getByText(/Claims are not released/)).toBeInTheDocument();
    expect(screen.getByText(/release-claim/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("agents-session-pause"));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Pause this agent session?",
    );
    await userEvent.type(screen.getByTestId("agent-action-reason"), "Review");
    await userEvent.click(screen.getByTestId("agent-action-confirm"));
    await waitFor(() =>
      expect(hoisted.pauseAgentSession).toHaveBeenCalledWith(
        "board-1",
        "session-1",
        "Review",
      ),
    );
    expect(
      (await screen.findAllByTestId("agent-pause-badge-session")).length,
    ).toBeGreaterThan(0);

    await userEvent.click(screen.getByTestId("agents-session-resume"));
    await userEvent.click(await screen.findByTestId("agent-action-confirm"));
    await waitFor(() =>
      expect(hoisted.resumeAgentSession).toHaveBeenCalledWith(
        "board-1",
        "session-1",
        undefined,
      ),
    );

    await userEvent.click(screen.getByTestId("agents-session-end"));
    await userEvent.type(screen.getByTestId("agent-action-summary"), "Done");
    await userEvent.click(screen.getByTestId("agent-action-confirm"));
    await waitFor(() =>
      expect(hoisted.endAgentSession).toHaveBeenCalledWith(
        "board-1",
        "session-1",
        { status: "completed", summary: "Done" },
      ),
    );
    expect(
      (await screen.findAllByTestId("agent-status-completed")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("agents-session-pause")).toBeNull();
    expect(screen.queryByTestId("agents-session-resume")).toBeNull();
    expect(screen.queryByTestId("agents-session-end")).toBeNull();
  });

  it("keeps the action dialog open and reports a busy/error failure", async () => {
    hoisted.pauseAgentSession.mockRejectedValue({ status: 500 });
    renderPage("/agents?section=sessions&board=board-1&session=session-1");

    await userEvent.click(await screen.findByTestId("agents-session-pause"));
    await userEvent.click(await screen.findByTestId("agent-action-confirm"));
    expect(
      await screen.findByText("Could not update the session"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-action-confirm")).toBeEnabled();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Pause this agent session?",
    );
  });

  it("hides every session action on a terminal session", async () => {
    renderPage("/agents?section=sessions&board=board-1&session=session-2");

    expect(
      await screen.findByTestId("agents-session-detail-hint"),
    ).toHaveTextContent("This session completed");
    expect(screen.queryByTestId("agents-session-pause")).toBeNull();
    expect(screen.queryByTestId("agents-session-resume")).toBeNull();
    expect(screen.queryByTestId("agents-session-end")).toBeNull();
    expect(screen.queryByTestId("agents-session-open-board")).toBeNull();
  });

  it("shows token settings only for the caller's own token", async () => {
    hoisted.listTokens.mockResolvedValue([{ id: "token-1", name: "QA agent" }]);
    const own = renderPage(
      "/agents?section=sessions&board=board-1&session=session-1",
    );
    expect(
      await screen.findByTestId("agents-session-token-settings"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agents-session-token-settings-readonly"),
    ).toBeNull();
    own.unmount();

    renderPage("/agents?section=sessions&board=board-2&session=session-3");
    expect(
      await screen.findByTestId("agents-session-token-settings-readonly"),
    ).toHaveTextContent("Other member's token");
    expect(screen.queryByTestId("agents-session-token-settings")).toBeNull();
  });

  it("keeps the master-detail sheet and 44px actions on mobile", async () => {
    renderPage("/agents?section=sessions&board=board-1&session=session-1");

    expect(
      await screen.findByTestId("agents-session-detail-back"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("agents-session-sheet-scrim"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agents-session-pause").className).toContain(
      "min-h-11",
    );
    const drawer = screen.getByTestId("agents-detail-panel");
    expect(drawer.className).toContain("max-[1060px]:w-[min(372px,100%)]");
    expect(drawer.className).not.toContain("max-[1060px]:inset-0");
    await userEvent.click(screen.getByTestId("agents-session-detail-back"));
    expect(screen.queryByTestId("agents-session-sheet-scrim")).toBeNull();
    expect(
      await screen.findByTestId("agents-session-list"),
    ).toBeInTheDocument();
  });

  it("limits concurrent board requests to four", async () => {
    const boards = Array.from({ length: 9 }, (_, index) => ({
      ...BOARDS[0],
      id: `board-${index}`,
    }));
    hoisted.listBoards.mockResolvedValue(boards);
    let active = 0;
    let peak = 0;
    hoisted.listAgentSessions.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return [];
    });
    renderPage("/agents?section=sessions");
    expect(await screen.findByTestId("agents-empty")).toBeInTheDocument();
    expect(hoisted.listAgentSessions).toHaveBeenCalledTimes(9);
    expect(peak).toBe(4);
  });
  it("supports keyboard navigation between sections", async () => {
    renderPage();
    const attention = screen.getByTestId("agents-section-attention");
    attention.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByTestId("agents-section-sessions")).toHaveFocus();
    expect(screen.getByTestId("agents-section-sessions")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.keyboard("{End}");
    expect(screen.getByTestId("agents-section-runs")).toHaveFocus();
  });
});
