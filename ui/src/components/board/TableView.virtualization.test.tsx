import { fireEvent, render, screen } from "@testing-library/react";
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

import { TableView } from "@/components/board/TableView";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import type { Board, Card } from "@janosik/shared";

/**
 * Table row windowing (TASK-139): a full table mounts only the rows around
 * its scroll position; scrolling swaps the window. The 2400-row table used
 * to mount ~49k DOM nodes and block the main thread for almost 2 s.
 */

const ROWS = 200;

function board(): Board {
  const cardIds = Array.from({ length: ROWS }, (_, index) => `row-${index}`);
  const cards = Object.fromEntries(
    cardIds.map((id, index) => [
      id,
      {
        id,
        title: `Row ${index}`,
        labelIds: [],
        createdAt: index,
        updatedAt: index,
      } satisfies Card,
    ]),
  );
  return {
    id: "b-table-virtual",
    title: "Table virtual",
    columns: [{ id: "col-1", title: "To do", cardIds, createdAt: 1 }],
    cards,
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderTable() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-table-virtual"]}>
                <ToastProvider>
                  <BoardProvider>
                    <TableView onCardClick={() => {}} />
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

describe("table row windowing (TASK-139)", () => {
  // jsdom reports every box as 0×0, which hides every virtual row. Give the
  // scroll container a real viewport and each <tr> the estimated height.
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "table-scroll") return 600;
        return this.tagName === "TR" ? 37 : 0;
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

  it("mounts only the rows around the viewport", () => {
    renderTable();
    const rows = screen.getAllByTestId("table-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(ROWS);
    expect(screen.getByText("Row 0")).toBeInTheDocument();
    expect(screen.queryByText(`Row ${ROWS - 1}`)).toBeNull();
  });

  it("swaps the mounted rows when the table scrolls", () => {
    renderTable();
    const scroller = screen.getByTestId("table-scroll");
    scroller.scrollTop = ROWS * 37;
    fireEvent.scroll(scroller);

    expect(screen.getByText(`Row ${ROWS - 1}`)).toBeInTheDocument();
    expect(screen.queryByText("Row 0")).toBeNull();
  });
});
