import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSettingsDialog } from "@/components/board/BoardSettingsDialog";
import { I18nProvider } from "@/i18n";
import type { Board } from "@janosik/shared";

const mocks = vi.hoisted(() => ({
  setBoardWorkflow: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  pendingCount: 0,
}));

vi.mock("@/store/BoardContext", () => {
  const board: Board = {
    id: "b-1",
    title: "Board",
    columns: [
      { id: "backlog", title: "Backlog", cardIds: [], createdAt: 1 },
      { id: "doing", title: "Doing", cardIds: [], createdAt: 1 },
    ],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    useBoardState: () => ({ board }),
    useBoardActions: () => ({
      setBoardWorkflow: mocks.setBoardWorkflow,
    }),
    useBoardAccess: () => ({ role: "ADMIN" }),
  };
});

vi.mock("@/components/Toast", () => ({
  useToast: () => ({
    success: mocks.success,
    error: mocks.error,
    info: mocks.info,
  }),
}));

vi.mock("@/components/agents/use-pending-approvals", () => ({
  usePendingApprovals: () => ({
    rows: [],
    counts: { "b-1": mocks.pendingCount },
    loading: false,
    error: false,
    reload: vi.fn(),
  }),
}));

// The policy body is TASK-179.7's surface. The shell contract under test is
// the dirty callback, not the panel internals.
vi.mock("@/components/board/settings/AgentsAutomationSettings", () => ({
  AgentsAutomationSettings: ({
    onDirtyChange,
    onOpenLiveControls,
  }: {
    onDirtyChange?: (dirty: boolean) => void;
    onOpenLiveControls?: () => void;
  }) => (
    <div data-testid="agents-automation-stub">
      <button
        type="button"
        data-testid="agents-make-dirty"
        onClick={() => onDirtyChange?.(true)}
      >
        Edit policy
      </button>
      <button
        type="button"
        data-testid="agents-open-live"
        onClick={() => onOpenLiveControls?.()}
      >
        Open live controls
      </button>
    </div>
  ),
}));

function renderDialog(options: { onOpenLiveControls?: () => void } = {}) {
  const onOpenChange = vi.fn();
  render(
    <I18nProvider>
      <BoardSettingsDialog
        open
        onOpenChange={onOpenChange}
        onOpenLiveControls={options.onOpenLiveControls}
      />
    </I18nProvider>,
  );
  return { onOpenChange };
}

function renderControlledDialog() {
  function Harness() {
    const [open, setOpen] = useState(true);
    return <BoardSettingsDialog open={open} onOpenChange={setOpen} />;
  }
  render(
    <I18nProvider>
      <Harness />
    </I18nProvider>,
  );
}

function openDialog() {
  const result = renderDialog();
  // Make the draft dirty and valid: enable control, then allow Backlog → Doing.
  fireEvent.click(screen.getByTestId("workflow-enabled"));
  fireEvent.click(screen.getByTestId("workflow-allow-doing"));
  return result;
}

function makePolicyDirty() {
  fireEvent.click(screen.getByTestId("board-settings-agents"));
  fireEvent.click(screen.getByTestId("agents-make-dirty"));
}

describe("BoardSettingsDialog workflow save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pendingCount = 0;
    localStorage.clear();
  });

  it("keeps the dialog open and shows the inline save error when the server refuses", async () => {
    mocks.setBoardWorkflow.mockResolvedValueOnce(false);
    const { onOpenChange } = openDialog();

    fireEvent.click(screen.getByTestId("workflow-save"));

    await waitFor(() => expect(mocks.setBoardWorkflow).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("workflow-save")).not.toBeDisabled(),
    );
    expect(screen.getByTestId("workflow-save-error")).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when the transport rejects", async () => {
    mocks.setBoardWorkflow.mockRejectedValueOnce(new Error("offline"));
    const { onOpenChange } = openDialog();

    fireEvent.click(screen.getByTestId("workflow-save"));

    await waitFor(() =>
      expect(screen.getByTestId("workflow-save")).not.toBeDisabled(),
    );
    expect(screen.getByTestId("workflow-save-error")).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("closes and confirms success only after the server acknowledges", async () => {
    mocks.setBoardWorkflow.mockResolvedValueOnce(true);
    const { onOpenChange } = openDialog();

    fireEvent.click(screen.getByTestId("workflow-save"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it("does not close after saving while the policy draft is dirty", async () => {
    mocks.setBoardWorkflow.mockResolvedValueOnce(true);
    const { onOpenChange } = openDialog();
    makePolicyDirty();
    fireEvent.click(screen.getByTestId("board-settings-workflow"));

    fireEvent.click(screen.getByTestId("workflow-save"));

    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("asks before closing a dirty workflow draft", () => {
    const { onOpenChange } = openDialog();

    fireEvent.click(screen.getByTestId("workflow-close"));

    expect(screen.getByText("Discard workflow changes?")).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks before closing a dirty workflow draft with Escape", () => {
    const { onOpenChange } = openDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByText("Discard workflow changes?")).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("asks before closing a dirty policy draft", () => {
    const { onOpenChange } = renderDialog();
    makePolicyDirty();

    fireEvent.click(screen.getByTestId("workflow-close"));

    expect(screen.getByText("Discard unsaved settings?")).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks once when both sections are dirty", () => {
    const { onOpenChange } = openDialog();
    makePolicyDirty();

    fireEvent.click(screen.getByTestId("workflow-close"));

    expect(screen.getByText("Discard unsaved settings?")).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes a clean agents section without a confirmation", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId("board-settings-agents"));

    fireEvent.click(screen.getByTestId("workflow-close"));

    expect(screen.queryByText("Discard unsaved settings?")).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("returns focus to the gear after a clean close", async () => {
    const trigger = document.createElement("button");
    trigger.dataset.testid = "board-settings-trigger";
    document.body.appendChild(trigger);
    try {
      renderControlledDialog();
      fireEvent.click(screen.getByTestId("workflow-close"));
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      trigger.remove();
    }
  });
});

describe("BoardSettingsDialog shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pendingCount = 0;
    localStorage.clear();
  });

  it("switches the top-level rail and keeps both drafts mounted", () => {
    const { onOpenChange } = openDialog();

    fireEvent.click(screen.getByTestId("board-settings-agents"));
    expect(screen.getByTestId("board-settings-agents")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("agents-automation-stub")).toBeVisible();

    fireEvent.click(screen.getByTestId("board-settings-workflow"));
    expect(screen.getByTestId("board-settings-workflow")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("workflow-row-switch-doing")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByTestId("board-settings-agents"));
    expect(screen.getByTestId("agents-automation-stub")).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("supports arrow, Home and End keys on the rail tabs", () => {
    renderDialog();
    const workflowTab = screen.getByTestId("board-settings-workflow");
    workflowTab.focus();

    fireEvent.keyDown(workflowTab, { key: "ArrowDown" });
    expect(screen.getByTestId("board-settings-agents")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("board-settings-agents"),
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(workflowTab).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(workflowTab);

    fireEvent.keyDown(workflowTab, { key: "End" });
    expect(screen.getByTestId("board-settings-agents")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("reflects the combined dirty state in the shell header", () => {
    renderDialog();
    expect(screen.getByTestId("board-settings-save-state")).toHaveTextContent(
      "All changes saved",
    );

    fireEvent.click(screen.getByTestId("workflow-enabled"));
    expect(screen.getByTestId("board-settings-save-state")).toHaveTextContent(
      "Unsaved changes",
    );
  });

  it("shows the combined dirty state in the workflow footer", () => {
    renderDialog();
    makePolicyDirty();
    fireEvent.click(screen.getByTestId("board-settings-workflow"));

    expect(screen.getByTestId("workflow-dirty")).toHaveTextContent(
      "Unsaved changes",
    );
    expect(
      screen.getByText("Unsaved changes are in Agents & automation"),
    ).toBeVisible();
  });

  it("shows the pending approvals badge on the agents rail", () => {
    mocks.pendingCount = 3;
    renderDialog();
    expect(screen.getByTestId("board-settings-agents")).toHaveTextContent("3");
  });

  it("opens Agent Control on Live without touching the board route", () => {
    const onOpenLiveControls = vi.fn();
    const { onOpenChange } = renderDialog({ onOpenLiveControls });

    fireEvent.click(screen.getByTestId("board-settings-agents"));
    fireEvent.click(screen.getByTestId("agents-open-live"));

    expect(onOpenLiveControls).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("guards unsaved settings before opening Agent Control on Live", () => {
    const onOpenLiveControls = vi.fn();
    const { onOpenChange } = renderDialog({ onOpenLiveControls });

    makePolicyDirty();
    fireEvent.click(screen.getByTestId("agents-open-live"));

    expect(onOpenLiveControls).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText("Discard unsaved settings?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onOpenLiveControls).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the mobile frame and a single scroll region", () => {
    renderDialog();

    const dialog = screen.getByTestId("board-settings-dialog");
    expect(dialog.className).toContain("max-md:h-[100dvh]");
    expect(dialog.className).toContain("overflow-hidden");

    const rail = screen.getByTestId("board-settings-rail");
    expect(rail.className).toContain("md:w-[194px]");
    expect(
      screen.getByRole("tablist", { name: "Board settings" }).className,
    ).toContain("overflow-x-auto");

    expect(screen.getByTestId("board-settings-content").className).toContain(
      "overflow-hidden",
    );
    expect(screen.getByTestId("workflow-body").className).toContain(
      "overflow-y-auto",
    );
  });
});
