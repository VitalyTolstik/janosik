import { fireEvent, render, screen } from "@testing-library/react";
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
import type { Board, Card } from "@janosik/shared";

/**
 * Large-board windowing (TASK-139): a full 200-card column mounts only the
 * rows around its scroll position, scrolling swaps the window, and the j/k
 * cursor can walk all the way to the last card.
 */

const CARDS = 200;

function board(): Board {
  const cardIds = Array.from({ length: CARDS }, (_, index) => `card-${index}`);
  const cards = Object.fromEntries(
    cardIds.map((id, index) => [
      id,
      {
        id,
        title: `Card ${index}`,
        labelIds: [],
        createdAt: index,
        updatedAt: index,
      } satisfies Card,
    ]),
  );
  return {
    id: "b-virtual",
    title: "Virtual",
    columns: [{ id: "col-1", title: "To do", cardIds, createdAt: 1 }],
    cards,
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function boardTree() {
  return (
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-virtual"]}>
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

describe("column card windowing (TASK-139)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("janosik-boards", JSON.stringify([board()]));
  });

  it("mounts only the rows around the viewport", () => {
    render(boardTree());

    const titles = screen.getAllByTestId("card-title");
    expect(titles).toHaveLength(8);
    expect(titles[0]).toHaveTextContent("Card 0");
    expect(titles.length).toBeLessThan(CARDS);
    expect(screen.queryByText("Card 199")).toBeNull();
  });

  it("swaps the mounted rows when the column scrolls", () => {
    render(boardTree());
    const scroller = screen.getByTestId("column-card-scroll");
    scroller.scrollTop = 19_500;
    fireEvent.scroll(scroller);

    expect(screen.getByText("Card 199")).toBeInTheDocument();
    expect(screen.queryByText("Card 0")).toBeNull();
  });

  it("scrolls the last card into view when j/k walks past the window", async () => {
    render(boardTree());
    for (let index = 0; index < 50; index += 1) {
      fireEvent.keyDown(window, { key: "j" });
    }

    const title = await screen.findByText("Card 49");
    expect(title.closest("article")).toHaveAttribute(
      "data-card-cursor",
      "true",
    );
  });
});
