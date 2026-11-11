import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArchiveDialog } from "@/components/board/ArchiveDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/routes";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Card archive dialog (TASK-18.1): lists the board's archived cards with
 * created/archived dates, live search, restore-to-column and an inline
 * delete-forever confirmation.
 */

function seedBoard() {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "b-1",
        title: "Alpha",
        columns: [
          { id: "col-1", title: "To do", cardIds: ["c-active"], createdAt: 1 },
        ],
        cards: {
          "c-active": {
            id: "c-active",
            title: "Active thing",
            labelIds: [],
            createdAt: 1000,
            updatedAt: 1000,
          },
          "c-old": {
            id: "c-old",
            title: "Archived thing",
            labelIds: [],
            createdAt: 2000,
            updatedAt: 3000,
            archivedAt: 3000,
          },
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

function addArchivedCards(count: number, wipLimit?: number) {
  const boards = JSON.parse(localStorage.getItem("janosik-boards")!);
  if (wipLimit !== undefined) boards[0].columns[0].wipLimit = wipLimit;
  for (let i = 0; i < count; i++) {
    const id = `extra-${i}`;
    boards[0].cards[id] = {
      id,
      title: `Extra ${i}`,
      labelIds: [],
      createdAt: 1000,
      updatedAt: 2000 + i,
      archivedAt: 2000 + i,
    };
  }
  localStorage.setItem("janosik-boards", JSON.stringify(boards));
}

function renderArchive() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[routes.board("b-1")]}>
                <BoardProvider>
                  <Routes>
                    <Route
                      path={routes.boardPattern}
                      element={<ArchiveDialog open onOpenChange={() => {}} />}
                    />
                  </Routes>
                </BoardProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

const originalHeight = window.innerHeight;

describe("ArchiveDialog", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 710,
    });
    localStorage.clear();
    seedBoard();
  });

  afterEach(() => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalHeight,
    });
  });

  it("lists archived cards with dates and skips active ones", () => {
    renderArchive();
    const list = screen.getByTestId("archive-list");
    expect(list).toHaveTextContent("Archived thing");
    expect(list).toHaveTextContent("Created");
    expect(list).toHaveTextContent("archived");
    expect(list).not.toHaveTextContent("Active thing");
  });

  it("filters rows by search and shows the empty result", async () => {
    renderArchive();
    await userEvent.type(screen.getByTestId("archive-search"), "zzz");
    expect(screen.getByTestId("archive-list")).toHaveTextContent(
      "Nothing found.",
    );
    fireEvent.change(screen.getByTestId("archive-search"), {
      target: { value: "archived" },
    });
    expect(screen.getByTestId("archive-list")).toHaveTextContent(
      "Archived thing",
    );
  });

  it("restores a card to the picked column", async () => {
    renderArchive();
    await userEvent.click(screen.getByTestId("archive-restore"));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "To do" }),
    );
    await waitFor(() => expect(screen.queryByTestId("archive-row")).toBeNull());
  });

  it("deletes an archived card for good after inline confirm", async () => {
    renderArchive();
    fireEvent.click(screen.getByTestId("archive-delete"));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(screen.queryByTestId("archive-row")).toBeNull());
    expect(screen.getByTestId("archive-list")).toHaveTextContent(
      "The archive is empty.",
    );
  });

  it("paginates and selects matching cards across all pages", async () => {
    addArchivedCards(12);
    renderArchive();
    expect(screen.getAllByTestId("archive-row")).toHaveLength(10);
    expect(screen.getByTestId("archive-pagination")).toHaveTextContent(
      "Page 1 of 2",
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select all matching cards" }),
    );
    expect(screen.getByText("Selected: 13")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByTestId("archive-row")).toHaveLength(3);
    expect(
      screen.getByRole("checkbox", { name: "Select Extra 0" }),
    ).toHaveAttribute("aria-checked", "true");
    await userEvent.type(screen.getByTestId("archive-search"), "Archived");
    expect(
      screen.getByText("12 selected cards do not match the current search."),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Selected: 0")).toBeVisible();
  });

  it("fits more archived cards on a taller screen", async () => {
    addArchivedCards(12);
    renderArchive();
    expect(screen.getAllByTestId("archive-row")).toHaveLength(10);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 1200,
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() =>
      expect(screen.getAllByTestId("archive-row")).toHaveLength(13),
    );
    expect(screen.queryByTestId("archive-pagination")).toBeNull();
  });

  it("restores selected cards into the chosen column", async () => {
    addArchivedCards(2);
    renderArchive();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select all matching cards" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Restore selected" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "To do" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("archive-list")).toHaveTextContent(
        "The archive is empty.",
      ),
    );
  });

  it("does not offer a target without enough room for all selected cards", async () => {
    addArchivedCards(2, 3);
    renderArchive();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select all matching cards" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Restore selected" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: /To do/ }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("requires confirmation before deleting selected cards", async () => {
    addArchivedCards(2);
    renderArchive();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select all matching cards" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Delete selected" }),
    );
    expect(
      screen.getByText("Permanently delete 3 selected cards from the archive?"),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByTestId("archive-row")).toHaveLength(3);
    await userEvent.click(
      screen.getByRole("button", { name: "Delete selected" }),
    );
    const confirmation = screen.getByRole("dialog", {
      name: "Delete selected cards?",
    });
    await userEvent.click(
      within(confirmation).getByRole("button", { name: "Delete selected" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("archive-list")).toHaveTextContent(
        "The archive is empty.",
      ),
    );
  });
});
