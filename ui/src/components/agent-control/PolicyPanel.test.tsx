import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board, BoardAgentPolicyStateDto } from "@janosik/shared";
import { DEFAULT_BOARD_AGENT_POLICY } from "@janosik/shared";

import { api, ApiError } from "@/api/client";
import { PolicyPanel } from "@/components/agent-control/PolicyPanel";
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
  columns: [],
  cards: {},
  labels: [],
  createdAt: 1,
  updatedAt: 1,
  agentsPausedAt: Date.UTC(2026, 10, 11, 9, 0, 0),
  agentsPauseReason: "Release freeze",
};

vi.mock("@/store/BoardContext", () => ({
  useBoardState: () => ({ board: BOARD }),
  useBoardAccess: () => ({ role: mocks.role }),
}));

function state(
  overrides: Partial<BoardAgentPolicyStateDto> = {},
): BoardAgentPolicyStateDto {
  return {
    policy: null,
    effective: { ...DEFAULT_BOARD_AGENT_POLICY },
    version: 1,
    paused: true,
    pausedAt: Date.UTC(2026, 10, 11, 9, 0, 0),
    pausedBy: "user-1",
    pauseReason: "Release freeze",
    ...overrides,
  };
}

let live: BoardLive;

function renderPanel() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <BoardLiveProvider live={live}>
          <PolicyPanel role={mocks.role} />
        </BoardLiveProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("PolicyPanel (TASK-166.15)", () => {
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

  it("shows defaults, pause state and saves an edited policy with the CAS version", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(state());
    const save = vi.spyOn(api, "updateBoardAgentPolicy").mockResolvedValue(
      state({
        policy: {
          ...DEFAULT_BOARD_AGENT_POLICY,
          destructive: "deny",
          maxCommandsPerRun: 10,
          requireApprovalFor: ["member.invite"],
        },
        effective: {
          ...DEFAULT_BOARD_AGENT_POLICY,
          destructive: "deny",
          maxCommandsPerRun: 10,
          requireApprovalFor: ["member.invite"],
        },
        version: 2,
      }),
    );

    renderPanel();

    expect(await screen.findByTestId("agent-policy-version")).toHaveTextContent(
      "Version 1",
    );
    expect(screen.getByTestId("agent-policy-pause")).toHaveAttribute(
      "data-paused",
      "true",
    );
    expect(
      screen.getByTestId("agent-policy-effective-limits"),
    ).toHaveTextContent("100");

    await userEvent.click(
      screen.getByTestId("agent-policy-destructive-option-deny"),
    );
    const commands = screen.getByTestId("agent-policy-max-commands");
    await userEvent.clear(commands);
    await userEvent.type(commands, "10");
    await userEvent.click(
      screen.getByTestId("agent-policy-require-member.invite"),
    );
    await userEvent.click(screen.getByTestId("agent-policy-save"));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("board-1", {
        version: 1,
        policy: expect.objectContaining({
          schemaVersion: 1,
          destructive: "deny",
          maxCommandsPerRun: 10,
          approverRoles: ["ADMIN"],
        }),
      }),
    );
    const sent = save.mock.calls[0][1].policy;
    expect(sent?.requireApprovalFor).not.toContain("member.invite");
    expect(sent?.requireApprovalFor).toContain("workflow.update");
    expect(await screen.findByText("Agent policy saved")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("agent-policy-version")).toHaveTextContent(
        "Version 2",
      ),
    );
  });

  it("resets the stored policy to defaults through confirmation", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(state());
    const save = vi
      .spyOn(api, "updateBoardAgentPolicy")
      .mockResolvedValue(state({ version: 2 }));

    renderPanel();
    await screen.findByTestId("agent-policy-panel");
    await userEvent.click(screen.getByTestId("agent-policy-reset"));

    const dialog = await screen.findByRole("dialog", {
      name: "Reset the agent policy?",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Reset to defaults" }),
    );

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("board-1", {
        policy: null,
        version: 1,
      }),
    );
    expect(
      await screen.findByText("Agent policy reset to defaults"),
    ).toBeInTheDocument();
  });

  it("explains a CAS conflict with the current version", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(state());
    vi.spyOn(api, "updateBoardAgentPolicy").mockRejectedValue(
      new ApiError(409, {
        code: "version_conflict",
        message: "stale",
        currentVersion: 2,
        details: { currentVersion: 2 },
      }),
    );

    renderPanel();
    await screen.findByTestId("agent-policy-panel");
    await userEvent.click(screen.getByTestId("agent-policy-save"));

    expect(await screen.findByTestId("agent-policy-error")).toHaveTextContent(
      "now version 2",
    );
  });

  it("is read-only outside a board ADMIN", async () => {
    mocks.role = "MEMBER";
    const get = vi.spyOn(api, "getBoardAgentPolicy");

    renderPanel();

    expect(
      await screen.findByTestId("agent-policy-read-only"),
    ).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("shows loading, error and retry states", async () => {
    const get = vi
      .spyOn(api, "getBoardAgentPolicy")
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(state());

    renderPanel();
    expect(
      await screen.findByText("Could not load the agent policy"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByTestId("agent-policy-panel")).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
