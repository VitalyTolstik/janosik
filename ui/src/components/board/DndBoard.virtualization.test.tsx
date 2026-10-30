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
import type { Board, Card } from "@janosik/shared";

/**
 * DnD against a windowed column (TASK-139): the target card is far outside
 * the mounted window, but `SortableContext` still holds every id, so the
 * drop resolves to the right index.
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

const PER_COLUMN = 150;

function board(): Board {
  const columnCards = (prefix: string) =>
    Array.from({ length: PER_COLUMN }, (_, i) => `${prefix}-${i}`);
  const cardIds = [...columnCards("a"), ...columnCards("b")];
  const cards = Object.fromEntries(
    cardIds.map((id) => [
      id,
      {
        id,
        title: id,
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      } satisfies Card,
    ]),
  );
  return {
    id: "b-dnd-virtual",
    title: "DnD virtual",
    columns: [
      { id: "col-a", title: "A", cardIds: columnCards("a"), createdAt: 1 },
      { id: "col-b", title: "B", cardIds: columnCards("b"), createdAt: 2 },
    ],
    cards,
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function BoardProbe() {
  const { board: state } = useBoard();
  return (
    <pre data-testid="board-probe">
      {JSON.stringify(
        state?.columns.map((column) => [column.id, column.cardIds]) ?? null,
      )}
    </pre>
  );
}

function renderBoard() {
  render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-dnd-virtual"]}>
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

function startDrag(id: string) {
  act(() =>
    dnd.handlers.onDragStart?.({
      active: { id, data: { current: { type: "card" } } },
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

describe("DnD into a windowed column (TASK-139)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("janosik-boards", JSON.stringify([board()]));
    dnd.handlers = {};
  });

  it("drops onto an off-window card by id", () => {
    renderBoard();
    expect(screen.getAllByTestId("card-title").length).toBeLessThan(
      PER_COLUMN * 2,
    );

    startDrag("a-0");
    dragOver("a-0", "b-149");
    drop("a-0", "b-149");

    const columns = JSON.parse(
      screen.getByTestId("board-probe").textContent ?? "null",
    ) as [string, string[]][];
    const byId = Object.fromEntries(columns);
    expect(byId["col-a"]).not.toContain("a-0");
    expect(byId["col-b"]).toContain("a-0");
  });
});
