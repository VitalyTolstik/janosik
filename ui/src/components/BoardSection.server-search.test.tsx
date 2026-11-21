import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";

import { api } from "@/api/client";
import { BoardSection } from "@/components/BoardSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

/**
 * Board filter + server search (TASK-177.13): the local query keeps hiding
 * cards; a comment/attachment match from the server brings a card back even
 * though its title/description do not contain the query.
 */

const SERVER_BOARD: Board = {
  id: "b-1",
  title: "Server board",
  columns: [
    {
      id: "col-1",
      title: "Todo",
      cardIds: ["c-1", "c-2"],
      createdAt: 1,
    },
  ],
  cards: {
    "c-1": {
      id: "c-1",
      title: "Server card",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
    "c-2": {
      id: "c-2",
      title: "Other card",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  },
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

function renderBoard() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-1"]}>
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

describe("BoardSection server search (TASK-177.13)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    api.clearAccessToken();
    api.onAuthLost = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps a card matched only in a comment", async () => {
    const server = new FakeServer([SERVER_BOARD]);
    vi.stubGlobal("fetch", server.handle);
    const search = vi.spyOn(api, "searchBoardCards").mockResolvedValue({
      cardIds: ["c-2"],
      matches: [
        {
          cardId: "c-2",
          matchIn: "comment",
          text: "the flaky build",
          commentId: "cm-1",
        },
      ],
    });

    renderBoard();
    expect(
      await screen.findByText("Other card", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();

    const input = screen.getByLabelText("Search cards", {
      selector: "input",
    });
    fireEvent.change(input, { target: { value: "flaky" } });

    // The local query does not match either title, so the card disappears
    // until the debounced server answer names it.
    await waitFor(() => expect(screen.queryByText("Other card")).toBeNull());
    expect(
      await screen.findByText("Other card", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith("b-1", "flaky");
    expect(screen.queryByText("Server card")).toBeNull();
  });
});
