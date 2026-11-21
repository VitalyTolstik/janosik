import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/routes";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Global search (header): debounced cross-board query, results grouped
 * Cards → Boards with highlighted matches, archived boards ranked last,
 * and a card click opening the board with the card dialog (?card=).
 */

function boardJson(
  id: string,
  title: string,
  cards: Array<{ id: string; title: string; description?: string }>,
) {
  return JSON.stringify({
    id,
    title,
    columns: [
      {
        id: `${id}-col`,
        title: "To do",
        cardIds: cards.map((c) => c.id),
        createdAt: 1,
      },
    ],
    cards: Object.fromEntries(
      cards.map((c) => [
        c.id,
        {
          id: c.id,
          title: c.title,
          ...(c.description ? { description: c.description } : {}),
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ),
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    ...(title.startsWith("Old") ? { archivedAt: 2 } : {}),
  });
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return (
    <div data-testid="loc">
      {pathname}
      {search}
    </div>
  );
}

function renderSearch(
  initialUrl = routes.board("b-1"),
  { iconOnly = false }: { iconOnly?: boolean } = {},
) {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[initialUrl]}>
                <BoardProvider>
                  <GlobalSearch iconOnly={iconOnly} />
                  <LocationProbe />
                  <Routes>
                    <Route path={routes.home} element={<div>home</div>} />
                    <Route
                      path={routes.boardPattern}
                      element={<BoardSection />}
                    />
                  </Routes>
                </BoardProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

async function search(query: string) {
  fireEvent.click(
    screen.getByRole("button", { name: "Search cards and boards" }),
  );
  const input = await screen.findByTestId("global-search-input");
  await userEvent.type(input, query);
  // Debounce (200 ms) — wait for the first result row.
  await waitFor(
    () => {
      expect(screen.queryAllByRole("option").length).toBeGreaterThan(0);
    },
    // Lazy palette chunks plus the 200 ms debounce can exceed old, tight
    // waits under a parallel coverage run — see the calendar specs.
    { timeout: 15_000 },
  );
  return screen.getAllByRole("option");
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "janosik-boards",
      `[${boardJson("b-1", "Alpha", [
        { id: "c-1", title: "Landing redesign", description: "hero mockups" },
        { id: "c-2", title: "Newsletter", description: "q3 plan notes" },
      ])},${boardJson("b-2", "Old stuff", [
        { id: "c-3", title: "Retro notes" },
      ])}]`,
    );
  });

  it("keeps the icon-only header trigger at 32x32", () => {
    renderSearch(routes.board("b-1"), { iconOnly: true });
    const trigger = screen.getByRole("button", {
      name: "Search cards and boards",
    });
    expect(trigger.className).toContain("w-8");
    expect(trigger.className).toContain("!px-0");
    expect(trigger.className).toContain("justify-center");
    expect(trigger.className).not.toContain("pr-2.5");
  });

  it("keeps the labeled trigger wider than the icon-only one", () => {
    renderSearch();
    const trigger = screen.getByRole("button", {
      name: "Search cards and boards",
    });
    expect(trigger.className).toContain("pr-2.5");
    expect(trigger.className).not.toContain("!px-0");
  });

  it("finds a card by description and highlights the match", async () => {
    renderSearch();
    const hits = await search("mockups");
    const hit = hits[0];
    expect(hit).toHaveTextContent("Landing redesign");
    expect(hit).toHaveTextContent("Alpha › To do");
    // Snippet with the highlighted match, not the whole description.
    expect(hit).toHaveTextContent("mockups");
  });

  it("ranks archived boards last and tags them", async () => {
    renderSearch();
    const hits = await search("retro");
    const hit = hits[0];
    expect(hit).toHaveTextContent("Retro notes");
    expect(hit).toHaveTextContent("Archived");
  });

  it("opens the card dialog on click (navigates with ?card=)", async () => {
    renderSearch();
    await search("newsletter");
    fireEvent.click(screen.getByRole("option"));
    await waitFor(() => {
      expect(screen.getByTestId("loc")).toHaveTextContent(
        "/board/b-1?card=c-2",
      );
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("finds boards by title in the Boards section", async () => {
    renderSearch();
    await search("alpha");
    // Card hits first (none match), then the board hit.
    const results = screen.getByTestId("global-search-results");
    expect(results).toHaveTextContent("Boards");
    expect(results).toHaveTextContent("Alpha");
  });

  it("keeps a board hit above the card cap and expands every group", async () => {
    const cards = Array.from({ length: 21 }, (_, index) => ({
      id: `c-cap-${index}`,
      title: `Widget ${String(index).padStart(2, "0")}`,
    }));
    localStorage.setItem(
      "janosik-boards",
      `[${boardJson("b-cap", "Project", cards)},${boardJson(
        "b-widget",
        "Widget",
        [],
      )}]`,
    );

    renderSearch();
    const options = await search("Widget");

    // 20 cards + the board hit — the board is not hidden by the card cap.
    expect(options).toHaveLength(21);
    const results = screen.getByTestId("global-search-results");
    const cardsGroup = within(results).getByRole("group", { name: "Cards" });
    expect(within(cardsGroup).getAllByRole("option")).toHaveLength(20);
    expect(results).toHaveTextContent("20 of 21");
    expect(
      within(results).getByRole("group", { name: "Boards" }),
    ).toHaveTextContent("Widget");

    fireEvent.click(screen.getByRole("button", { name: "Show all results" }));

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(22));
    expect(screen.queryByText("20 of 21")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show all results" }),
    ).toBeNull();
  });

  it("links the combobox to its selected option and resets on no matches", async () => {
    renderSearch();
    await search("newsletter");
    const input = screen.getByRole("combobox", {
      name: "Search cards and boards",
    });
    const listbox = screen.getByRole("listbox");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(input).toHaveAttribute("aria-expanded", "true");
    const option = screen.getByRole("option", { selected: true });
    expect(input).toHaveAttribute("aria-activedescendant", option.id);
    expect(listbox).toContainElement(option);
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "a query with no matches" } });
    await waitFor(() =>
      expect(input).toHaveAttribute("aria-expanded", "false"),
    );
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("handles Ctrl+K only in the palette, not the board filter (B-7)", async () => {
    renderSearch();
    const filterInput = screen.getByLabelText("Search cards", {
      selector: "input",
    });
    const filterFocus = vi.spyOn(filterInput, "focus");

    fireEvent.keyDown(window, { key: "л", code: "KeyK", ctrlKey: true });

    // The palette opens…
    expect(
      await screen.findByTestId("global-search-input"),
    ).toBeInTheDocument();
    // …and the board filter never reacted to the shortcut.
    expect(filterFocus).not.toHaveBeenCalled();
  });
});
