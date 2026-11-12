import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionDto,
  ApprovalRequestDto,
  Board,
} from "@janosik/shared";

import { api } from "@/api/client";
import { AgentControlDialog } from "@/components/agent-control/AgentControlDialog";
import { AgentControlButton } from "@/components/agent-control/AgentControlButton";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import {
  BoardLiveProvider,
  createBoardLive,
  type BoardLive,
} from "@/store/board-live";

const mocks = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "MEMBER" | "VIEWER",
  refreshBoards: vi.fn(),
}));

const BOARD: Board = {
  id: "board-1",
  title: "Launch board",
  columns: [{ id: "col-1", title: "Todo", cardIds: ["card-1"], createdAt: 1 }],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Remove stale card",
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
};

vi.mock("@/store/BoardContext", () => ({
  useBoardState: () => ({ board: BOARD }),
  useBoardActions: () => ({ refreshBoards: mocks.refreshBoards }),
  useBoardAccess: () => ({ role: mocks.role }),
}));

function approval(
  overrides: Partial<ApprovalRequestDto> = {},
): ApprovalRequestDto {
  return {
    id: "approval-1",
    boardId: "board-1",
    cardId: "card-1",
    requestedBy: "user-1",
    requestedByTokenId: "token-1",
    agentSessionId: "session-1",
    kind: "destructive",
    actionType: "DELETE_CARD",
    summary: "Delete card “Remove stale card”",
    risk: "high",
    planHash: "a".repeat(64),
    status: "pending",
    expiresAt: Date.now() + 30 * 60_000,
    decidedBy: null,
    decidedAt: null,
    decisionComment: null,
    runId: null,
    consumedAt: null,
    createdAt: Date.now() - 60_000,
    plan: {
      schemaVersion: 1,
      boardId: "board-1",
      commands: [
        {
          commandId: "cmd-1",
          action: { type: "DELETE_CARD", cardId: "card-1" },
        },
      ],
    },
    ...overrides,
  };
}

function session(overrides: Partial<AgentSessionDto> = {}): AgentSessionDto {
  return {
    id: "session-1",
    userId: "user-1",
    apiTokenId: "token-1",
    boardId: "board-1",
    name: "Release bot",
    clientName: "MCP",
    model: "gpt",
    status: "active",
    currentCardId: "card-1",
    currentRunId: null,
    startedAt: Date.now() - 10 * 60_000,
    lastHeartbeatAt: Date.now() - 30_000,
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

let live: BoardLive;
let onOpenChange: (open: boolean) => void;

function renderDialog() {
  onOpenChange = vi.fn();
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <BoardLiveProvider live={live}>
            <AgentControlDialog open onOpenChange={onOpenChange} />
          </BoardLiveProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

function renderButton() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <BoardLiveProvider live={live}>
              <AgentControlButton onOpen={vi.fn()} />
            </BoardLiveProvider>
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("agent control (TASK-166.14)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    vi.restoreAllMocks();
    mocks.role = "ADMIN";
    live = createBoardLive();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("loads the queue and approves the exact plan hash", async () => {
    const row = approval();
    const decided = approval({
      status: "approved",
      decidedBy: "user-2",
      decidedAt: Date.now(),
      decisionComment: "Ship it",
    });
    vi.spyOn(api, "listApprovals").mockResolvedValue([row]);
    vi.spyOn(api, "getApproval")
      .mockResolvedValueOnce(row)
      .mockResolvedValue(decided);
    const decide = vi.spyOn(api, "decideApproval").mockResolvedValue(decided);

    renderDialog();

    const queue = await screen.findByTestId("approval-queue");
    expect(within(queue).getByText(row.summary)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(`approval-row-${row.id}`));

    expect(await screen.findByTestId("approval-plan-hash")).toHaveTextContent(
      row.planHash,
    );
    expect(screen.getByTestId("approval-plan-command")).toHaveTextContent(
      "DELETE_CARD",
    );

    await userEvent.click(screen.getByTestId("approval-approve"));
    expect(
      await screen.findByTestId("approval-approve-dialog"),
    ).toHaveTextContent("Approve this exact plan?");
    await userEvent.click(screen.getByTestId("approval-confirm"));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("board-1", row.id, {
        decision: "approve",
        planHash: row.planHash,
      }),
    );
    expect(await screen.findByText("Approval granted")).toBeInTheDocument();
  });

  it("requires a reason and sends the plan hash when rejecting", async () => {
    const row = approval();
    vi.spyOn(api, "listApprovals").mockResolvedValue([row]);
    vi.spyOn(api, "getApproval").mockResolvedValue(row);
    const decide = vi
      .spyOn(api, "decideApproval")
      .mockResolvedValue(approval({ status: "rejected" }));

    renderDialog();
    await screen.findByTestId("approval-queue");
    await userEvent.click(screen.getByTestId(`approval-row-${row.id}`));
    await userEvent.click(await screen.findByTestId("approval-reject"));
    expect(screen.getByTestId("approval-confirm")).toBeDisabled();
    await userEvent.type(
      screen.getByTestId("approval-comment"),
      "Not this card",
    );
    await userEvent.click(screen.getByTestId("approval-confirm"));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("board-1", row.id, {
        decision: "reject",
        planHash: row.planHash,
        comment: "Not this card",
      }),
    );
    expect(await screen.findByText("Approval rejected")).toBeInTheDocument();
  });

  it("explains an expired request and hides the decision controls", async () => {
    const row = approval({ expiresAt: Date.now() - 1_000 });
    vi.spyOn(api, "listApprovals").mockResolvedValue([row]);
    vi.spyOn(api, "getApproval").mockResolvedValue(row);

    renderDialog();
    await userEvent.click(await screen.findByTestId("approval-filter-all"));
    await screen.findByTestId("approval-queue");
    await userEvent.click(screen.getByTestId(`approval-row-${row.id}`));

    expect(await screen.findByTestId("approval-status")).toHaveAttribute(
      "data-status",
      "expired",
    );
    expect(screen.queryByTestId("approval-approve")).toBeNull();
    expect(screen.queryByTestId("approval-reject")).toBeNull();
  });

  it("navigates the control rail with arrow keys", async () => {
    renderDialog();
    screen.getByTestId("agent-approvals-tab").focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByTestId("agent-pause-tab")).toHaveFocus();
    expect(screen.getByTestId("agent-pause-tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("gives a member the read-only runs entry instead of the admin trigger", () => {
    mocks.role = "MEMBER";
    renderButton();

    expect(screen.queryByTestId("agent-control-trigger")).toBeNull();
    expect(screen.getByTestId("agent-runs-trigger")).toBeInTheDocument();
  });

  it("hides approvals from a member and opens Live read-only", async () => {
    mocks.role = "MEMBER";
    const list = vi.spyOn(api, "listApprovals");
    renderDialog();
    expect(screen.queryByTestId("agent-approvals-tab")).toBeNull();
    expect(screen.getByTestId("agent-pause-tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByTestId("approval-approve")).toBeNull();
  });

  it("shows empty and error states, and retries the queue", async () => {
    const list = vi
      .spyOn(api, "listApprovals")
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([]);

    renderDialog();
    expect(
      await screen.findByText("Could not load the approval queue"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No pending approvals")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("refetches the queue on an approval SSE frame without a reload", async () => {
    const row = approval();
    const list = vi.spyOn(api, "listApprovals").mockResolvedValue([row]);
    vi.spyOn(api, "getApproval").mockResolvedValue(row);

    renderDialog();
    await screen.findByTestId("approval-queue");
    expect(list).toHaveBeenCalledTimes(1);

    act(() => {
      live.agentControl.publishApproval({
        type: "approval",
        approvalId: row.id,
        status: "approved",
        at: Date.now(),
      });
    });

    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
  });

  it("shows and refreshes the pending badge from the queue", async () => {
    const list = vi
      .spyOn(api, "listApprovals")
      .mockResolvedValueOnce([approval()])
      .mockResolvedValueOnce([approval(), approval({ id: "approval-2" })]);

    renderButton();
    expect(
      await screen.findByTestId("agent-control-pending-count"),
    ).toHaveTextContent("1");

    act(() => {
      live.agentControl.publishApproval({
        type: "approval",
        approvalId: "approval-2",
        status: "pending",
        at: Date.now(),
      });
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("agent-control-pending-count"),
      ).toHaveTextContent("2"),
    );
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("pauses and resumes a board and a session with a reason", async () => {
    vi.spyOn(api, "listApprovals").mockResolvedValue([]);
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([session()]);
    const pauseBoard = vi.spyOn(api, "pauseBoardAgents").mockResolvedValue({
      scope: "board",
      boardId: "board-1",
      paused: true,
      pausedAt: Date.now(),
      pausedBy: "user-2",
      reason: "Release freeze",
    });
    const resumeBoard = vi.spyOn(api, "resumeBoardAgents").mockResolvedValue({
      scope: "board",
      boardId: "board-1",
      paused: false,
      pausedAt: null,
      pausedBy: null,
      reason: null,
    });
    const pauseSession = vi.spyOn(api, "pauseAgentSession").mockResolvedValue(
      session({
        paused: true,
        pausedAt: Date.now(),
        pausedBy: "user-2",
        pausedReason: "Review",
        pauseScope: "session",
      }),
    );
    const resumeSession = vi
      .spyOn(api, "resumeAgentSession")
      .mockResolvedValue(session());

    renderDialog();
    await userEvent.click(screen.getByTestId("agent-pause-tab"));

    const boardStatus = await screen.findByTestId("board-pause-status");
    expect(boardStatus).toHaveAttribute("data-paused", "false");

    await userEvent.type(
      screen.getByTestId("board-pause-reason"),
      "Release freeze",
    );
    await userEvent.click(screen.getByTestId("board-pause"));
    await waitFor(() =>
      expect(pauseBoard).toHaveBeenCalledWith("board-1", "Release freeze"),
    );
    expect(await screen.findByTestId("board-pause-status")).toHaveAttribute(
      "data-paused",
      "true",
    );

    await userEvent.click(screen.getByTestId("board-resume"));
    await waitFor(() => expect(resumeBoard).toHaveBeenCalledWith("board-1"));

    const row = await screen.findByTestId("agent-session-row-session-1");
    expect(within(row).getByText("Release bot")).toBeInTheDocument();
    await userEvent.click(within(row).getByTestId("agent-session-pause"));
    await userEvent.type(
      screen.getByTestId("agent-session-pause-reason"),
      "Review",
    );
    await userEvent.click(screen.getByTestId("agent-session-pause-confirm"));
    await waitFor(() =>
      expect(pauseSession).toHaveBeenCalledWith(
        "board-1",
        "session-1",
        "Review",
      ),
    );

    expect(
      await screen.findByTestId("agent-session-paused"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agent-session-resume"));
    await waitFor(() =>
      expect(resumeSession).toHaveBeenCalledWith("board-1", "session-1"),
    );
  });
});
