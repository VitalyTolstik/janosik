import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionDto,
  ApprovalRequestDto,
  Board,
  UserTokenDto,
} from "@janosik/shared";

import { api } from "@/api/client";
import { AgentControlDialog } from "@/components/agent-control/AgentControlDialog";
import { AgentControlButton } from "@/components/agent-control/AgentControlButton";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { effectiveApprovalStatus } from "@/utils/approval";
import { overviewItem, overviewResponse } from "@/test/agents-overview";
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

function token(overrides: Partial<UserTokenDto> = {}): UserTokenDto {
  return {
    id: "token-1",
    name: "QA agent",
    createdAt: 1,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    boardId: null,
    readOnly: false,
    rateLimitPerMinute: null,
    scopePreset: "worker",
    trustedCi: false,
    individualPausedAt: null,
    individualPausedBy: null,
    individualPausedReason: null,
    stopAllPausedAt: null,
    stopAllPausedBy: null,
    paused: false,
    effectiveTokenScope: "worker",
    ...overrides,
  };
}

const mockInbox =
  vi.fn<
    (
      boardId?: string,
      query?: { status?: string },
    ) => Promise<ApprovalRequestDto[]>
  >();

let live: BoardLive;
let onOpenChange: (open: boolean) => void;

function renderDialog(path = "/board/board-1") {
  onOpenChange = vi.fn();
  return render(
    <MemoryRouter initialEntries={[path]}>
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
    vi.spyOn(api, "listTokens").mockResolvedValue([]);
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([]);
    mockInbox.mockReset().mockResolvedValue([]);
    vi.spyOn(api, "agentsOverview").mockImplementation(async (query = {}) => {
      const rows = (await mockInbox(query.boardId, query)).map((row) =>
        overviewItem({
          ...row,
          status: effectiveApprovalStatus(
            row.status,
            row.expiresAt,
            Date.now(),
          ),
        }),
      );
      const items = rows.filter((row) =>
        query.status === "pending"
          ? row.status === "pending"
          : query.status === "decided"
            ? row.status !== "pending"
            : true,
      );
      return overviewResponse(items, { boardId: query.boardId });
    });
    vi.spyOn(api, "listRuns").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shortens a fallback token id in the board inbox detail", async () => {
    const longToken = "px-token-release-archive";
    const row = approval({
      requestedByTokenId: longToken,
      agentSessionId: null,
    });
    mockInbox.mockResolvedValue([row]);
    vi.spyOn(api, "getApproval").mockResolvedValue(row);

    renderDialog("/board/board-1?agents=inbox");

    await userEvent.click(await screen.findByTestId(`approval-row-${row.id}`));
    const detail = await screen.findByTestId("approval-detail");
    expect(detail).toHaveTextContent("px-token…rchive");
    expect(detail).not.toHaveTextContent(longToken);
    expect(detail).not.toHaveTextContent("px-token-rele…");
  });

  it("loads the queue and approves the exact plan hash", async () => {
    const row = approval();
    const decided = approval({
      status: "approved",
      decidedBy: "user-2",
      decidedAt: Date.now(),
      decisionComment: "Ship it",
    });
    mockInbox.mockResolvedValue([row]);
    vi.spyOn(api, "getApproval")
      .mockResolvedValueOnce(row)
      .mockResolvedValue(decided);
    const decide = vi.spyOn(api, "decideApproval").mockResolvedValue(decided);

    renderDialog();

    const queue = await screen.findByTestId("approval-queue");
    expect(within(queue).getByText(row.summary)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(`approval-row-${row.id}`));

    expect(await screen.findByTestId("approval-plan-hash")).toHaveTextContent(
      row.planHash.slice(0, 44),
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

  it("groups the queue and names the requesting agent from the token list", async () => {
    const row = approval();
    mockInbox.mockResolvedValue([row]);
    vi.spyOn(api, "getApproval").mockResolvedValue(row);
    vi.spyOn(api, "listTokens").mockResolvedValue([token()]);
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([session()]);

    renderDialog();

    const queue = await screen.findByTestId("approval-queue");
    expect(within(queue).getByText("Needs decision")).toBeInTheDocument();
    expect(
      within(queue).getByText("QA agent · Remove stale card"),
    ).toBeInTheDocument();
    expect(
      within(queue).getByTestId(`approval-row-${row.id}`),
    ).toHaveTextContent("expires in 30 min");
    expect(within(queue).getByTestId("approval-row-status")).toHaveTextContent(
      "Pending",
    );
  });

  it("shows the mockup header cancel action and inline footer", async () => {
    const row = approval();
    mockInbox.mockResolvedValue([row]);
    vi.spyOn(api, "getApproval").mockResolvedValue(row);
    const cancel = vi
      .spyOn(api, "cancelApproval")
      .mockResolvedValue(approval({ status: "cancelled" }));

    renderDialog();
    await userEvent.click(await screen.findByTestId(`approval-row-${row.id}`));
    expect(await screen.findByTestId("approval-cancel-menu")).toBeVisible();
    expect(
      screen.getAllByText(/Approving authorizes only/).length,
    ).toBeGreaterThan(0);
    const footerHost = screen.getByTestId("agent-control-footer");
    expect(within(footerHost).getByTestId("approval-reject")).toBeVisible();
    expect(within(footerHost).getByTestId("approval-approve")).toBeVisible();
    expect(
      screen.getByTestId("approval-detail").querySelector("footer"),
    ).toBeNull();
    expect(screen.queryByTestId("approval-next-pending")).toBeNull();

    await userEvent.click(screen.getByTestId("approval-cancel-menu"));
    const confirmTitle = await screen.findByText("Cancel this request?");
    const dialog = confirmTitle.closest('[role="dialog"]') as HTMLElement;
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel request" }),
    );
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("board-1", row.id));
  });

  it("selects the first pending request from the visible Needs queue, not an expired head row", async () => {
    const expired = approval({
      id: "approval-expired",
      summary: "Expired landing move",
      expiresAt: Date.now() - 60_000,
    });
    const pending = approval({
      id: "approval-pending",
      summary: "Pending delete claim",
    });
    mockInbox.mockResolvedValue([expired, pending]);
    vi.spyOn(api, "getApproval").mockImplementation((_boardId, id) =>
      Promise.resolve(id === pending.id ? pending : expired),
    );

    renderDialog();

    expect(await screen.findByText("Pending delete claim")).toBeInTheDocument();
    expect(await screen.findByTestId("approval-approve")).toBeVisible();
    expect(screen.queryByText("Expired landing move")).toBeNull();
  });

  it("moves the detail to the visible queue when the filter changes", async () => {
    const pending = approval({
      id: "approval-pending",
      summary: "Pending delete claim",
    });
    const decided = approval({
      id: "approval-decided",
      summary: "Approved landing move",
      status: "approved",
      decidedBy: "Auditor",
      decidedAt: Date.now() - 60_000,
    });
    mockInbox.mockResolvedValue([pending, decided]);
    vi.spyOn(api, "getApproval").mockImplementation((_boardId, id) =>
      Promise.resolve(id === decided.id ? decided : pending),
    );

    renderDialog();
    expect(await screen.findByText("Pending delete claim")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("approval-filter-decided"));

    await waitFor(() =>
      expect(screen.getByTestId("approval-detail")).toHaveTextContent(
        "Approved landing move",
      ),
    );
    expect(screen.queryByText("Pending delete claim")).toBeNull();
    // Decided rows show an absolute decision moment, never “X minutes ago”.
    expect(screen.getByTestId(`approval-row-${decided.id}`)).toHaveTextContent(
      /Today, /,
    );
    expect(
      screen.getByTestId(`approval-row-${decided.id}`),
    ).not.toHaveTextContent(/ago/);
  });

  it("honors an explicit ?approval deep link even when the row is decided", async () => {
    const expired = approval({
      id: "approval-expired",
      summary: "Expired landing move",
      expiresAt: Date.now() - 60_000,
    });
    const pending = approval({
      id: "approval-pending",
      summary: "Pending delete claim",
    });
    mockInbox.mockResolvedValue([expired, pending]);
    vi.spyOn(api, "getApproval").mockResolvedValue(expired);

    renderDialog("/board/board-1?agents=inbox&approval=approval-expired");

    expect(
      await screen.findByRole("heading", { name: "Expired landing move" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("approval-approve")).toBeNull();
  });

  it("requires a reason and sends the plan hash when rejecting", async () => {
    const row = approval();
    mockInbox.mockResolvedValue([row]);
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
    mockInbox.mockResolvedValue([row]);
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

  it("explains an approved plan whose apply window has ended", async () => {
    const row = approval({
      status: "approved",
      decidedBy: "user-2",
      decidedAt: Date.now() - 10 * 60_000,
      expiresAt: Date.now() - 1_000,
    });
    mockInbox.mockImplementation((_boardId, query) =>
      Promise.resolve(query?.status === "pending" ? [] : [row]),
    );
    vi.spyOn(api, "getApproval").mockResolvedValue(row);

    renderDialog();
    await userEvent.click(await screen.findByTestId("approval-filter-decided"));
    await screen.findByTestId("approval-queue");
    await userEvent.click(screen.getByTestId(`approval-row-${row.id}`));

    expect(await screen.findByTestId("approval-status")).toHaveAttribute(
      "data-status",
      "approved",
    );
    expect(
      screen.getAllByText(/the apply window has ended/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("approval-approve")).toBeNull();
    expect(screen.queryByTestId("approval-reject")).toBeNull();
  });

  it("reaches an old pending request behind 100 newer decided rows", async () => {
    const pending = approval({
      id: "approval-old-pending",
      summary: "Old pending delete claim",
    });
    const decided = Array.from({ length: 100 }, (_, index) =>
      approval({
        id: `approval-decided-${index}`,
        status: "rejected",
        decidedBy: "user-2",
        decidedAt: Date.now() - index * 1_000,
        summary: `Rejected request ${index}`,
      }),
    );
    mockInbox.mockImplementation((_boardId, query) =>
      Promise.resolve(query?.status === "pending" ? [pending] : decided),
    );
    vi.spyOn(api, "getApproval").mockResolvedValue(pending);

    renderDialog();

    const queue = await screen.findByTestId("approval-queue");
    expect(within(queue).getByText("Old pending delete claim")).toBeVisible();
    expect(
      await screen.findByTestId("agent-approvals-count"),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId("agent-control-header-pending"),
    ).toHaveTextContent("1 waiting");
  });

  it("loads all 250 pending approvals across two cursors when the recent page fails", async () => {
    const rows = Array.from({ length: 250 }, (_, index) =>
      overviewItem({ id: `pending-${index}`, summary: `Pending ${index}` }),
    );
    let decidedAvailable = false;
    const decided = overviewItem({
      id: "decided-1",
      status: "rejected",
      summary: "Decided earlier",
    });
    const overview = vi
      .spyOn(api, "agentsOverview")
      .mockImplementation(async (query = {}) => {
        if (query.status === "decided" && !decidedAvailable)
          throw new Error("Recent page unavailable");
        const start = Number(query.cursor ?? 0);
        const items =
          query.status === "decided"
            ? [decided]
            : rows.slice(start, start + 100);
        return {
          ...overviewResponse(items, {
            boardId: "board-1",
            total: query.status === "decided" ? 1 : rows.length,
          }),
          nextCursor:
            query.status === "pending" && start + 100 < rows.length
              ? // Repeat the last initial row to exercise cursor-page deduplication.
                String(start === 0 ? 99 : start + 100)
              : null,
        };
      });
    vi.spyOn(api, "getApproval").mockImplementation(async (_boardId, id) =>
      approval({ id }),
    );
    renderDialog();
    expect(
      await screen.findByTestId("agent-approvals-count"),
    ).toHaveTextContent("250");
    expect(
      screen.getByTestId("agent-control-header-pending"),
    ).toHaveTextContent("250 waiting");
    expect(await screen.findByTestId("approval-row-pending-0")).toBeVisible();
    await userEvent.click(screen.getByTestId("approval-load-more"));
    expect(await screen.findByTestId("approval-row-pending-100")).toBeVisible();
    expect(overview).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", cursor: "99" }),
    );
    expect(screen.getAllByTestId(/^approval-row-pending-/)).toHaveLength(199);
    const loadMore = screen.getByTestId("approval-load-more");
    expect(loadMore).toBeEnabled();
    await userEvent.click(loadMore);
    expect(await screen.findByTestId("approval-row-pending-249")).toBeVisible();
    expect(overview).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", cursor: "199" }),
    );
    expect(screen.getAllByTestId(/^approval-row-pending-/)).toHaveLength(250);
    expect(screen.queryByTestId("approval-load-more")).toBeNull();
    decidedAvailable = true;
    await userEvent.click(screen.getByTestId("approval-refresh"));
    await userEvent.click(screen.getByTestId("approval-filter-all"));
    expect(await screen.findByTestId("approval-row-decided-1")).toBeVisible();
    expect(
      screen.getAllByTestId(/^approval-row-(pending-|decided-1)/).at(-1),
    ).toHaveAttribute("data-testid", "approval-row-decided-1");
  });

  it("drops the pending count when a request TTL lapses without SSE", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const now = Date.now();
      const row = approval({
        expiresAt: now + 29_000,
        createdAt: now - 60_000,
      });
      mockInbox.mockImplementation((_boardId, query) =>
        Promise.resolve(query?.status === "pending" ? [row] : [row]),
      );
      vi.spyOn(api, "getApproval").mockResolvedValue(row);

      renderDialog();
      await screen.findByTestId("approval-queue");
      expect(screen.getByTestId("agent-approvals-count")).toHaveTextContent(
        "1",
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });

      await waitFor(() =>
        expect(screen.queryByTestId("agent-approvals-count")).toBeNull(),
      );
      expect(screen.queryByTestId("agent-control-header-pending")).toBeNull();
      expect(screen.queryByTestId("approval-queue")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes Board Live on heartbeat and token-pause SSE frames", async () => {
    const list = vi
      .spyOn(api, "listAgentSessions")
      .mockResolvedValue([session()]);
    renderDialog();
    await userEvent.click(screen.getByTestId("agent-pause-tab"));
    await screen.findByTestId("agent-session-row-session-1");
    const beforeHeartbeat = list.mock.calls.length;

    act(() => {
      live.agentControl.publishAgent("board-1", {
        type: "agent",
        op: "heartbeat",
        sessionId: "session-1",
        scope: "session",
        at: Date.now(),
      });
    });
    await waitFor(() =>
      expect(list.mock.calls.length).toBeGreaterThan(beforeHeartbeat),
    );

    const beforePause = list.mock.calls.length;
    act(() => {
      live.agentControl.publishAgent("board-1", {
        type: "agent",
        op: "paused",
        scope: "token",
        at: Date.now(),
      });
    });
    await waitFor(() =>
      expect(list.mock.calls.length).toBeGreaterThan(beforePause),
    );
  });

  it("repaints the board pause and refreshes rows from a board frame", async () => {
    const list = vi
      .spyOn(api, "listAgentSessions")
      .mockResolvedValue([session()]);
    renderDialog();
    await userEvent.click(screen.getByTestId("agent-pause-tab"));
    expect(await screen.findByTestId("board-pause-status")).toHaveAttribute(
      "data-paused",
      "false",
    );
    const before = list.mock.calls.length;

    act(() => {
      live.agentControl.publishAgent("board-1", {
        type: "agent",
        op: "paused",
        scope: "board",
        at: Date.now(),
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("board-pause-status")).toHaveAttribute(
        "data-paused",
        "true",
      ),
    );
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  });

  it("refetches approval detail on an external decision SSE frame", async () => {
    const row = approval();
    const rejected = approval({
      status: "rejected",
      decidedBy: "user-2",
      decidedAt: Date.now(),
    });
    mockInbox.mockResolvedValue([row]);
    const get = vi
      .spyOn(api, "getApproval")
      .mockResolvedValueOnce(row)
      .mockResolvedValue(rejected);

    renderDialog();
    await userEvent.click(await screen.findByTestId(`approval-row-${row.id}`));
    expect(await screen.findByTestId("approval-approve")).toBeVisible();

    act(() => {
      live.agentControl.publishApproval({
        type: "approval",
        approvalId: row.id,
        status: "rejected",
        at: Date.now(),
      });
    });

    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByTestId("approval-status")).toHaveAttribute(
      "data-status",
      "rejected",
    );
    expect(screen.queryByTestId("approval-approve")).toBeNull();
  });

  it("opens a mobile deep link whose approval is outside the loaded page", async () => {
    const target = approval({
      id: "approval-old",
      summary: "Old pending delete claim",
      expiresAt: Date.now() + 10 * 60_000,
    });
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query.includes("max-width: 760px"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    mockInbox.mockImplementation((_boardId, query) =>
      Promise.resolve(query?.status === "pending" ? [] : []),
    );
    vi.spyOn(api, "getApproval").mockResolvedValue(target);

    renderDialog("/board/board-1?agents=inbox&approval=approval-old");

    expect(
      await screen.findByRole("heading", { name: "Old pending delete claim" }),
    ).toBeVisible();
    expect(screen.getByTestId("approval-split")).toHaveClass("is-detail-open");
  });

  it("keeps the focused mobile detail after an external decision", async () => {
    const row = approval();
    const approved = approval({
      status: "approved",
      decidedBy: "user-2",
      decidedAt: Date.now(),
    });
    let decided = false;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query.includes("max-width: 760px"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    mockInbox.mockImplementation(() =>
      Promise.resolve(decided ? [approved] : [row]),
    );
    vi.spyOn(api, "getApproval").mockImplementation(() =>
      Promise.resolve(decided ? approved : row),
    );

    renderDialog();
    await userEvent.click(await screen.findByTestId(`approval-row-${row.id}`));
    expect(screen.getByTestId("approval-split")).toHaveClass("is-detail-open");

    decided = true;
    act(() => {
      live.agentControl.publishApproval({
        type: "approval",
        approvalId: row.id,
        status: "approved",
        at: Date.now(),
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("approval-status")).toHaveAttribute(
        "data-status",
        "approved",
      ),
    );
    expect(screen.getByTestId("approval-split")).toHaveClass("is-detail-open");
    expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
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
    const overview = vi.spyOn(api, "agentsOverview");
    renderButton();

    expect(screen.queryByTestId("agent-control-trigger")).toBeNull();
    expect(screen.getByTestId("agent-runs-trigger")).toBeInTheDocument();
    expect(overview).not.toHaveBeenCalled();
  });

  it("hides approvals from a member and opens Live read-only", async () => {
    mocks.role = "MEMBER";
    const list = vi.spyOn(api, "agentsOverview");
    renderDialog();
    expect(screen.queryByTestId("agent-approvals-tab")).toBeNull();
    expect(screen.getByTestId("agent-pause-tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("board-pause-status")).toHaveAttribute(
      "data-paused",
      "false",
    );
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByTestId("approval-approve")).toBeNull();
  });

  it("shows empty and error states, and retries the queue", async () => {
    const list = mockInbox
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue([]);

    renderDialog();
    expect(
      await screen.findByText("Could not load the approval queue"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-approvals-error-card")).toHaveTextContent(
      "Retry does not drop the filters",
    );
    expect(screen.queryByTestId("approval-detail-empty")).toBeNull();
    expect(screen.queryByText("Select an approval")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No approvals waiting")).toBeInTheDocument();
    expect(screen.getByText("Select an approval")).toBeInTheDocument();
    // Pending and decided are independent; the header shares the pending page.
    expect(list).toHaveBeenCalledTimes(4);
  });

  it("refreshes the header pending count after an inbox retry", async () => {
    const row = approval({
      id: "approval-pending",
      summary: "Pending delete claim",
    });
    let fail = true;
    mockInbox.mockImplementation(() =>
      fail ? Promise.reject(new Error("down")) : Promise.resolve([row]),
    );
    vi.spyOn(api, "getApproval").mockResolvedValue(row);

    renderDialog("/board/board-1?agents=inbox");
    expect(
      await screen.findByText("Could not load the approval queue"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("agent-approvals-count")).toBeNull();

    fail = false;
    await userEvent.click(screen.getByTestId("agent-approvals-retry"));

    expect(await screen.findByTestId("approval-queue")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("agent-approvals-count")).toHaveTextContent(
        "1",
      ),
    );
  });

  it("refetches the queue on an approval SSE frame without a reload", async () => {
    const row = approval();
    const list = mockInbox.mockResolvedValue([row]);
    vi.spyOn(api, "getApproval").mockResolvedValue(row);

    renderDialog();
    await screen.findByTestId("approval-queue");
    const initialCalls = list.mock.calls.length;

    act(() => {
      live.agentControl.publishApproval({
        type: "approval",
        approvalId: row.id,
        status: "approved",
        at: Date.now(),
      });
    });

    await waitFor(() =>
      expect(list.mock.calls.length).toBeGreaterThan(initialCalls),
    );
  });

  it("shows and refreshes the pending badge from the overview count", async () => {
    const overview = vi
      .spyOn(api, "agentsOverview")
      .mockResolvedValueOnce(
        overviewResponse([overviewItem()], {
          boardId: "board-1",
          boards: [{ id: "board-1", title: "Launch board", role: "ADMIN" }],
          pendingByBoard: { "board-1": 1 },
          pendingTotal: 1,
          totalApprovals: 1,
        }),
      )
      .mockResolvedValueOnce(
        overviewResponse([overviewItem()], {
          boardId: "board-1",
          boards: [{ id: "board-1", title: "Launch board", role: "ADMIN" }],
          pendingByBoard: { "board-1": 2 },
          pendingTotal: 2,
          totalApprovals: 2,
        }),
      );

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
    expect(overview).toHaveBeenCalledTimes(2);
  });

  it("renders 99+ on the board trigger for a large exact count", async () => {
    const listApprovals = vi.spyOn(api, "listApprovals");
    vi.spyOn(api, "agentsOverview").mockResolvedValue(
      overviewResponse([overviewItem()], {
        boardId: "board-1",
        boards: [{ id: "board-1", title: "Launch board", role: "ADMIN" }],
        pendingByBoard: { "board-1": 150 },
        pendingTotal: 150,
        totalApprovals: 150,
      }),
    );

    renderButton();
    expect(
      await screen.findByTestId("agent-control-pending-count"),
    ).toHaveTextContent("99+");
    expect(listApprovals).not.toHaveBeenCalled();
  });

  it("pauses and resumes a board and a session with a reason", async () => {
    mockInbox.mockResolvedValue([]);
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

    await userEvent.click(screen.getByTestId("board-pause"));
    expect(await screen.findByTestId("board-pause-dialog")).toBeInTheDocument();
    await userEvent.type(
      screen.getByTestId("board-pause-reason"),
      "Release freeze",
    );
    await userEvent.click(screen.getByTestId("board-pause-confirm"));
    await waitFor(() =>
      expect(pauseBoard).toHaveBeenCalledWith("board-1", "Release freeze"),
    );
    expect(await screen.findByTestId("board-pause-status")).toHaveAttribute(
      "data-paused",
      "true",
    );

    await userEvent.click(screen.getByTestId("board-resume"));
    expect(
      await screen.findByTestId("board-resume-dialog"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("board-resume-confirm"));
    await waitFor(() =>
      expect(resumeBoard).toHaveBeenCalledWith("board-1", undefined),
    );

    const row = await screen.findByTestId("agent-session-row-session-1");
    expect(within(row).getByText("Release bot")).toBeInTheDocument();
    await userEvent.click(within(row).getByTestId("agent-session-pause"));
    await userEvent.type(screen.getByTestId("agent-action-reason"), "Review");
    await userEvent.click(screen.getByTestId("agent-action-confirm"));
    await waitFor(() =>
      expect(pauseSession).toHaveBeenCalledWith(
        "board-1",
        "session-1",
        "Review",
      ),
    );

    const pausedRow = await screen.findByTestId("agent-session-row-session-1");
    expect(
      within(pausedRow).getByTestId("agent-status-paused"),
    ).toHaveTextContent("Paused");
    // One paused pill: no duplicate "Session pause" chip and no row-level
    // reason; the reason lives in the detail surface.
    expect(within(pausedRow).queryByTestId("agent-session-paused")).toBeNull();
    expect(pausedRow).not.toHaveTextContent("Reason: Review");
    await userEvent.click(screen.getByTestId("agent-session-resume"));
    await userEvent.click(await screen.findByTestId("agent-action-confirm"));
    await waitFor(() =>
      expect(resumeSession).toHaveBeenCalledWith(
        "board-1",
        "session-1",
        undefined,
      ),
    );
  });

  it("shows lifecycle and heartbeat separately, and hides terminal actions", async () => {
    const staleActive = session({
      id: "stale-active",
      stale: true,
      lastHeartbeatAt: Date.now() - 6 * 60_000,
    });
    const completed = session({
      id: "completed",
      status: "completed",
      endedAt: Date.now() - 1_000,
      lastHeartbeatAt: Date.now() - 1_100,
    });
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([
      staleActive,
      completed,
    ]);

    renderDialog();
    await userEvent.click(screen.getByTestId("agent-pause-tab"));

    const staleRow = await screen.findByTestId(
      "agent-session-row-stale-active",
    );
    expect(
      within(staleRow).getByTestId("agent-status-active"),
    ).toHaveTextContent("Active");
    expect(staleRow).toHaveTextContent("No heartbeat · 6m");
    expect(within(staleRow).queryByTestId("agent-status-stale")).toBeNull();
    const terminalRow = screen.getByTestId("agent-session-row-completed");
    expect(
      within(terminalRow).getByTestId("agent-status-completed"),
    ).toHaveTextContent("Completed");
    expect(within(terminalRow).queryByTestId("agent-session-pause")).toBeNull();
    expect(
      within(terminalRow).queryByTestId("agent-session-resume"),
    ).toBeNull();
    expect(within(terminalRow).queryByTestId("agent-session-end")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Stop token|Stop all/i }),
    ).toBeNull();
  });

  it("links token settings only for the caller's own token", async () => {
    vi.spyOn(api, "listTokens").mockResolvedValue([
      token({ id: "token-1", name: "QA agent" }),
    ]);
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([
      session({ id: "own", apiTokenId: "token-1" }),
      session({
        id: "other",
        apiTokenId: "token-2",
        name: "Other session",
      }),
    ]);

    renderDialog();
    await userEvent.click(screen.getByTestId("agent-pause-tab"));

    expect(
      await screen.findByTestId("agent-live-token-settings-token-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("agent-live-token-settings-token-2-readonly"),
    ).toHaveTextContent("Other member's token");
    expect(
      screen.queryByTestId("agent-live-token-settings-token-2"),
    ).toBeNull();
  });

  it("shows Inbox, Live and Runs counts on the rail before leaving Inbox", async () => {
    mockInbox.mockResolvedValue([approval()]);
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([
      session(),
      session({ id: "session-2" }),
    ]);
    vi.spyOn(api, "listRuns").mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: `run-${index}`,
      })) as never,
    );

    renderDialog();

    expect(
      await screen.findByTestId("agent-approvals-count"),
    ).toHaveTextContent("1");
    expect(screen.getByTestId("agent-pause-count")).toHaveTextContent("2");
    expect(screen.getByTestId("agent-runs-count")).toHaveTextContent("5");
  });

  it("hides the pending chip and rail count when approvals fail", async () => {
    mockInbox.mockRejectedValue(new Error("down"));

    renderDialog();
    expect(
      await screen.findByText("Could not load the approval queue"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("agent-control-header-pending")).toBeNull();
    expect(screen.queryByTestId("agent-approvals-count")).toBeNull();
    expect(screen.queryByText("No pending")).toBeNull();
  });

  it("keeps the pause footer when sessions fail to load", async () => {
    vi.spyOn(api, "listAgentSessions").mockRejectedValue({ status: 500 });

    renderDialog();
    await userEvent.click(screen.getByTestId("agent-pause-tab"));

    expect(await screen.findByTestId("board-pause-status")).toHaveAttribute(
      "data-paused",
      "false",
    );
    expect(screen.getByTestId("board-pause")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pause is a board-wide safety switch, not a policy change. In-flight finishes; claims stay.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Could not load agent sessions"),
    ).toBeInTheDocument();
    const errorCard = screen.getByTestId("agent-live-error-card");
    expect(errorCard).toHaveTextContent("Retry does not drop the filters");
    expect(screen.getByTestId("agent-live-panel")).not.toHaveTextContent(
      "0 sessions",
    );
  });

  it("keeps the stale age in the subline, not the No heartbeat chip", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([
      session({ stale: true, lastHeartbeatAt: Date.now() - 53 * 60_000 }),
    ]);
    renderDialog();
    await userEvent.click(screen.getByTestId("agent-pause-tab"));

    const row = await screen.findByTestId("agent-session-row-session-1");
    const chip = within(row).getByTestId("agent-session-no-heartbeat");
    expect(chip).toHaveTextContent(/^No heartbeat$/);
    expect(chip).not.toHaveTextContent("53m");
    expect(within(row).getByTestId("agent-heartbeat")).toHaveTextContent(
      "No heartbeat · 53m",
    );
  });

  it("keeps the board pause dialog open with an inline error", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([session()]);
    vi.spyOn(api, "pauseBoardAgents").mockRejectedValue({ status: 500 });

    renderDialog();
    await userEvent.click(screen.getByTestId("agent-pause-tab"));
    await userEvent.click(await screen.findByTestId("board-pause"));
    await userEvent.click(await screen.findByTestId("board-pause-confirm"));

    expect(await screen.findByTestId("board-pause-error")).toHaveTextContent(
      "Could not complete the action",
    );
    expect(screen.getByTestId("board-pause-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("board-pause-confirm")).toBeEnabled();
    expect(
      screen.getByText("Pause all agents on this board?"),
    ).toBeInTheDocument();
  });

  it("ends a live session from the Live panel and removes its row", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([session()]);
    const end = vi.spyOn(api, "endAgentSession").mockResolvedValue(
      session({
        status: "completed",
        endedAt: Date.now(),
        endReason: "completed",
      }),
    );

    renderDialog();
    await userEvent.click(screen.getByTestId("agent-pause-tab"));
    const row = await screen.findByTestId("agent-session-row-session-1");
    await userEvent.click(within(row).getByTestId("agent-session-end"));
    expect(await screen.findByText("End this session?")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agent-action-confirm"));

    await waitFor(() =>
      expect(end).toHaveBeenCalledWith("board-1", "session-1", {
        status: "completed",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("agent-session-row-session-1")).toBeNull(),
    );
  });

  it("has no Policy tab and links to Board Settings → Agents & automation", async () => {
    mockInbox.mockResolvedValue([]);
    const onOpenPolicy = vi.fn();
    render(
      <MemoryRouter>
        <I18nProvider>
          <ToastProvider>
            <BoardLiveProvider live={live}>
              <AgentControlDialog
                open
                onOpenChange={vi.fn()}
                onOpenPolicy={onOpenPolicy}
              />
            </BoardLiveProvider>
          </ToastProvider>
        </I18nProvider>
      </MemoryRouter>,
    );

    const policyLink = await screen.findByTestId("agent-open-policy");
    expect(screen.queryByTestId("agent-policy-tab")).toBeNull();
    expect(screen.getByText("Agent policy ↗")).toBeInTheDocument();
    expect(policyLink).toHaveClass("ac-rail-link");
    expect(policyLink).toHaveTextContent("Open policy settings");
    await userEvent.click(policyLink);
    expect(onOpenPolicy).toHaveBeenCalledTimes(1);
  });

  it("renders the prototype empty Inbox state with search and refresh", async () => {
    const list = mockInbox.mockResolvedValue([]);
    renderDialog();

    expect(await screen.findByText("No approvals waiting")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The board is clear. Decided requests stay in the history.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Select an approval")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose a request to see its impact, hash and decision.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-control-footer")).toHaveTextContent(
      "Only a board admin can decide. This queue is empty.",
    );
    expect(screen.getByTestId("approval-search")).toHaveAttribute(
      "placeholder",
      "Search approvals…",
    );
    expect(screen.getByTestId("approval-filter-needs")).toHaveClass(
      "chip",
      "primary",
    );
    expect(screen.getByTestId("approval-filter-needs")).toHaveTextContent(
      "Needs0",
    );

    const before = list.mock.calls.length;
    await userEvent.click(screen.getByTestId("approval-refresh"));
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  });

  it("filters approvals by the search query", async () => {
    const first = approval();
    const second = approval({
      id: "approval-2",
      summary: "Archive old column",
      planHash: "b".repeat(64),
    });
    mockInbox.mockResolvedValue([first, second]);
    vi.spyOn(api, "getApproval").mockResolvedValue(first);

    renderDialog();
    await screen.findByTestId("approval-queue");

    await userEvent.type(screen.getByTestId("approval-search"), "Archive");
    expect(screen.queryByTestId(`approval-row-${first.id}`)).toBeNull();
    expect(screen.getByTestId(`approval-row-${second.id}`)).toBeInTheDocument();
    // The prototype keeps the full counts; search only narrows the list.
    expect(screen.getByTestId("approval-filter-needs")).toHaveTextContent(
      "Needs2",
    );

    await userEvent.clear(screen.getByTestId("approval-search"));
    expect(screen.getByTestId(`approval-row-${first.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`approval-row-${second.id}`)).toBeInTheDocument();
  });

  it("uses filtered-empty copy and clears the search", async () => {
    const row = approval();
    mockInbox.mockResolvedValue([row]);
    vi.spyOn(api, "getApproval").mockResolvedValue(row);

    renderDialog();
    await screen.findByTestId("approval-queue");
    const search = screen.getByTestId("approval-search");
    await userEvent.type(search, "zzzz-no-match");

    expect(
      await screen.findByText("No approvals match these filters"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No approvals waiting")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear filters" }),
    );

    expect(await screen.findByTestId("approval-queue")).toBeInTheDocument();
    expect(search).toHaveValue("");
  });

  it("shows the prototype empty Live state and pause footer", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([]);
    renderDialog();
    await userEvent.click(screen.getByTestId("agent-pause-tab"));

    expect(await screen.findByTestId("agent-live-empty")).toBeInTheDocument();
    expect(screen.getByText("0 sessions")).toBeInTheDocument();
    expect(screen.getByText("No live sessions")).toBeInTheDocument();
    expect(
      screen.getByText("Agent sessions appear here as soon as they heartbeat."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pause is a board-wide safety switch, not a policy change. In-flight finishes; claims stay.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("board-pause")).toHaveTextContent(
      "Pause all agents",
    );
    expect(screen.queryByTestId("pause-semantics")).toBeNull();
    expect(screen.queryByTestId("agent-live-manage-tokens")).toBeNull();
    expect(
      screen.queryByText(
        "Ending a session releases its claims. Token-level pause, stop-all and revoke stay in Account → API keys; this board surface only links there.",
      ),
    ).toBeNull();
  });
});
