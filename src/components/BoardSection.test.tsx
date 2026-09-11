import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { Header } from "@/components/Header";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Render test for the main board: with an empty localStorage the app falls
 * back to the seed board, and the board title, columns and cards are
 * rendered on screen. Also covers the view switcher (board / calendar /
 * table projections of the same data, TASK-14).
 */

function renderBoard(initialRoute = "/") {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <I18nProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[initialRoute]}>
              <BoardProvider>
                <Header />
                <BoardSection />
              </BoardProvider>
            </MemoryRouter>
          </TooltipProvider>
        </I18nProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

/** A board with one due-dated card due "today noon" and one without a due. */
function boardWithDueCard(): string {
  const now = new Date();
  const due = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0,
  );
  return JSON.stringify([
    {
      id: "board-view",
      title: "Views",
      columns: [
        {
          id: "col-1",
          title: "To Do",
          cardIds: ["card-due", "card-plain"],
          createdAt: 1,
        },
        {
          id: "col-2",
          title: "Doing",
          cardIds: [],
          createdAt: 1,
        },
      ],
      cards: {
        "card-due": {
          id: "card-due",
          title: "Dated card",
          labelIds: [],
          dueDate: due.getTime(),
          createdAt: 1,
          updatedAt: 1,
        },
        "card-plain": {
          id: "card-plain",
          title: "Plain card",
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
}

describe("BoardSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the seed board with its columns and cards", () => {
    renderBoard();

    expect(
      screen.getByRole("heading", { name: "Product Launch" }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: "Backlog" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "In Progress" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();

    expect(
      screen.getByText("Design the new onboarding flow"),
    ).toBeInTheDocument();
    expect(screen.getByText("Set up CI/CD pipeline")).toBeInTheDocument();
    expect(
      screen.getByText("Write unit tests for the reducer"),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no columns", () => {
    const emptyBoard =
      '[{"id":"empty","title":"Empty","columns":[],"cards":{},"labels":[],"createdAt":1,"updatedAt":1}]';
    localStorage.setItem("janosik-boards", emptyBoard);

    renderBoard();

    expect(screen.getByText("Empty")).toBeInTheDocument();
  });

  it("renames the board from the header title (click → Enter)", () => {
    renderBoard();

    // The header title is clickable; click it to start editing.
    const title = screen.getByRole("heading", { name: "Product Launch" });
    fireEvent.click(title);
    const input = screen.getByRole("textbox", { name: "Board title" });
    expect(input).toHaveValue("Product Launch");

    fireEvent.change(input, { target: { value: "Launch 2.0" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Editing ends and the new name shows in the header; no duplicate title
    // exists anywhere else on the page.
    expect(
      screen.getByRole("heading", { name: "Launch 2.0" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Launch 2.0")).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Board title" })).toBeNull();
  });

  it("cancels the rename with Escape", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("heading", { name: "Product Launch" }));
    const input = screen.getByRole("textbox", { name: "Board title" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      screen.getByRole("heading", { name: "Product Launch" }),
    ).toBeInTheDocument();
  });

  it("shows the board name exactly once (header only, not in content)", () => {
    renderBoard();
    expect(screen.getAllByText("Product Launch")).toHaveLength(1);
  });

  it("renders the board view by default and can switch to the calendar", () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    // Default view: the kanban strip with column headings.
    expect(
      screen.getByRole("heading", { name: "To Do" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));

    // The kanban strip is gone; the month grid shows the dated card chip
    // and the footer counts the card without a due date.
    expect(screen.queryByRole("heading", { name: "To Do" })).toBeNull();
    expect(screen.getByText("Dated card")).toBeInTheDocument();
    expect(
      screen.getByText("1 card without a due date"),
    ).toBeInTheDocument();

    // And back to the board.
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByRole("heading", { name: "To Do" })).toBeInTheDocument();
  });

  it("opens the card dialog from a calendar chip", () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    fireEvent.click(screen.getByText("Dated card"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Dated card")).toBeInTheDocument();
  });

  it("shows the table view with column, due badge and labels", () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Table" }));

    const table = screen.getByRole("table");
    expect(within(table).getByText("Dated card")).toBeInTheDocument();
    expect(within(table).getByText("Plain card")).toBeInTheDocument();
    // The column chip appears once per row.
    expect(within(table).getAllByText("To Do")).toHaveLength(2);
    // The due badge is rendered for the dated card only.
    expect(within(table).getByTestId("card-due-badge")).toBeInTheDocument();
  });

  it("opens the card dialog from a deep link and from a table row", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard("/board/board-view?card=card-plain");

    // The deep link opens the dialog directly, in the default board view.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Plain card")).toBeInTheDocument();

    // While a modal dialog is open the rest of the page is aria-hidden —
    // close it first (Escape), then switch to the table view.
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    fireEvent.click(within(screen.getByRole("table")).getByText("Plain card"));

    // The row click opens the same dialog from the table projection.
    expect(
      within(screen.getByRole("dialog")).getByText("Plain card"),
    ).toBeInTheDocument();
  });
});
