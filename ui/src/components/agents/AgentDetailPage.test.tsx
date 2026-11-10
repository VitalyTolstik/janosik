import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  },
}));

vi.mock("@/store/BoardContext", () => ({
  useBoard: () => ({ boards: [] }),
}));

vi.mock("@/components/agents/use-agent-events", () => ({
  useAgentSessionEvents: () => {},
}));

import { AgentDetailPage } from "@/components/agents/AgentDetailPage";

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

function renderDetail(tokenId = "token-1") {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/agents/${tokenId}`]}>
          <Routes>
            <Route path="/agents/:tokenId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listBoards.mockResolvedValue(BOARDS);
  hoisted.listTokens.mockResolvedValue([{ id: "token-1", name: "QA agent" }]);
  hoisted.me.mockResolvedValue({ id: "user-1", token: null });
  hoisted.listAgentSessions.mockImplementation((boardId: string) =>
    Promise.resolve(
      boardId === "board-1"
        ? [session()]
        : [
            session({
              id: "session-2",
              boardId: "board-2",
              apiTokenId: "token-2",
            }),
          ],
    ),
  );
  hoisted.pauseAgentSession.mockResolvedValue(
    session({
      paused: true,
      pausedAt: Date.now(),
      pausedBy: "user-1",
      pausedReason: "Stop the loop",
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
});

describe("AgentDetailPage", () => {
  it("renders the agent identity and every session with its heartbeat", async () => {
    renderDetail();

    expect(await screen.findByTestId("agent-detail-name")).toHaveTextContent(
      "QA agent",
    );
    const sessions = screen.getAllByTestId("agent-session");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toHaveTextContent("Launch");
    expect(sessions[0]).toHaveTextContent("Nightly triage");
    expect(sessions[0]).toHaveTextContent("gpt-5");
    expect(sessions[0]).toHaveTextContent("run-1");
    expect(within(sessions[0]).getAllByTestId("agent-last-seen").length).toBe(
      1,
    );
    expect(screen.getByTestId("agent-detail-stat-sessions")).toHaveTextContent(
      "1",
    );
  });

  it("pauses a session with a reason and updates the row without a reload", async () => {
    renderDetail();
    await screen.findByTestId("agent-session-list");

    await userEvent.click(screen.getByTestId("agent-session-pause"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByTestId("agent-action-reason"),
      "Stop the loop",
    );
    await userEvent.click(within(dialog).getByTestId("agent-action-confirm"));

    await waitFor(() =>
      expect(hoisted.pauseAgentSession).toHaveBeenCalledWith(
        "board-1",
        "session-1",
        "Stop the loop",
      ),
    );
    expect(
      await screen.findByTestId("agent-pause-badge-session"),
    ).toBeVisible();
    expect(screen.getByTestId("agent-session-resume")).toBeInTheDocument();
  });

  it("ends a session with a final status and hides the controls", async () => {
    renderDetail();
    await screen.findByTestId("agent-session-list");

    await userEvent.click(screen.getByTestId("agent-session-end"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByTestId("agent-action-summary"),
      "Finished the queue",
    );
    await userEvent.click(within(dialog).getByTestId("agent-action-confirm"));

    await waitFor(() =>
      expect(hoisted.endAgentSession).toHaveBeenCalledWith(
        "board-1",
        "session-1",
        { status: "completed", summary: "Finished the queue" },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("agent-session-end")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("agent-status-completed")).toBeVisible();
  });

  it("renders a MEMBER's session read-only", async () => {
    hoisted.listBoards.mockResolvedValue([{ ...BOARDS[0], role: "MEMBER" }]);
    renderDetail();

    await screen.findByTestId("agent-session-list");
    expect(screen.getByTestId("agent-read-only-notice")).toBeVisible();
    expect(screen.queryByTestId("agent-session-pause")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-session-end")).not.toBeInTheDocument();
  });

  it("shows a not-found state for a token with no visible sessions", async () => {
    renderDetail("token-missing");

    expect(await screen.findByTestId("agent-not-found")).toBeVisible();
  });
});
