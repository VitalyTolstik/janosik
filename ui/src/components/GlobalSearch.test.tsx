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
  fireEvent.click(screen.getByRole("button", { name: "Global search" }));
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
      name: "Global search",
    });
    expect(trigger.className).toContain("w-8");
    expect(trigger.className).toContain("!px-0");
    expect(trigger.className).toContain("justify-center");
    expect(trigger.className).not.toContain("pr-2.5");
  });

  it("keeps the labeled trigger wider than the icon-only one", () => {
    renderSearch();
    const trigger = screen.getByRole("button", {
      name: "Global search",
    });
    expect(trigger.className).toContain("pr-2.5");
    expect(trigger.className).not.toContain("!px-0");
  });

  it("selects a board in command mode with the keyboard", async () => {
    localStorage.setItem(
      "janosik-boards",
      `[${boardJson("b-1", "Alpha", [])},${boardJson("b-2", "Beta", [])},${boardJson("b-3", "Old stuff", [])}]`,
    );
    renderSearch();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Global search" });
    await user.click(trigger);
    const input = screen.getByRole("combobox");
    await user.type(input, "> navigate");
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeVisible();
    await user.keyboard("{Enter}");
    const list = screen.getByRole("listbox", { name: "Switch board" });
    const [alpha, beta] = within(list).getAllByRole("option");
    expect(within(list).getAllByRole("option")).toHaveLength(2);
    expect(input).toHaveAttribute("aria-activedescendant", alpha.id);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", beta.id);
    expect(beta).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", alpha.id);
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent("/board/b-2"),
    );
    expect(trigger).toHaveFocus();
  });

  it("shows a command empty state and returns to full-text search with Backspace", async () => {
    renderSearch();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Global search" }));
    const input = screen.getByRole("combobox");
    await user.type(input, ">x");
    expect(
      within(screen.getByTestId("global-search-results")).getByRole("status"),
    ).toHaveTextContent("No matching commands or options.");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    await user.keyboard("{Backspace}");
    expect(screen.getByRole("option", { name: "Switch board" })).toBeVisible();
    await user.keyboard("{Backspace}");
    expect(input).toHaveAccessibleName("Search cards and boards");
    await user.type(input, "mockups");
    expect(
      await screen.findByRole("option", { name: /Landing redesign/ }),
    ).toBeVisible();
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
    const cardsGroup = within(results).getByRole("group", {
      name: "Cards, 20 of 21",
    });
    expect(within(cardsGroup).getAllByRole("option")).toHaveLength(20);
    expect(results).toHaveTextContent("20 of 21");
    expect(screen.getByText("20 of 21")).toHaveAttribute("aria-live", "polite");
    expect(
      within(results).getByRole("group", { name: "Boards" }),
    ).toHaveTextContent("Widget");

    results.scrollTop = 120;
    fireEvent.click(screen.getByRole("button", { name: "Show all results" }));

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(22));
    expect(results.scrollTop).toBe(120);
    expect(screen.queryByText("20 of 21")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show all results" }),
    ).toBeNull();
  });

  it("keeps the board selected by identity when Show all expands cards", async () => {
    const cards = Array.from({ length: 21 }, (_, index) => ({
      id: `c-select-${index}`,
      title: `Widget ${String(index).padStart(2, "0")}`,
    }));
    localStorage.setItem(
      "janosik-boards",
      `[${boardJson("b-cards", "Project", cards)},${boardJson(
        "b-target",
        "Widget",
        [],
      )}]`,
    );

    renderSearch();
    await search("Widget");
    const input = screen.getByRole("combobox", {
      name: "Search cards and boards",
    });
    for (let index = 0; index < 20; index += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    const selected = screen.getByRole("option", { selected: true });
    expect(selected).toHaveTextContent("Widget");
    expect(within(selected).getByTestId("search-type-badge")).toHaveAttribute(
      "data-type",
      "board",
    );

    fireEvent.click(screen.getByRole("button", { name: "Show all results" }));

    // The board moved one row down, but the cursor stays on the same hit.
    const stillSelected = screen.getByRole("option", { selected: true });
    expect(stillSelected).toHaveTextContent("Widget");
    expect(
      within(stillSelected).getByTestId("search-type-badge"),
    ).toHaveAttribute("data-type", "board");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent("/board/b-target"),
    );
  });

  it("does not carry Show all across a debounced query change", async () => {
    const widgetCards = Array.from({ length: 21 }, (_, index) => ({
      id: `c-widget-${index}`,
      title: `Widget ${String(index).padStart(2, "0")}`,
    }));
    const gadgetCards = Array.from({ length: 21 }, (_, index) => ({
      id: `c-gadget-${index}`,
      title: `Gadget ${String(index).padStart(2, "0")}`,
    }));
    localStorage.setItem(
      "janosik-boards",
      `[${boardJson("b-widget-cards", "Project one", widgetCards)},${boardJson(
        "b-widget",
        "Widget",
        [],
      )},${boardJson("b-gadget-cards", "Project two", gadgetCards)},${boardJson(
        "b-gadget",
        "Gadget",
        [],
      )}]`,
    );

    renderSearch();
    await search("Widget");
    // 20 cards + the board, capped.
    expect(screen.getAllByRole("option")).toHaveLength(21);

    const input = screen.getByRole("combobox", {
      name: "Search cards and boards",
    });
    fireEvent.change(input, { target: { value: "Gadget" } });
    // Click while the old Widget results are still on screen but the debounce
    // for Gadget has not landed yet.
    fireEvent.click(screen.getByRole("button", { name: "Show all results" }));

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(21));
    expect(screen.getByText("20 of 21")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show all results" }),
    ).toBeInTheDocument();
  });

  it("bounds Show all at 200 per group and keeps its own counter", async () => {
    const cards = Array.from({ length: 205 }, (_, index) => ({
      id: `c-limit-${index}`,
      title: `Limit ${String(index).padStart(3, "0")}`,
    }));
    localStorage.setItem(
      "janosik-boards",
      `[${boardJson("b-limit", "Project", cards)}]`,
    );

    renderSearch();
    const options = await search("Limit");
    expect(options).toHaveLength(20);

    fireEvent.click(screen.getByRole("button", { name: "Show all results" }));

    await waitFor(() =>
      expect(screen.getAllByRole("option")).toHaveLength(200),
    );
    expect(screen.getByText("200 of 205")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show all results" }),
    ).toBeNull();
  });

  it("caps a boards-only result set and expands it", async () => {
    const boards = Array.from({ length: 21 }, (_, index) =>
      boardJson(
        `b-many-${index}`,
        `Board ${String(index).padStart(2, "0")}`,
        [],
      ),
    );
    localStorage.setItem("janosik-boards", `[${boards.join(",")}]`);

    renderSearch();
    const options = await search("Board");
    expect(options).toHaveLength(20);
    const results = screen.getByTestId("global-search-results");
    expect(
      within(results).getByRole("group", { name: "Boards, 20 of 21" }),
    ).toBeInTheDocument();
    // No card hits — only the Boards section is rendered and capped.
    expect(within(results).queryByRole("group", { name: "Cards" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all results" }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(21));
  });

  it("finds an archived card left in a legacy column only once", async () => {
    const legacy = JSON.parse(
      boardJson("b-legacy", "Legacy", [
        { id: "c-arch", title: "Legacy duplicate" },
        { id: "c-live", title: "Live card" },
      ]),
    );
    legacy.cards["c-arch"].archivedAt = 2;
    localStorage.setItem("janosik-boards", JSON.stringify([legacy]));

    renderSearch();
    const options = await search("Legacy duplicate");

    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Legacy duplicate");
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
