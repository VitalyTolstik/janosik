import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

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

describe("ArchiveDialog", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
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
});
