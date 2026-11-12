import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionDto, BoardSummary } from "@janosik/shared";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";

const hoisted = vi.hoisted(() => ({
  listBoards: vi.fn(),
  listTokens: vi.fn(),
  me: vi.fn(),
  listAgentSessions: vi.fn(),
  pauseAgentSession: vi.fn(),
  resumeAgentSession: vi.fn(),
  endAgentSession: vi.fn(),
  listApprovals: vi.fn(),
  getApproval: vi.fn(),
  decideApproval: vi.fn(),
  cancelApproval: vi.fn(),
  listRuns: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  isApiEnabled: () => true,
  api: {
    listBoards: hoisted.listBoards,
    listTokens: hoisted.listTokens,
    me: hoisted.me,
    listAgentSessions: hoisted.listAgentSessions,
    pauseAgentSession: hoisted.pauseAgentSession,
    resumeAgentSession: hoisted.resumeAgentSession,
    endAgentSession: hoisted.endAgentSession,
    listApprovals: hoisted.listApprovals,
    getApproval: hoisted.getApproval,
    decideApproval: hoisted.decideApproval,
    cancelApproval: hoisted.cancelApproval,
    listRuns: hoisted.listRuns,
  },
}));

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

function renderPage(path = "/agents") {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AgentsPage />
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
  hoisted.listApprovals.mockResolvedValue([]);
  hoisted.getApproval.mockResolvedValue(approval());
  hoisted.decideApproval.mockResolvedValue(approval({ status: "rejected" }));
  hoisted.cancelApproval.mockResolvedValue(approval({ status: "cancelled" }));
  hoisted.listRuns.mockResolvedValue([]);
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
    expect(screen.getByText("QA agent")).toBeInTheDocument();
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

  it("explains approvals to a member and labels the rail scope", async () => {
    renderPage("/agents?board=board-2");

    expect(await screen.findByTestId("agents-member-note")).toHaveTextContent(
      "Approvals are handled by board admins.",
    );
    expect(screen.queryByTestId("agents-attention-clear")).toBeNull();
    expect(screen.getByText("Scope")).toBeInTheDocument();
  });

  it("shows the runs empty state and clear-all action", async () => {
    renderPage("/agents?section=runs");

    expect(await screen.findByTestId("agents-runs-empty")).toHaveTextContent(
      "No runs yet",
    );
    expect(screen.getByTestId("agents-runs-clear-all")).toBeInTheDocument();
  });

  it("shows pending approvals in the rail and board scope", async () => {
    hoisted.listApprovals.mockImplementation((boardId: string) =>
      Promise.resolve(boardId === "board-1" ? [approval()] : []),
    );
    renderPage("/agents?section=attention");

    expect(
      await screen.findByTestId("agents-count-attention"),
    ).toHaveTextContent("1");
    expect(
      await screen.findByTestId("agents-approval-approval-1"),
    ).toHaveTextContent("Delete card");
    await userEvent.click(screen.getByTestId("agents-filter-board"));
    expect(
      screen.getByTestId("agents-filter-board-option-board-1"),
    ).toHaveTextContent("1");
  });

  it("opens an approval plan and requires a rejection reason", async () => {
    const row = approval();
    hoisted.listApprovals.mockResolvedValue([row]);
    hoisted.getApproval.mockResolvedValue(row);
    renderPage("/agents?section=attention&board=board-1&approval=approval-1");

    expect(await screen.findByTestId("agents-approval-detail")).toBeVisible();
    expect(await screen.findByTestId("approval-plan-hash")).toHaveTextContent(
      row.planHash,
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

  it("filters approvals by needs, decided and all with true counts", async () => {
    hoisted.listApprovals.mockResolvedValue([
      approval(),
      approval({
        id: "approval-2",
        status: "rejected",
        summary: "Rejected request",
        decisionComment: "No",
      }),
    ]);
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

  it("shows an expired approval without decision controls", async () => {
    const expired = approval({ expiresAt: Date.now() - 1_000 });
    hoisted.listApprovals.mockResolvedValue([expired]);
    hoisted.getApproval.mockResolvedValue(expired);
    renderPage("/agents?section=attention&board=board-1&approval=approval-1");

    expect(
      await screen.findByTestId("agents-approval-detail"),
    ).toHaveTextContent("Expired");
    expect(screen.queryByTestId("approval-approve")).toBeNull();
    expect(screen.queryByTestId("approval-reject")).toBeNull();
  });

  it("groups sessions by agent and shows the board, status and heartbeat", async () => {
    renderPage("/agents?section=sessions");

    expect(await screen.findByTestId("agents-list")).toBeInTheDocument();
    const rows = screen.getAllByTestId("agent-row");
    expect(rows).toHaveLength(2);
    const qa = rows.find((row) => row.textContent?.includes("QA agent"))!;
    const docs = rows.find((row) => row.textContent?.includes("Docs agent"))!;
    expect(qa).toHaveTextContent("Launch");
    expect(docs).toHaveTextContent("Docs");
    expect(screen.getAllByTestId("agent-last-seen").length).toBeGreaterThan(0);
  });

  it("filters by status from the URL without a round-trip", async () => {
    renderPage("/agents?section=sessions&status=completed");

    expect(await screen.findByTestId("agents-list")).toBeInTheDocument();
    const rows = screen.getAllByTestId("agent-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("QA agent");
    expect(rows[0]).toHaveTextContent("Completed");
  });

  it("shows the filtered empty state and clears it", async () => {
    renderPage("/agents?section=sessions&status=failed");

    expect(
      await screen.findByTestId("agents-filtered-empty"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agents-clear-filters"));
    expect(await screen.findByTestId("agents-list")).toBeInTheDocument();
  });

  it("shows the sessions empty state when no agent has ever run", async () => {
    hoisted.listAgentSessions.mockResolvedValue([]);
    renderPage("/agents?section=sessions");

    expect(await screen.findByTestId("agents-empty")).toBeInTheDocument();
    expect(screen.getByTestId("agents-empty")).toHaveTextContent(
      "No agent sessions yet",
    );
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
      expect(screen.getByTestId("agents-list")).toBeInTheDocument(),
    );
  });
  it("defaults to Attention, switches sections, and preserves board scope", async () => {
    renderPage("/agents?board=board-1");
    expect(
      await screen.findByTestId("agents-attention-clear"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agents-section-attention")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await userEvent.click(screen.getByTestId("agents-section-sessions"));
    expect(await screen.findByTestId("agents-list")).toHaveTextContent(
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
    expect(screen.getByText("QA agent")).toBeInTheDocument();
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
    expect(await screen.findByTestId("agents-list")).toBeInTheDocument();
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
    expect(
      await screen.findByTestId("agents-filtered-empty"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agents-clear-filters"));
    expect(await screen.findByTestId("agents-list")).toHaveTextContent(
      "QA agent",
    );
    expect(screen.getByTestId("agents-list")).toHaveTextContent("Docs agent");
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
