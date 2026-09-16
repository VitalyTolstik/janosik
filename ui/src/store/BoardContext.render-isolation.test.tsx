import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { I18nProvider } from "@/i18n";
import {
  BoardProvider,
  useBoardActions,
  useBoardHistory,
  useBoardState,
} from "@/store/BoardContext";

/**
 * The same claim as the probes in `BoardContext.test.tsx`, but driven
 * through a real keystroke in the real card dialog (TASK-21.4).
 *
 * The path matters: an update dispatched straight from a test hides render
 * passes that a genuine DOM event produces, because React computes state
 * eagerly inside event handlers and re-runs the updater while rendering.
 * That is how publishing `canUndo`/`canRedo` as a freshly built object cost
 * the header a second render — invisible to a direct-dispatch test.
 *
 * The probes stand in for the header: they subscribe exactly as it does.
 */

let historyRenders = 0;
let actionsRenders = 0;
let stateRenders = 0;

function HistoryProbe() {
  historyRenders += 1;
  useBoardHistory();
  return null;
}

function ActionsProbe() {
  actionsRenders += 1;
  useBoardActions();
  return null;
}

function StateProbe() {
  stateRenders += 1;
  useBoardState();
  return null;
}

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
          "c-2": card("c-2", "Bystander"),
          "c-3": card("c-3", "Elsewhere"),
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

function renderBoard() {
  historyRenders = 0;
  actionsRenders = 0;
  stateRenders = 0;
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-1?card=c-1"]}>
                <BoardProvider>
                  <HistoryProbe />
                  <ActionsProbe />
                  <StateProbe />
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

describe("render isolation while typing (TASK-21.4)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
  });

  it("five keystrokes in a card title cost the header one render", async () => {
    renderBoard();
    const dialog = await screen.findByRole("dialog");
    const title = within(dialog).getByRole("textbox", { name: /title/i });

    const historyBefore = historyRenders;
    const actionsBefore = actionsRenders;
    const stateBefore = stateRenders;

    let text = "Edited card";
    for (const ch of "12345") {
      text += ch;
      fireEvent.change(title, { target: { value: text } });
    }
    expect(title).toHaveValue("Edited card12345");

    // The board data reaches its consumers on every keystroke...
    expect(stateRenders - stateBefore).toBeGreaterThanOrEqual(5);
    // ...the actions never change...
    expect(actionsRenders).toBe(actionsBefore);
    // ...and undo availability flips once: disabled -> enabled.
    expect(historyRenders - historyBefore).toBe(1);
  });
});
