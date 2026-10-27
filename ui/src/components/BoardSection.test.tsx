import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { Header } from "@/components/Header";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Render test for the main board: with an empty localStorage the app falls
 * back to the seed board, and the board title, columns and cards are
 * rendered on screen. Also covers the view switcher (board / calendar /
 * table projections of the same data, TASK-14).
 */

/** Exposes the current URL query and a Back button to the test. */
function RouteProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="route-probe">{location.search}</span>
      <button data-testid="route-back" onClick={() => navigate(-1)}>
        back
      </button>
    </>
  );
}

function renderBoard(initialRoute = "/") {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <ToastProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={[initialRoute]}>
                  <BoardProvider>
                    <Header />
                    <BoardSection />
                    <RouteProbe />
                  </BoardProvider>
                </MemoryRouter>
              </TooltipProvider>
            </ToastProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

// The calendar/table views are lazy chunks (TASK-34): the first switch
// resolves an import, so the view must be awaited before its assertions.
// The generous timeout absorbs full-suite load (chunk import under a busy
// worker can exceed the 1 s default).
async function openCalendarView() {
  fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
  await screen.findAllByTestId("calendar-day", {}, { timeout: 15_000 });
}

async function openTableView() {
  fireEvent.click(screen.getByRole("button", { name: "Table" }));
  await screen.findByRole("table", {}, { timeout: 15_000 });
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

  // The header reads undo availability from its own narrow context slice
  // (TASK-21.4) instead of the board state — this is that wiring, end to end.
  it("arms the header undo button with the first edit", () => {
    renderBoard();
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();

    fireEvent.click(screen.getByRole("heading", { name: "Product Launch" }));
    const input = screen.getByRole("textbox", { name: "Board title" });
    fireEvent.change(input, { target: { value: "Launch 2.0" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(undo).toBeEnabled();

    fireEvent.click(undo);
    expect(
      screen.getByRole("heading", { name: "Product Launch" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
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

  it("renders the board view by default and can switch to the calendar", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    // Default view: the kanban strip with column headings.
    expect(screen.getByRole("heading", { name: "To Do" })).toBeInTheDocument();

    await openCalendarView();

    // The kanban strip is gone; the month grid shows the dated card chip
    // and the unscheduled side panel holds the card without a due date.
    expect(screen.queryByRole("heading", { name: "To Do" })).toBeNull();
    expect(screen.getByText("Dated card")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("unscheduled-list")).getByText("Plain card"),
    ).toBeInTheDocument();

    // And back to the board.
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByRole("heading", { name: "To Do" })).toBeInTheDocument();
  });

  it("opens the card dialog from a calendar chip", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    await openCalendarView();
    fireEvent.click(screen.getByText("Dated card"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Dated card")).toBeInTheDocument();
  });

  it("shows the table view with column, due badge and labels", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    await openTableView();

    const table = screen.getByRole("table");
    expect(within(table).getByText("Dated card")).toBeInTheDocument();
    expect(within(table).getByText("Plain card")).toBeInTheDocument();
    // The column chip appears once per row.
    expect(within(table).getAllByText("To Do")).toHaveLength(2);
    // The due badge is rendered for the dated card only.
    expect(within(table).getByTestId("card-due-badge")).toBeInTheDocument();
  });

  it("disables the WIP-full column in the table row's move menu", async () => {
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        {
          id: "board-view",
          title: "Views",
          columns: [
            {
              id: "col-1",
              title: "To Do",
              cardIds: ["card-plain"],
              createdAt: 1,
            },
            {
              id: "col-2",
              title: "Doing",
              cardIds: ["card-occupant"],
              wipLimit: 1,
              createdAt: 1,
            },
          ],
          cards: {
            "card-plain": {
              id: "card-plain",
              title: "Plain card",
              labelIds: [],
              createdAt: 1,
              updatedAt: 1,
            },
            "card-occupant": {
              id: "card-occupant",
              title: "Occupant",
              labelIds: [],
              createdAt: 1,
              updatedAt: 1,
            },
          },
          labels: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    renderBoard();

    await openTableView();

    // The move menu of the "Plain card" row: "Doing" is over its WIP limit.
    const row = screen.getByText("Plain card").closest("tr") as HTMLElement;
    // Radix DropdownMenu opens on pointerdown, not click.
    fireEvent.pointerDown(within(row).getByTestId("table-column-cell"));

    // Radix menu items signal via aria-disabled, not the disabled attribute.
    const full = await screen.findByRole("menuitem", { name: /Doing/ });
    expect(full).toHaveAttribute("aria-disabled", "true");
    expect(full).toHaveTextContent("1/1");
    // The card's own column stays disabled as before (✓ mark, no counter).
    const own = screen.getByRole("menuitem", { name: /To Do/ });
    expect(own).toHaveAttribute("aria-disabled", "true");
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

    await openTableView();
    fireEvent.click(within(screen.getByRole("table")).getByText("Plain card"));

    // The row click opens the same dialog from the table projection.
    expect(
      within(screen.getByRole("dialog")).getByText("Plain card"),
    ).toBeInTheDocument();
  });

  it("mirrors the open card into ?card= and Back closes the dialog", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard("/board/board-view");

    // A plain click opens the dialog and writes the shareable link into
    // the address bar (the same behaviour as the search/archive paths).
    fireEvent.click(await screen.findByText("Plain card"));
    expect(
      within(screen.getByRole("dialog")).getByText("Plain card"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("route-probe")).toHaveTextContent(
      "card=card-plain",
    );

    // A history Back (the browser's) closes the dialog and drops the param.
    fireEvent.click(screen.getByTestId("route-back"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("route-probe")).toHaveTextContent("");
  });

  it("drops a dead ?card= param and reports the missing card", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard("/board/board-view?card=does-not-exist");

    // No dialog opens for a card that is not on the board…
    expect(screen.queryByRole("dialog")).toBeNull();
    // …the dead param is stripped from the URL (replace, not push)…
    await waitFor(() =>
      expect(screen.getByTestId("route-probe")).toHaveTextContent(""),
    );
    // …and the user is told why nothing happened.
    expect(await screen.findByText("Card not found")).toBeInTheDocument();
  });

  // Regression: a server commit landing right after a deliberate close
  // (e.g. the "Duplicate card" click) must not flash the dialog back open
  // while the ?card= cleanup is still settling.
  it("keeps the dialog closed when a board update lands around the close", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard("/board/board-view?card=card-plain");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Plain card")).toBeInTheDocument();

    // Close, then immediately touch the board state (a rename) — the same
    // interleaving a live command commit produces.
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByRole("heading", { name: "Views" }));
    const input = screen.getByRole("textbox", { name: "Board title" });
    fireEvent.change(input, { target: { value: "Views 2.0" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The dialog stays closed and the deep-link param is gone.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("route-probe")).toHaveTextContent("");
    expect(
      screen.getByRole("heading", { name: "Views 2.0" }),
    ).toBeInTheDocument();

    // A fresh deep link still opens the dialog after all that.
    fireEvent.click(screen.getByText("Plain card"));
    expect(
      within(screen.getByRole("dialog")).getByText("Plain card"),
    ).toBeInTheDocument();
  });
});

/** Today's local calendar-day key, as CalendarView builds it. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

describe("CalendarView interactivity (TASK-14.1)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("switches to the week scale and remembers the choice", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    await openCalendarView();
    expect(screen.getAllByTestId("calendar-day")).toHaveLength(42);

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getAllByTestId("calendar-day")).toHaveLength(7);
    expect(localStorage.getItem("janosik-calendar-scale")).toBe("week");
  });

  it("centers Today on the current week in week mode (B-4)", async () => {
    // A mid-month date makes the first-week-of-month regression detectable.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 16, 12, 0, 0));
    try {
      localStorage.setItem("janosik-boards", boardWithDueCard());
      renderBoard();
      await openCalendarView();

      fireEvent.click(screen.getByRole("button", { name: "Week" }));
      fireEvent.click(screen.getByRole("button", { name: "Today" }));

      // The current week is on screen, not the week of the 1st of the month.
      expect(
        document.querySelector(`[data-date="${todayKey()}"]`),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("plans an unscheduled card by dragging it onto a day", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    await openCalendarView();
    const panel = screen.getByTestId("unscheduled-list");
    const item = within(panel).getByText("Plain card");
    fireEvent.dragStart(item, {
      dataTransfer: { setData: () => {}, effectAllowed: "move" },
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const key = `${tomorrow.getFullYear()}-${tomorrow.getMonth()}-${tomorrow.getDate()}`;
    const day = document.querySelector(`[data-date="${key}"]`);
    expect(day).not.toBeNull();
    fireEvent.drop(day as Element, {
      dataTransfer: { getData: () => "card-plain" },
    });

    // The card left the unscheduled panel and landed on the target day.
    expect(
      within(screen.getByTestId("unscheduled-list")).queryByText("Plain card"),
    ).toBeNull();
    expect(
      within(day as HTMLElement).getByText("Plain card"),
    ).toBeInTheDocument();
  });

  it("opens the day panel with the full list and opens a card from it", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    await openCalendarView();
    const today = document.querySelector(`[data-date="${todayKey()}"]`);
    expect(today).not.toBeNull();
    fireEvent.click(today as Element);

    const panel = screen.getByTestId("day-panel");
    expect(within(panel).getByText("Dated card")).toBeInTheDocument();

    // Clicking the card in the day panel opens the card dialog (the panel
    // itself is aria-hidden under the modal dialog).
    fireEvent.click(within(panel).getByText("Dated card"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Dated card")).toBeInTheDocument();
  });

  it("quick-adds a card from the unscheduled panel", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    await openCalendarView();

    // The dashed "+" row expands into an input.
    fireEvent.click(screen.getByTestId("unscheduled-add"));
    const input = screen.getByTestId("unscheduled-add-input");
    fireEvent.change(input, { target: { value: "Fresh idea" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The new card appears in the panel (no due date — it was created
    // without one) and Escape reverts the composer to the "+" row.
    expect(
      within(screen.getByTestId("unscheduled-list")).getByText("Fresh idea"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("unscheduled-add-input")).toBeNull();
    expect(screen.getByTestId("unscheduled-add")).toBeInTheDocument();
  });

  it("creates a card from the day panel composer, due that day", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    await openCalendarView();
    fireEvent.click(
      document.querySelector(`[data-date="${todayKey()}"]`) as Element,
    );

    const input = screen.getByTestId("day-composer-input");
    fireEvent.change(input, { target: { value: "Brand new" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The card dialog opens for the freshly created card.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Brand new")).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    // The new card now sits on the target day, no longer unscheduled.
    const today = document.querySelector(`[data-date="${todayKey()}"]`);
    expect(
      within(today as HTMLElement).getByText("Brand new"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("unscheduled-list")).queryByText("Brand new"),
    ).toBeNull();
  });

  it("cancels the day panel composer draft", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    await openCalendarView();
    fireEvent.click(
      document.querySelector(`[data-date="${todayKey()}"]`) as Element,
    );

    const input = screen.getByTestId("day-composer-input");
    fireEvent.change(input, { target: { value: "Never added" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(input).toHaveValue("");
    // Nothing was created — the day cell has no "Never added" chip.
    const today = document.querySelector(`[data-date="${todayKey()}"]`);
    expect(within(today as HTMLElement).queryByText("Never added")).toBeNull();
  });

  it("creates the day-panel card in the chosen column", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    await openCalendarView();
    fireEvent.click(
      document.querySelector(`[data-date="${todayKey()}"]`) as Element,
    );

    // Radix DropdownMenu opens on pointerdown — pick "Doing" (the second
    // column) instead of the default first one.
    fireEvent.pointerDown(screen.getByTestId("day-composer-column"), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Doing" }));

    const input = screen.getByTestId("day-composer-input");
    fireEvent.change(input, { target: { value: "Chosen" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Close the auto-opened dialog for the fresh card.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Board" }));

    const doing = screen
      .getByRole("heading", { name: "Doing" })
      .closest("section") as HTMLElement;
    const todo = screen
      .getByRole("heading", { name: "To Do" })
      .closest("section") as HTMLElement;
    expect(within(doing).getByText("Chosen")).toBeInTheDocument();
    expect(within(todo).queryByText("Chosen")).toBeNull();
  });

  it("attaches labels from the day panel composer", async () => {
    localStorage.setItem("janosik-boards", boardWithLabels());
    renderBoard();

    await openCalendarView();
    fireEvent.click(
      document.querySelector(`[data-date="${todayKey()}"]`) as Element,
    );

    // Pick a label before committing — it must land on the new card.
    const design = within(screen.getByTestId("day-panel")).getByRole("button", {
      name: "Design",
    });
    fireEvent.click(design);
    expect(design).toHaveAttribute("aria-pressed", "true");

    const input = screen.getByTestId("day-composer-input");
    fireEvent.change(input, { target: { value: "Labeled" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Close the auto-opened dialog for the fresh card.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    // The chip on today's cell carries the label (stripe + tooltip).
    const chip = within(
      document.querySelector(`[data-date="${todayKey()}"]`) as HTMLElement,
    )
      .getByText("Labeled")
      .closest("button") as HTMLElement;
    expect(chip.title).toContain("Design");
  });
});

/** The due-card board, plus two board labels offered to the composers. */
function boardWithLabels(): string {
  const board = JSON.parse(boardWithDueCard()) as Record<string, unknown>[];
  (board[0] as { labels: unknown }).labels = [
    { id: "l-design", name: "Design", color: "indigo" },
    { id: "l-urgent", name: "Urgent", color: "red" },
  ];
  return JSON.stringify(board);
}

/** A board with three cards in one column, stored in a non-alphabetical order. */
function boardWithThreeCards(): string {
  return JSON.stringify([
    {
      id: "board-sort",
      title: "Sorting",
      columns: [
        {
          id: "col-1",
          title: "To Do",
          cardIds: ["card-b", "card-a", "card-c"],
          createdAt: 1,
        },
      ],
      cards: {
        "card-a": {
          id: "card-a",
          title: "Alpha task",
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
        "card-b": {
          id: "card-b",
          title: "Beta task",
          labelIds: [],
          createdAt: 2,
          updatedAt: 2,
        },
        "card-c": {
          id: "card-c",
          title: "Gamma task",
          labelIds: [],
          createdAt: 3,
          updatedAt: 3,
        },
      },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
}

describe("TableView interactivity (TASK-14.1)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function openTable() {
    localStorage.setItem("janosik-boards", boardWithThreeCards());
    renderBoard();
    return openTableView().then(() => within(screen.getByRole("table")));
  }

  const rowTitles = (table: ReturnType<typeof within>): string[] =>
    table
      .getAllByTestId("table-row")
      .map((row: HTMLElement) => row.querySelector("td")?.textContent ?? "");

  it("sorts by a header (asc → desc → reset to the board order)", async () => {
    const table = await openTable();
    expect(rowTitles(table)).toEqual(["Beta task", "Alpha task", "Gamma task"]);

    fireEvent.click(screen.getByTestId("table-sort-title"));
    expect(rowTitles(table)).toEqual(["Alpha task", "Beta task", "Gamma task"]);

    fireEvent.click(screen.getByTestId("table-sort-title"));
    expect(rowTitles(table)).toEqual(["Gamma task", "Beta task", "Alpha task"]);

    // The third click resets to the stored board order.
    fireEvent.click(screen.getByTestId("table-sort-title"));
    expect(rowTitles(table)).toEqual(["Beta task", "Alpha task", "Gamma task"]);
  });

  it("renames a card inline (Enter saves, Escape reverts)", async () => {
    const table = await openTable();

    // Inline rename lives on the title double-click (the hover icon is
    // the archive button).
    fireEvent.doubleClick(
      within(table.getAllByTestId("table-row")[0]).getByText("Beta task"),
    );
    const input = screen.getByTestId("table-title-input");
    expect(input).toHaveValue("Beta task");
    fireEvent.change(input, { target: { value: "Renamed row" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(table.getByText("Renamed row")).toBeInTheDocument();

    // Escape reverts the draft.
    fireEvent.doubleClick(
      within(table.getAllByTestId("table-row")[0]).getByText("Renamed row"),
    );
    const input2 = screen.getByTestId("table-title-input");
    fireEvent.change(input2, { target: { value: "Never saved" } });
    fireEvent.keyDown(input2, { key: "Escape" });
    expect(screen.queryByTestId("table-title-input")).toBeNull();
    expect(table.getByText("Renamed row")).toBeInTheDocument();
  });

  it("moves a card to another column from the column cell", async () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();
    await openTableView();
    const table = within(screen.getByRole("table"));

    // Radix DropdownMenu opens on pointerdown (not click).
    fireEvent.pointerDown(
      within(table.getAllByTestId("table-row")[0]).getByTestId(
        "table-column-cell",
      ),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Doing" }));

    // Rows stay grouped by column: the moved card is now in the second
    // group and its chip reads "Doing".
    const movedRow = table
      .getAllByTestId("table-row")
      .find((row) => row.textContent?.includes("Dated card"));
    expect(movedRow).toBeDefined();
    expect(
      within(movedRow as HTMLElement).getByText("Doing"),
    ).toBeInTheDocument();
  });

  it("adds a card from the table composer with a picked label", async () => {
    localStorage.setItem("janosik-boards", boardWithLabels());
    renderBoard();
    await openTableView();

    fireEvent.click(screen.getByTestId("table-add-card"));
    // The popover composer offers the board labels as chips.
    const design = within(
      screen.getByTestId("table-composer-labels"),
    ).getByRole("button", { name: "Design" });
    fireEvent.click(design);
    expect(design).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByTestId("table-composer-input"), {
      target: { value: "Labeled row" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));

    // The new row's labels cell carries the picked label.
    const row = within(screen.getByRole("table"))
      .getAllByTestId("table-row")
      .find((r) => r.textContent?.includes("Labeled row"));
    expect(row).toBeDefined();
    expect(within(row as HTMLElement).getByText("Design")).toBeInTheDocument();
  });

  it("cancels the table composer popover", async () => {
    localStorage.setItem("janosik-boards", boardWithLabels());
    renderBoard();
    await openTableView();

    fireEvent.click(screen.getByTestId("table-add-card"));
    expect(screen.getByTestId("table-composer-input")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("table-composer-input")).toBeNull();
  });

  it("shows optional columns from the settings menu and persists them", async () => {
    await openTable();

    fireEvent.pointerDown(screen.getByTestId("table-columns-settings"), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Created" }),
    );
    // The modal menu keeps the rest aria-hidden — close it first.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(
      within(screen.getByRole("table")).getByText("Created"),
    ).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("janosik-table-columns") ?? "[]"),
    ).toContain("createdAt");
  });

  it("adds a card from the table composer", async () => {
    const table = await openTable();

    fireEvent.click(screen.getByTestId("table-add-card"));
    fireEvent.change(screen.getByTestId("table-composer-input"), {
      target: { value: "Composed row" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));

    expect(await table.findByText("Composed row")).toBeInTheDocument();
  });

  it("adds a card between cards via the inline hover zone", () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    // The zone between "Dated card" and "Plain card" (gap 1) opens an
    // in-place composer.
    fireEvent.click(screen.getByTestId("card-insert-1"));
    const textarea = screen.getByPlaceholderText(
      "Enter a title for this card…",
    );
    fireEvent.change(textarea, { target: { value: "Inserted" } });
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));

    // The card lands at gap 1: after "Dated card", before "Plain card".
    const todo = screen
      .getByRole("heading", { name: "To Do" })
      .closest("section") as HTMLElement;
    const inserted = within(todo).getByText("Inserted");
    const plain = within(todo).getByText("Plain card");
    expect(
      inserted.compareDocumentPosition(plain) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Rapid entry: the composer re-mounts at its new gap position after the
    // first commit (autoFocus restores the caret) — the next commit goes
    // right after "Inserted".
    const textarea2 = screen.getByPlaceholderText(
      "Enter a title for this card…",
    );
    fireEvent.change(textarea2, { target: { value: "Second" } });
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    const second = within(todo).getByText("Second");
    expect(
      inserted.compareDocumentPosition(second) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("closes the inline composer on Escape and restores the zone", () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    fireEvent.click(screen.getByTestId("card-insert-1"));
    const textarea = screen.getByPlaceholderText(
      "Enter a title for this card…",
    );
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(
      screen.queryByPlaceholderText("Enter a title for this card…"),
    ).toBeNull();
    expect(screen.getByTestId("card-insert-1")).toBeInTheDocument();
  });

  it("adds the first card to an empty column via its hover zone", () => {
    localStorage.setItem("janosik-boards", boardWithDueCard());
    renderBoard();

    // Empty "Doing" column: the zone sits under the empty state.
    const doing = screen
      .getByRole("heading", { name: "Doing" })
      .closest("section") as HTMLElement;
    fireEvent.click(within(doing).getByTestId("card-insert-0"));
    const textarea = within(doing).getByPlaceholderText(
      "Enter a title for this card…",
    );
    fireEvent.change(textarea, { target: { value: "Firstborn" } });
    fireEvent.click(within(doing).getByRole("button", { name: "Add card" }));

    expect(within(doing).getByText("Firstborn")).toBeInTheDocument();
  });

  it("hides the inline hover zones when the column is at its WIP limit", () => {
    const limited = JSON.stringify([
      {
        id: "board-wip",
        title: "WIP",
        columns: [
          {
            id: "col-1",
            title: "To Do",
            cardIds: ["card-1"],
            wipLimit: 1,
            createdAt: 1,
          },
        ],
        cards: {
          "card-1": {
            id: "card-1",
            title: "Only card",
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
    localStorage.setItem("janosik-boards", limited);
    renderBoard();

    expect(screen.queryByTestId("card-insert-zone-0")).toBeNull();
    expect(screen.queryByTestId("card-insert-zone-1")).toBeNull();
  });
});
