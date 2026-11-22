import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";
import { CardDialog } from "@/components/board/CardDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

vi.mock("@/components/editor/DescriptionEditor", () => {
  return import("react").then(({ forwardRef }) => ({
    DescriptionEditor: forwardRef(function MockedDescriptionEditor(
      _props: Record<string, never>,
      _ref: unknown,
    ) {
      return <div data-testid="description-editor" />;
    }),
  }));
});

const AGENT_BOARD: Board = {
  id: "b-1",
  title: "Agent board",
  columns: [{ id: "col-1", title: "To do", cardIds: ["card-1"], createdAt: 1 }],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Agent-owned card",
      labelIds: [],
      acceptanceCriteria: ["runs"],
      definitionOfDone: ["tests green"],
      claimedBy: "u-agent",
      leaseUntil: Date.now() + 900_000,
      createdAt: 1,
      updatedAt: 1,
    },
  },
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

function tree(children: React.ReactNode) {
  return (
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <ToastProvider>
                <MemoryRouter initialEntries={["/board/b-1"]}>
                  <BoardProvider>{children}</BoardProvider>
                </MemoryRouter>
              </ToastProvider>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}

function renderDialog(readOnly = false) {
  return render(
    tree(
      <CardDialog
        cardId="card-1"
        open
        readOnly={readOnly}
        onOpenChange={() => {}}
      />,
    ),
  );
}

describe("CardDialog task spec and claim (TASK-177.4)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("janosik-boards", JSON.stringify([AGENT_BOARD]));
  });

  it("keeps the dialog and the draft open on Escape inside the spec editor", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "Card details" });
    fireEvent.click(await screen.findByTestId("card-task-spec-edit"));
    const input = screen.getByTestId("card-task-spec-criteria-input");
    fireEvent.change(input, { target: { value: "draft that must survive" } });

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("dialog", { name: "Card details" })).toBe(dialog);
    expect(screen.getByTestId("card-task-spec-form")).toBeInTheDocument();
    expect(input).toHaveValue("draft that must survive");
  });

  it("focuses the surviving Edit control after confirming Clear", async () => {
    renderDialog();
    await screen.findByRole("dialog", { name: "Card details" });
    fireEvent.click(await screen.findByTestId("card-task-spec-clear"));
    const confirm = screen.getByRole("dialog", {
      name: "Clear the task spec?",
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Clear" }));

    await waitFor(() =>
      expect(screen.getByTestId("card-task-spec-edit")).toHaveFocus(),
    );
  });

  it("focuses the task-spec section after confirming Release claim", async () => {
    renderDialog();
    await screen.findByRole("dialog", { name: "Card details" });
    fireEvent.click(await screen.findByTestId("card-claim-release"));
    const confirm = screen.getByRole("dialog", {
      name: "Release this claim?",
    });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Release claim" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("card-task-spec-edit")).toHaveFocus(),
    );
    expect(screen.queryByTestId("card-claim")).toBeNull();
  });

  it("falls back to the spec toggle when releasing while the editor is open", async () => {
    renderDialog();
    await screen.findByRole("dialog", { name: "Card details" });
    fireEvent.click(await screen.findByTestId("card-task-spec-edit"));
    fireEvent.change(screen.getByTestId("card-task-spec-criteria-input"), {
      target: { value: "draft survives release" },
    });

    fireEvent.click(await screen.findByTestId("card-claim-release"));
    const confirm = screen.getByRole("dialog", {
      name: "Release this claim?",
    });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Release claim" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("card-task-spec")).toHaveFocus(),
    );
    expect(screen.getByTestId("card-task-spec-form")).toBeInTheDocument();
    expect(screen.getByTestId("card-task-spec-criteria-input")).toHaveValue(
      "draft survives release",
    );
  });

  it("renders a VIEWER card without edit, clear or release controls", async () => {
    renderDialog(true);
    await screen.findByRole("dialog", { name: "Card details" });

    expect(screen.getByTestId("card-task-spec-acceptance")).toHaveTextContent(
      "runs",
    );
    expect(screen.getByTestId("card-claim")).toBeInTheDocument();
    expect(screen.queryByTestId("card-task-spec-edit")).toBeNull();
    expect(screen.queryByTestId("card-task-spec-clear")).toBeNull();
    expect(screen.queryByTestId("card-claim-release")).toBeNull();
  });
});
