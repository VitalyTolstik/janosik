import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionDto,
  Board,
  BoardAction,
  RevertPreviewDto,
  RunDetailDto,
  RunSummaryDto,
} from "@janosik/shared";

import { api, ApiError } from "@/api/client";
import { RunsPanel } from "@/components/agent-control/RunsPanel";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/i18n";
import {
  BoardLiveProvider,
  createBoardLive,
  type BoardLive,
} from "@/store/board-live";

const mocks = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "MEMBER" | "VIEWER",
}));

const BOARD: Board = {
  id: "board-1",
  title: "Launch board",
  columns: [{ id: "col-1", title: "Todo", cardIds: ["card-1"], createdAt: 1 }],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Release notes",
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
  useBoardAccess: () => ({ role: mocks.role }),
}));

const RUN: RunSummaryDto = {
  id: "run-1",
  boardId: "board-1",
  apiTokenId: "token-1",
  agentSessionId: "session-1",
  actorId: "user-1",
  kind: "batch",
  status: "applied",
  clientRunId: "client-run-1",
  planHash: "a".repeat(64),
  approvalId: null,
  commandCount: 1,
  firstSeq: 5,
  lastSeq: 5,
  revertsRunId: null,
  createdAt: Date.now() - 60_000,
  appliedAt: Date.now() - 59_000,
  revertedAt: null,
};

function run(overrides: Partial<RunSummaryDto> = {}): RunSummaryDto {
  return { ...RUN, ...overrides };
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
    startedAt: 1,
    lastHeartbeatAt: 2,
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

function detail(
  preimages: Record<string, unknown> = {},
  overrides: Partial<RunDetailDto> = {},
): RunDetailDto {
  return {
    run: RUN,
    commands: [
      {
        seq: 5,
        action: {
          type: "DELETE_CARD",
          boardId: "board-1",
          cardId: "card-1",
          at: 1,
        } as unknown as BoardAction,
        actorId: "user-1",
        actorType: "agent",
        commandId: "cmd-1",
        touches: ["card:card-1"],
        apiTokenId: "token-1",
        agentSessionId: "session-1",
        runId: RUN.id,
        agentName: "Release bot",
      },
    ],
    preimages,
    ...overrides,
  };
}

function revertedDetail(preimages: Record<string, unknown> = {}): RunDetailDto {
  return detail(preimages, {
    run: {
      ...RUN,
      status: "reverted",
      revertedAt: Date.now(),
    },
  });
}

function revertRunDetail(
  preimages: Record<string, unknown> = {},
): RunDetailDto {
  return detail(preimages, {
    run: {
      ...RUN,
      id: "revert-1",
      kind: "revert",
      status: "applied",
      revertsRunId: RUN.id,
      revertedAt: null,
    },
  });
}

function preview(overrides: Partial<RevertPreviewDto> = {}): RevertPreviewDto {
  return {
    dryRun: true,
    run: RUN,
    conflicts: [],
    canRevert: true,
    diff: { "card:card-1": { title: "Release notes" } },
    ...overrides,
  };
}

let live: BoardLive;

function renderPanel() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter>
          <BoardLiveProvider live={live}>
            <RunsPanel role={mocks.role} />
          </BoardLiveProvider>
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>,
  );
}

function mockHappyPath(detailValue = detail()) {
  vi.spyOn(api, "listRuns").mockResolvedValue([RUN]);
  vi.spyOn(api, "getRun").mockResolvedValue(detailValue);
  vi.spyOn(api, "previewRunRevert").mockResolvedValue(preview());
  vi.spyOn(api, "listAgentSessions").mockResolvedValue([
    session({ name: "Nightly triage" }),
  ]);
  vi.spyOn(api, "listTokens").mockResolvedValue([
    {
      id: "token-1",
      name: "QA agent",
      scopePreset: "worker",
      boardId: null,
      readOnly: false,
      trustedCi: false,
      expiresAt: null,
      createdAt: 1,
      lastUsedAt: null,
    },
  ] as never);
}

describe("RunsPanel (TASK-179.5)", () => {
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

  it("lists a run, names token/session filters and applies a danger-confirmed rollback", async () => {
    const preimages = {
      "cmd-1": { schemaVersion: 1, entities: [{ touch: "card:card-1" }] },
    };
    vi.spyOn(api, "listRuns").mockResolvedValue([RUN]);
    const get = vi
      .spyOn(api, "getRun")
      .mockResolvedValueOnce(detail(preimages))
      .mockResolvedValue(revertedDetail(preimages));
    vi.spyOn(api, "previewRunRevert").mockResolvedValue(preview());
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([
      session({ name: "Nightly triage" }),
    ]);
    vi.spyOn(api, "listTokens").mockResolvedValue([
      {
        id: "token-1",
        name: "QA agent",
        scopePreset: "worker",
        boardId: null,
        readOnly: false,
        trustedCi: false,
        expiresAt: null,
        createdAt: 1,
        lastUsedAt: null,
      },
    ] as never);
    const revert = vi
      .spyOn(api, "revertRun")
      .mockResolvedValue(revertRunDetail(preimages));

    renderPanel();

    const row = await screen.findByTestId(`agent-run-row-${RUN.id}`);
    expect(row).toHaveAttribute("data-status", "applied");
    expect(within(row).getByText(/Batch run/)).toBeInTheDocument();

    const panel = await screen.findByTestId("agent-run-detail");
    expect(within(panel).getByText("DELETE_CARD")).toBeInTheDocument();
    expect(within(panel).getByText("Release notes")).toBeInTheDocument();
    expect(panel).toHaveTextContent((RUN.planHash ?? "").slice(0, 34));
    expect(
      await screen.findByTestId("agent-run-preimages"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-run-can-revert")).toHaveAttribute(
      "data-can-revert",
      "true",
    );

    // Named comboboxes: the token comes from the caller's own token list and
    // the session from the board session list, never a raw UUID input.
    await userEvent.click(screen.getByTestId("run-filter-token"));
    expect(
      screen.getByTestId("run-filter-token-option-token-1"),
    ).toHaveTextContent("QA agent");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByTestId("run-filter-session"));
    expect(
      screen.getByTestId("run-filter-session-option-session-1"),
    ).toHaveTextContent("Nightly triage");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByTestId("agent-run-revert-apply"));
    const dialog = await screen.findByTestId("run-revert-dialog");
    expect(dialog).toHaveTextContent("This is a destructive");
    expect(dialog).toHaveTextContent("1");
    await userEvent.click(screen.getByTestId("run-revert-confirm"));

    await waitFor(() =>
      expect(revert).toHaveBeenCalledWith(
        "board-1",
        RUN.id,
        expect.objectContaining({
          dryRun: false,
          commandId: expect.any(String),
        }),
      ),
    );
    expect(await screen.findByText("Run reverted")).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    // The apply response is the audit revert run; the pane stays pinned to
    // the original run and refetches it, so the badge must flip to Reverted.
    expect(screen.getByTestId("agent-run-status")).toHaveAttribute(
      "data-status",
      "reverted",
    );
    expect(screen.getByTestId("agent-run-reverted-at")).toBeVisible();
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(2));
  });

  it("previews conflicts for a member without apply, diff or pre-images", async () => {
    mocks.role = "MEMBER";
    vi.spyOn(api, "listRuns").mockResolvedValue([RUN]);
    vi.spyOn(api, "getRun").mockResolvedValue(detail());
    vi.spyOn(api, "previewRunRevert").mockResolvedValue(
      preview({
        canRevert: false,
        diff: undefined,
        conflicts: [
          {
            touch: "card:card-1",
            expectedVersion: 1,
            currentVersion: 3,
            reason: "version_changed",
          },
        ],
      }),
    );
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([session()]);
    vi.spyOn(api, "listTokens").mockResolvedValue([]);

    renderPanel();

    expect(await screen.findByTestId("agent-run-conflicts")).toHaveTextContent(
      "card:card-1",
    );
    expect(screen.getByTestId("agent-run-can-revert")).toHaveAttribute(
      "data-can-revert",
      "false",
    );
    expect(screen.queryByTestId("agent-run-revert-apply")).toBeNull();
    expect(
      screen.getByText(
        "Only a signed-in board admin can apply a revert. You can preview conflicts.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("agent-run-preimages")).toBeNull();
    expect(screen.queryByTestId("agent-run-diff")).toBeNull();
    expect(screen.getByTestId("agent-run-admin-only-note")).toHaveTextContent(
      "Pre-images and diffs",
    );
    expect(screen.queryByTestId("agent-run-plan-hash")).toBeNull();
  });

  it("shows loading, error and empty states, and retries the list", async () => {
    const list = vi
      .spyOn(api, "listRuns")
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([]);
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([]);
    vi.spyOn(api, "listTokens").mockResolvedValue([]);

    renderPanel();
    expect(
      await screen.findByText("Could not load the run history"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agent-runs-retry"));

    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Runs appear when an agent applies commands. Rollback is available only for applied runs without conflicts.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No runs on this board")).toBeInTheDocument();
    expect(screen.getByTestId("agent-runs-open-all")).toHaveTextContent(
      "Open all runs",
    );
    expect(screen.getByTestId("agent-runs-open-all")).toHaveClass(
      "btn",
      "btn-outline",
      "btn-sm",
    );
    expect(screen.queryByTestId("run-filter-status")).toBeNull();
    expect(screen.queryByText("Select a run")).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("refetches the list and detail on a run.reverted SSE frame", async () => {
    mockHappyPath();
    const list = vi.spyOn(api, "listRuns").mockResolvedValue([RUN]);
    const get = vi.spyOn(api, "getRun").mockResolvedValue(detail());

    renderPanel();
    await screen.findByTestId(`agent-run-row-${RUN.id}`);
    expect(list).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);

    act(() => {
      live.agentControl.publishRun({
        type: "run",
        op: "reverted",
        runId: RUN.id,
        revertRunId: "revert-1",
        at: Date.now(),
      });
    });

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it("keeps the open run pinned when a refresh prepends the revert run", async () => {
    const revertRun = run({
      id: "run-revert",
      kind: "revert",
      revertsRunId: RUN.id,
      createdAt: Date.now(),
      appliedAt: Date.now(),
    });
    const list = vi
      .spyOn(api, "listRuns")
      .mockResolvedValueOnce([RUN])
      .mockResolvedValue([revertRun, RUN]);
    const get = vi.spyOn(api, "getRun").mockResolvedValue(detail());
    vi.spyOn(api, "previewRunRevert").mockResolvedValue(preview());
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([]);
    vi.spyOn(api, "listTokens").mockResolvedValue([]);

    renderPanel();
    expect(await screen.findByTestId("agent-run-detail")).toHaveAttribute(
      "data-run-id",
      RUN.id,
    );

    act(() => {
      live.agentControl.publishRun({
        type: "run",
        op: "reverted",
        runId: RUN.id,
        revertRunId: revertRun.id,
        at: Date.now(),
      });
    });

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByTestId(`agent-run-row-${revertRun.id}`),
    ).toBeVisible();
    expect(screen.getByTestId("agent-run-detail")).toHaveAttribute(
      "data-run-id",
      RUN.id,
    );
    expect(get).toHaveBeenLastCalledWith("board-1", RUN.id);
  });

  it("drives the server query from status, kind and time filters and clears them", async () => {
    mockHappyPath();
    const list = vi.spyOn(api, "listRuns").mockResolvedValue([RUN]);

    renderPanel();
    await screen.findByTestId(`agent-run-row-${RUN.id}`);

    await userEvent.click(screen.getByTestId("run-filter-status"));
    await userEvent.click(
      screen.getByTestId("run-filter-status-option-failed"),
    );
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        "board-1",
        expect.objectContaining({ status: "failed" }),
      ),
    );

    await userEvent.click(screen.getByTestId("run-filter-kind"));
    await userEvent.click(screen.getByTestId("run-filter-kind-option-plan"));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        "board-1",
        expect.objectContaining({ kind: "plan" }),
      ),
    );

    await userEvent.click(screen.getByTestId("run-filter-time"));
    await userEvent.click(screen.getByTestId("run-filter-time-option-24h"));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        "board-1",
        expect.objectContaining({ from: expect.any(Number) }),
      ),
    );

    await userEvent.click(screen.getByTestId("agent-runs-clear-filters"));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        "board-1",
        expect.not.objectContaining({
          status: expect.anything(),
          kind: expect.anything(),
          from: expect.anything(),
        }),
      ),
    );
  });

  it("shows a total and appends the next page with Load more", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      run({
        id: `run-${index}`,
        createdAt: Date.now() - index * 1000,
        appliedAt: Date.now() - index * 1000,
      }),
    );
    const list = vi
      .spyOn(api, "listRuns")
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        run({ id: "run-old", createdAt: 1, appliedAt: 1 }),
      ]);
    vi.spyOn(api, "getRun").mockResolvedValue(detail());
    vi.spyOn(api, "previewRunRevert").mockResolvedValue(preview());
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([]);
    vi.spyOn(api, "listTokens").mockResolvedValue([]);

    renderPanel();
    const total = await screen.findByTestId("agent-runs-total");
    expect(total).toHaveTextContent("100 runs");
    expect(total).toHaveAttribute("data-has-more", "true");
    await userEvent.click(screen.getByTestId("agent-runs-more"));

    await waitFor(() => expect(total).toHaveTextContent("101 runs"));
    expect(list).toHaveBeenLastCalledWith(
      "board-1",
      expect.objectContaining({ cursor: "run-99" }),
    );
  });

  it("does not leave Load more disabled when a reload races the page request", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      run({
        id: `run-${index}`,
        createdAt: Date.now() - index * 1000,
        appliedAt: Date.now() - index * 1000,
      }),
    );
    let resolvePage: (rows: RunSummaryDto[]) => void = () => undefined;
    const page = new Promise<RunSummaryDto[]>((resolve) => {
      resolvePage = resolve;
    });
    const list = vi
      .spyOn(api, "listRuns")
      .mockImplementation((_board, query) =>
        query?.cursor === undefined ? Promise.resolve(firstPage) : page,
      );
    vi.spyOn(api, "getRun").mockResolvedValue(detail());
    vi.spyOn(api, "previewRunRevert").mockResolvedValue(preview());
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([]);
    vi.spyOn(api, "listTokens").mockResolvedValue([]);

    renderPanel();
    const more = await screen.findByTestId("agent-runs-more");
    await userEvent.click(more);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    act(() => {
      live.agentControl.publishRun({
        type: "run",
        op: "reverted",
        runId: RUN.id,
        revertRunId: "revert-1",
        at: Date.now(),
      });
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));

    resolvePage([]);
    await waitFor(() => expect(more).not.toBeDisabled());
  });

  it("retries a failed detail request", async () => {
    vi.spyOn(api, "listRuns").mockResolvedValue([RUN]);
    vi.spyOn(api, "getRun")
      .mockRejectedValueOnce(new ApiError(500, { message: "down" }))
      .mockResolvedValueOnce(detail());
    vi.spyOn(api, "previewRunRevert").mockResolvedValue(preview());
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([]);
    vi.spyOn(api, "listTokens").mockResolvedValue([]);

    renderPanel();
    expect(await screen.findByTestId("agent-run-detail-error")).toBeVisible();
    await userEvent.click(screen.getByTestId("agent-run-detail-retry"));
    expect(await screen.findByTestId("agent-run-detail")).toBeVisible();
  });

  it("reports a retention-expired run and keeps apply disabled", async () => {
    vi.spyOn(api, "listRuns").mockResolvedValue([RUN]);
    vi.spyOn(api, "getRun").mockResolvedValue(detail());
    vi.spyOn(api, "previewRunRevert").mockRejectedValue(
      new ApiError(409, { code: "run_expired", message: "expired" }),
    );
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([]);
    vi.spyOn(api, "listTokens").mockResolvedValue([]);

    renderPanel();
    expect(await screen.findByTestId("agent-run-expired")).toHaveTextContent(
      "removed by retention",
    );
    expect(screen.queryByTestId("agent-run-revert-apply")).toBeNull();
    expect(screen.getByTestId("agent-run-expired-preview")).toBeVisible();
  });
});
