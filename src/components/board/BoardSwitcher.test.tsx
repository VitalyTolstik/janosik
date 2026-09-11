import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { BoardTitle } from "@/components/board/BoardTitle";
import { NoBoardRoute } from "@/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/routes";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Board switcher: lists boards (with card counts and the active check),
 * live search, keyboard navigation, inline create (navigates to the new
 * board), archiving (Trello's close-board: data kept, hidden from the
 * active list) with an archived section (restore / delete-for-good).
 */

function boardJson(id: string, title: string) {
  return JSON.stringify({
    id,
    title,
    columns: [{ id: `${id}-col`, title: "To do", cardIds: [], createdAt: 1 }],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  });
}

function renderSwitcher(initialUrl = routes.board("b-1")) {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <I18nProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[initialUrl]}>
              <BoardProvider>
                <BoardTitle />
                <BoardSwitcher />
                <Routes>
                  <Route path={routes.home} element={<NoBoardRoute />} />
                  <Route
                    path={routes.boardPattern}
                    element={<BoardSection />}
                  />
                </Routes>
              </BoardProvider>
            </MemoryRouter>
          </TooltipProvider>
        </I18nProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

function seedTwoBoards() {
  localStorage.setItem("janosik-boards", `[${boardJson("b-1", "Alpha")},${boardJson("b-2", "Beta")}]`);
}

async function openSwitcher() {
  fireEvent.click(screen.getByRole("button", { name: "Switch board" }));
  const listbox = await screen.findByRole("listbox");
  return listbox;
}

describe("BoardSwitcher", () => {
  beforeEach(() => {
    localStorage.clear();
    seedTwoBoards();
  });

  it("lists all boards with the active one marked", async () => {
    renderSwitcher();
    const listbox = await openSwitcher();
    expect(listbox).toHaveTextContent("Alpha");
    expect(listbox).toHaveTextContent("Beta");
    expect(screen.getAllByRole("option", { selected: true })).toHaveLength(1);
  });

  it("filters boards by search query", async () => {
    renderSwitcher();
    await openSwitcher();
    const input = screen.getByLabelText("Search boards…");
    await userEvent.type(input, "bet");
    expect(screen.getByRole("listbox")).toHaveTextContent("Beta");
    expect(screen.getByRole("listbox")).not.toHaveTextContent("Alpha");
  });

  it("shows an empty state when nothing matches", async () => {
    renderSwitcher();
    await openSwitcher();
    await userEvent.type(screen.getByLabelText("Search boards…"), "zzz");
    expect(screen.getByText("No boards match")).toBeInTheDocument();
  });

  it("navigates with ArrowDown + Enter", async () => {
    renderSwitcher();
    await openSwitcher();
    const input = screen.getByLabelText("Search boards…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Beta" }),
      ).toBeInTheDocument();
    });
  });

  it("creates a board from the footer row and navigates to it", async () => {
    renderSwitcher();
    await openSwitcher();
    fireEvent.click(screen.getByText("New board"));
    const input = await screen.findByLabelText("Board name");
    await userEvent.type(input, "Gamma{Enter}");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Gamma" }),
      ).toBeInTheDocument();
    });
  });

  it("creates a board named after a non-matching search query", async () => {
    renderSwitcher();
    await openSwitcher();
    await userEvent.type(screen.getByLabelText("Search boards…"), "Delta");
    fireEvent.click(screen.getByText('Create "Delta"'));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Delta" }),
      ).toBeInTheDocument();
    });
  });

  it("archives a non-active board after inline confirm (data kept)", async () => {
    renderSwitcher();
    const listbox = await openSwitcher();
    // Beta is not active — hover its row to reveal the archive button.
    const betaRow = listbox.querySelector<HTMLElement>('[data-index="1"]')!;
    fireEvent.mouseEnter(betaRow);
    fireEvent.click(within(betaRow).getByRole("button", { name: "Archive board" }));
    // Confirm with the dedicated yes-button.
    fireEvent.click(await screen.findByRole("button", { name: "Yes, archive" }));
    await waitFor(() => {
      // Beta left the active list…
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent("Alpha");
    });
    // …but landed in the archived section (nothing was destroyed).
    expect(screen.getByTestId("archived-section")).toHaveTextContent("Beta");
    // Still on the untouched board.
    expect(
      screen.getByRole("heading", { name: "Alpha" }),
    ).toBeInTheDocument();
  });

  it("archiving the active board navigates to the remaining one", async () => {
    renderSwitcher();
    const listbox = await openSwitcher();    const alphaRow = listbox.querySelector<HTMLElement>('[data-index="0"]')!;
    fireEvent.mouseEnter(alphaRow);
    fireEvent.click(within(alphaRow).getByRole("button", { name: "Archive board" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, archive" }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Beta" }),
      ).toBeInTheDocument();
    });
  });

  it("restores an archived board back to the active list", async () => {
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        JSON.parse(boardJson("b-1", "Alpha")),
        { ...JSON.parse(boardJson("b-2", "Beta")), archivedAt: 123 },
      ]),
    );
    renderSwitcher();
    await openSwitcher();
    // Beta is archived — only Alpha is navigable.
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByTestId("archived-section")).toHaveTextContent("Beta");
    const archivedSection = screen.getByTestId("archived-section");
    fireEvent.click(
      within(archivedSection).getByRole("button", { name: "Restore board" }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("archived-section")).toBeNull();
    });
    // Beta is a real option again (and the header shows Alpha still).
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Alpha" }),
    ).toBeInTheDocument();
  });

  it("deletes an archived board for good after confirm", async () => {
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        JSON.parse(boardJson("b-1", "Alpha")),
        { ...JSON.parse(boardJson("b-2", "Beta")), archivedAt: 123 },
      ]),
    );
    renderSwitcher();
    await openSwitcher();
    const archivedSection = screen.getByTestId("archived-section");
    fireEvent.click(
      within(archivedSection).getByRole("button", { name: "Delete board" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Yes, delete" }));
    await waitFor(() => {
      expect(screen.queryByTestId("archived-section")).toBeNull();
    });
    // Alpha remains active.
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("does not offer restore/delete for active boards (only archive)", async () => {
    renderSwitcher();
    const listbox = await openSwitcher();
    const alphaRow = listbox.querySelector<HTMLElement>('[data-index="0"]')!;
    fireEvent.mouseEnter(alphaRow);
    expect(
      within(alphaRow).getByRole("button", { name: "Archive board" }),
    ).toBeInTheDocument();
    expect(
      within(alphaRow).queryByRole("button", { name: "Delete board" }),
    ).toBeNull();
    expect(screen.queryByTestId("archived-section")).toBeNull();
  });

  it("archiving the only board shows the empty state, not the archived board", async () => {
    localStorage.setItem("janosik-boards", `[${boardJson("b-1", "Alpha")}]`);
    renderSwitcher();
    const listbox = await openSwitcher();
    const alphaRow = listbox.querySelector<HTMLElement>('[data-index="0"]')!;
    fireEvent.mouseEnter(alphaRow);
    fireEvent.click(within(alphaRow).getByRole("button", { name: "Archive board" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, archive" }));
    // The empty-state screen replaces the board (never stranded on an
    // archived board), and the popover still offers restoration.
    expect(await screen.findByTestId("empty-create-board")).toBeInTheDocument();
    expect(screen.getByText("All boards are archived.")).toBeInTheDocument();
    expect(screen.getByTestId("archived-section")).toHaveTextContent("Alpha");
    // Restoring brings the board (and the route) back.
    fireEvent.click(screen.getByRole("button", { name: "Restore board" }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Alpha" }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("empty-create-board")).toBeNull();
  });

  it("creates a board from the empty-state CTA and navigates to it", async () => {
    localStorage.setItem("janosik-boards", `[${boardJson("b-1", "Alpha")}]`);
    renderSwitcher();
    const listbox = await openSwitcher();
    const alphaRow = listbox.querySelector<HTMLElement>('[data-index="0"]')!;
    fireEvent.mouseEnter(alphaRow);
    fireEvent.click(within(alphaRow).getByRole("button", { name: "Archive board" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, archive" }));
    fireEvent.click(await screen.findByTestId("empty-create-board"));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "New board" }),
      ).toBeInTheDocument();
    });
  });
});
