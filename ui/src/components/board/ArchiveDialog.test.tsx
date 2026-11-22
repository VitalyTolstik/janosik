import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";
import { api } from "@/api/client";
import { ArchiveDialog } from "@/components/board/ArchiveDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/routes";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { FakeServer } from "@/test/fake-server";
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

function renderArchive(entry = routes.board("b-1"), boardId?: string) {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[entry]}>
                <ToastProvider>
                  <BoardProvider>
                    <Routes>
                      <Route
                        path={routes.boardPattern}
                        element={
                          <ArchiveDialog
                            open
                            onOpenChange={() => {}}
                            boardId={boardId}
                          />
                        }
                      />
                    </Routes>
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

  it("removes an archived card after inline confirm", async () => {
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

  it("restores a bulk selection oldest-first so the column keeps the archived order", async () => {
    addArchivedCards(3);
    renderArchive();
    expect(screen.getByTestId("archive-undo-hint")).toHaveTextContent(
      "one at a time",
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select all matching cards" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Restore selected" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "To do" }),
    );
    expect(
      await screen.findByText(
        "Restored 4 cards. Undo removes them one at a time.",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("archive-list")).toHaveTextContent(
        "The archive is empty.",
      ),
    );
    await waitFor(
      () => {
        const [board] = JSON.parse(
          localStorage.getItem("janosik-boards")!,
        ) as Board[];
        expect(
          board.columns[0].cardIds.map((id) => board.cards[id].title),
        ).toEqual([
          "Active thing",
          "Extra 0",
          "Extra 1",
          "Extra 2",
          "Archived thing",
        ]);
      },
      { timeout: 2_000 },
    );
  });

  it("singularises the bulk restore toast for one card", async () => {
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
    expect(
      await screen.findByText("Restored 1 card. Undo removes it right away."),
    ).toBeInTheDocument();
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

  it("uses a singular bulk-delete title for one card", async () => {
    renderArchive();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select Archived thing" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Delete selected" }),
    );
    expect(
      screen.getByRole("dialog", {
        name: "Delete 1 selected card from the archive?",
      }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
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
      screen.getByText(
        "3 selected cards will be deleted from the archive. You can undo this right away, one card at a time.",
      ),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByTestId("archive-row")).toHaveLength(3);
    await userEvent.click(
      screen.getByRole("button", { name: "Delete selected" }),
    );
    const confirmation = screen.getByRole("dialog", {
      name: "Delete 3 selected cards from the archive?",
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

const SERVER_BOARD: Board = {
  id: "b-1",
  title: "Alpha",
  columns: [{ id: "col-1", title: "To do", cardIds: [], createdAt: 1 }],
  cards: {
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
};

describe("ArchiveDialog permissions", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("gives a VIEWER a read-only archive: no per-row or bulk write actions", async () => {
    const server = new FakeServer([SERVER_BOARD]);
    server.role = "VIEWER";
    vi.stubGlobal("fetch", server.handle);
    renderArchive();

    const row = await screen.findByTestId(
      "archive-row",
      {},
      { timeout: 15_000 },
    );
    expect(row).toHaveTextContent("Archived thing");
    expect(within(row).queryByTestId("archive-restore")).toBeNull();
    expect(within(row).queryByTestId("archive-delete")).toBeNull();
    expect(screen.queryByTestId("archive-bulk-controls")).toBeNull();
    // Opening the archived card stays available for reading.
    expect(within(row).getByTestId("archive-row-title")).toBeEnabled();
  });

  it("keeps an archived board's archive read-only and explains why", async () => {
    const server = new FakeServer([{ ...SERVER_BOARD, archivedAt: 5_000 }]);
    vi.stubGlobal("fetch", server.handle);
    renderArchive(`${routes.board("b-1")}?card=c-old`);

    const row = await screen.findByTestId(
      "archive-row",
      {},
      { timeout: 15_000 },
    );
    expect(row).toHaveTextContent("Archived thing");
    expect(screen.getByTestId("archived-board-notice")).toHaveTextContent(
      /archived and read-only/i,
    );
    expect(screen.getByTestId("archived-board-restore")).toBeVisible();
    expect(within(row).queryByTestId("archive-restore")).toBeNull();
    expect(within(row).queryByTestId("archive-delete")).toBeNull();
    expect(screen.queryByTestId("archive-bulk-controls")).toBeNull();

    await userEvent.click(screen.getByTestId("archived-board-restore"));
    await waitFor(() =>
      expect(screen.queryByTestId("archived-board-notice")).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("archive-search")).toHaveFocus(),
    );
  });

  it("archives the viewed route board, not the active one", async () => {
    const archivedBoard: Board = {
      ...SERVER_BOARD,
      id: "b-2",
      title: "Archived beta",
      archivedAt: 5_000,
    };
    const server = new FakeServer([SERVER_BOARD, archivedBoard]);
    vi.stubGlobal("fetch", server.handle);
    renderArchive(routes.board("b-1"), "b-2");

    const dialog = await screen.findByRole(
      "dialog",
      { name: "Card archive" },
      { timeout: 15_000 },
    );
    expect(dialog).toHaveTextContent("Archived beta");
    expect(dialog).not.toHaveTextContent("Alpha");
    const row = await screen.findByTestId("archive-row");
    expect(within(row).queryByTestId("archive-restore")).toBeNull();
    expect(within(row).queryByTestId("archive-delete")).toBeNull();
    expect(screen.queryByTestId("archive-bulk-controls")).toBeNull();
    expect(screen.getByTestId("archived-board-notice")).toBeVisible();
  });

  it("tells a VIEWER to ask an admin instead of offering restore", async () => {
    const server = new FakeServer([{ ...SERVER_BOARD, archivedAt: 5_000 }]);
    server.role = "VIEWER";
    vi.stubGlobal("fetch", server.handle);
    renderArchive(`${routes.board("b-1")}?card=c-old`);

    const notice = await screen.findByTestId(
      "archived-board-notice",
      {},
      { timeout: 15_000 },
    );
    expect(notice).toHaveTextContent(/ask a board admin/i);
    expect(within(notice).queryByTestId("archived-board-restore")).toBeNull();
  });
});
