import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";

import { GlobalSearch } from "@/components/GlobalSearch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";

/**
 * Global search totals while background board hydration is still streaming
 * (TASK-177.10 review). `pendingBoardCount` is mocked because the real
 * provider only produces it in server mode with slow aggregates.
 */

const boardState = vi.hoisted(() => ({
  boards: [] as Board[],
  pendingBoardCount: 0,
}));

vi.mock("@/store/BoardContext", () => ({
  useBoard: () => boardState,
}));

function widgetBoard(): Board {
  const ids = Array.from({ length: 21 }, (_, index) => `c-${index}`);
  return {
    id: "b-widget",
    title: "Widget",
    columns: [{ id: "col", title: "To do", cardIds: ids, createdAt: 1 }],
    cards: Object.fromEntries(
      ids.map((id, index) => [
        id,
        {
          id,
          title: `Widget ${index}`,
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ),
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function searchUi() {
  return (
    <I18nProvider>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/board/b-widget"]}>
          <GlobalSearch />
        </MemoryRouter>
      </TooltipProvider>
    </I18nProvider>
  );
}

async function search(query: string) {
  fireEvent.click(screen.getByRole("button", { name: "Global search" }));
  const input = await screen.findByTestId("global-search-input");
  await userEvent.type(input, query);
  await waitFor(
    () => {
      expect(screen.queryAllByRole("option").length).toBeGreaterThan(0);
    },
    { timeout: 15_000 },
  );
}

describe("GlobalSearch hydration totals", () => {
  beforeEach(() => {
    localStorage.clear();
    boardState.boards = [widgetBoard()];
    boardState.pendingBoardCount = 2;
  });

  it("marks capped totals as loaded until hydration settles", async () => {
    const view = render(searchUi());
    await search("Widget");

    expect(screen.getByTestId("search-boards-loading")).toBeInTheDocument();
    expect(screen.getByText("20 of 21 loaded")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Cards, 20 of 21 loaded" }),
    ).toBeInTheDocument();

    boardState.pendingBoardCount = 0;
    view.rerender(searchUi());

    await waitFor(() =>
      expect(screen.getByText("20 of 21")).toBeInTheDocument(),
    );
    expect(screen.queryByText("20 of 21 loaded")).not.toBeInTheDocument();
    expect(screen.queryByTestId("search-boards-loading")).toBeNull();
  });
});
