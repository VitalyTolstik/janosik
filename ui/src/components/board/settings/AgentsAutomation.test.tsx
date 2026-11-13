import { render, screen, waitFor, within } from "@testing-library/react";
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
import { DESTRUCTIVE_POLICY_ACTIONS } from "@/components/board/settings/policy-model";
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
    lastSavedBy: null,
    lastSavedAt: null,
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
    onOpenLiveControls?: () => void;
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
      "Policy v1",
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
        "Policy v2",
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
    ).toHaveTextContent("Safe defaults are active where unset");
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
      "Policy v3",
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

  it("shows the differing trigger labels for an array conflict", async () => {
    const initial = state();
    const serverPolicy = policy({
      requireApprovalFor: DEFAULT_BOARD_AGENT_POLICY.requireApprovalFor.filter(
        (action) => action !== "workflow.update",
      ),
    });
    const latest = state({
      policy: serverPolicy,
      effective: serverPolicy,
      version: 2,
    });
    vi.spyOn(api, "getBoardAgentPolicy")
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(latest);
    vi.spyOn(api, "updateBoardAgentPolicy").mockRejectedValueOnce(
      versionConflict(2),
    );

    renderPanel();
    await screen.findByTestId("agent-policy-panel");
    await userEvent.click(
      screen.getByTestId("agent-policy-require-move_to_done"),
    );
    await userEvent.click(screen.getByTestId("agent-policy-save"));

    const conflict = await screen.findByTestId(
      "agents-automation-conflict-requireApprovalFor",
    );
    expect(conflict).toHaveTextContent("Move a card to Done");
    expect(conflict).toHaveTextContent("Change the board workflow");
    expect(conflict).toHaveTextContent("Invite a member");
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
    const newerPolicy = policy({
      destructive: "deny",
      approvalTtlMinutes: 120,
    });
    const newer = state({
      policy: newerPolicy,
      effective: newerPolicy,
      version: 3,
    });
    const get = vi
      .spyOn(api, "getBoardAgentPolicy")
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(latest)
      .mockResolvedValue(newer);
    const update = vi
      .spyOn(api, "updateBoardAgentPolicy")
      .mockRejectedValueOnce(versionConflict(2))
      .mockResolvedValueOnce(
        state({
          policy: policy({ destructive: "deny", approvalTtlMinutes: 90 }),
          effective: policy({ destructive: "deny", approvalTtlMinutes: 90 }),
          version: 4,
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
        "Policy v3",
      ),
    );
    expect(get).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("agent-policy-ttl")).toHaveValue("90");
    expect(
      screen.getByTestId("agent-policy-destructive-option-deny"),
    ).toBeChecked();
    expect(
      screen.getByTestId("agents-automation-conflict-approvalTtlMinutes"),
    ).toBeVisible();

    await userEvent.click(
      screen.getByTestId("agents-automation-conflict-approvalTtlMinutes-mine"),
    );
    await userEvent.click(screen.getByTestId("agent-policy-save"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toMatchObject({
      version: 3,
      policy: expect.objectContaining({
        destructive: "deny",
        approvalTtlMinutes: 90,
      }),
    });
  });

  it("resets only the draft and saves defaults with the next Save", async () => {
    const custom = policy({ destructive: "deny", approvalTtlMinutes: 90 });
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(
      state({ policy: custom, effective: custom }),
    );
    const update = vi
      .spyOn(api, "updateBoardAgentPolicy")
      .mockResolvedValue(state({ version: 2 }));

    renderPanel();
    await screen.findByTestId("agent-policy-panel");
    await userEvent.click(screen.getByTestId("agent-policy-reset"));
    await userEvent.click(screen.getByRole("button", { name: "Reset policy" }));

    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTestId("agents-automation-dirty")).toHaveTextContent(
      "Unsaved changes",
    );
    expect(
      screen.getByTestId("agent-policy-destructive-option-approval"),
    ).toBeChecked();
    expect(screen.getByTestId("agent-policy-max-commands")).toHaveValue("100");
    expect(screen.getByTestId("agent-policy-save")).not.toBeDisabled();
    expect(
      await screen.findByText("Draft reset to safe defaults. Save to apply."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("agent-policy-save"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toEqual({ policy: null, version: 1 });
  });

  it("uses the prototype reset confirmation copy and impact strip", async () => {
    const custom = policy({ approvalTtlMinutes: 90 });
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(
      state({ policy: custom, effective: custom }),
    );

    renderPanel();
    await screen.findByTestId("agent-policy-panel");
    await userEvent.click(screen.getByTestId("agent-policy-reset"));

    const dialog = await screen.findByTestId("agent-policy-reset-dialog");
    expect(
      within(dialog).getByText("Reset policy to safe defaults?"),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "This replaces the current draft with the default destructive gate, limits and triggers. You still need to save.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByTestId("agent-policy-reset-impact"),
    ).toHaveTextContent(
      "Default: require approval for destructive actions · 100 commands / 50 cards / 60 min.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Reset policy" }),
    ).toBeInTheDocument();
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

  it("opens board Agent Control on Live from the status strip", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(state());
    const onOpenLiveControls = vi.fn();

    renderPanel({ onOpenLiveControls });
    await screen.findByTestId("agent-policy-panel");

    await userEvent.click(screen.getByTestId("agent-policy-open-live"));
    expect(onOpenLiveControls).toHaveBeenCalledTimes(1);
  });

  it("uses the prototype copy for the destructive mode and safe defaults", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(state());

    renderPanel({ onOpenLiveControls: vi.fn() });
    await screen.findByTestId("agent-policy-panel");

    expect(screen.getByText("Block completely")).toBeInTheDocument();
    expect(
      screen.getByText(/There are no individual destructive checkboxes/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-policy-version")).toHaveTextContent(
      "Policy v1",
    );
    expect(screen.getByTestId("agent-policy-open-live")).toHaveTextContent(
      "Open live controls",
    );
    expect(
      screen.getByTestId("agent-policy-effective-limits"),
    ).toHaveTextContent("Safe defaults are active where unset");
  });

  it("shows one neutral covered status for all destructive triggers", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(state());

    renderPanel();
    await screen.findByTestId("agent-policy-panel");

    // The stored policy includes some destructive actions and omits others.
    // The UI must not reflect that split: every destructive row is covered by
    // the mode and has no checkbox of its own.
    const statuses = screen.getAllByTestId(/^agent-policy-covered-status-/);
    expect(statuses).toHaveLength(DESTRUCTIVE_POLICY_ACTIONS.length);
    for (const status of statuses) {
      expect(status).toHaveTextContent("Covered · Require approval");
      expect(status).toHaveAttribute("data-mode", "approval");
    }
    for (const action of DESTRUCTIVE_POLICY_ACTIONS) {
      const row = screen.getByTestId(`agent-policy-require-row-${action}`);
      expect(row).toHaveAttribute("data-covered", "true");
      expect(within(row).queryByRole("checkbox")).toBeNull();
      expect(row.querySelector(".line-through")).toBeNull();
      expect(screen.queryByTestId(`agent-policy-require-${action}`)).toBeNull();
    }

    const editable = screen.getByTestId("agent-policy-require-move_to_done");
    expect(editable).not.toBeChecked();
    expect(editable).not.toBeDisabled();

    const checkedEditable = screen.getByTestId(
      "agent-policy-require-workflow.update",
    );
    expect(checkedEditable).toBeChecked();
    expect(checkedEditable).not.toBeDisabled();

    await userEvent.click(
      screen.getByTestId("agent-policy-destructive-option-deny"),
    );
    for (const status of screen.getAllByTestId(
      /^agent-policy-covered-status-/,
    )) {
      expect(status).toHaveTextContent("Covered · Block completely");
      expect(status).toHaveAttribute("data-mode", "deny");
    }
    expect(
      screen.getByTestId("agent-policy-require-workflow.update"),
    ).toBeChecked();
  });

  it("explains the trigger model and jumps to the destructive mode switch", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(state());

    renderPanel();
    await screen.findByTestId("agent-policy-panel");

    const guide = screen.getByTestId("agent-policy-triggers-guide");
    expect(guide).toHaveTextContent(
      "Destructive actions controls all 15 destructive triggers.",
    );
    expect(guide).toHaveTextContent(
      "The 2 independent triggers below can be toggled individually.",
    );

    await userEvent.click(
      screen.getByTestId("agent-policy-change-destructive"),
    );
    expect(
      screen.getByTestId("agent-policy-destructive-option-approval"),
    ).toHaveFocus();
  });

  it("shows who last saved the policy and when", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(
      state({
        lastSavedBy: "Audit Admin",
        lastSavedAt: Date.now() - 3 * 60_000,
      }),
    );

    renderPanel();
    await screen.findByTestId("agent-policy-panel");

    expect(screen.getByTestId("agents-automation-footer")).toHaveTextContent(
      /Last saved by Audit Admin · 3 minutes ago/,
    );
  });

  it("shows a never-saved footer for untouched safe defaults", async () => {
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(state());

    renderPanel();
    await screen.findByTestId("agent-policy-panel");

    const footer = screen.getByTestId("agents-automation-footer");
    expect(footer).toHaveTextContent("Safe defaults");
    expect(footer).toHaveTextContent("Never saved · safe defaults apply");
  });

  it("does not claim safe defaults when a custom policy has no Activity row", async () => {
    const custom = policy({ approvalTtlMinutes: 90 });
    vi.spyOn(api, "getBoardAgentPolicy").mockResolvedValue(
      state({ policy: custom, effective: custom, version: 2 }),
    );

    renderPanel();
    await screen.findByTestId("agent-policy-panel");

    const footer = screen.getByTestId("agents-automation-footer");
    expect(footer).toHaveTextContent("All changes saved");
    expect(footer).toHaveTextContent("Last save details unavailable");
    expect(footer).not.toHaveTextContent("Never saved");
    expect(footer).not.toHaveTextContent("safe defaults apply");
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
    expect(screen.getByTestId("agent-policy-save").className).toContain(
      "max-md:h-11",
    );
  });
});
