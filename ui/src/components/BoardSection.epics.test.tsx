import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it } from "vitest";
import type { Board } from "@janosik/shared";

import { BoardSection } from "@/components/BoardSection";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider, useBoard } from "@/store/BoardContext";

function BoardProbe() {
  const { board, undo } = useBoard();
  return (
    <>
      <output data-testid="board-probe">{JSON.stringify(board)}</output>
      <button type="button" onClick={undo}>
        Undo command
      </button>
    </>
  );
}

function mountedBoard() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/board/epic-board"]}>
            <BoardProvider>
              <BoardBackgroundProvider>
                <BoardGlassProvider>
                  <BoardSection />
                  <BoardProbe />
                </BoardGlassProvider>
              </BoardBackgroundProvider>
            </BoardProvider>
          </MemoryRouter>
        </TooltipProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

function snapshot(): Board {
  return JSON.parse(screen.getByTestId("board-probe").textContent ?? "null");
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "epic-board",
        title: "Epic board",
        columns: [
          {
            id: "backlog",
            title: "Backlog",
            cardIds: ["child", "flat", "loose"],
            createdAt: 1,
          },
          { id: "done", title: "Done", cardIds: ["shipped"], createdAt: 1 },
        ],
        cards: {
          child: {
            id: "child",
            title: "Find me",
            epicId: "active",
            labelIds: ["blue"],
            createdAt: 1,
            updatedAt: 1,
          },
          flat: {
            id: "flat",
            title: "Open from completed",
            epicId: "complete",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
          loose: {
            id: "loose",
            title: "Ordinary",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
          shipped: {
            id: "shipped",
            title: "Shipped",
            epicId: "active",
            labelIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
        labels: [{ id: "blue", color: "blue", name: "Checkout" }],
        epics: [
          {
            id: "active",
            title: "Active epic",
            color: "rose",
            status: "active",
            position: 0,
            dueDate: new Date(2026, 11, 12, 12).getTime(),
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "complete",
            title: "Finished epic",
            color: "rose",
            status: "completed",
            position: 1,
            completedAt: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
});

it("navigates and selects the visible card projection and allows a completed child to open", () => {
  const { container } = mountedBoard();
  expect(screen.queryByText("Find me")).not.toBeInTheDocument();
  const tile = screen.getByRole("button", {
    name: /Active epic.*1 open/i,
  });
  expect(tile).toHaveAccessibleDescription("1 of 2 done");
  expect(tile).toHaveTextContent("Checkout");
  expect(tile).toHaveTextContent("Due Dec 12");
  expect(screen.getByTestId("backlog-other")).toHaveTextContent(
    "Other cards 2",
  );

  fireEvent.keyDown(window, { key: "j", code: "KeyJ" });
  expect(
    container.querySelector('[data-card-cursor="true"]'),
  ).toHaveTextContent("Open from completed");
  fireEvent.keyDown(window, { key: "a", ctrlKey: true });
  expect(
    screen
      .getAllByTestId("card-title")
      .filter((title) => title.closest('[data-card-selected="true"]'))
      .map((title) => title.textContent),
  ).toEqual(["Open from completed", "Ordinary", "Shipped"]);

  fireEvent.click(tile);
  expect(screen.getByText("Find me").closest("li")).toHaveAttribute(
    "data-epic-child",
    "active",
  );
  fireEvent.keyDown(window, { key: "k", code: "KeyK" });
  expect(
    container.querySelector('[data-card-cursor="true"]'),
  ).toHaveTextContent("Find me");

  const fold = screen.getByRole("button", { name: "Completed 1" });
  expect(fold).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(fold);
  expect(screen.getByText("Finished epic")).toBeVisible();
  expect(
    within(
      screen.getByText("Open from completed").closest("article")!,
    ).getByTestId("card-epic-chip"),
  ).toHaveTextContent("EP-2");
});

it("force-expands search matches and restores the stored collapse state when cleared", async () => {
  const user = userEvent.setup();
  mountedBoard();
  const query = screen.getByTestId("filter-search-input");
  await user.type(query, "Find me");
  expect(await screen.findByText("Find me")).toBeVisible();
  expect(
    screen.getByRole("button", { name: /^EPIC\s*EP-1\s*Active epic/i }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(screen.queryByText("Ordinary")).not.toBeInTheDocument();
  await user.clear(query);
  expect(
    await screen.findByRole("button", { name: /^EPIC\s*EP-1\s*Active epic/i }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("Find me")).not.toBeInTheDocument();
});

it("adds an epic child optimistically and undo removes the entire add", async () => {
  const user = userEvent.setup();
  mountedBoard();
  await user.click(
    screen.getByRole("button", { name: /^EPIC\s*EP-1\s*Active epic/i }),
  );
  await user.click(screen.getByRole("button", { name: "Add subtask" }));
  const editor = screen.getByRole("textbox", {
    name: "New subtask for Active epic",
  });
  await user.type(editor, "One command{Enter}");
  const stored = snapshot();
  const added = Object.values(stored.cards).find(
    ({ title }) => title === "One command",
  );
  expect(added?.epicId).toBe("active");
  expect(stored.columns[0].cardIds).toContain(added?.id);
  expect(screen.getByText("One command").closest("li")).toHaveAttribute(
    "data-epic-child",
    "active",
  );
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Undo command" }));
  expect(
    Object.values(snapshot().cards).some(
      ({ title }) => title === "One command",
    ),
  ).toBe(false);
});
