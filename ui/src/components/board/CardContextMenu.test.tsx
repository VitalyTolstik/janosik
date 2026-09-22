import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

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
import type { Board } from "@janosik/shared";

/**
 * The card context menu (right-click / mouse button 2) on every surface:
 * the board face, the calendar (chip + unscheduled row) and the table row.
 * The menu reuses the dialog's own editors, so the tests exercise the
 * dispatching paths: labels, priority, due date, links, checklist.
 */

/** Two days out — always inside the calendar's visible month grid. */
const DUE = Date.now() + 2 * 24 * 60 * 60 * 1000;

const BOARD: Board = {
  id: "b-ctx",
  title: "Context",
  columns: [
    { id: "col-1", title: "To do", cardIds: ["c-1", "c-2"], createdAt: 1 },
  ],
  cards: {
    "c-1": {
      id: "c-1",
      title: "Alpha card",
      labelIds: ["lb-red"],
      createdAt: 1,
      updatedAt: 1,
      dueDate: DUE,
    },
    "c-2": {
      id: "c-2",
      title: "Beta card",
      labelIds: [],
      createdAt: 2,
      updatedAt: 2,
    },
  },
  labels: [
    { id: "lb-red", name: "Red tape", color: "red" },
    { id: "lb-blue", name: "Blue sky", color: "blue" },
  ],
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
              <MemoryRouter initialEntries={["/board/b-ctx"]}>
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

function rightClick(el: Element) {
  fireEvent.contextMenu(el, { button: 2, clientX: 16, clientY: 16 });
}

async function openMenuOnBoard() {
  render(tree(<DndBoard onCardClick={() => {}} />));
  rightClick(screen.getAllByTestId("card-title")[0]!);
  const menu = await screen.findByTestId("card-context-menu");
  return menu;
}

async function openSub(trigger: string, content: string) {
  fireEvent.click(screen.getByTestId(trigger));
  return await screen.findByTestId(content);
}

describe("card context menu (right-click)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("janosik-boards", JSON.stringify([BOARD]));
  });

  it("opens from the board card face and lists the card editors", async () => {
    await openMenuOnBoard();
    expect(screen.getByTestId("ctx-open")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-labels-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-due-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-priority-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-assignee-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-link-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-cover-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-checklist-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-comment-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-copy-link")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-duplicate")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-archive")).toBeInTheDocument();
  });

  it("toggles labels and creates a new one", async () => {
    await openMenuOnBoard();
    await openSub("ctx-labels-trigger", "ctx-labels-content");
    const blue = screen.getByTestId("ctx-label-lb-blue");
    expect(blue).toHaveAttribute("aria-checked", "false");
    fireEvent.click(blue);
    await waitFor(() =>
      expect(screen.getByTestId("ctx-label-lb-blue")).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    // Create a fresh label straight from the menu.
    fireEvent.change(screen.getByTestId("ctx-new-label-name"), {
      target: { value: "Urgent" },
    });
    fireEvent.click(screen.getByTestId("ctx-label-color-orange"));
    fireEvent.click(screen.getByTestId("ctx-label-create"));
    const menuContent = screen.getByTestId("ctx-labels-content");
    const createdRow = within(menuContent)
      .getByText("Urgent")
      .closest("[role='menuitemcheckbox']");
    expect(createdRow).toHaveAttribute("aria-checked", "true");
    // The created label is on the card straight away (chip on the face)
    // alongside the new menu row.
    expect(screen.getAllByText("Urgent").length).toBeGreaterThanOrEqual(2);
  });

  it("sets the priority from the radio submenu", async () => {
    await openMenuOnBoard();
    await openSub("ctx-priority-trigger", "ctx-priority-content");
    const high = screen.getByTestId("ctx-priority-high");
    expect(high).toHaveAttribute("aria-checked", "false");
    fireEvent.click(high);
    // The card front picks the badge up from the board store — sibling
    // cards render their (default medium) badges too.
    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("card-priority-badge")
          .some((badge) => badge.getAttribute("data-priority") === "high"),
      ).toBe(true);
    });
  });

  it("sets a due date from the calendar submenu", async () => {
    await openMenuOnBoard();
    await openSub("ctx-due-trigger", "ctx-due-content");
    // The calendar is React.lazy (TASK-19) — wait for the grid to mount.
    const grid = await screen.findByRole("grid", {}, { timeout: 5000 });
    // DayPicker's day buttons carry the day number as their text.
    const dayButton = within(grid)
      .getAllByRole("button")
      .find((button) => /^\d+$/.test(button.textContent ?? ""));
    expect(dayButton).toBeDefined();
    fireEvent.click(dayButton as HTMLElement);
    expect(await screen.findByTestId("card-due-badge")).toBeInTheDocument();
  });

  it("links another card through the search submenu", async () => {
    await openMenuOnBoard();
    await openSub("ctx-link-trigger", "ctx-link-content");
    fireEvent.change(screen.getByTestId("ctx-link-search"), {
      target: { value: "Beta" },
    });
    fireEvent.click(await screen.findByTestId("ctx-link-target-c-2"));
    // The linked-cards badge appears on both cards' faces (the link is
    // visible from either side).
    const badges = await screen.findAllByLabelText("1 link");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("adds a checklist, its items and ticks one", async () => {
    await openMenuOnBoard();
    await openSub("ctx-checklist-trigger", "ctx-checklist-content");
    const newInput = screen.getByTestId("ctx-checklist-new");
    fireEvent.change(newInput, { target: { value: "Ship it" } });
    fireEvent.keyDown(newInput, { key: "Enter" });
    expect(await screen.findByText("Ship it")).toBeInTheDocument();
    const itemInput = screen
      .getAllByTestId(/^ctx-checklist-add-item-/)
      .at(-1) as HTMLElement;
    fireEvent.change(itemInput, { target: { value: "Task one" } });
    fireEvent.keyDown(itemInput, { key: "Enter" });
    const item = await screen.findByText("Task one");
    const itemRow = item.closest("[role='menuitemcheckbox']");
    expect(itemRow).not.toBeNull();
    fireEvent.click(itemRow as HTMLElement);
    await waitFor(() =>
      expect(itemRow).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("keeps the comment send disabled while offline but the composer works", async () => {
    await openMenuOnBoard();
    await openSub("ctx-comment-trigger", "ctx-comment-content");
    const input = screen.getByTestId("ctx-comment-input");
    fireEvent.change(input, { target: { value: "Hello from the menu" } });
    expect(input).toHaveValue("Hello from the menu");
    expect(screen.getByTestId("ctx-comment-send")).toBeDisabled();
  });

  it("a viewer gets read-only actions only", async () => {
    render(tree(<DndBoard readOnly onCardClick={() => {}} />));
    rightClick(screen.getAllByTestId("card-title")[0]!);
    await screen.findByTestId("card-context-menu");
    expect(screen.getByTestId("ctx-open")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-copy-link")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-open-new-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ctx-labels-trigger")).toBeNull();
    expect(screen.queryByTestId("ctx-archive")).toBeNull();
  });

  it("opens from a table row", async () => {
    render(tree(<TableView onCardClick={() => {}} />));
    rightClick(
      screen
        .getAllByTestId("table-row")
        .find((row) => row.textContent?.includes("Beta card")) as Element,
    );
    expect(await screen.findByTestId("card-context-menu")).toBeInTheDocument();
    expect(screen.getByTestId("ctx-archive")).toBeInTheDocument();
  });

  it("opens from a calendar chip and an unscheduled row", async () => {
    render(tree(<CalendarView onCardClick={() => {}} />));
    // The scheduled chip on its date cell.
    rightClick(screen.getAllByTestId("calendar-chip")[0]!);
    expect(await screen.findByTestId("card-context-menu")).toBeInTheDocument();
    // The unscheduled row in the side list.
    const unscheduledRow = screen
      .getByTestId("unscheduled-list")
      .querySelector("button") as Element;
    rightClick(unscheduledRow);
    expect(await screen.findByTestId("card-context-menu")).toBeInTheDocument();
  });
});
