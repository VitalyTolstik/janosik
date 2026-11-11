import { render, screen, waitFor } from "@testing-library/react";
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
    renderPage();
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
    hoisted.listAgentSessions.mockImplementation((boardId: string) =>
      Promise.resolve(boardId === "board-1" ? [session()] : []),
    );
    await userEvent.click(screen.getByTestId("agents-retry"));
    await waitFor(() =>
      expect(screen.queryByTestId("agents-error")).toBeNull(),
    );
    expect(screen.queryByText("Docs agent")).toBeNull();
  });
  it("groups sessions by agent and shows the board, status and heartbeat", async () => {
    renderPage();

    expect(await screen.findByTestId("agents-list")).toBeInTheDocument();
    const rows = screen.getAllByTestId("agent-row");
    expect(rows).toHaveLength(2);
    const qa = rows.find((row) => row.textContent?.includes("QA agent"))!;
    const docs = rows.find((row) => row.textContent?.includes("Docs agent"))!;
    expect(qa).toHaveTextContent("Launch");
    expect(docs).toHaveTextContent("Docs");
    expect(screen.getByTestId("agents-stat-agents")).toHaveTextContent("2");
    expect(screen.getByTestId("agents-stat-live")).toHaveTextContent("2");
    expect(screen.getByTestId("agents-stat-waiting")).toHaveTextContent("1");
    expect(screen.getAllByTestId("agent-last-seen").length).toBeGreaterThan(0);
  });

  it("filters by status from the URL without a round-trip", async () => {
    renderPage("/agents?status=completed");

    expect(await screen.findByTestId("agents-list")).toBeInTheDocument();
    const rows = screen.getAllByTestId("agent-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("QA agent");
    expect(rows[0]).toHaveTextContent("Completed");
  });

  it("shows the filtered empty state and clears it", async () => {
    renderPage("/agents?status=failed");

    expect(
      await screen.findByTestId("agents-filtered-empty"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agents-clear-filters"));
    expect(await screen.findByTestId("agents-list")).toBeInTheDocument();
  });

  it("shows the empty state when no agent has ever run", async () => {
    hoisted.listAgentSessions.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByTestId("agents-empty")).toBeInTheDocument();
    expect(screen.getByTestId("agents-empty")).toHaveTextContent(
      "No agent sessions yet",
    );
  });

  it("surfaces a failure and retries it", async () => {
    hoisted.listAgentSessions.mockRejectedValue({ status: 0 });
    renderPage();

    expect(await screen.findByTestId("agents-error")).toBeInTheDocument();
    expect(screen.getByTestId("agents-error")).toHaveTextContent(
      "Could not load agent sessions",
    );

    hoisted.listAgentSessions.mockResolvedValue([session()]);
    await userEvent.click(screen.getByTestId("agents-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("agents-list")).toBeInTheDocument(),
    );
  });
});
