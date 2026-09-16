import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { TableView } from "@/components/board/TableView";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * TableView sorting: every sortable header cycles asc → desc → board order.
 * The due-date comparator must keep undated cards last in BOTH directions
 * (finding B-2) — the reducer's sortColumn behaves the same way.
 */

function seedBoard() {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "board-sort",
        title: "Sorting",
        columns: [
          {
            id: "col-1",
            title: "To Do",
            // Stored in a deliberately unsorted order.
            cardIds: ["card-b", "card-c", "card-a"],
            createdAt: 1,
          },
        ],
        cards: {
          "card-a": {
            id: "card-a",
            title: "Alpha task",
            labelIds: [],
            dueDate: 100,
            createdAt: 30,
            updatedAt: 30,
          },
          "card-b": {
            id: "card-b",
            title: "Beta task",
            labelIds: [],
            dueDate: 200,
            createdAt: 20,
            updatedAt: 20,
          },
          "card-c": {
            id: "card-c",
            title: "Gamma task",
            labelIds: [],
            createdAt: 10,
            updatedAt: 10,
          },
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

function renderTable() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/board-sort"]}>
                <ToastProvider>
                  <BoardProvider>
                    <TableView onCardClick={() => {}} />
                  </BoardProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

function rowTitles(): string[] {
  return screen
    .getAllByTestId("table-row")
    .map((row) => row.querySelector("td")?.textContent ?? "");
}

/** Click a header once for asc, twice for desc. */
function sortBy(testId: string, dir: 1 | -1) {
  fireEvent.click(screen.getByTestId(testId));
  if (dir === -1) fireEvent.click(screen.getByTestId(testId));
}

describe("TableView sorting", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
  });

  it("starts in the stored board order", () => {
    renderTable();
    expect(rowTitles()).toEqual(["Beta task", "Gamma task", "Alpha task"]);
  });

  it("sorts by title in both directions", () => {
    renderTable();
    fireEvent.click(screen.getByTestId("table-sort-title"));
    expect(rowTitles()).toEqual(["Alpha task", "Beta task", "Gamma task"]);
    fireEvent.click(screen.getByTestId("table-sort-title"));
    expect(rowTitles()).toEqual(["Gamma task", "Beta task", "Alpha task"]);
  });

  it("sorts by due date ascending with undated cards last", () => {
    renderTable();
    sortBy("table-sort-due", 1);
    expect(rowTitles()).toEqual(["Alpha task", "Beta task", "Gamma task"]);
  });

  it("sorts by due date descending with undated cards still last", () => {
    renderTable();
    sortBy("table-sort-due", -1);
    expect(rowTitles()).toEqual(["Beta task", "Alpha task", "Gamma task"]);
  });

  it("sorts by creation date in both directions", () => {
    // The creation date is an optional column — enable its header first.
    localStorage.setItem(
      "janosik-table-columns",
      JSON.stringify(["createdAt"]),
    );
    renderTable();
    fireEvent.click(screen.getByTestId("table-sort-createdAt"));
    expect(rowTitles()).toEqual(["Gamma task", "Beta task", "Alpha task"]);
    fireEvent.click(screen.getByTestId("table-sort-createdAt"));
    expect(rowTitles()).toEqual(["Alpha task", "Beta task", "Gamma task"]);
  });

  it("resets to the board order on the third click", () => {
    renderTable();
    fireEvent.click(screen.getByTestId("table-sort-title"));
    fireEvent.click(screen.getByTestId("table-sort-title"));
    expect(rowTitles()).toEqual(["Gamma task", "Beta task", "Alpha task"]);
    fireEvent.click(screen.getByTestId("table-sort-title"));
    expect(rowTitles()).toEqual(["Beta task", "Gamma task", "Alpha task"]);
  });

  it("renders the due badge only for dated rows", () => {
    renderTable();
    const table = within(screen.getByRole("table"));
    expect(table.getAllByTestId("card-due-badge")).toHaveLength(2);
  });

  it("hides the row hover archive on touch — row menu and dialog cover it", () => {
    renderTable();
    const archiveButtons = screen.getAllByTestId("table-archive-btn");
    expect(archiveButtons.length).toBeGreaterThan(0);
    for (const btn of archiveButtons) {
      expect(btn.className).toContain("no-hover:hidden");
    }
  });
});
