import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { routes } from "@/routes";
import { BoardProvider } from "@/store/BoardContext";
import { EMPTY_FILTER } from "@/utils/filter";
import { loadSavedViews, saveSavedViews } from "@/utils/saved-views";

const BOARD_A = "board-a";
const BOARD_B = "board-b";

function boardJson(
  id: string,
  title: string,
  cardTitle: string,
): Record<string, unknown> {
  return {
    id,
    title,
    columns: [
      {
        id: `${id}-todo`,
        title: "To Do",
        cardIds: [`${id}-card-1`, `${id}-card-2`],
        createdAt: 1,
      },
    ],
    cards: {
      [`${id}-card-1`]: {
        id: `${id}-card-1`,
        title: cardTitle,
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      [`${id}-card-2`]: {
        id: `${id}-card-2`,
        title: `${cardTitle} 2`,
        labelIds: [],
        createdAt: 2,
        updatedAt: 2,
      },
    },
    labels: [{ id: "l-bug", name: "Bug", color: "red" }],
    createdAt: 1,
    updatedAt: 1,
  };
}

function seedBoards(): void {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      boardJson(BOARD_A, "Alpha", "Alpha card"),
      boardJson(BOARD_B, "Beta", "Beta card"),
    ]),
  );
}

function RouteProbe() {
  const location = useLocation();
  return <span data-testid="route-probe">{location.search}</span>;
}

function BoardSwitchProbe() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="switch-board"
      onClick={() => navigate(routes.board(BOARD_B))}
    >
      switch
    </button>
  );
}

function renderBoard(initialRoute = `/board/${BOARD_A}`) {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <ToastProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={[initialRoute]}>
                  <BoardProvider>
                    <BoardSection />
                    <RouteProbe />
                    <BoardSwitchProbe />
                  </BoardProvider>
                </MemoryRouter>
              </TooltipProvider>
            </ToastProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

async function openSavedViews() {
  fireEvent.click(await screen.findByTestId("saved-views-menu"));
  return screen.findByRole("dialog", { name: "Saved views" });
}

function applySavedView(name: string) {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`Apply view.*${name}`) }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("BoardSection saved views integration", () => {
  it("mounts the menu beside FilterBar", async () => {
    seedBoards();
    renderBoard();

    const toolbar = screen.getByTestId("board-toolbar");
    const filterBar = within(toolbar).getByTestId("filter-bar");
    const menu = await within(toolbar).findByTestId("saved-views-menu");
    expect(filterBar).toBeInTheDocument();
    expect(menu).toBeInTheDocument();
    expect([
      ...toolbar.querySelectorAll(
        '[data-testid="filter-bar"], [data-testid="saved-views-menu"]',
      ),
    ]).toEqual([filterBar, menu]);
  });

  it("applies filter and view, writes the URL and closes the menu", async () => {
    seedBoards();
    saveSavedViews("local", BOARD_A, [
      {
        name: "Urgent",
        filter: { ...EMPTY_FILTER, due: "overdue" },
        view: "table",
      },
    ]);
    renderBoard();
    await openSavedViews();

    applySavedView("Urgent");

    await waitFor(() =>
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "f.due=overdue",
      ),
    );
    await waitFor(() =>
      expect(localStorage.getItem("janosik-board-view")).toBe("table"),
    );
    await screen.findByRole("table", {}, { timeout: 15_000 });
    expect(
      screen.queryByRole("dialog", { name: "Saved views" }),
    ).not.toBeInTheDocument();
  });

  it("preserves ?card= and unrelated params when applying", async () => {
    seedBoards();
    saveSavedViews("local", BOARD_A, [
      {
        name: "Urgent",
        filter: { ...EMPTY_FILTER, due: "overdue" },
        view: "table",
      },
    ]);
    // A live card deep link opens the card dialog, which covers the toolbar in
    // a real session; fire the menu through the DOM to exercise the URL write
    // (the serializer must keep `card` when a filter is applied next to it).
    renderBoard(`/board/${BOARD_A}?card=${BOARD_A}-card-1&keep=1`);
    await screen.findByRole("dialog");
    fireEvent.click(await screen.findByTestId("saved-views-menu"));
    const apply = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(
        "[data-saved-view-apply]",
      );
      if (button === null) throw new Error("saved view not rendered");
      return button;
    });
    fireEvent.click(apply);

    await waitFor(() => {
      const search = screen.getByTestId("route-probe").textContent ?? "";
      expect(search).toContain(`card=${BOARD_A}-card-1`);
      expect(search).toContain("keep=1");
      expect(search).toContain("f.due=overdue");
    });
  });

  it("does not auto-restore a saved view on load", async () => {
    seedBoards();
    saveSavedViews("local", BOARD_A, [
      {
        name: "Urgent",
        filter: { ...EMPTY_FILTER, due: "overdue" },
      },
    ]);
    renderBoard();
    await screen.findByTestId("saved-views-menu");

    expect(screen.getByTestId("route-probe")).toHaveTextContent(/^$/);
  });

  it("isolates views per board and re-peeks the trigger count", async () => {
    seedBoards();
    saveSavedViews("local", BOARD_A, [
      { name: "A one", filter: { ...EMPTY_FILTER, query: "one" } },
      { name: "A two", filter: { ...EMPTY_FILTER, query: "two" } },
    ]);
    saveSavedViews("local", BOARD_B, [
      { name: "B one", filter: { ...EMPTY_FILTER, query: "beta" } },
    ]);
    renderBoard();

    expect(await screen.findByTestId("saved-views-menu")).toHaveAttribute(
      "aria-label",
      "Saved views (2)",
    );
    await openSavedViews();
    expect(
      screen.getByRole("button", { name: /Apply view.*A one/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("B one")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByTestId("switch-board"));
    await screen.findByText("Beta card");
    expect(screen.getByTestId("saved-views-menu")).toHaveAttribute(
      "aria-label",
      "Saved views (1)",
    );
    await openSavedViews();
    expect(
      screen.getByRole("button", { name: /Apply view.*B one/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("A one")).not.toBeInTheDocument();
  });

  it("does not prune assignees while the roster is not loaded", async () => {
    seedBoards();
    saveSavedViews("local", BOARD_A, [
      {
        name: "Mine",
        filter: { ...EMPTY_FILTER, assignees: ["u-1"] },
        view: "table",
      },
    ]);
    renderBoard();
    await openSavedViews();

    applySavedView("Mine");

    await waitFor(() =>
      expect(screen.getByTestId("route-probe")).toHaveTextContent(
        "f.assignee=u-1",
      ),
    );
    // The roster failed/never loaded: the preserved chip keeps the filter
    // value but names it for a human instead of showing the raw uuid.
    const assigneeChip = document.querySelector(
      '[data-testid="filter-chip"][data-facet="assignee"]',
    );
    expect(assigneeChip).toHaveTextContent("Unknown user");
    expect(assigneeChip).not.toHaveTextContent("u-1");
    await screen.findByRole("table", {}, { timeout: 15_000 });
    expect(loadSavedViews("local", BOARD_A).views[0].filter.assignees).toEqual([
      "u-1",
    ]);
    expect(screen.queryByText(/no longer exist/)).not.toBeInTheDocument();
  });

  it("keeps a 390px static flex layout with a 44px menu target", async () => {
    seedBoards();
    renderBoard();

    const toolbar = screen.getByTestId("board-toolbar");
    expect(toolbar).toHaveClass(
      "flex",
      "min-w-0",
      "flex-wrap",
      "items-center",
      "gap-2",
    );
    expect(screen.getByTestId("filter-search-region")).toHaveClass("contents");
    expect(screen.getByTestId("filter-bar")).toHaveClass("contents");
    expect(await screen.findByTestId("saved-views-menu")).toHaveClass(
      "h-9",
      "w-9",
      "max-lg:h-11",
      "max-lg:w-11",
    );
  });

  it("keeps bulk selection working alongside the menu", async () => {
    seedBoards();
    renderBoard();

    fireEvent.click(screen.getByTestId("bulk-select-toggle"));
    const checkbox = await screen.findAllByTestId("card-select");
    fireEvent.click(checkbox[0]);

    await waitFor(() =>
      expect(screen.getByTestId("bulk-select-count")).toHaveTextContent("1"),
    );
    expect(await screen.findByTestId("saved-views-menu")).toBeInTheDocument();
  });
});
