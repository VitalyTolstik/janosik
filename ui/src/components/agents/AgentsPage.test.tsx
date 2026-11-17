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

import { ApiError } from "@/api/client";
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
  const summary = run(overrides);
  // Fixtures mirror a real applied run: one stored command (and pre-image)
  // per recorded command, so the Commands section cannot claim N applied
  // while rendering zero rows.
  const commands = Array.from({ length: summary.commandCount }, (_, index) => ({
    seq: index + 1,
    action: {
      type: "DELETE_CARD",
      boardId: summary.boardId,
      cardId: "card-1",
      at: 1,
    } as unknown as BoardAction,
    actorId: "user-1",
    actorType: "agent" as const,
    commandId: `command-${index + 1}`,
    touches: [`card:card-${index + 1}`],
    runId: summary.id,
    agentName: "QA agent",
  }));
  return {
    run: summary,
    commands,
    preimages: Object.fromEntries(
      commands.map((command) => [
        command.commandId,
        { schemaVersion: 1, entities: [] },
      ]),
    ),
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
  it("shows one partial-error banner on Runs when sessions and runs both fail", async () => {
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-2"
        ? Promise.reject({ status: 503 })
        : Promise.resolve([session()]),
    );
    hoisted.listRuns.mockImplementation((boardId: string) =>
      boardId === "board-2"
        ? Promise.reject({ status: 503 })
        : Promise.resolve([run({ id: `run-${boardId}`, boardId })]),
    );
    renderPage("/agents?section=runs");

    const banner = await screen.findByTestId("agents-runs-stale");
    expect(banner).toHaveTextContent("Docs");
    expect(banner).toHaveTextContent("Some boards are unavailable");
    expect(banner).toHaveTextContent("Boards: Docs");
    expect(banner).not.toHaveTextContent("Unavailable:");
    expect(screen.queryByTestId("agents-error")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(
      screen.getByTestId("agents-run-row-run-board-1"),
    ).toBeInTheDocument();
  });

  it("shows only the sessions banner on Runs when runs still succeed", async () => {
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-2"
        ? Promise.reject({ status: 503 })
        : Promise.resolve([session()]),
    );
    hoisted.listRuns.mockImplementation((boardId: string) =>
      Promise.resolve([run({ id: `run-${boardId}`, boardId })]),
    );
    renderPage("/agents?section=runs");

    const banner = await screen.findByTestId("agents-error");
    expect(banner).toHaveTextContent("Boards: Docs");
    expect(banner).not.toHaveTextContent("Unavailable:");
    expect(screen.queryByTestId("agents-runs-stale")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("shows only the runs banner on Runs when sessions still succeed", async () => {
    hoisted.listRuns.mockImplementation((boardId: string) =>
      boardId === "board-2"
        ? Promise.reject({ status: 503 })
        : Promise.resolve([run({ id: `run-${boardId}`, boardId })]),
    );
    renderPage("/agents?section=runs");

    const banner = await screen.findByTestId("agents-runs-stale");
    expect(banner).toHaveTextContent("Boards: Docs");
    expect(banner).not.toHaveTextContent("Unavailable:");
    expect(screen.queryByTestId("agents-error")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

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
  it("renders a human run title from the command summary hint", async () => {
    hoisted.listRuns.mockResolvedValue([
      run({
        commandSummary: { actionTypes: ["ADD_CARD"], title: null },
        commandCount: 2,
      }),
    ]);
    renderPage("/agents?section=runs&board=board-1&run=run-1");

    expect(
      await screen.findByText("QA agent added 2 cards"),
    ).toBeInTheDocument();
  });

  it("shows the scoped session count in the rail", async () => {
    renderPage("/agents?section=attention");

    const sessionsCount = await screen.findByTestId("agents-count-sessions");
    expect(sessionsCount).toHaveTextContent("3");
    expect(screen.queryByTestId("agents-count-attention")).toBeNull();
  });

  it("shows the runs count before the Runs tab is opened", async () => {
    hoisted.listRuns.mockImplementation((boardId: string) =>
      Promise.resolve(
        boardId === "board-1"
          ? [run({ id: "run-a" }), run({ id: "run-b" })]
          : [],
      ),
    );
    renderPage("/agents?section=attention");

    expect(await screen.findByTestId("agents-count-runs")).toHaveTextContent(
      "2",
    );
  });

  it("opens the board agent-control Live surface from a session", async () => {
    renderPage("/agents?section=sessions&board=board-1&session=session-1");

    const open = await screen.findByTestId("agents-session-open-board");
    expect(open).toHaveAttribute("href", "/board/board-1?agents=live");
  });

  it("explains approvals to a member and requests only cross-board counts", async () => {
    renderPage("/agents?board=board-2");

    expect(await screen.findByTestId("agents-member-note")).toHaveTextContent(
      "Approvals are handled by board admins on this board.",
    );
    expect(screen.queryByTestId("agents-attention-clear")).toBeNull();
    expect(screen.getByTestId("agents-boards-scope")).toHaveTextContent(
      "Pending",
    );
    // No approval can be selected for this member, so Attention falls back
    // to the first filtered session detail instead of "Nothing selected".
    expect(
      await screen.findByTestId("agents-session-detail-hint"),
    ).toBeVisible();
    expect(screen.getByTestId("agents-detail-panel")).not.toHaveTextContent(
      "Nothing selected",
    );
    expect(hoisted.agentsOverview).toHaveBeenCalledWith({
      section: "approvals",
      limit: 100,
    });
    expect(hoisted.getApproval).not.toHaveBeenCalled();
    expect(hoisted.listApprovals).not.toHaveBeenCalled();
  });

  it("keeps the admin Attention detail empty when no approval is visible", async () => {
    renderPage("/agents?section=attention&board=board-1");

    expect(await screen.findByText("Nothing selected")).toBeInTheDocument();
    expect(screen.queryByTestId("agents-session-detail-hint")).toBeNull();
  });

  it("never opens an approval detail from a member deep link", async () => {
    renderPage("/agents?section=attention&board=board-2&approval=approval-1");

    expect(await screen.findByTestId("agents-member-note")).toBeVisible();
    expect(hoisted.getApproval).not.toHaveBeenCalled();
    expect(hoisted.agentsOverview).toHaveBeenCalledWith({
      section: "approvals",
      limit: 100,
    });
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
    expect(rollback.getAttribute("href")).toMatch(
      /\/docs\/user-guide\/agents\/#rollback-and-run-recovery$/,
    );
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
    const firstPage = Array.from({ length: 10 }, (_, index) =>
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
    await waitFor(() =>
      expect(screen.getByTestId("agents-count-runs")).toHaveTextContent("11"),
    );
    await waitFor(() => expect(total).toHaveTextContent("7 runs shown"));
    expect(total).toHaveAttribute("data-has-more", "true");
    await userEvent.click(screen.getByTestId("agents-runs-more"));
    await waitFor(() => expect(total).toHaveTextContent("10 runs shown"));
    await userEvent.click(screen.getByTestId("agents-runs-more"));

    await waitFor(() => expect(total).toHaveTextContent("11 runs shown"));
    expect(hoisted.listRuns).toHaveBeenLastCalledWith(
      "board-1",
      expect.objectContaining({ cursor: "run-9" }),
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

  it("keeps all boards in the list when opening a run", async () => {
    hoisted.listRuns.mockImplementation((boardId: string) =>
      Promise.resolve([run({ id: `run-${boardId}`, boardId })]),
    );
    hoisted.getRun.mockResolvedValue(runDetail({ id: "run-board-1" }));
    renderPage("/agents?section=runs");
    await userEvent.click(
      await screen.findByTestId("agents-run-row-run-board-1"),
    );
    expect(
      screen.getByTestId("agents-run-row-run-board-2"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("scope=all");
    expect(await screen.findByTestId("agent-run-detail")).toHaveAttribute(
      "data-run-id",
      "run-board-1",
    );
  });

  it("shows a conflict chip in the list before the run is opened", async () => {
    hoisted.listRuns.mockImplementation((boardId: string) =>
      Promise.resolve([run({ id: `run-${boardId}`, boardId })]),
    );
    hoisted.getRun.mockResolvedValue(runDetail({ id: "run-board-1" }));
    hoisted.previewRunRevert.mockImplementation(
      (_boardId: string, runId: string) =>
        Promise.resolve(
          revertPreview({
            conflicts:
              runId === "run-board-1"
                ? [
                    {
                      touch: "card:card-1",
                      expectedVersion: 1,
                      currentVersion: 2,
                      reason: "version_changed",
                    },
                  ]
                : [],
          }),
        ),
    );
    renderPage("/agents?section=runs");

    expect(await screen.findByText("1 conflict")).toBeInTheDocument();
    expect(
      await screen.findByTestId("agents-run-row-run-board-1"),
    ).toHaveTextContent("1 conflict");
    expect(
      screen.getByTestId("agents-run-row-run-board-2"),
    ).not.toHaveTextContent("conflict");
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

  it("renders the run detail with mockup commands, timeline, icons and footer", async () => {
    hoisted.listRuns.mockResolvedValue([run()]);
    renderPage("/agents?section=runs&board=board-1&run=run-1");

    const detail = await screen.findByTestId("agent-run-detail");
    const commands = screen.getByTestId("agent-run-commands");
    expect(within(commands).getAllByTestId(/^agent-run-command-/)).toHaveLength(
      2,
    );
    expect(screen.queryByTestId("agent-run-commands-missing")).toBeNull();
    expect(within(detail).getByText("Commands")).toBeInTheDocument();
    expect(within(detail).queryByText("Commands (0)")).toBeNull();

    const timeline = screen.getByTestId("agent-run-timeline");
    expect(within(timeline).getAllByText(/,/).length).toBeGreaterThan(0);
    expect(within(timeline).getAllByText(/Today, /).length).toBe(2);
    expect(within(timeline).queryByText(/11\/\d{1,2}\/\d{2}/)).toBeNull();

    expect(
      within(detail).getByText(
        "Re-applies 2 pre-images atomically. No conflicts found. A separate audit run records the revert.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Runs are history. Rollback is available only for applied runs without conflicts.",
      ),
    ).toBeInTheDocument();

    // Mockup icons: no folder on the board chip, Activity for the session
    // link, Link for copy-link, and no icon on the footer's Open board.
    expect(
      screen.getByTestId("agent-run-board-chip").querySelector("svg"),
    ).toBeNull();
    expect(
      screen
        .getByTestId("agent-run-open-session")
        .querySelector("svg")
        ?.getAttribute("class"),
    ).toContain("lucide-activity");
    expect(
      screen
        .getByTestId("agent-run-footer-copy-link")
        .querySelector("svg")
        ?.getAttribute("class"),
    ).toContain("lucide-link");
    expect(
      screen.getByTestId("agent-run-footer-open-board").querySelector("svg"),
    ).toBeNull();
    const footerOpen = screen.getByTestId("agent-run-footer-open-board");
    expect(footerOpen.className).toContain("h-8");
    expect(footerOpen.className).toContain("text-[11.5px]");
    expect(footerOpen).toHaveAttribute("href", "/board/board-1?agents=runs");
    const footerCopy = screen.getByTestId("agent-run-footer-copy-link");
    expect(footerCopy.className).toContain("h-8");
    expect(footerCopy.querySelector("svg")).toHaveClass("h-[13px]", "w-[13px]");
  });

  it("keeps a failed rollback error visible after the pane refreshes", async () => {
    hoisted.listRuns.mockResolvedValue([run()]);
    hoisted.getRun.mockResolvedValue(runDetail());
    hoisted.previewRunRevert.mockResolvedValue(revertPreview());
    hoisted.revertRun.mockRejectedValue(
      new ApiError(409, {
        code: "run_conflict",
        message: "another writer changed an affected entity",
      }),
    );
    renderPage("/agents?section=runs&board=board-1&run=run-1");

    await userEvent.click(await screen.findByTestId("agent-run-revert-apply"));
    await userEvent.click(await screen.findByTestId("run-revert-confirm"));

    expect(
      await screen.findByTestId("agent-run-action-error"),
    ).toHaveTextContent("another writer changed an affected entity");
    await waitFor(() => expect(hoisted.getRun).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("agent-run-action-error")).toBeVisible();
  });

  it("is honest when a run records commands but has no stored log", async () => {
    hoisted.listRuns.mockResolvedValue([run({ commandCount: 2 })]);
    hoisted.getRun.mockResolvedValue({
      ...runDetail({ commandCount: 2 }),
      commands: [],
      preimages: {},
    });
    hoisted.previewRunRevert.mockRejectedValue(
      new ApiError(409, { code: "run_expired", message: "missing" }),
    );
    renderPage("/agents?section=runs&board=board-1&run=run-1");

    expect(
      await screen.findByTestId("agent-run-commands-missing"),
    ).toHaveTextContent(
      "The command log for this run is missing. The run records 2 commands",
    );
    expect(screen.getByText("0 of 2 stored")).toBeInTheDocument();
    expect(screen.queryByText("Commands (0)")).toBeNull();
    // A missing log does not justify claiming the retention window expired.
    expect(screen.queryByText(/under the retention window/)).toBeNull();
    expect(screen.queryByTestId("agent-run-expired")).toBeNull();
    expect(
      await screen.findByTestId("agent-run-preview-unavailable"),
    ).toHaveTextContent("Retention removed the run or its pre-images");
  });

  it("counts all runs in the board scope independently of status and session filters", async () => {
    const all = [
      run(),
      run({ id: "run-2", status: "failed", agentSessionId: "other" }),
    ];
    hoisted.listRuns.mockImplementation(
      (_board: string, query: { status?: string; agentSessionId?: string }) =>
        Promise.resolve(
          all.filter(
            (r) =>
              (!query.status || r.status === query.status) &&
              (!query.agentSessionId ||
                r.agentSessionId === query.agentSessionId),
          ),
        ),
    );
    renderPage(
      "/agents?section=runs&board=board-1&status=failed&session=other",
    );
    await waitFor(() =>
      expect(screen.getByTestId("agents-section-runs")).toHaveTextContent("2"),
    );
    await waitFor(() =>
      expect(hoisted.listRuns).toHaveBeenCalledWith(
        "board-1",
        expect.objectContaining({ status: "failed", agentSessionId: "other" }),
      ),
    );
  });

  it("never shows applied diffs or preimages for a failed run", async () => {
    const failed = run({ status: "failed" });
    hoisted.listRuns.mockResolvedValue([failed]);
    hoisted.getRun.mockResolvedValue(runDetail({ status: "failed" }));
    renderPage("/agents?section=runs&board=board-1&run=run-1");
    expect(await screen.findByTestId("agent-run-failed-banner")).toBeVisible();
    expect(
      within(screen.getByTestId("agent-run-commands")).getAllByText(
        "Not applied",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("agent-run-preimage")).toBeNull();
    expect(screen.queryByTestId("agent-run-preimages")).toBeNull();
    expect(screen.queryByText("After")).toBeNull();
  });

  it("shows an approvals skeleton while the overview is pending", async () => {
    hoisted.agentsOverview.mockImplementation(() => new Promise(() => {}));
    renderPage("/agents?section=attention&board=board-1");
    expect(
      await screen.findByTestId("agents-approvals-loading"),
    ).toHaveAttribute("aria-busy", "true");
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
    expect(screen.queryByTestId("agents-approval-detail")).toBeNull();
    expect(hoisted.getApproval).not.toHaveBeenCalled();
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

  it("resolves board=all to the approval's concrete board", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()]),
    );
    hoisted.getApproval.mockResolvedValue(approval());
    renderPage("/agents?section=attention&board=all&approval=approval-1");

    await waitFor(() =>
      expect(hoisted.getApproval).toHaveBeenCalledWith("board-1", "approval-1"),
    );
  });

  it("resolves board=all to the selected run's concrete board", async () => {
    hoisted.listRuns.mockResolvedValue([run()]);
    hoisted.getRun.mockResolvedValue(runDetail());
    renderPage("/agents?section=runs&board=all&run=run-1");

    await waitFor(() =>
      expect(hoisted.getRun).toHaveBeenCalledWith("board-1", "run-1"),
    );
  });

  it("does not offer a session link for an approval without a session", async () => {
    const row = approval({ agentSessionId: null });
    hoisted.getApproval.mockResolvedValue(row);
    renderPage("/agents?section=attention&board=board-1&approval=approval-1");
    expect(await screen.findByTestId("approval-links")).toBeVisible();
    expect(screen.queryByTestId("approval-session-link")).toBeNull();
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

  it("auto-selects the first pending approval on Attention", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );
    renderPage("/agents?section=attention");

    expect(await screen.findByTestId("agents-approval-detail")).toBeVisible();
    expect(await screen.findByTestId("approval-plan-hash")).toBeVisible();
  });

  it("attributes a member-board approval to the token and keeps the session separate", async () => {
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      Promise.resolve(
        boardId === "board-1"
          ? [
              session(),
              session({
                id: "session-3",
                apiTokenId: "token-other",
                name: "Docs build",
                tokenName: "Docs agent",
                status: "waiting_approval",
                currentCardId: null,
                currentRunId: null,
              }),
            ]
          : [],
      ),
    );
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse(
        [
          overviewItem({
            requestedByTokenId: "token-other",
            agentSessionId: "session-3",
            sessionName: "Docs build",
            tokenName: null,
            requestedBy: "user-member",
          }),
        ],
        {
          boards: BOARDS,
          pendingByBoard: { "board-1": 1 },
          pendingTotal: 1,
          totalApprovals: 1,
        },
      ),
    );
    hoisted.getApproval.mockResolvedValue(
      approval({
        requestedByTokenId: "token-other",
        agentSessionId: "session-3",
      }),
    );
    renderPage("/agents?section=attention");

    const card = await screen.findByTestId("agents-approval-approval-1");
    expect(card).toHaveTextContent("Docs agent asks to run DELETE_CARD");
    expect(card).not.toHaveTextContent("Docs build asks");

    const detail = await screen.findByTestId("agents-approval-detail");
    expect(detail).toHaveTextContent("Docs agent asks to run DELETE_CARD");
    expect(detail).not.toHaveTextContent("Docs build asks");
    expect(within(detail).getByText("Session")).toBeInTheDocument();
    expect(within(detail).getByText("Docs build")).toBeInTheDocument();
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

  it("keeps cross-board pending counts in a member board scope", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 3 },
      }),
    );
    renderPage("/agents?section=attention&board=board-2");

    expect(await screen.findByTestId("agents-boards-scope")).toHaveTextContent(
      "Pending",
    );
    await userEvent.click(screen.getByTestId("agents-filter-board"));
    expect(
      screen.getByTestId("agents-filter-board-option-board-1"),
    ).toHaveTextContent("3");
    expect(
      screen.getByTestId("agents-filter-board-option-all"),
    ).toHaveTextContent("3");
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

  it("renders approvals, stale rows and live sessions in that order without duplicates", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([overviewItem()], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 1,
      }),
    );
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-1"
        ? [
            session({ id: "live-1", name: "Live triage" }),
            session({
              id: "stale-1",
              name: "Stale triage",
              stale: true,
              lastHeartbeatAt: Date.now() - 600_000,
            }),
            session({
              id: "done-1",
              name: "Done triage",
              status: "completed",
              endedAt: Date.now() - 1_000,
            }),
          ]
        : [],
    );
    renderPage("/agents?section=attention");

    const approvals = await screen.findByTestId("agents-approval-list");
    const staleHeading = await screen.findByRole("heading", {
      name: "Needs a nudge",
    });
    const live = await screen.findByTestId("agents-live-sessions");

    expect(
      approvals.compareDocumentPosition(staleHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      staleHeading.compareDocumentPosition(live) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(
      within(live).getByTestId("agent-session-row-live-1"),
    ).toBeInTheDocument();
    expect(within(live).queryByTestId("agent-session-row-stale-1")).toBeNull();
    expect(within(live).queryByTestId("agent-session-row-done-1")).toBeNull();
    expect(screen.getAllByTestId(/^agent-session-row-/)).toHaveLength(1);
    expect(screen.getAllByText(/Stale triage/)).toHaveLength(1);
    expect(
      within(screen.getByTestId("agents-stale-session-stale-1")).getByText(
        /Stale triage/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agents-live-count-active")).toHaveTextContent(
      "2 active",
    );
    expect(screen.getByTestId("agents-live-count-stale")).toHaveTextContent(
      "1 no heartbeat",
    );
    expect(screen.queryByTestId("agents-live-count-waiting")).toBeNull();
    expect(screen.queryByTestId("agents-live-count-paused")).toBeNull();
  });

  it("counts pending decisions only and keeps a paused session in the live preview", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse(
        [
          overviewItem(),
          overviewItem({
            id: "approval-2",
            summary: "Archive card “Release checklist”",
            actionType: "ARCHIVE_CARD",
          }),
        ],
        {
          boards: BOARDS,
          pendingByBoard: { "board-1": 2 },
          pendingTotal: 2,
          totalApprovals: 2,
        },
      ),
    );
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-1"
        ? [
            session({ id: "waiting", status: "waiting_approval" }),
            session({
              id: "stale-1",
              name: "Stale triage",
              stale: true,
              lastHeartbeatAt: Date.now() - 600_000,
            }),
            session({ id: "active-1", name: "Active triage" }),
            session({
              id: "paused-1",
              name: "Paused triage",
              status: "idle",
              paused: true,
              pausedAt: Date.now(),
              pauseScope: "session",
              pausedReason: "Human review",
              stale: true,
              lastHeartbeatAt: Date.now() - 600_000,
            }),
          ]
        : [],
    );
    renderPage("/agents?section=attention");

    const count = await screen.findByTestId("agents-count-attention");
    expect(count).toHaveTextContent("2");
    expect(count).toHaveAttribute("title", "2 pending decisions");

    const live = await screen.findByTestId("agents-live-sessions");
    const pausedRow = within(live).getByTestId("agent-session-row-paused-1");
    expect(
      within(pausedRow).getByTestId("agent-status-paused"),
    ).toHaveTextContent("Paused");
    expect(
      within(live).getByTestId("agents-live-count-paused"),
    ).toHaveTextContent("1 paused");
    expect(
      within(live).getByTestId("agents-live-count-stale"),
    ).toHaveTextContent("2 no heartbeat");
    // The paused session is not a "needs a nudge" card; only the genuinely
    // stale session is.
    expect(screen.queryByTestId("agents-stale-session-paused-1")).toBeNull();
    expect(
      screen.getByTestId("agents-stale-session-stale-1"),
    ).toBeInTheDocument();

    await userEvent.click(pausedRow);
    const hint = await screen.findByTestId("agents-session-detail-hint");
    expect(hint).toHaveTextContent("Session writes are paused");
    expect(hint).toHaveTextContent(/No heartbeat for \d+m/);
    expect(hint).not.toHaveTextContent("Idle");
  });

  it("caps the live preview at four rows and counts every filtered session", async () => {
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-1"
        ? Array.from({ length: 6 }, (_, index) =>
            session({ id: `live-${index}`, name: `Live ${index}` }),
          )
        : [],
    );
    renderPage("/agents?section=attention");

    const live = await screen.findByTestId("agents-live-sessions");
    expect(within(live).getAllByTestId(/^agent-session-row-/)).toHaveLength(4);
    expect(screen.getByTestId("agents-live-count-active")).toHaveTextContent(
      "6 active",
    );
    expect(screen.queryByRole("heading", { name: "Needs a nudge" })).toBeNull();
  });

  it("renders only the stale block when no session is live", async () => {
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-1"
        ? [
            session({
              id: "stale-1",
              name: "Stale triage",
              stale: true,
              lastHeartbeatAt: Date.now() - 600_000,
            }),
            session({
              id: "done-1",
              name: "Done triage",
              status: "cancelled",
              endedAt: Date.now() - 1_000,
            }),
          ]
        : [],
    );
    renderPage("/agents?section=attention");

    expect(
      await screen.findByRole("heading", { name: "Needs a nudge" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("agents-loading")).toBeNull(),
    );
    expect(screen.queryByTestId("agents-live-sessions")).toBeNull();
  });

  it("shows the empty state when there are no approvals and no sessions", async () => {
    hoisted.listAgentSessions.mockResolvedValue([]);
    renderPage("/agents?section=attention");

    await waitFor(() =>
      expect(screen.queryByTestId("agents-loading")).toBeNull(),
    );
    const empty = screen.getByTestId("agents-attention-empty");
    expect(empty).toHaveTextContent("No agent sessions yet");
    expect(empty).toHaveTextContent(
      "Attention will show decisions and missing heartbeats here.",
    );
    expect(screen.queryByTestId("agents-empty")).toBeNull();
    expect(screen.queryByTestId("agents-attention-clear")).toBeNull();
    expect(screen.queryByTestId("agents-live-sessions")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Needs a nudge" })).toBeNull();
  });

  it("switches to Sessions from the live preview", async () => {
    renderPage("/agents?section=attention");

    const live = await screen.findByTestId("agents-live-sessions");
    expect(within(live).getAllByTestId(/^agent-session-row-/).length).toBe(2);
    await userEvent.click(screen.getByTestId("agents-live-view-all"));

    expect(
      await screen.findByTestId("agents-session-list"),
    ).toBeInTheDocument();
    const url = new URLSearchParams(
      screen.getByTestId("location").textContent ?? "",
    );
    expect(url.get("section")).toBe("sessions");
    expect(screen.getByTestId("agents-section-sessions")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByTestId("agents-live-sessions")).toBeNull();
  });

  it("opens a live session in the right panel from Attention without leaving the tab", async () => {
    renderPage("/agents?section=attention");

    const live = await screen.findByTestId("agents-live-sessions");
    await userEvent.click(
      within(live).getByTestId("agent-session-row-session-1"),
    );

    expect(
      await screen.findByTestId("agents-session-detail-hint"),
    ).toBeVisible();
    expect(screen.getByTestId("agents-detail-panel")).toContainElement(
      screen.getByTestId("agents-session-detail-hint"),
    );
    expect(screen.queryByTestId("agents-session-list")).toBeNull();
    expect(screen.getByTestId("agents-live-sessions")).toBeInTheDocument();
    expect(screen.getByTestId("agents-section-attention")).toHaveAttribute(
      "aria-current",
      "page",
    );
    const url = new URLSearchParams(
      screen.getByTestId("location").textContent ?? "",
    );
    expect(url.get("section")).toBe("attention");
    expect(url.get("session")).toBe("session-1");
  });

  it("opens a stale session card in the right panel from Attention", async () => {
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-1"
        ? [
            session({
              id: "stale-1",
              name: "Stale triage",
              stale: true,
              lastHeartbeatAt: Date.now() - 6 * 60_000,
            }),
          ]
        : [],
    );
    renderPage("/agents?section=attention");

    await userEvent.click(
      await screen.findByTestId("agents-stale-session-stale-1"),
    );

    const hint = await screen.findByTestId("agents-session-detail-hint");
    expect(hint).toHaveTextContent(
      /No heartbeat for \d+m\. The last known lifecycle status is Active\./,
    );
    const url = new URLSearchParams(
      screen.getByTestId("location").textContent ?? "",
    );
    expect(url.get("section")).toBe("attention");
    expect(url.get("session")).toBe("stale-1");
    expect(screen.queryByTestId("agent-row")).toBeNull();
    expect(screen.getByTestId("agents-section-attention")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("hides the stale block when no session needs a nudge", async () => {
    renderPage("/agents?section=attention");

    await screen.findByTestId("agents-live-sessions");
    expect(screen.queryByTestId("agents-stale-sessions")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Needs a nudge" })).toBeNull();
  });

  it("shows the live preview to a member without admin controls", async () => {
    renderPage("/agents?section=attention&board=board-2");

    expect(await screen.findByTestId("agents-member-note")).toBeVisible();
    const live = await screen.findByTestId("agents-live-sessions");
    expect(
      within(live).getByTestId("agent-session-row-session-3"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("agents-approval-list")).toBeNull();
    expect(hoisted.agentsOverview).toHaveBeenCalledWith({
      section: "approvals",
      limit: 100,
    });
    expect(within(live).queryByTestId("agents-session-pause")).toBeNull();
    expect(within(live).queryByTestId("agents-session-end")).toBeNull();
    expect(within(live).queryByTestId("agent-token-settings")).toBeNull();

    await userEvent.click(
      within(live).getByTestId("agent-session-row-session-3"),
    );
    expect(
      await screen.findByTestId("agents-session-read-only"),
    ).toHaveTextContent(
      "You can watch. A board admin pauses, resumes or ends sessions.",
    );
    expect(screen.queryByTestId("agents-session-pause")).toBeNull();
    expect(screen.queryByTestId("agents-session-end")).toBeNull();
  });

  it("filters approvals by needs, decided and all with true counts", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse(
        [
          overviewItem(),
          overviewItem({
            id: "approval-2",
            actionType: "ARCHIVE_CARD",
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
    expect(screen.getByText("Recently decided")).toBeVisible();
    expect(
      screen.getByText("Read-only history. Decisions cannot be changed."),
    ).toBeVisible();
    // Decided rows are history: the dead Reject action must not render.
    expect(
      screen.queryByTestId("agents-approval-reject-approval-2"),
    ).toBeNull();
  });

  it("offers Next pending from a decided approval with a pending sibling", async () => {
    const approved = overviewItem({
      id: "approval-approved",
      status: "approved",
      storedStatus: "approved",
      summary: "Approved request",
      decidedBy: "user-1",
      decidedAt: Date.now(),
      decisionComment: "Ship it",
    });
    const pending = overviewItem({
      id: "approval-pending",
      actionType: "ARCHIVE_CARD",
      summary: "Still waiting",
    });
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([approved, pending], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 1 },
        pendingTotal: 1,
        totalApprovals: 2,
      }),
    );
    hoisted.getApproval.mockImplementation((_boardId: string, id: string) =>
      Promise.resolve(
        id === approved.id
          ? approval({
              id: approved.id,
              status: "approved",
              decidedBy: "user-1",
              decidedAt: Date.now(),
              decisionComment: "Ship it",
            })
          : approval({ id: pending.id, summary: pending.summary }),
      ),
    );
    renderPage("/agents?section=attention");

    await userEvent.click(
      await screen.findByTestId("agents-approvals-filter-decided"),
    );
    expect(await screen.findByTestId("approval-status")).toHaveAttribute(
      "data-status",
      "approved",
    );
    await userEvent.click(screen.getByTestId("approval-next-pending"));
    await waitFor(() =>
      expect(screen.getByTestId("approval-status")).toHaveAttribute(
        "data-status",
        "pending",
      ),
    );
    // The list follows the detail: Needs is active and the pending row is
    // visibly selected instead of leaving an off-list detail under Decided.
    expect(screen.getByTestId("agents-approvals-filter-needs")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByTestId("agents-approval-approval-pending"),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("agents-approval-list")).toHaveTextContent(
      /needs decision/i,
    );
  });

  it("shows a toolbar Clear filters action for an active session search", async () => {
    renderPage("/agents?section=sessions&q=no-match");
    const empty = await screen.findByTestId("agents-filtered-empty");
    expect(empty).toHaveTextContent(
      "Try a different board, agent or heartbeat filter.",
    );
    expect(screen.getByTestId("agents-toolbar-clear")).toBeVisible();
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

  it("uses approvals copy for the Attention filtered empty state", async () => {
    hoisted.agentsOverview.mockResolvedValue(
      overviewResponse([], {
        boards: BOARDS,
        pendingByBoard: { "board-1": 0 },
        pendingTotal: 0,
        totalApprovals: 0,
      }),
    );
    renderPage("/agents?section=attention&board=board-1&q=no-match");

    const empty = await screen.findByTestId("agents-filtered-empty");
    expect(empty).toHaveTextContent("No approvals match these filters");
    expect(empty).toHaveTextContent(
      "The queue is empty for this scope and search.",
    );
    expect(empty).not.toHaveTextContent("No sessions match these filters");
  });

  it("shows the filtered empty state and clears it", async () => {
    renderPage("/agents?section=sessions&status=failed");

    expect(
      await screen.findByTestId("agents-filtered-empty"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("agents-detail-create-key")).toBeNull();
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

    expect(await screen.findByTestId("agents-load-error")).toHaveTextContent(
      "Could not load agent sessions",
    );
    expect(screen.queryByTestId("agents-error")).toBeNull();

    hoisted.listAgentSessions.mockResolvedValue([session()]);
    await userEvent.click(screen.getByTestId("agents-load-error-retry"));
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
    const empty = await screen.findByTestId("agents-empty");
    await userEvent.click(
      within(empty).getByRole("button", { name: "Create API key" }),
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
              session({
                id: "active-fresh",
                status: "active",
                name: "Fresh session",
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
    for (const [status, label] of [
      ["active", "Active"],
      ["idle", "Idle"],
      ["waiting_approval", "Waiting"],
      ["completed", "Completed"],
      ["failed", "Failed"],
      ["cancelled", "Cancelled"],
    ] as const) {
      expect(
        within(list).getAllByTestId(`agent-status-${status}`)[0],
      ).toHaveTextContent(label);
    }
    const staleRow = screen.getByTestId("agent-session-row-active-stale");
    expect(
      within(staleRow).getByTestId("agent-status-active"),
    ).toHaveTextContent("Active");
    const heartbeat = within(staleRow).getByTestId("agent-heartbeat");
    expect(heartbeat).toHaveAttribute("data-stale", "true");
    expect(heartbeat).toHaveTextContent("No heartbeat · 6m");
    expect(within(staleRow).queryByTestId("agent-status-stale")).toBeNull();
  });

  it("matches the mockup session detail: no board folder, token link or run chip", async () => {
    renderPage("/agents?section=sessions&board=board-1&session=session-1");

    const detail = await screen.findByTestId("agents-session-detail-hint");
    expect(detail).toBeInTheDocument();
    const boardChip = screen.getByTestId("agents-session-board-chip");
    expect(boardChip.querySelector("svg")).toBeNull();
    expect(
      screen.getByTestId("agents-session-open-board").querySelector("svg"),
    ).toBeNull();

    const currentWork = screen.getByTestId("agents-session-current-work");
    const cardLink = within(currentWork).getAllByRole("link")[0];
    expect(cardLink).toHaveTextContent("card-1");
    expect(cardLink.querySelector("svg")).not.toBeNull();
    expect(
      within(currentWork).getByTestId("agents-session-current-work-run"),
    ).toHaveTextContent(/Run/);
    expect(screen.getByTestId("agents-session-current-run")).toHaveTextContent(
      "1",
    );
    expect(screen.queryByTestId("agents-session-token-settings")).toBeNull();
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
    expect(
      screen.getByText(
        "Pause finishes in-flight work; End releases claims and is final.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agents-session-pause").className).toContain(
      "bg-hover",
    );
    expect(screen.getByTestId("agents-session-pause").className).toContain(
      "font-[650]",
    );
    expect(screen.getByTestId("agents-session-end").className).toContain(
      "text-[color:var(--danger)]",
    );
    expect(screen.getByText(/Claims are not released/)).toBeInTheDocument();
    expect(
      screen.getByText(/Ending the session releases claims and is final/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("agents-session-pause"));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Pause this session?",
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
    const paused = await screen.findAllByTestId("agent-status-paused");
    expect(paused[0]).toHaveTextContent("Paused");
    expect(paused[0]).toHaveAttribute("data-lifecycle", "false");
    expect(screen.queryByTestId("agent-pause-badge-session")).toBeNull();
    expect(screen.queryByTestId("agent-status-active")).toBeNull();

    await userEvent.click(screen.getByTestId("agents-session-resume"));
    expect(await screen.findByTestId("agent-action-reason")).toHaveAttribute(
      "placeholder",
      "Why are you resuming this session?",
    );
    await userEvent.click(await screen.findByTestId("agent-action-confirm"));
    await waitFor(() =>
      expect(hoisted.resumeAgentSession).toHaveBeenCalledWith(
        "board-1",
        "session-1",
        undefined,
      ),
    );

    await userEvent.click(screen.getByTestId("agents-session-end"));
    await userEvent.click(screen.getByTestId("agent-action-confirm"));
    await waitFor(() =>
      expect(hoisted.endAgentSession).toHaveBeenCalledWith(
        "board-1",
        "session-1",
        { status: "completed" },
      ),
    );
    expect(
      (await screen.findAllByTestId("agent-status-completed")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("agents-session-pause")).toBeNull();
    expect(screen.queryByTestId("agents-session-resume")).toBeNull();
    expect(screen.queryByTestId("agents-session-end")).toBeNull();
  });

  it("offers Resume when a board pause masks a session pause", async () => {
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      boardId === "board-1"
        ? [
            session({
              id: "masked",
              status: "idle",
              paused: true,
              pausedAt: Date.now(),
              pausedReason: "Human review",
              pauseScope: "board",
            }),
          ]
        : [],
    );
    renderPage("/agents?section=sessions&board=board-1&session=masked");

    expect(
      (await screen.findAllByTestId("agent-status-paused"))[0],
    ).toHaveTextContent("Paused");
    expect(screen.getByTestId("agent-pause-badge-board")).toHaveTextContent(
      "Board pause",
    );
    expect(screen.getByTestId("agents-session-resume")).toBeInTheDocument();
    expect(screen.queryByTestId("agents-session-pause")).toBeNull();
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
    expect(screen.getByRole("dialog")).toHaveTextContent("Pause this session?");
  });

  it("hides every session action on a terminal session", async () => {
    renderPage("/agents?section=sessions&board=board-1&session=session-2");

    expect(
      await screen.findByTestId("agents-session-detail-hint"),
    ).toHaveTextContent("This session has ended");
    expect(screen.queryByTestId("agents-session-pause")).toBeNull();
    expect(screen.queryByTestId("agents-session-resume")).toBeNull();
    expect(screen.queryByTestId("agents-session-end")).toBeNull();
    expect(screen.queryByTestId("agents-session-open-board")).toBeNull();
    expect(
      screen.getByText(
        "This session ended. Claims were released; no further actions are available.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the read-only footer to a member", async () => {
    renderPage("/agents?section=sessions&board=board-2&session=session-3");

    expect(
      await screen.findByTestId("agents-session-read-only"),
    ).toHaveTextContent(
      "You can watch. A board admin pauses, resumes or ends sessions.",
    );
    expect(screen.getByTestId("agents-session-open-board")).toBeInTheDocument();
    expect(screen.queryByTestId("agents-session-pause")).toBeNull();
    expect(screen.queryByTestId("agents-session-end")).toBeNull();
  });

  it("keeps the token as plain metadata, without Account controls", async () => {
    hoisted.listTokens.mockResolvedValue([{ id: "token-1", name: "QA agent" }]);
    renderPage("/agents?section=sessions&board=board-1&session=session-1");

    expect(
      await screen.findByTestId("agents-session-detail-hint"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("agents-session-token-settings")).toBeNull();
    expect(
      screen.queryByTestId("agents-session-token-settings-readonly"),
    ).toBeNull();
    // The mockup's token field is a mono value, not a settings link.
    expect(screen.getByTestId("agents-session-board-chip")).toBeInTheDocument();
  });

  it("shows the plain-mono token id in a token group header", async () => {
    renderPage("/agents?section=sessions&group=token");

    const group = await screen.findByTestId("agents-token-group-token-1");
    expect(group).toHaveTextContent("QA agent");
    expect(group).toHaveTextContent("2 sessions");
    expect(group).toHaveTextContent("0 no heartbeat");
    expect(
      within(group).queryByTestId("agents-token-settings-token-1"),
    ).toBeNull();
    const tokenChip = within(group).getByTestId("agents-token-chip-token-1");
    expect(tokenChip).toHaveTextContent("token-1");
    expect(tokenChip.className).toContain("font-mono");
  });

  it("shortens a long token id in the token group chip", async () => {
    const longToken = "px-token-release-archive";
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      Promise.resolve(
        boardId === "board-1"
          ? [
              session({
                apiTokenId: longToken,
                currentRunId: null,
              }),
            ]
          : [],
      ),
    );
    renderPage("/agents?section=sessions&group=token");

    const group = await screen.findByTestId(`agents-token-group-${longToken}`);
    const tokenChip = within(group).getByTestId(
      `agents-token-chip-${longToken}`,
    );
    expect(tokenChip).toHaveTextContent("px-token…rchive");
    expect(tokenChip).not.toHaveTextContent(longToken);
    expect(tokenChip).toHaveAttribute("title", longToken);
    expect(tokenChip.className).toContain("font-mono");
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
