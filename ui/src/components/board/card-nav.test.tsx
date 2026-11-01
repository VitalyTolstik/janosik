import { fireEvent, render, screen } from "@testing-library/react";
import { addDays } from "date-fns";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarView } from "@/components/board/CalendarView";
import { TableView } from "@/components/board/TableView";
import { DndBoard } from "@/components/board/DndBoard";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { cardHref } from "@/utils/card-nav";
import type { Board } from "@janosik/shared";

/**
 * Middle-click (wheel) opening, surface by surface: the board's card face,
 * the calendar (scheduled chips, unscheduled list, day-panel rows), and the
 * table rows. Every card-like element exposes its deep link as
 * `data-card-href` and bridges a middle-click to `window.open` — the
 * plain left click keeps opening the in-app dialog.
 */

const BOARD: Board = {
  id: "b-nav",
  title: "Nav",
  columns: [
    {
      id: "col-1",
      title: "To do",
      cardIds: ["c-chip", "c-plain"],
      createdAt: 1,
    },
  ],
  cards: {
    "c-chip": {
      id: "c-chip",
      title: "Scheduled card",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
      // Tomorrow — always inside the calendar's visible month grid (the whole
      // current month plus the adjacent days it pads with), so the chip is
      // there whatever the wall-clock date.
      dueDate: addDays(new Date(), 1).getTime(),
    },
    "c-plain": {
      id: "c-plain",
      title: "Unscheduled card",
      labelIds: [],
      createdAt: 2,
      updatedAt: 2,
    },
  },
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

function tree(children: React.ReactNode) {
  return (
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-nav"]}>
                <ToastProvider>
                  <BoardProvider>{children}</BoardProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}

function middleClick(el: Element) {
  // React's onAuxClick listens for the `auxclick` DOM event — jsdom does
  // not derive it from a button:1 click, so fire it explicitly.
  fireEvent(
    el,
    new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
  );
}

describe("middle-click opens a card in a new tab", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("janosik-boards", JSON.stringify([BOARD]));
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("TableView: wheel-clicking a row opens the card", () => {
    render(tree(<TableView onCardClick={vi.fn()} />));
    const row = screen
      .getAllByTestId("table-row")
      .find(
        (el) =>
          el.getAttribute("data-card-href") === cardHref("b-nav", "c-plain"),
      );
    expect(row).toBeDefined();
    middleClick(row as Element);
    expect(window.open).toHaveBeenCalledWith(
      cardHref("b-nav", "c-plain"),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("CalendarView: scheduled chip, unscheduled card and day-panel row", () => {
    render(tree(<CalendarView onCardClick={vi.fn()} />));

    // The scheduled chip sits on its date cell.
    const chip = screen.getByTestId("calendar-chip");
    middleClick(chip);
    expect(window.open).toHaveBeenCalledWith(
      cardHref("b-nav", "c-chip"),
      "_blank",
      "noopener,noreferrer",
    );

    // The unscheduled side list: c-plain renders there; the day panel may
    // also be open by default, so query within the list container.
    const unscheduledRow = Array.from(
      screen.getByTestId("unscheduled-list").querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Unscheduled card"));
    expect(unscheduledRow).toBeDefined();
    middleClick(unscheduledRow as Element);
    expect(window.open).toHaveBeenCalledWith(
      cardHref("b-nav", "c-plain"),
      "_blank",
      "noopener,noreferrer",
    );

    // The day panel's own card rows: open the day that hosts the chip,
    // then wheel-click its row inside the panel.
    const dayCell = chip.closest("[data-testid='calendar-day']");
    expect(dayCell).toBeDefined();
    fireEvent.click(dayCell as Element);
    const dayRow = Array.from(
      screen.getAllByTestId("day-panel")[0].querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Scheduled card"));
    expect(dayRow).toBeDefined();
    middleClick(dayRow as Element);
    expect(window.open).toHaveBeenCalledWith(
      cardHref("b-nav", "c-chip"),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("DndBoard: Cmd+click on the card face opens the card", () => {
    render(tree(<DndBoard onCardClick={vi.fn()} />));
    const face = screen
      .getAllByTestId("card-title")
      .find((el) => el.textContent === "Scheduled card");
    expect(face).toBeDefined();
    fireEvent.click(face as Element, { metaKey: true });
    expect(window.open).toHaveBeenCalledWith(
      cardHref("b-nav", "c-chip"),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("plain left click still opens the dialog instead of a new tab", () => {
    const onCardClick = vi.fn();
    render(tree(<TableView onCardClick={onCardClick} />));
    const row = screen
      .getAllByTestId("table-row")
      .find(
        (el) =>
          el.getAttribute("data-card-href") === cardHref("b-nav", "c-plain"),
      );
    fireEvent.click(row as Element);
    expect(onCardClick).toHaveBeenCalledWith("c-plain");
    expect(window.open).not.toHaveBeenCalled();
  });
});
