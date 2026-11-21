import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Board, BoardCardSearchResult } from "@janosik/shared";

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
 * though its title/description do not contain the query. While the debounced
 * lookup runs the board must not claim a definitive empty result.
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

function result(cardId: string): BoardCardSearchResult {
  return { cardIds: [cardId], matches: [] };
}

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

function filterInput() {
  return screen.getByLabelText("Search cards", { selector: "input" });
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
    const search = vi
      .spyOn(api, "searchBoardCards")
      .mockResolvedValue(result("c-2"));

    renderBoard();
    expect(
      await screen.findByText("Other card", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();

    fireEvent.change(filterInput(), { target: { value: "flaky" } });

    await waitFor(() => expect(screen.queryByText("Other card")).toBeNull());
    expect(
      await screen.findByText("Other card", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith("b-1", "flaky", {
      includeMatches: false,
    });
    expect(screen.queryByText("Server card")).toBeNull();
  });

  it("shows a pending status instead of a false empty result", async () => {
    const server = new FakeServer([SERVER_BOARD]);
    vi.stubGlobal("fetch", server.handle);
    let release!: (value: BoardCardSearchResult) => void;
    const pending = new Promise<BoardCardSearchResult>((resolve) => {
      release = resolve;
    });
    vi.spyOn(api, "searchBoardCards").mockReturnValue(pending);

    renderBoard();
    await screen.findByText("Server card", {}, { timeout: 15_000 });
    fireEvent.change(filterInput(), { target: { value: "flaky" } });

    expect(
      await screen.findByTestId("filter-server-pending"),
    ).toHaveTextContent("Searching comments and attachments…");
    expect(screen.queryByText("No cards match the filter")).toBeNull();
    expect(screen.queryByText(/0 cards found/)).toBeNull();
    expect(screen.getByTestId("filter-match-count")).toHaveTextContent(
      "Searching comments and attachments…",
    );

    await act(async () => release(result("c-2")));

    expect(
      await screen.findByText("Other card", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("filter-server-pending")).toBeNull();
  });

  it("ignores a stale server response after a newer query", async () => {
    const server = new FakeServer([SERVER_BOARD]);
    vi.stubGlobal("fetch", server.handle);
    let releaseOld!: (value: BoardCardSearchResult) => void;
    let releaseNew!: (value: BoardCardSearchResult) => void;
    const oldResponse = new Promise<BoardCardSearchResult>((resolve) => {
      releaseOld = resolve;
    });
    const newResponse = new Promise<BoardCardSearchResult>((resolve) => {
      releaseNew = resolve;
    });
    const search = vi
      .spyOn(api, "searchBoardCards")
      .mockImplementation((_boardId, query) =>
        query === "flaky" ? oldResponse : newResponse,
      );

    renderBoard();
    await screen.findByText("Server card", {}, { timeout: 15_000 });
    fireEvent.change(filterInput(), { target: { value: "flaky" } });
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith("b-1", "flaky", {
        includeMatches: false,
      }),
    );

    fireEvent.change(filterInput(), { target: { value: "widget" } });
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith("b-1", "widget", {
        includeMatches: false,
      }),
    );

    await act(async () => releaseNew(result("c-1")));
    expect(await screen.findByText("Server card")).toBeInTheDocument();

    await act(async () => releaseOld(result("c-2")));
    await waitFor(() => expect(screen.queryByText("Other card")).toBeNull());
  });

  it("makes one request per debounce window", async () => {
    const server = new FakeServer([SERVER_BOARD]);
    vi.stubGlobal("fetch", server.handle);
    const search = vi
      .spyOn(api, "searchBoardCards")
      .mockResolvedValue(result("c-2"));

    renderBoard();
    await screen.findByText("Server card", {}, { timeout: 15_000 });
    const input = filterInput();
    fireEvent.change(input, { target: { value: "f" } });
    fireEvent.change(input, { target: { value: "fl" } });
    fireEvent.change(input, { target: { value: "fla" } });
    fireEvent.change(input, { target: { value: "flaky" } });

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith("b-1", "flaky", {
        includeMatches: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(search).toHaveBeenCalledTimes(1);
  });
});
