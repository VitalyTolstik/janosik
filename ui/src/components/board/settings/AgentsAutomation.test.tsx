import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BOARD_AGENT_POLICY,
  type Board,
  type BoardAgentPolicy,
  type BoardAgentPolicyStateDto,
  type BoardRole,
} from "@janosik/shared";

import { api, ApiError } from "@/api/client";
import { AgentsAutomation } from "@/components/board/settings/AgentsAutomation";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/i18n";

const mocks = vi.hoisted(() => ({
  role: "ADMIN" as BoardRole,
}));

const BOARD: Board = {
  id: "board-1",
  title: "Launch board",
  columns: [],
  cards: {},
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

vi.mock("@/store/BoardContext", () => ({
  useBoardState: () => ({ board: BOARD }),
}));

function policy(overrides: Partial<BoardAgentPolicy> = {}): BoardAgentPolicy {
  return {
    ...DEFAULT_BOARD_AGENT_POLICY,
    requireApprovalFor: [...DEFAULT_BOARD_AGENT_POLICY.requireApprovalFor],
    ...overrides,
  };
}

function state(
  overrides: Partial<BoardAgentPolicyStateDto> = {},
): BoardAgentPolicyStateDto {
  const stored = overrides.policy ?? null;
  return {
    policy: stored,
    effective: stored === null ? policy() : { ...stored },
    version: 1,
    paused: false,
    pausedAt: null,
    pausedBy: null,
    pauseReason: null,
    ...overrides,
  };
}

function versionConflict(version: number): ApiError {
  return new ApiError(409, {
    code: "version_conflict",
    message: "stale",
    currentVersion: version,
    details: { currentVersion: version },
  });
}

function renderPanel(
  props: {
    onDirtyChange?: (dirty: boolean) => void;
  } = {},
) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <AgentsAutomation role={mocks.role} {...props} />
      </ToastProvider>
    </I18nProvider>,
  );
}

async function changeNumber(testId: string, value: string) {
  const input = screen.getByTestId(testId);
  await userEvent.clear(input);
  if (value !== "") await userEvent.type(input, value);
}

describe("AgentsAutomation (TASK-179.7)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    vi.restoreAllMocks();
    mocks.role = "ADMIN";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("loads the policy, edits fields and saves with the CAS version", async () => {
    const initial = state();
    const savedPolicy = policy({
      destructive: "deny",
      maxCommandsPerRun: 10,
      requireApprovalFor: ["move_to_done"],
    });
    const saved = state({
      policy: savedPolicy,
      effective: savedPolicy,
      version: 2,
    });
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(initial);
    const update = vi
      .spyOn(api, "updateBoardAgentPolicy")
      .mockResolvedValue(saved);

    renderPanel();
    await screen.findByTestId("agent-policy-panel");

    expect(screen.getByTestId("agent-policy-version")).toHaveTextContent(
      "Version 1",
    );
    expect(
      screen.getByTestId("agent-policy-effective-limits"),
    ).toHaveTextContent("100");
    expect(screen.getByTestId("agent-policy-reset")).toBeDisabled();

    await userEvent.click(
      screen.getByTestId("agent-policy-destructive-option-deny"),
    );
    await changeNumber("agent-policy-max-commands", "10");
    await userEvent.click(
      screen.getByTestId("agent-policy-require-move_to_done"),
    );
    expect(screen.getByTestId("agents-automation-dirty")).toHaveTextContent(
      "Unsaved changes",
    );

    await userEvent.click(screen.getByTestId("agent-policy-save"));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("board-1", {
        version: 1,
        policy: expect.objectContaining({
          schemaVersion: 1,
          destructive: "deny",
          maxCommandsPerRun: 10,
          approverRoles: ["ADMIN"],
        }),
      }),
    );
    const sent = update.mock.calls[0][1].policy;
    expect(sent?.requireApprovalFor).toContain("move_to_done");
    expect(await screen.findByText("Agent policy saved")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("agent-policy-version")).toHaveTextContent(
        "Version 2",
      ),
    );
    expect(screen.getByTestId("agent-policy-reset")).not.toBeDisabled();
  });

  it("disables reset and shows safe defaults when the stored policy is null", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(state());

    renderPanel();
    await screen.findByTestId("agent-policy-panel");

    expect(screen.getByTestId("agent-policy-reset")).toBeDisabled();
    expect(
      screen.getByTestId("agent-policy-effective-limits"),
    ).toHaveTextContent("Using safe defaults");
  });

  it("validates limits inline, reports dirty state and discards local edits", async () => {
    const custom = policy({ maxCommandsPerRun: 80 });
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(
      state({ policy: custom, effective: custom }),
    );
    const onDirtyChange = vi.fn();

    renderPanel({ onDirtyChange });
    await screen.findByTestId("agent-policy-panel");
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(false));

    await changeNumber("agent-policy-max-commands", "");
    expect(
      screen.getByText("Enter a whole number from 1 to 100."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-policy-save")).toBeDisabled();
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));

    await changeNumber("agent-policy-max-commands", "70");
    expect(
      screen.queryByText("Enter a whole number from 1 to 100."),
    ).toBeNull();
    expect(screen.getByTestId("agent-policy-save")).not.toBeDisabled();

    await userEvent.click(screen.getByTestId("agents-automation-discard"));
    expect(screen.getByTestId("agent-policy-max-commands")).toHaveValue("80");
    expect(screen.getByTestId("agent-policy-save")).toBeDisabled();
    expect(screen.getByTestId("agents-automation-dirty")).toHaveTextContent(
      "All changes saved",
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("merges non-conflicting local fields over the newer server policy", async () => {
    const initial = state();
    const serverPolicy = policy({ destructive: "deny" });
    const latest = state({
      policy: serverPolicy,
      effective: serverPolicy,
      version: 2,
    });
    const savedPolicy = policy({ destructive: "deny", approvalTtlMinutes: 90 });
    const saved = state({
      policy: savedPolicy,
      effective: savedPolicy,
      version: 3,
    });
    const get = vi
      .spyOn(api, "getBoardAgentPolicy")
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(latest);
    const update = vi
      .spyOn(api, "updateBoardAgentPolicy")
      .mockRejectedValueOnce(versionConflict(2))
      .mockResolvedValueOnce(saved);

    renderPanel();
    await screen.findByTestId("agent-policy-panel");
    await changeNumber("agent-policy-ttl", "90");
    await userEvent.click(screen.getByTestId("agent-policy-save"));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[0][1].version).toBe(1);
    expect(update.mock.calls[1][1]).toMatchObject({
      version: 2,
      policy: expect.objectContaining({
        destructive: "deny",
        approvalTtlMinutes: 90,
      }),
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("agents-automation-cas-banner")).toBeNull();
    expect(await screen.findByText("Agent policy saved")).toBeInTheDocument();
    expect(screen.getByTestId("agent-policy-version")).toHaveTextContent(
      "Version 3",
    );
  });

  it("requires an explicit choice when the same field changed on both sides", async () => {
    const initial = state();
    const serverPolicy = policy({ approvalTtlMinutes: 120 });
    const latest = state({
      policy: serverPolicy,
      effective: serverPolicy,
      version: 2,
    });
    const savedPolicy = policy({ approvalTtlMinutes: 90 });
    const saved = state({
      policy: savedPolicy,
      effective: savedPolicy,
      version: 3,
    });
    vi.spyOn(api, "getBoardAgentPolicy")
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(latest);
    const update = vi
      .spyOn(api, "updateBoardAgentPolicy")
      .mockRejectedValueOnce(versionConflict(2))
      .mockResolvedValueOnce(saved);

    renderPanel();
    await screen.findByTestId("agent-policy-panel");
    await changeNumber("agent-policy-ttl", "90");
    await userEvent.click(screen.getByTestId("agent-policy-save"));

    const conflict = await screen.findByTestId(
      "agents-automation-conflict-approvalTtlMinutes",
    );
    expect(conflict).toHaveTextContent("90");
    expect(conflict).toHaveTextContent("120");
    expect(screen.getByTestId("agents-automation-cas-banner")).toBeVisible();
    expect(screen.getByTestId("agent-policy-save")).toBeDisabled();
    expect(update).toHaveBeenCalledTimes(1);

    await userEvent.click(
      screen.getByTestId("agents-automation-conflict-approvalTtlMinutes-mine"),
    );
    expect(
      screen.queryByTestId("agents-automation-conflict-approvalTtlMinutes"),
    ).toBeNull();
    expect(screen.getByTestId("agent-policy-save")).not.toBeDisabled();

    await userEvent.click(screen.getByTestId("agent-policy-save"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toMatchObject({
      version: 2,
      policy: expect.objectContaining({ approvalTtlMinutes: 90 }),
    });
  });

  it("accepts the server value without writing the stale draft", async () => {
    const initial = state();
    const serverPolicy = policy({ approvalTtlMinutes: 120 });
    const latest = state({
      policy: serverPolicy,
      effective: serverPolicy,
      version: 2,
    });
    vi.spyOn(api, "getBoardAgentPolicy")
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(latest);
    const update = vi
      .spyOn(api, "updateBoardAgentPolicy")
      .mockRejectedValueOnce(versionConflict(2));

    renderPanel();
    await screen.findByTestId("agent-policy-panel");
    await changeNumber("agent-policy-ttl", "90");
    await userEvent.click(screen.getByTestId("agent-policy-save"));

    await screen.findByTestId("agents-automation-conflict-approvalTtlMinutes");
    await userEvent.click(
      screen.getByTestId(
        "agents-automation-conflict-approvalTtlMinutes-server",
      ),
    );

    expect(screen.getByTestId("agent-policy-ttl")).toHaveValue("120");
    expect(screen.getByTestId("agent-policy-save")).toBeDisabled();
    expect(screen.getByTestId("agents-automation-dirty")).toHaveTextContent(
      "All changes saved",
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("reloads the latest policy and keeps the draft and its conflict", async () => {
    const initial = state();
    const serverPolicy = policy({ approvalTtlMinutes: 120 });
    const latest = state({
      policy: serverPolicy,
      effective: serverPolicy,
      version: 2,
    });
    vi.spyOn(api, "getBoardAgentPolicy")
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(latest);
    const update = vi
      .spyOn(api, "updateBoardAgentPolicy")
      .mockRejectedValueOnce(versionConflict(2))
      .mockResolvedValueOnce(
        state({
          policy: policy({ approvalTtlMinutes: 90 }),
          effective: policy({ approvalTtlMinutes: 90 }),
          version: 3,
        }),
      );

    renderPanel();
    await screen.findByTestId("agent-policy-panel");
    await changeNumber("agent-policy-ttl", "90");
    await userEvent.click(screen.getByTestId("agent-policy-save"));
    await screen.findByTestId("agents-automation-conflict-approvalTtlMinutes");

    await userEvent.click(screen.getByTestId("agents-automation-reload"));
    await waitFor(() =>
      expect(screen.getByTestId("agent-policy-version")).toHaveTextContent(
        "Version 2",
      ),
    );
    expect(screen.getByTestId("agent-policy-ttl")).toHaveValue("90");
    expect(
      screen.getByTestId("agents-automation-conflict-approvalTtlMinutes"),
    ).toBeVisible();

    await userEvent.click(
      screen.getByTestId("agents-automation-conflict-approvalTtlMinutes-mine"),
    );
    await userEvent.click(screen.getByTestId("agent-policy-save"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toMatchObject({
      version: 2,
      policy: expect.objectContaining({ approvalTtlMinutes: 90 }),
    });
  });

  it("asks for a second confirmation when reset conflicts with a newer policy", async () => {
    const custom = policy({ approvalTtlMinutes: 90 });
    const initial = state({ policy: custom, effective: custom, version: 1 });
    const newer = policy({ approvalTtlMinutes: 120 });
    const latest = state({ policy: newer, effective: newer, version: 2 });
    vi.spyOn(api, "getBoardAgentPolicy")
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(latest);
    const update = vi
      .spyOn(api, "updateBoardAgentPolicy")
      .mockRejectedValueOnce(versionConflict(2))
      .mockResolvedValueOnce(state({ version: 3 }));

    renderPanel();
    await screen.findByTestId("agent-policy-panel");
    await userEvent.click(screen.getByTestId("agent-policy-reset"));

    expect(
      await screen.findByText("Reset the agent policy?"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Reset to defaults" }),
    );

    expect(
      await screen.findByText("Policy changed. Reset anyway?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The policy changed in another tab \(now version 2\)/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Reset to defaults" }),
    );

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toEqual({ policy: null, version: 2 });
    expect(
      await screen.findByText("Agent policy reset to defaults"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-policy-reset")).toBeDisabled();
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

  it("is read-only outside a board ADMIN", async () => {
    mocks.role = "MEMBER";
    const get = vi.spyOn(api, "getBoardAgentPolicy");

    renderPanel();

    expect(
      await screen.findByTestId("agent-policy-read-only"),
    ).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("uses the mobile-safe layout and a single scroll region", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(state());

    renderPanel();
    await screen.findByTestId("agent-policy-panel");

    const scroll = screen.getByTestId("agents-automation-scroll");
    expect(scroll.className).toContain("overflow-y-auto");
    expect(scroll.className).toContain("overflow-x-hidden");
    expect(scroll.className).toContain("max-md:px-2.5");
    expect(screen.getByTestId("agent-policy-require-list").className).toContain(
      "sm:grid-cols-2",
    );
    expect(screen.getByTestId("agents-automation-footer").className).toContain(
      "max-md:flex-col",
    );
  });
});
