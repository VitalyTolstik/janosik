import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function renderSearch(initialUrl = routes.board("b-1")) {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[initialUrl]}>
                <BoardProvider>
                  <GlobalSearch />
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
    { timeout: 1500 },
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

  it("handles Ctrl+K only in the palette, not the board filter (B-7)", async () => {
    renderSearch();
    const filterInput = screen.getByLabelText("Search cards", {
      selector: "input",
    });
    const filterFocus = vi.spyOn(filterInput, "focus");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    // The palette opens…
    expect(
      await screen.findByTestId("global-search-input"),
    ).toBeInTheDocument();
    // …and the board filter never reacted to the shortcut.
    expect(filterFocus).not.toHaveBeenCalled();
  });
});
