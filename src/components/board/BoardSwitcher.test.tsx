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
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Board switcher: lists boards (with card counts and the active check),
 * live search, keyboard navigation, inline create (navigates to the new
 * board), inline delete confirm and the last-board guard.
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

function renderSwitcher(initialUrl = "/board/b-1") {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <I18nProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[initialUrl]}>
              <BoardProvider>
                <BoardSwitcher />
                <Routes>
                  <Route path="/board/:boardId" element={<BoardSection />} />
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

  it("deletes a non-active board after inline confirm", async () => {
    renderSwitcher();
    const listbox = await openSwitcher();
    // Beta is not active — hover its row to reveal the delete button.
    const betaRow = listbox.querySelector<HTMLElement>('[data-index="1"]')!;
    fireEvent.mouseEnter(betaRow);
    fireEvent.click(within(betaRow).getByRole("button", { name: "Delete board" }));
    // Confirm with the dedicated yes-button.
    fireEvent.click(await screen.findByRole("button", { name: "Yes, delete" }));
    await waitFor(() => {
      expect(screen.getByRole("listbox")).not.toHaveTextContent("Beta");
    });
    // Still on the untouched board.
    expect(
      screen.getByRole("heading", { name: "Alpha" }),
    ).toBeInTheDocument();
  });

  it("deleting the active board navigates to the remaining one", async () => {
    renderSwitcher();
    const listbox = await openSwitcher();
    // The active board (b-1, first row) — hover swaps its check for a trash.
    const alphaRow = listbox.querySelector<HTMLElement>('[data-index="0"]')!;
    fireEvent.mouseEnter(alphaRow);
    fireEvent.click(within(alphaRow).getByRole("button", { name: "Delete board" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, delete" }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Beta" }),
      ).toBeInTheDocument();
    });
  });

  it("protects the last remaining board from deletion", async () => {
    renderSwitcher();
    const listbox = await openSwitcher();
    // Remove Beta first.
    const betaRow = listbox.querySelector<HTMLElement>('[data-index="1"]')!;
    fireEvent.mouseEnter(betaRow);
    fireEvent.click(within(betaRow).getByRole("button", { name: "Delete board" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, delete" }));
    await waitFor(() => {
      expect(screen.getByRole("listbox")).not.toHaveTextContent("Beta");
    });
    // Alpha (the last board) has no delete button anymore.
    expect(
      screen.queryByRole("button", { name: "Delete board" }),
    ).toBeNull();
  });
});
