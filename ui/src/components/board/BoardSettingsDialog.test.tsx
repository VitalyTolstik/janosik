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

function openDialog() {
  const onOpenChange = vi.fn();
  render(
    <I18nProvider>
      <BoardSettingsDialog open onOpenChange={onOpenChange} />
    </I18nProvider>,
  );
  // Make the draft dirty and valid: enable control, then allow Backlog → Doing.
  fireEvent.click(screen.getByTestId("workflow-enabled"));
  fireEvent.click(screen.getByTestId("workflow-allow-doing"));
  return { onOpenChange };
}

describe("BoardSettingsDialog workflow save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("asks before closing a dirty draft", () => {
    const { onOpenChange } = openDialog();

    fireEvent.click(screen.getByTestId("workflow-close"));

    expect(screen.getByText("Discard workflow changes?")).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes a clean draft without a confirmation", () => {
    const onOpenChange = vi.fn();
    render(
      <I18nProvider>
        <BoardSettingsDialog open onOpenChange={onOpenChange} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId("workflow-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
