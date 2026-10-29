import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";
import { DndBoard } from "@/components/board/DndBoard";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Keyboard access to cards (a11y): a VIEWER's card is reachable with Tab
 * and opens on Enter/Space; an editor's card opens on Enter — Enter used to
 * start a keyboard drag — while Space still picks it up for dragging.
 */

const BOARD: Board = {
  id: "b-1",
  title: "Keys",
  columns: [{ id: "col-1", title: "To do", cardIds: ["card-1"], createdAt: 1 }],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Keyboard card",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  },
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

function renderBoard(readOnly: boolean, onCardClick: (id: string) => void) {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-1"]}>
                <ToastProvider>
                  <BoardProvider>
                    <DndBoard readOnly={readOnly} onCardClick={onCardClick} />
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

describe("card keyboard access", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("janosik-boards", JSON.stringify([BOARD]));
  });

  it("VIEWER: the card face is a tab stop and opens on Enter or Space", () => {
    const open = vi.fn();
    renderBoard(true, open);
    const face = screen.getByText("Keyboard card").closest("article");
    expect(face).toHaveAttribute("tabindex", "0");
    expect(face).toHaveAttribute("role", "button");

    fireEvent.keyDown(face as HTMLElement, { key: "Enter", code: "Enter" });
    fireEvent.keyDown(face as HTMLElement, { key: " ", code: "Space" });
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith("card-1");
  });

  it("editor: Enter opens the card instead of starting a drag; Space drags", () => {
    const open = vi.fn();
    renderBoard(false, open);
    const handle = screen
      .getByText("Keyboard card")
      .closest('[aria-roledescription="sortable"]') as HTMLElement;
    expect(handle).toHaveAttribute("tabindex", "0");
    // The face itself is not a second tab stop for editors.
    expect(
      screen.getByText("Keyboard card").closest("article"),
    ).not.toHaveAttribute("tabindex");

    act(() => {
      handle.focus();
      fireEvent.keyDown(handle, { key: "Enter", code: "Enter" });
    });
    expect(open).toHaveBeenCalledWith("card-1");
    expect(handle).not.toHaveAttribute("aria-pressed");

    open.mockClear();
    act(() => {
      fireEvent.keyDown(handle, { key: " ", code: "Space" });
    });
    expect(open).not.toHaveBeenCalled();
    // A group must not carry `aria-pressed` (TASK-156); the drag state is
    // exposed through dnd-kit's `aria-roledescription` instead.
    expect(handle).not.toHaveAttribute("aria-pressed");
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
  });
});
