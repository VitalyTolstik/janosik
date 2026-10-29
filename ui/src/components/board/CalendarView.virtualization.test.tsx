import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { CalendarView } from "@/components/board/CalendarView";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import type { Board, Card } from "@janosik/shared";

/**
 * Calendar list windowing (TASK-139): the bound month grid is unchanged, but
 * the always-visible unscheduled panel, the week cells and the day panel stop
 * mounting every card once a bucket is large.
 */

const COUNT = 200;
const DUE = new Date(
  new Date().getFullYear(),
  new Date().getMonth(),
  1,
  12,
).getTime();

function board(): Board {
  const cardIds = Array.from({ length: COUNT * 2 }, (_, i) => `c-${i}`);
  const cards = Object.fromEntries(
    cardIds.map((id, i) => [
      id,
      {
        id,
        title: `Card ${i}`,
        labelIds: [],
        createdAt: i,
        updatedAt: i,
        ...(i < COUNT ? { dueDate: DUE } : {}),
      } satisfies Card,
    ]),
  );
  return {
    id: "b-cal-virtual",
    title: "Calendar virtual",
    columns: [{ id: "col-1", title: "To do", cardIds, createdAt: 1 }],
    cards,
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderCalendar() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-cal-virtual"]}>
                <ToastProvider>
                  <BoardProvider>
                    <CalendarView onCardClick={() => {}} />
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

describe("calendar list windowing (TASK-139)", () => {
  // jsdom reports 0-height boxes, which hides every virtual row.
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        const testId = this.dataset.testid;
        if (
          testId === "unscheduled-list" ||
          testId === "calendar-grid" ||
          testId === "day-entries-scroll"
        ) {
          return 600;
        }
        return 26;
      },
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("janosik-boards", JSON.stringify([board()]));
  });

  it("windows the always-visible unscheduled panel", () => {
    renderCalendar();
    const panel = screen.getByTestId("unscheduled-list");
    const rows = within(panel).getAllByRole("button");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(COUNT);
    expect(within(panel).queryByText(`Card ${COUNT * 2 - 1}`)).toBeNull();
  });

  it("swaps unscheduled rows on scroll", () => {
    renderCalendar();
    const panel = screen.getByTestId("unscheduled-list");
    panel.scrollTop = COUNT * 26;
    fireEvent.scroll(panel);

    expect(
      within(panel).getByText(`Card ${COUNT * 2 - 1}`),
    ).toBeInTheDocument();
  });

  it("windows a crowded week cell", () => {
    localStorage.setItem("janosik-calendar-scale", "week");
    renderCalendar();
    const chips = screen.getAllByTestId("calendar-chip");
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThan(COUNT);
  });

  it("windows the day panel's full list", () => {
    renderCalendar();
    const day = new Date(DUE);
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    fireEvent.click(document.querySelector(`[data-date="${key}"]`) as Element);

    const list = within(screen.getByTestId("day-entries-scroll"));
    const rows = list.getAllByRole("button");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(COUNT);
  });
});
