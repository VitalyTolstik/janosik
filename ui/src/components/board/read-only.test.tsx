import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";
import { CardDialog } from "@/components/board/CardDialog";
import { CalendarView } from "@/components/board/CalendarView";
import { DndBoard } from "@/components/board/DndBoard";
import { TableView } from "@/components/board/TableView";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

vi.mock("@/components/editor/DescriptionEditor", () => ({
  DescriptionEditor: ({
    value,
    readOnly,
  }: {
    value: string;
    readOnly?: boolean;
  }) => (
    <textarea
      aria-label="Description"
      data-testid="description-editor"
      readOnly={readOnly}
      defaultValue={value}
    />
  ),
}));

/**
 * VIEWER read-only UI (TASK-35). The server answers 403 to every command,
 * so the UI must not offer the action at all: no drag, no composers, no
 * menus, no inline editors, no destructive footer.
 */

const dnd = vi.hoisted(() => ({ sensors: [] as unknown[] }));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => {
      dnd.sensors = props.sensors ?? [];
      return <actual.DndContext {...props} />;
    },
  };
});

const DUE = Date.UTC(2026, 9, 1, 12, 0);

const SAMPLE_BOARD: Board = {
  id: "b-1",
  title: "Read only",
  columns: [{ id: "col-1", title: "To do", cardIds: ["card-1"], createdAt: 1 }],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Careful card",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
      dueDate: DUE,
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
              <MemoryRouter initialEntries={["/board/b-1"]}>
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

describe("VIEWER read-only UI (TASK-35)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("janosik-boards", JSON.stringify([SAMPLE_BOARD]));
    dnd.sensors = [];
  });

  it("DndBoard: mounts no sensors and hides composers/column controls", () => {
    const { container } = render(
      tree(<DndBoard readOnly onCardClick={() => {}} />),
    );

    expect(dnd.sensors).toEqual([]);
    expect(container.querySelector("[data-composer-trigger]")).toBeNull();
    expect(container.querySelector("[data-add-column-trigger]")).toBeNull();
    // Content stays visible and clickable for reading.
    expect(screen.getByText("Careful card")).toBeInTheDocument();
  });

  it("DndBoard: keeps the full sensor trio without readOnly (control)", () => {
    render(tree(<DndBoard onCardClick={() => {}} />));

    expect(dnd.sensors).toHaveLength(3);
  });

  it("CardDialog: static fields, no duplicate/archive/delete", async () => {
    render(
      tree(
        <CardDialog cardId="card-1" open readOnly onOpenChange={() => {}} />,
      ),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByDisplayValue("Careful card")).toHaveAttribute(
      "readonly",
    );
    expect(within(dialog).getByTestId("description-editor")).toHaveAttribute(
      "readonly",
    );
    expect(
      within(dialog).queryByRole("button", { name: /duplicate/i }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: /archive/i }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: /delete/i }),
    ).toBeNull();
    expect(within(dialog).queryByTestId("due-date-trigger")).toBeNull();
    expect(within(dialog).queryByTestId("cover-trigger")).toBeNull();
    // Reading is still possible: the Close button is there.
    expect(
      within(dialog).getAllByRole("button", { name: /close/i }).length,
    ).toBeGreaterThan(0);
  });

  it("TableView: no add card, no inline editors, no archive/move menus", () => {
    render(tree(<TableView readOnly onCardClick={() => {}} />));

    expect(screen.queryByTestId("table-add-card")).toBeNull();
    expect(screen.queryByTestId("table-column-cell")).toBeNull();
    expect(screen.queryByTestId("table-archive-btn")).toBeNull();
    expect(screen.queryByTestId("table-archive-card")).toBeNull();
    expect(screen.queryByTestId("table-due-cell")).toBeNull();

    fireEvent.doubleClick(screen.getByText("Careful card"));
    expect(screen.queryByTestId("table-title-input")).toBeNull();
  });

  it("CalendarView: no add buttons, no composer, no draggable chips", () => {
    render(tree(<CalendarView readOnly onCardClick={() => {}} />));

    expect(screen.queryByTestId("day-add")).toBeNull();
    expect(
      within(screen.getByTestId("unscheduled-list")).queryByRole("textbox"),
    ).toBeNull();

    for (const chip of screen.getAllByTestId("calendar-chip")) {
      expect(chip.getAttribute("draggable")).not.toBe("true");
    }
  });

  it("CalendarView: own sensors/drag stay on by default (control)", () => {
    render(tree(<CalendarView onCardClick={() => {}} />));

    for (const chip of screen.getAllByTestId("calendar-chip")) {
      expect(chip.getAttribute("draggable")).toBe("true");
    }
    expect(screen.getAllByTestId("day-add").length).toBeGreaterThan(0);
  });
});
