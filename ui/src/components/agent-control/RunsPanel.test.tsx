import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Board,
  BoardAction,
  RevertPreviewDto,
  RunDetailDto,
  RunSummaryDto,
} from "@janosik/shared";

import { api } from "@/api/client";
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
  createdAt: Date.UTC(2026, 10, 11, 10, 0, 0),
  appliedAt: Date.UTC(2026, 10, 11, 10, 0, 1),
  revertedAt: null,
};

function detail(preimages: Record<string, unknown> = {}): RunDetailDto {
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
  };
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
        <BoardLiveProvider live={live}>
          <RunsPanel role={mocks.role} />
        </BoardLiveProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

function mockHappyPath(detailValue = detail()) {
  vi.spyOn(api, "listRuns").mockResolvedValue([RUN]);
  vi.spyOn(api, "getRun").mockResolvedValue(detailValue);
  vi.spyOn(api, "previewRunRevert").mockResolvedValue(preview());
}

describe("RunsPanel (TASK-166.15)", () => {
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

  it("lists a run, auto-previews it and applies a confirmed rollback", async () => {
    const preimages = {
      "cmd-1": { schemaVersion: 1, entities: [{ touch: "card:card-1" }] },
    };
    mockHappyPath(detail(preimages));
    const revert = vi
      .spyOn(api, "revertRun")
      .mockResolvedValue(detail(preimages));

    renderPanel();

    const row = await screen.findByTestId(`agent-run-row-${RUN.id}`);
    expect(row).toHaveAttribute("data-status", "applied");
    expect(within(row).getByText("Batch")).toBeInTheDocument();

    const panel = await screen.findByTestId("agent-run-detail");
    expect(within(panel).getByText("DELETE_CARD")).toBeInTheDocument();
    expect(within(panel).getByText("Release notes")).toBeInTheDocument();
    expect(panel).toHaveTextContent(RUN.planHash ?? "");
    expect(
      await screen.findByTestId("agent-run-preimages"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-run-can-revert")).toHaveAttribute(
      "data-can-revert",
      "true",
    );

    await userEvent.click(screen.getByTestId("agent-run-revert-apply"));
    expect(await screen.findByTestId("run-revert-dialog")).toBeInTheDocument();
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
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(2));
  });

  it("shows conflicts and keeps the apply action away from a non-admin", async () => {
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
  });

  it("shows loading, error and empty states, and retries the list", async () => {
    const list = vi
      .spyOn(api, "listRuns")
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([]);

    renderPanel();
    expect(
      await screen.findByText("Could not load the run history"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No agent runs yet")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("refetches the list on a run.reverted SSE frame", async () => {
    mockHappyPath();
    const list = vi.spyOn(api, "listRuns").mockResolvedValue([RUN]);

    renderPanel();
    await screen.findByTestId(`agent-run-row-${RUN.id}`);
    expect(list).toHaveBeenCalledTimes(1);

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
  });
});
