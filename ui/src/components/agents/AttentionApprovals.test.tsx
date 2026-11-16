import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionDto,
  ApprovalRequestDto,
  Board,
} from "@janosik/shared";

import { I18nProvider } from "@/i18n";
import { overviewItem } from "@/test/agents-overview";

const hoisted = vi.hoisted(() => ({
  getApproval: vi.fn(),
  getBoard: vi.fn(),
  listMembers: vi.fn(),
  listAgentSessions: vi.fn(),
  listTokens: vi.fn(),
  decideApproval: vi.fn(),
  cancelApproval: vi.fn(),
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
      getApproval: hoisted.getApproval,
      getBoard: hoisted.getBoard,
      listMembers: hoisted.listMembers,
      listAgentSessions: hoisted.listAgentSessions,
      listTokens: hoisted.listTokens,
      decideApproval: hoisted.decideApproval,
      cancelApproval: hoisted.cancelApproval,
    },
  };
});

import {
  AttentionApprovalDetail,
  AttentionApprovalList,
  type AttentionApprovalRow,
} from "@/components/agents/AttentionApprovals";

const CARD_TITLE = "Card claim visibility";
const AGENT = "Claude Code — audit";

const BOARD: Board = {
  id: "board-1",
  title: "Launch",
  columns: [],
  cards: {
    "card-1": {
      id: "card-1",
      title: CARD_TITLE,
      labelIds: [],
      createdAt: 0,
      updatedAt: 0,
    },
  },
  labels: [],
  createdAt: 0,
  updatedAt: 0,
};

function approval(
  overrides: Partial<ApprovalRequestDto> = {},
): ApprovalRequestDto {
  const now = Date.now();
  return {
    id: "approval-1",
    boardId: "board-1",
    cardId: "card-1",
    requestedBy: "user-1",
    requestedByTokenId: "token-1",
    agentSessionId: null,
    kind: "destructive",
    actionType: "DELETE_CARD",
    // Legacy seed: straight single quotes and no `Apply ` prefix.
    summary: "Delete card 'Card claim visibility'",
    risk: "medium",
    planHash: "a".repeat(64),
    status: "pending",
    expiresAt: now + 30 * 60_000,
    decidedBy: null,
    decidedAt: null,
    decisionComment: null,
    runId: null,
    consumedAt: null,
    createdAt: now - 60_000,
    impact: { comments: 3, attachments: 2 },
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
    name: "Nightly triage",
    clientName: "mcp",
    model: "gpt-5",
    status: "active",
    currentCardId: null,
    currentRunId: null,
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

function renderList(overrides: Partial<AttentionApprovalRow> = {}) {
  const row: AttentionApprovalRow = {
    ...overviewItem({
      summary: "Delete card 'Card claim visibility'",
      impact: { comments: 3, attachments: 2 },
      ...overrides,
    }),
    agentName: AGENT,
    ...overrides,
  };
  return render(
    <I18nProvider>
      <AttentionApprovalList
        rows={[row]}
        filter="needs"
        onFilterChange={() => {}}
        selectedId={null}
        onSelect={() => {}}
        onReject={() => {}}
        now={Date.now()}
      />
    </I18nProvider>,
  );
}

function renderDetail(
  detail: ApprovalRequestDto = approval(),
  fallbackAgentName = AGENT,
) {
  hoisted.getApproval.mockResolvedValue(detail);
  return render(
    <MemoryRouter>
      <I18nProvider>
        <AttentionApprovalDetail
          boardId="board-1"
          approvalId={detail.id}
          boardTitle="Launch"
          fallbackAgentName={fallbackAgentName}
          onChanged={() => {}}
        />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("AttentionApprovals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getBoard.mockResolvedValue(BOARD);
    hoisted.listMembers.mockResolvedValue([]);
    hoisted.listAgentSessions.mockResolvedValue([]);
    hoisted.listTokens.mockResolvedValue([{ id: "token-1", name: AGENT }]);
    hoisted.decideApproval.mockImplementation((async (
      _boardId: string,
      _approvalId: string,
      body: { decision: "approve" | "reject" },
    ) => ({
      ...approval(),
      status: body.decision === "approve" ? "approved" : "rejected",
      decidedBy: "user-1",
      decidedAt: Date.now(),
    })) as never);
  });

  it("rewrites a legacy DELETE_CARD summary with curly quotes", () => {
    const { container } = renderList();
    expect(container).toHaveTextContent("Delete card “Card claim visibility”");
    expect(container).not.toHaveTextContent(
      "Delete card 'Card claim visibility'",
    );
  });

  it("uses the mockup impact sentence with real comment and attachment counts", () => {
    const { container } = renderList();
    expect(container).toHaveTextContent(
      "Claude Code — audit asks to run DELETE_CARD. This removes 1 card — “Card claim visibility” and its 3 comments, 2 attachments and history will be deleted.",
    );
  });

  it("omits a zero-count clause", () => {
    const { container } = renderList({
      impact: { comments: 0, attachments: 1 },
    });
    expect(container).toHaveTextContent(
      "This removes 1 card — “Card claim visibility” and its 1 attachment and history will be deleted.",
    );
    expect(container).not.toHaveTextContent("0 comments");
  });

  it("falls back to history when both counts are zero", () => {
    const { container } = renderList({
      impact: { comments: 0, attachments: 0 },
    });
    expect(container).toHaveTextContent(
      "This removes 1 card — “Card claim visibility” and its history will be deleted.",
    );
  });

  it("names the categories without numbers when impact is not loaded", () => {
    const { container } = renderList({ impact: undefined });
    expect(container).toHaveTextContent(
      "This removes 1 card — “Card claim visibility” and its comments, attachments and history will be deleted.",
    );
  });

  it("uses the mockup warning tone for the eyebrow, risk chip and pending card", () => {
    const { container } = renderList();
    expect(screen.getByText("Approval · needs decision")).toHaveClass(
      "text-[color:var(--warning)]",
    );
    expect(screen.getByTestId("approval-risk")).toHaveClass(
      "border-[color-mix(in_oklab,var(--warning)_36%,var(--border))]",
      "bg-[color-mix(in_oklab,var(--warning)_7%,transparent)]",
      "text-[color:var(--warning)]",
    );
    expect(container.querySelector("article")).toHaveClass(
      "bg-[color-mix(in_oklab,var(--warning)_4%,var(--surface))]",
    );
  });

  it("shows the exact plan and the decision dialog impact", async () => {
    const user = userEvent.setup();
    renderDetail();

    expect(
      await screen.findByRole("heading", {
        name: "Delete card “Card claim visibility”",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("approval-plan")).toHaveTextContent(
      "DELETE_CARD",
    );
    expect(screen.queryByTestId("agents-approval-impact")).toBeNull();

    await user.click(screen.getByTestId("approval-approve"));
    const dialog = await screen.findByTestId("approval-approve-dialog");
    expect(dialog).toHaveTextContent(
      "1 command. Delete card 'Card claim visibility'. Target: card Card claim visibility.",
    );
  });

  it("uses the resolved token name and opens Account → API keys from the token dialog", async () => {
    const user = userEvent.setup();
    const openApiKeys = vi.fn();
    window.addEventListener("janosik:open-api-keys", openApiKeys);
    renderDetail();

    const trigger = await screen.findByTestId("approval-token-link");
    await user.click(trigger);
    const dialog = await screen.findByTestId("approval-token-dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: `Your token · ${AGENT}`,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("approval-token-impact"),
    ).toHaveTextContent(
      "This link is shown only for your own token. Other members' tokens stay read-only and expose no settings action.",
    );
    expect(within(dialog).queryByText("token-1")).toBeNull();

    await user.click(within(dialog).getByTestId("approval-token-open-account"));
    expect(openApiKeys).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByTestId("approval-token-dialog")).toBeNull(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    window.removeEventListener("janosik:open-api-keys", openApiKeys);
  });

  it("keeps another member's token read-only with no settings action", async () => {
    const user = userEvent.setup();
    hoisted.listTokens.mockResolvedValue([
      { id: "token-own", name: "My token" },
    ]);
    renderDetail(approval({ requestedByTokenId: "token-other" }));

    const staticToken = await screen.findByTestId("approval-token-static");
    expect(staticToken).toHaveAttribute("data-ownership", "other");
    expect(staticToken).toHaveTextContent(`Token: ${AGENT} (other member)`);
    expect(screen.queryByTestId("approval-token-link")).toBeNull();
    expect(screen.queryByTestId("approval-token-open-account")).toBeNull();

    await user.click(staticToken);
    expect(screen.queryByTestId("approval-token-dialog")).toBeNull();
  });

  it("attributes the approval to the token, not the session name", async () => {
    hoisted.listTokens.mockResolvedValue([
      { id: "token-own", name: "My token" },
    ]);
    hoisted.listAgentSessions.mockResolvedValue([
      session({
        id: "session-other",
        apiTokenId: "token-other",
        name: "Docs build",
        tokenName: "Docs agent",
        status: "waiting_approval",
      }),
    ]);
    // A stale parent fallback must not win over the session's token name.
    renderDetail(
      approval({
        requestedByTokenId: "token-other",
        agentSessionId: "session-other",
      }),
      "Docs build",
    );

    const detail = await screen.findByTestId("agents-approval-detail");
    expect(detail).toHaveTextContent("Docs agent asks to run DELETE_CARD");
    expect(detail).not.toHaveTextContent("Docs build asks");
    expect(within(detail).getAllByText("Docs agent").length).toBeGreaterThan(1);
    expect(within(detail).getByText("Session")).toBeInTheDocument();
    expect(within(detail).getByText("Docs build")).toBeInTheDocument();
  });
});
