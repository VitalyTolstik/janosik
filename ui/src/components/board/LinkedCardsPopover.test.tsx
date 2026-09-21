import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { ToastProvider } from "@/components/Toast";
import { routes } from "@/routes";

/**
 * The linked-cards popover behind the card-front badges: clicking the
 * "N links" count or the red "Blocked" badge opens the list of linked
 * cards (Jira's linked-issues widget) instead of opening the host card —
 * the badges are triggers, not bubbles. A row navigates to the linked
 * card through the `?card=` deep link.
 */

const ALPHA = {
  id: "c-a",
  title: "Alpha card",
  labelIds: [],
  createdAt: 1000,
  updatedAt: 1000,
  priority: "high" as const,
  links: [{ id: "lk-1", type: "blocks" as const, targetCardId: "c-b" }],
};

const BETA = {
  id: "c-b",
  title: "Beta card",
  labelIds: [],
  createdAt: 1001,
  updatedAt: 1001,
  assigneeId: "u-boris",
};

function seedBoard() {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "b-links",
        title: "Links",
        columns: [
          { id: "col-1", title: "To do", cardIds: ["c-a"], createdAt: 1 },
          { id: "col-2", title: "Doing", cardIds: ["c-b"], createdAt: 2 },
        ],
        cards: { "c-a": ALPHA, "c-b": BETA },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

function renderBoard() {
  render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[routes.board("b-links")]}>
                <ToastProvider>
                  <BoardProvider>
                    <Routes>
                      <Route
                        path={routes.boardPattern}
                        element={<BoardSection />}
                      />
                    </Routes>
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

describe("LinkedCardsPopover (card-front badges)", () => {
  it("opens the list from the link badge without opening the host card", async () => {
    seedBoard();
    renderBoard();
    const alpha = (await screen.findByText("Alpha card")).closest(
      "article",
    ) as HTMLElement;

    fireEvent.click(within(alpha).getByTestId("card-links-badge"));

    // The fix for the "random card" bug: the badge never opens the host
    // card's dialog — the popover opens instead (the card dialog owns a
    // "card-title-input"; the popover content is a Radix dialog too, so
    // the host check goes by the title field, not the role).
    const popover = await screen.findByTestId("card-links-popover");
    expect(screen.queryByDisplayValue("Alpha card")).toBeNull();

    // The row carries the linked card's data: title, its column (status),
    // priority, and the assignee's avatar.
    const row = within(popover).getByTestId("card-link-popover-row");
    expect(row).toHaveTextContent("Beta card");
    expect(within(row).getByText("Doing")).toBeDefined();
    // Beta has no priority — the row stays quiet about it (TASK-45 rules).
    expect(within(row).queryByTestId("card-priority-badge")).toBeNull();
    expect(within(row).getByTestId("user-avatar")).toBeDefined();
    // Grouped the way the relation reads from Alpha.
    expect(within(popover).getByText("blocks")).toBeDefined();
  });

  it("shows the linked card's priority when it deviates from the default", async () => {
    seedBoard();
    renderBoard();
    // Beta has no priority of its own; open the popover on Beta — the
    // blocker Alpha carries "high".
    fireEvent.click(screen.getByTestId("card-blocked-badge"));

    const popover = await screen.findByTestId("card-links-popover");
    const row = within(popover).getByTestId("card-link-popover-row");
    expect(row).toHaveTextContent("Alpha card");
    expect(within(row).getByTestId("card-priority-badge")).toHaveAttribute(
      "data-priority",
      "high",
    );
    expect(within(popover).getByText("is blocked by")).toBeDefined();
  });

  it("navigates to the linked card from a row and closes", async () => {
    seedBoard();
    renderBoard();
    const alpha = (await screen.findByText("Alpha card")).closest(
      "article",
    ) as HTMLElement;
    fireEvent.click(within(alpha).getByTestId("card-links-badge"));
    const popover = await screen.findByTestId("card-links-popover");

    fireEvent.click(within(popover).getByTestId("card-link-popover-row"));

    await waitFor(() => {
      // The dialog re-points to Beta (the title textarea carries the name).
      expect(screen.getByLabelText("Title")).toHaveValue("Beta card");
    });
    expect(screen.queryByTestId("card-links-popover")).toBeNull();
  });
});
