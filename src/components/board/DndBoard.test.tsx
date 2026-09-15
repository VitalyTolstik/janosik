import { act, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { DndBoard } from "@/components/board/DndBoard";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider, useBoard } from "@/store/BoardContext";

/**
 * DndBoard orchestration (finding T-6): the real `handleDragStart/Over/End`
 * callbacks are captured off the rendered `DndContext` and driven directly —
 * `PointerSensor`/`KeyboardSensor` still mount, but the pointer geometry is
 * supplied by the test. Covers cross-column drops (including an EMPTY
 * column, the B-6 regression) and column reordering.
 */

const dnd = vi.hoisted(() => ({
  handlers: {} as {
    onDragStart?: (event: DragStartEvent) => void;
    onDragOver?: (event: DragOverEvent) => void;
    onDragEnd?: (event: DragEndEvent) => void;
  },
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => {
      dnd.handlers = {
        onDragStart: props.onDragStart,
        onDragOver: props.onDragOver,
        onDragEnd: props.onDragEnd,
      };
      return <actual.DndContext {...props} />;
    },
  };
});

function startDrag(id: string, type: "card" | "column") {
  act(() =>
    dnd.handlers.onDragStart?.({
      active: { id, data: { current: { type } } },
    } as unknown as DragStartEvent),
  );
}

function dragOver(activeId: string, overId: string) {
  act(() =>
    dnd.handlers.onDragOver?.({
      active: { id: activeId, rect: { current: { translated: null } } },
      over: { id: overId, rect: { top: 0, height: 10 } },
    } as unknown as DragOverEvent),
  );
}

function drop(activeId: string, overId: string) {
  act(() =>
    dnd.handlers.onDragEnd?.({
      active: { id: activeId, rect: { current: { translated: null } } },
      over: { id: overId, rect: { top: 0, height: 10 } },
    } as unknown as DragEndEvent),
  );
}

function seedBoard() {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "b-1",
        title: "DnD",
        columns: [
          {
            id: "col-1",
            title: "To do",
            cardIds: ["card-1", "card-2"],
            createdAt: 1,
          },
          { id: "col-2", title: "Doing", cardIds: ["card-3"], createdAt: 2 },
          { id: "col-3", title: "Empty", cardIds: [], createdAt: 3 },
        ],
        cards: Object.fromEntries(
          ["card-1", "card-2", "card-3"].map((id) => [
            id,
            {
              id,
              title: id,
              labelIds: [],
              createdAt: 1,
              updatedAt: 1,
            },
          ]),
        ),
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

function BoardProbe() {
  const { board } = useBoard();
  const snapshot = board
    ? {
        columnOrder: board.columns.map((col) => col.id),
        cardIds: Object.fromEntries(
          board.columns.map((col) => [col.id, col.cardIds]),
        ),
      }
    : null;
  return <pre data-testid="board-probe">{JSON.stringify(snapshot)}</pre>;
}

function renderBoard() {
  render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-1"]}>
                <ToastProvider>
                  <BoardProvider>
                    <DndBoard onCardClick={() => {}} />
                    <BoardProbe />
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

function snapshot() {
  return JSON.parse(
    screen.getByTestId("board-probe").textContent ?? "null",
  ) as {
    columnOrder: string[];
    cardIds: Record<string, string[]>;
  };
}

describe("DndBoard drag orchestration (T-6)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
    dnd.handlers = {};
  });

  it("moves a card into another column", () => {
    renderBoard();
    startDrag("card-1", "card");
    dragOver("card-1", "card-3");
    drop("card-1", "card-3");

    const state = snapshot();
    expect(state.cardIds["col-1"]).toEqual(["card-2"]);
    expect(state.cardIds["col-2"]).toContain("card-1");
  });

  it("moves a card into an EMPTY column when dropping on the column body (B-6)", () => {
    renderBoard();
    startDrag("card-1", "card");
    // No dragOver geometry trickery: a fast drop reports the column itself.
    dragOver("card-1", "col-3");
    drop("card-1", "col-3");

    const state = snapshot();
    expect(state.cardIds["col-1"]).toEqual(["card-2"]);
    expect(state.cardIds["col-3"]).toEqual(["card-1"]);
  });

  it("reorders columns by dragging a column header", () => {
    renderBoard();
    startDrag("col-1", "column");
    dragOver("col-1", "col-2");
    drop("col-1", "col-2");

    expect(snapshot().columnOrder).toEqual(["col-2", "col-1", "col-3"]);
  });
});
