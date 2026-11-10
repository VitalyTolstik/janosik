import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarView } from "@/components/board/CalendarView";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider, useBoard } from "@/store/BoardContext";
import type { Board } from "@janosik/shared";

/**
 * Calendar touch reschedule (TASK-31). HTML5 drag events never fire on a
 * phone, so the chip is lifted by a long press and dropped on the day under
 * the finger; the time-of-day survives, exactly as in the desktop drop.
 */

const SOURCE = new Date();
SOURCE.setHours(14, 30, 0, 0);

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function seedBoard(): Board {
  const board: Board = {
    id: "b-cal-touch",
    title: "Calendar touch",
    columns: [
      { id: "col-1", title: "To do", cardIds: ["card-1"], createdAt: 1 },
    ],
    cards: {
      "card-1": {
        id: "card-1",
        title: "Touch task",
        labelIds: [],
        dueDate: SOURCE.getTime(),
        createdAt: 1,
        updatedAt: 1,
      },
    },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
  localStorage.setItem("janosik-boards", JSON.stringify([board]));
  return board;
}

function DueProbe() {
  const { board } = useBoard();
  return (
    <output data-testid="due">
      {String(board?.cards["card-1"]?.dueDate ?? "")}
    </output>
  );
}

function renderCalendar() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-cal-touch"]}>
                <ToastProvider>
                  <BoardProvider>
                    <CalendarView onCardClick={() => {}} />
                    <DueProbe />
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

function targetDayKey(): string {
  const cells = screen.getAllByTestId("calendar-day");
  const today = cells.find(
    (cell) => cell.getAttribute("data-date") === dayKey(SOURCE),
  );
  const index = today ? cells.indexOf(today) : -1;
  const target = cells[index + 1] ?? cells[index - 1];
  if (!target) throw new Error("no adjacent day in the grid");
  return target.getAttribute("data-date") as string;
}

describe("calendar touch reschedule (TASK-31)", () => {
  let elementFromPoint: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    seedBoard();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    elementFromPoint = vi.fn();
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("moves a chip to the day under the finger and keeps its time", () => {
    renderCalendar();
    const chip = screen.getByTestId("calendar-chip");
    const key = targetDayKey();
    const target = screen
      .getAllByTestId("calendar-day")
      .find((cell) => cell.getAttribute("data-date") === key);
    if (!target) throw new Error("target day is not rendered");

    fireEvent.pointerDown(chip, {
      pointerType: "touch",
      button: 0,
      pointerId: 7,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    });
    act(() => vi.advanceTimersByTime(260));

    elementFromPoint.mockReturnValue(target);
    fireEvent.pointerMove(window, {
      pointerId: 7,
      clientX: 80,
      clientY: 80,
    });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 80, clientY: 80 });

    const [year, month, day] = key.split("-").map(Number);
    const expected = new Date(year, month, day, 14, 30).getTime();
    expect(screen.getByTestId("due")).toHaveTextContent(String(expected));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a slow tap a card-open gesture", () => {
    const onCardClick = vi.fn();
    render(
      <ThemeProvider>
        <BoardBackgroundProvider>
          <BoardGlassProvider>
            <I18nProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={["/board/b-cal-touch"]}>
                  <ToastProvider>
                    <BoardProvider>
                      <CalendarView onCardClick={onCardClick} />
                      <DueProbe />
                    </BoardProvider>
                  </ToastProvider>
                </MemoryRouter>
              </TooltipProvider>
            </I18nProvider>
          </BoardGlassProvider>
        </BoardBackgroundProvider>
      </ThemeProvider>,
    );
    const chip = screen.getByTestId("calendar-chip");
    const before = screen.getByTestId("due").textContent;
    fireEvent.pointerDown(chip, {
      pointerType: "touch",
      button: 0,
      pointerId: 8,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    });
    act(() => vi.advanceTimersByTime(260));
    fireEvent.pointerUp(window, { pointerId: 8, clientX: 20, clientY: 20 });
    fireEvent.click(chip);

    expect(onCardClick).toHaveBeenCalledWith("card-1");
    expect(screen.getByTestId("due")).toHaveTextContent(before as string);
  });

  it("offers the card context menu through an explicit touch button", () => {
    renderCalendar();
    fireEvent.click(screen.getByTestId("calendar-chip-menu"));
    const menu = screen.getByTestId("card-context-menu");
    expect(menu).toBeInTheDocument();
    expect(menu.textContent).toContain("Open card");
    expect(menu.textContent).toContain("Due date");
    expect(menu.textContent).toContain("Priority");
    expect(menu.textContent).toContain("Archive");
  });

  it("does not reschedule while a filter is active", () => {
    render(
      <ThemeProvider>
        <BoardBackgroundProvider>
          <BoardGlassProvider>
            <I18nProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={["/board/b-cal-touch"]}>
                  <ToastProvider>
                    <BoardProvider>
                      <CalendarView onCardClick={() => {}} isFiltering />
                      <DueProbe />
                    </BoardProvider>
                  </ToastProvider>
                </MemoryRouter>
              </TooltipProvider>
            </I18nProvider>
          </BoardGlassProvider>
        </BoardBackgroundProvider>
      </ThemeProvider>,
    );
    const chip = screen.getByTestId("calendar-chip");
    const key = targetDayKey();
    const target = screen
      .getAllByTestId("calendar-day")
      .find((cell) => cell.getAttribute("data-date") === key);
    if (!target) throw new Error("target day is not rendered");

    const before = screen.getByTestId("due").textContent;
    fireEvent.pointerDown(chip, {
      pointerType: "touch",
      button: 0,
      pointerId: 9,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    });
    act(() => vi.advanceTimersByTime(260));
    elementFromPoint.mockReturnValue(target);
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 80, clientY: 80 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 80, clientY: 80 });

    expect(screen.getByTestId("due")).toHaveTextContent(before as string);
    expect(screen.getByTestId("calendar-chip")).toHaveAttribute(
      "draggable",
      "false",
    );
  });
});
