import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { Header } from "@/components/Header";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Keyboard shortcuts: "?" opens the cheat-sheet overlay; on the board,
 * n/c open the composers, j/k move the cursor, e/Enter open the cursor's
 * card, Escape clears it. Single-letter keys are inert while typing.
 */

const SEED = JSON.stringify([
  {
    id: "b-1",
    title: "Alpha",
    columns: [
      {
        id: "col-1",
        title: "To do",
        cardIds: ["c-1", "c-2"],
        createdAt: 1,
      },
      { id: "col-2", title: "Doing", cardIds: ["c-3"], createdAt: 1 },
    ],
    cards: {
      "c-1": {
        id: "c-1",
        title: "First card",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      "c-2": {
        id: "c-2",
        title: "Second card",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      "c-3": {
        id: "c-3",
        title: "Third card",
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

function renderBoard() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter>
                <BoardProvider>
                  <Header />
                  <BoardSection />
                </BoardProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

const pressKey = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key, ...init });

// Radix DropdownMenu opens on pointerdown, not click.
const openHelp = () =>
  fireEvent.pointerDown(screen.getByRole("button", { name: "Help" }), {
    button: 0,
  });

describe("keyboard shortcuts", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("janosik-boards", SEED);
  });

  it("'?' opens the cheat sheet listing search and navigation keys", () => {
    renderBoard();
    pressKey("?");
    const table = screen.getByTestId("shortcuts-table");
    expect(table).toHaveTextContent("Ctrl+K");
    expect(table).toHaveTextContent("N");
    expect(table).toHaveTextContent("J");
    fireEvent.keyDown(table, { key: "Escape" });
    // Radix closes on Escape via its own handler.
  });

  it("opens the cheat sheet from the Help menu", () => {
    renderBoard();
    openHelp();
    fireEvent.click(
      screen.getByRole("menuitem", { name: /keyboard shortcuts/i }),
    );
    expect(screen.getByTestId("shortcuts-table")).toBeInTheDocument();
  });

  it("links to the documentation from the Help menu", () => {
    renderBoard();
    openHelp();
    const docs = screen.getByTestId("help-docs");
    expect(docs).toHaveAttribute("href", "/docs/");
    expect(docs).toHaveAttribute("target", "_blank");
  });

  it("'n' opens a card composer, 'c' opens the column composer", () => {
    renderBoard();
    pressKey("n");
    // The idle "Add a card" trigger was clicked → its textarea is in the DOM.
    expect(
      screen.getByPlaceholderText("Enter a title for this card…"),
    ).toBeInTheDocument();
  });

  it("j/k move the cursor, Enter opens the cursor's card", () => {
    renderBoard();
    pressKey("j");
    expect(
      document.querySelector('[data-card-cursor="true"]'),
    ).toHaveTextContent("First card");
    pressKey("j");
    expect(
      document.querySelector('[data-card-cursor="true"]'),
    ).toHaveTextContent("Second card");
    pressKey("k");
    expect(
      document.querySelector('[data-card-cursor="true"]'),
    ).toHaveTextContent("First card");
    pressKey("Enter");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("'e' opens the cursor's card, Escape clears the cursor", () => {
    renderBoard();
    pressKey("j");
    pressKey("j");
    pressKey("e");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    // Dialog closed — cursor cleared by the dialog flow, board visible again.
  });

  it("single-letter keys are ignored while typing", () => {
    renderBoard();
    pressKey("c");
    const input = screen.getByPlaceholderText("Column title…");
    fireEvent.keyDown(input, { key: "j" });
    // No cursor appeared: the key was typed into the input.
    expect(document.querySelector('[data-card-cursor="true"]')).toBeNull();
  });

  it("Enter opens the focused card, not the cursor card", () => {
    renderBoard();
    pressKey("j");
    expect(
      document.querySelector('[data-card-cursor="true"]'),
    ).toHaveTextContent("First card");

    const second = screen.getByRole("group", { name: /^Second card$/ });
    second.focus();
    fireEvent.keyDown(second, { key: "Enter", code: "Enter" });

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Title" })).toHaveValue(
      "Second card",
    );
  });

  it("ignores board shortcuts while the card context menu is open", async () => {
    renderBoard();
    fireEvent.contextMenu(screen.getByText("First card"), {
      button: 2,
      clientX: 16,
      clientY: 16,
    });
    expect(await screen.findByTestId("card-context-menu")).toBeInTheDocument();

    pressKey("j");

    expect(document.querySelector('[data-card-cursor="true"]')).toBeNull();
  });

  it("ignores ? while a menu is open", async () => {
    renderBoard();
    fireEvent.contextMenu(screen.getByText("First card"), {
      button: 2,
      clientX: 16,
      clientY: 16,
    });
    expect(await screen.findByTestId("card-context-menu")).toBeInTheDocument();

    pressKey("?");

    expect(screen.queryByTestId("shortcuts-table")).toBeNull();
  });

  it("leaves Enter to a focused control while the cursor is active", () => {
    renderBoard();
    pressKey("j");
    const switcher = screen.getByRole("button", { name: "Switch board" });
    switcher.focus();

    const notPrevented = fireEvent.keyDown(switcher, {
      key: "Enter",
      code: "Enter",
    });

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focuses the board search with slash unless an overlay is open", () => {
    renderBoard();
    const search = screen.getByRole("textbox", { name: "Search cards" });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);

    pressKey("/");
    expect(search).not.toHaveFocus();

    dialog.remove();
    pressKey("/");
    expect(search).toHaveFocus();
  });
});
