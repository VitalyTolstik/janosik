import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TableView } from "@/components/board/TableView";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider, useBoard } from "@/store/BoardContext";
import type { Board } from "@janosik/shared";

/**
 * Table touch row move (TASK-31). A long press lifts a row; releasing it over
 * another row moves the card into that row's column (or reorders within the
 * column in board order). Buttons inside the row keep their own gestures.
 */

function seedBoard(wipLimit?: number): Board {
  const board: Board = {
    id: "b-table-touch",
    title: "Table touch",
    columns: [
      {
        id: "col-1",
        title: "To do",
        cardIds: ["card-a", "card-b"],
        createdAt: 1,
      },
      {
        id: "col-2",
        title: "Doing",
        cardIds: ["card-c"],
        createdAt: 2,
        ...(wipLimit === undefined ? {} : { wipLimit }),
      },
    ],
    cards: {
      "card-a": {
        id: "card-a",
        title: "Alpha",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      "card-b": {
        id: "card-b",
        title: "Beta",
        labelIds: [],
        createdAt: 2,
        updatedAt: 2,
      },
      "card-c": {
        id: "card-c",
        title: "Gamma",
        labelIds: [],
        dueDate: 100,
        createdAt: 3,
        updatedAt: 3,
      },
    },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
  localStorage.setItem("janosik-boards", JSON.stringify([board]));
  return board;
}

function ColumnProbe({ cardId }: { cardId: string }) {
  const { board } = useBoard();
  const column = board?.columns.find((entry) => entry.cardIds.includes(cardId));
  return <output data-testid={`column-${cardId}`}>{column?.id ?? ""}</output>;
}

function OrderProbe({ columnId }: { columnId: string }) {
  const { board } = useBoard();
  const column = board?.columns.find((entry) => entry.id === columnId);
  return (
    <output data-testid={`order-${columnId}`}>
      {(column?.cardIds ?? []).join(",")}
    </output>
  );
}

function WorkflowProbe() {
  const { board } = useBoard();
  return (
    <output data-testid="workflow-enabled">
      {String(board?.workflow?.enabled ?? false)}
    </output>
  );
}

function renderTable(onCardClick: (cardId: string) => void = () => {}) {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-table-touch"]}>
                <ToastProvider>
                  <BoardProvider>
                    <TableView onCardClick={onCardClick} />
                    <ColumnProbe cardId="card-a" />
                    <OrderProbe columnId="col-1" />
                    <WorkflowProbe />
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

function rowByTitle(title: string): HTMLElement {
  const rows = screen.getAllByTestId("table-row");
  const match = rows.find((entry) => entry.textContent?.includes(title));
  if (!match) throw new Error(`row ${title} is not rendered`);
  return match;
}

function longPress(target: HTMLElement) {
  fireEvent.pointerDown(target, {
    pointerType: "touch",
    button: 0,
    pointerId: 3,
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });
  act(() => vi.advanceTimersByTime(260));
}

function moveTo(target: HTMLElement) {
  fireEvent.pointerMove(window, { pointerId: 3, clientX: 50, clientY: 50 });
  fireEvent.pointerUp(window, { pointerId: 3, clientX: 50, clientY: 50 });
  return target;
}

describe("table touch row move (TASK-31)", () => {
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

  it("moves a row into the column of the row under the finger", () => {
    renderTable();
    const source = rowByTitle("Alpha");
    const target = rowByTitle("Gamma");

    longPress(source);
    elementFromPoint.mockReturnValue(
      within(target).getByText("Gamma", { exact: true }),
    );
    moveTo(target);

    expect(screen.getByTestId("column-card-a")).toHaveTextContent("col-2");
  });

  it("reorders within the same column when the table is in board order", () => {
    renderTable();
    const source = rowByTitle("Alpha");
    const target = rowByTitle("Beta");

    longPress(source);
    elementFromPoint.mockReturnValue(
      within(target).getByText("Beta", { exact: true }),
    );
    moveTo(target);

    expect(screen.getByTestId("order-col-1")).toHaveTextContent(
      "card-b,card-a",
    );
  });

  it("keeps a short press a normal row tap", () => {
    const onCardClick = vi.fn();
    render(
      <ThemeProvider>
        <BoardBackgroundProvider>
          <BoardGlassProvider>
            <I18nProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={["/board/b-table-touch"]}>
                  <ToastProvider>
                    <BoardProvider>
                      <TableView onCardClick={onCardClick} />
                    </BoardProvider>
                  </ToastProvider>
                </MemoryRouter>
              </TooltipProvider>
            </I18nProvider>
          </BoardGlassProvider>
        </BoardBackgroundProvider>
      </ThemeProvider>,
    );
    const source = rowByTitle("Alpha");
    fireEvent.pointerDown(source, {
      pointerType: "touch",
      button: 0,
      pointerId: 4,
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 10, clientY: 10 });
    fireEvent.click(source);
    expect(onCardClick).toHaveBeenCalledWith("card-a");
  });

  it("does not start a row drag from the due-date button", () => {
    renderTable();
    const source = rowByTitle("Alpha");
    const target = rowByTitle("Gamma");
    const due = within(source).getByTestId("table-due-cell");

    fireEvent.pointerDown(due, {
      pointerType: "touch",
      button: 0,
      pointerId: 5,
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(260));
    elementFromPoint.mockReturnValue(target);
    fireEvent.pointerMove(window, { pointerId: 5, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(window, { pointerId: 5, clientX: 50, clientY: 50 });

    expect(screen.getByTestId("column-card-a")).toHaveTextContent("col-1");
  });

  it("opens the card from a keyboard-focused title", () => {
    const onCardClick = vi.fn();
    renderTable(onCardClick);
    const title = within(rowByTitle("Alpha")).getByRole("button", {
      name: "Alpha",
    });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(onCardClick).toHaveBeenCalledWith("card-a");
  });

  it("exposes the card menu through an explicit row button", () => {
    renderTable();
    fireEvent.click(within(rowByTitle("Alpha")).getByTestId("table-row-menu"));
    const menu = screen.getByTestId("card-context-menu");
    expect(menu).toBeInTheDocument();
    expect(menu.textContent).toContain("Due date");
    expect(menu.textContent).toContain("Priority");
    expect(menu.textContent).toContain("Duplicate card");
    expect(menu.textContent).toContain("Archive");
  });

  it("does not reorder silently while a sort is active", () => {
    renderTable();
    fireEvent.click(screen.getByTestId("table-sort-title"));
    const source = rowByTitle("Alpha");
    const target = rowByTitle("Beta");

    longPress(source);
    elementFromPoint.mockReturnValue(
      within(target).getByText("Beta", { exact: true }),
    );
    moveTo(target);

    expect(screen.getByTestId("order-col-1")).toHaveTextContent(
      "card-a,card-b",
    );
    expect(
      screen.getByText("Reset the sort to reorder cards within a column.", {
        exact: true,
      }),
    ).toBeInTheDocument();
  });

  it("refuses a drop into a column at its WIP limit", () => {
    localStorage.clear();
    seedBoard(1);
    renderTable();
    const source = rowByTitle("Alpha");
    const target = rowByTitle("Gamma");

    longPress(source);
    elementFromPoint.mockReturnValue(
      within(target).getByText("Gamma", { exact: true }),
    );
    moveTo(target);

    expect(screen.getByTestId("column-card-a")).toHaveTextContent("col-1");
    expect(
      screen.getByText(/reached its WIP limit/, { exact: false }),
    ).toBeInTheDocument();
  });

  it("refuses a workflow-forbidden touch row move", () => {
    localStorage.clear();
    const seeded = seedBoard();
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        {
          ...seeded,
          workflow: {
            schemaVersion: 1,
            enabled: true,
            initialColumnId: "col-1",
            doneColumnIds: [],
            transitions: [
              { id: "back", fromColumnId: "col-2", toColumnId: "col-1" },
            ],
          },
        },
      ]),
    );
    renderTable();
    expect(screen.getByTestId("workflow-enabled")).toHaveTextContent("true");
    const source = rowByTitle("Alpha");
    const target = rowByTitle("Gamma");

    longPress(source);
    elementFromPoint.mockReturnValue(
      within(target).getByText("Gamma", { exact: true }),
    );
    moveTo(target);

    expect(screen.getByTestId("column-card-a")).toHaveTextContent("col-1");
    expect(
      screen.getByText(/not allowed by the workflow/, { exact: false }),
    ).toBeInTheDocument();
  });

  it("ignores touch drags for a VIEWER", () => {
    render(
      <ThemeProvider>
        <BoardBackgroundProvider>
          <BoardGlassProvider>
            <I18nProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={["/board/b-table-touch"]}>
                  <ToastProvider>
                    <BoardProvider>
                      <TableView onCardClick={() => {}} readOnly />
                      <ColumnProbe cardId="card-a" />
                    </BoardProvider>
                  </ToastProvider>
                </MemoryRouter>
              </TooltipProvider>
            </I18nProvider>
          </BoardGlassProvider>
        </BoardBackgroundProvider>
      </ThemeProvider>,
    );
    const source = rowByTitle("Alpha");
    const target = rowByTitle("Gamma");
    expect(within(source).queryByTestId("table-row-menu")).toBeNull();
    longPress(source);
    elementFromPoint.mockReturnValue(target);
    moveTo(target);
    expect(screen.getByTestId("column-card-a")).toHaveTextContent("col-1");

    // Without touch drag the wrapper's Base UI long-press still opens the
    // card context menu for a VIEWER.
    fireEvent.touchStart(source, {
      touches: [{ identifier: 1, clientX: 10, clientY: 10 }],
    });
    act(() => vi.advanceTimersByTime(550));
    expect(screen.getByTestId("card-context-menu")).toBeInTheDocument();
    fireEvent.touchEnd(source, { touches: [] });
  });
});
