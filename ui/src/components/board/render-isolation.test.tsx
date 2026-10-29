import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Who re-renders while the user types in a card title (TASK-21.4.1).
 *
 * Counting happens through two leaf modules replaced by counting doubles:
 * they sit *inside* the memoized subtrees, so they run exactly when the
 * component around them runs — `HighlightedText` once per rendered card
 * front and table row, `CardComposer` once per rendered column.
 *
 * Before TASK-21.4.1 an edit to one card re-rendered every column (and with
 * it every insert zone, menu and dialog inside them) and every row of the
 * table, because both looked their cards up in the store, and the store
 * hands out a new board object on every keystroke.
 */

const counter = vi.hoisted(() => ({
  fronts: {} as Record<string, number>,
  columns: {} as Record<string, number>,
}));

vi.mock("@/components/ui/highlight", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/ui/highlight")
  >("@/components/ui/highlight");
  return {
    ...actual,
    HighlightedText: (props: { text: string; query: string }) => {
      counter.fronts[props.text] = (counter.fronts[props.text] ?? 0) + 1;
      return <actual.HighlightedText {...props} />;
    },
  };
});

vi.mock("@/components/board/CardComposer", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/board/CardComposer")
  >("@/components/board/CardComposer");
  return {
    ...actual,
    CardComposer: (
      props: Parameters<typeof actual.CardComposer>[0] & { columnId?: string },
    ) => {
      const key = props.columnId ?? "inline";
      counter.columns[key] = (counter.columns[key] ?? 0) + 1;
      return <actual.CardComposer {...props} />;
    },
  };
});

function card(id: string, title: string) {
  return { id, title, labelIds: [], createdAt: 1000, updatedAt: 1000 };
}

function seedBoard() {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "b-1",
        title: "Alpha",
        columns: [
          {
            id: "col-1",
            title: "To do",
            cardIds: ["c-1", "c-2"],
            createdAt: 1,
          },
          { id: "col-2", title: "Doing", cardIds: ["c-3"], createdAt: 2 },
        ],
        cards: {
          "c-1": card("c-1", "Edited card"),
          "c-2": card("c-2", "Neighbour card"),
          "c-3": card("c-3", "Other column card"),
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

function renderBoard(route = "/board/b-1?card=c-1") {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={[route]}>
                <BoardProvider>
                  <BoardSection />
                </BoardProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

async function typeInCardTitle(text: string) {
  const dialog = await screen.findByRole("dialog");
  const title = within(dialog).getByRole("textbox", { name: /title/i });
  let value = "Edited card";
  for (const ch of text) {
    value += ch;
    fireEvent.change(title, { target: { value } });
  }
  // Title edits are local until blur/close (TASK-150, C8); flush the quiet
  // write so the board sees the edit once, like a real editing session.
  fireEvent.blur(title);
}

describe("render isolation on a card edit (TASK-21.4.1)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("janosik-board-view", "board");
    seedBoard();
    counter.fronts = {};
    counter.columns = {};
  });

  it("leaves the other column, and every other card, alone", async () => {
    renderBoard();
    await screen.findByText("Neighbour card");
    const before = {
      editedColumn: counter.columns["col-1"] ?? 0,
      otherColumn: counter.columns["col-2"] ?? 0,
      neighbour: counter.fronts["Neighbour card"] ?? 0,
      otherColumnCard: counter.fronts["Other column card"] ?? 0,
    };

    await typeInCardTitle("12345");

    // The edited card's own column re-renders — it has to, the title shows
    // on the card front.
    expect(counter.columns["col-1"]).toBeGreaterThan(before.editedColumn);
    // Nothing else does.
    expect(counter.columns["col-2"] ?? 0).toBe(before.otherColumn);
    expect(counter.fronts["Neighbour card"] ?? 0).toBe(before.neighbour);
    expect(counter.fronts["Other column card"] ?? 0).toBe(
      before.otherColumnCard,
    );
  });

  it("leaves the other column alone with a filter active too", async () => {
    // A filter rebuilds its per-column id lists on every keystroke, and
    // dragging is disabled while it is on — both used to hand dnd-kit (and
    // the columns) fresh values on every render.
    renderBoard("/board/b-1");
    fireEvent.change(screen.getByRole("textbox", { name: "Search cards" }), {
      target: { value: "card" },
    });
    // The query highlights matches, so the title is split across <mark>s —
    // click the card front by its test id instead of by text.
    fireEvent.click((await screen.findAllByTestId("card-title"))[0]);
    const before = {
      editedColumn: counter.columns["col-1"] ?? 0,
      otherColumn: counter.columns["col-2"] ?? 0,
      neighbour: counter.fronts["Neighbour card"] ?? 0,
    };
    expect(before.otherColumn).toBeGreaterThan(0);

    await typeInCardTitle("12345");

    expect(counter.columns["col-1"]).toBeGreaterThan(before.editedColumn);
    expect(counter.columns["col-2"] ?? 0).toBe(before.otherColumn);
    expect(counter.fronts["Neighbour card"] ?? 0).toBe(before.neighbour);
  });

  it("leaves every other row of the table alone", async () => {
    localStorage.setItem("janosik-board-view", "table");
    // The table is lazy and an open modal aria-hides the rest of the page,
    // so the dialog is opened from a row instead of from the URL.
    renderBoard("/board/b-1");
    const table = await screen.findByRole("table", {}, { timeout: 15_000 });
    fireEvent.click(within(table).getByText("Edited card"));
    const before = {
      neighbour: counter.fronts["Neighbour card"] ?? 0,
      otherColumnCard: counter.fronts["Other column card"] ?? 0,
    };
    expect(before.neighbour).toBeGreaterThan(0);

    await typeInCardTitle("12345");

    expect(counter.fronts["Neighbour card"] ?? 0).toBe(before.neighbour);
    expect(counter.fronts["Other column card"] ?? 0).toBe(
      before.otherColumnCard,
    );
  });
});
