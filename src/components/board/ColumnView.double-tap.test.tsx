import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { DndBoard } from "@/components/board/DndBoard";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Double-tap rename on the column header (TASK-21.11).
 *
 * On touch the browser only synthesizes `dblclick` when its gesture
 * recognizer accepts the tap pair, and the header also owns dnd-kit's
 * TouchSensor listeners — so the rename gesture must be read from the
 * pointer stream. These tests dispatch the pointer events of two taps
 * (jsdom does not synthesize `dblclick` from touches) and assert the
 * dialog opens, plus the untouched mouse path.
 */

function seedBoard() {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "b-1",
        title: "Touch",
        columns: [
          { id: "col-1", title: "To do", cardIds: ["card-1"], createdAt: 1 },
        ],
        cards: {
          "card-1": { id: "card-1", title: "Card", labelIds: [], createdAt: 1 },
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

function boardTree() {
  return (
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-1"]}>
                <ToastProvider>
                  <BoardProvider>
                    <DndBoard onCardClick={() => {}} />
                  </BoardProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}

/** Dispatches one tap as the pointer events a touch screen produces. */
function touchTap(target: Element) {
  fireEvent.pointerDown(target, {
    pointerType: "touch",
    button: 0,
    clientX: 20,
    clientY: 20,
  });
  fireEvent.pointerUp(target, {
    pointerType: "touch",
    button: 0,
    clientX: 20,
    clientY: 20,
  });
}

describe("column header rename on touch (TASK-21.11)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
  });

  it("opens the rename dialog on a double tap", () => {
    render(boardTree());
    const title = screen.getByText("To do");

    touchTap(title);
    expect(screen.queryByRole("dialog")).toBeNull();

    touchTap(title);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("To do")).toBeInTheDocument();
  });

  it("does not open the rename dialog on a single tap", () => {
    render(boardTree());

    touchTap(screen.getByText("To do"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the mouse double-click path working", () => {
    render(boardTree());

    fireEvent.doubleClick(screen.getByText("To do"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
