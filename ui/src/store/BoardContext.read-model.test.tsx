import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Board } from "@janosik/shared";
import { api } from "@/api/client";
import { I18nProvider } from "@/i18n";
import { AuthProvider } from "@/auth/AuthContext";
import { ToastProvider } from "@/components/Toast";
import { BoardProvider, useBoard } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

const CARD_COUNT = 120;

function largeBoard(count = CARD_COUNT): Board {
  const cardIds = Array.from({ length: count }, (_, index) => `card-${index}`);
  const cards = Object.fromEntries(
    cardIds.map((id, index) => [
      id,
      {
        id,
        title: `Card ${index}`,
        description: `body-${index}`,
        checklists: [
          {
            id: `check-${index}`,
            title: "Steps",
            items: [{ id: `item-${index}`, text: "do", done: index % 2 === 0 }],
          },
        ],
        labelIds: index === 99 ? ["label-1"] : [],
        createdAt: index,
        updatedAt: index,
      },
    ]),
  );
  return {
    id: "b-1",
    title: "Large board",
    columns: [{ id: "col-1", title: "Todo", cardIds, createdAt: 1 }],
    cards,
    labels: [{ id: "label-1", name: "Deep label", color: "red" }],
    createdAt: 1,
    updatedAt: 1,
  };
}

function Probe() {
  const {
    board,
    syncStatus,
    canUndo,
    dispatch,
    loadCardDetail,
    undo,
    redo,
    readModelPartial,
    retryReadModel,
    updateCard,
  } = useBoard();
  const card = board?.cards["card-99"];
  return (
    <div>
      <div data-testid="status">{syncStatus}</div>
      <div data-testid="count">{Object.keys(board?.cards ?? {}).length}</div>
      <div data-testid="id-order">{board?.columns[0]?.cardIds.length ?? 0}</div>
      <div data-testid="title">{card?.title ?? ""}</div>
      <div data-testid="description">{card?.description ?? ""}</div>
      <div data-testid="detail-loaded">
        {String(card?.readModel?.detailLoaded ?? false)}
      </div>
      <div data-testid="can-undo">{String(canUndo)}</div>
      <div data-testid="readModelPartial">{String(readModelPartial)}</div>
      <div data-testid="links">{String(card?.readModel?.linkCount ?? -1)}</div>
      <div data-testid="blocked">
        {String(card?.readModel?.blocked ?? false)}
      </div>
      <div data-testid="card0-done">
        {String(board?.cards["card-0"]?.readModel?.checklistDoneCount ?? -1)}
      </div>
      <div data-testid="card0-total">
        {String(board?.cards["card-0"]?.readModel?.checklistItemCount ?? -1)}
      </div>
      <button
        type="button"
        data-testid="load-detail"
        onClick={() => {
          void loadCardDetail("b-1", "card-99");
        }}
      />
      <button
        type="button"
        data-testid="delete"
        onClick={() => {
          void dispatch({
            type: "DELETE_CARD",
            cardId: "card-99",
            boardId: "b-1",
            at: Date.now(),
          });
        }}
      />
      <div data-testid="labels">{board?.labels.length ?? 0}</div>
      <div data-testid="copy-column-count">
        {board?.columns[1]?.cardIds.length ?? 0}
      </div>
      <button
        type="button"
        data-testid="duplicate-column"
        onClick={() => {
          void dispatch({
            type: "DUPLICATE_COLUMN",
            columnId: "col-1",
            newColumnId: "col-copy",
            newCardIds: (board?.columns[0]?.cardIds ?? []).map(
              (_, index) => `copy-${index}`,
            ),
            activityIds: (board?.columns[0]?.cardIds ?? []).map(
              (_, index) => `activity-${index}`,
            ),
            at: Date.now(),
          });
        }}
      />
      <button
        type="button"
        data-testid="delete-label"
        onClick={() => {
          void dispatch({
            type: "DELETE_LABEL",
            labelId: "label-1",
            boardId: "b-1",
            at: Date.now(),
          });
        }}
      />
      <button
        type="button"
        data-testid="rename-first"
        onClick={() => updateCard("card-0", { title: "Renamed" })}
      />
      <button type="button" data-testid="undo" onClick={() => undo()} />
      <button type="button" data-testid="redo" onClick={() => redo()} />
      <button
        type="button"
        data-testid="retry-read"
        onClick={() => retryReadModel()}
      />
    </div>
  );
}

function renderApp() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/board/b-1"]}>
            <BoardProvider>
              <Probe />
            </BoardProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

async function waitReady() {
  await waitFor(() =>
    expect(screen.getByTestId("status").textContent).toBe("ready"),
  );
}

describe("BoardProvider read model (TASK-200.9)", () => {
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

  it("hydrates the summary and streams every page without detail bodies", async () => {
    const server = new FakeServer([largeBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    // The complete ordered id list is known immediately, while the first
    // page holds only a bounded prefix of card summaries.
    expect(screen.getByTestId("id-order").textContent).toBe(String(CARD_COUNT));
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe(String(CARD_COUNT)),
    );

    // A background page card has title/list fields but no detail body.
    expect(screen.getByTestId("title").textContent).toBe("Card 99");
    expect(screen.getByTestId("description").textContent).toBe("");
    expect(screen.getByTestId("detail-loaded").textContent).toBe("false");

    const paths = server.requests.map((entry) => entry.path);
    expect(paths).toContain("/api/v1/boards/b-1/summary");
    expect(paths).toContain("/api/v1/boards/b-1/cards");
    // The initial read never falls back to the full aggregate.
    expect(
      server.requests.some(
        (entry) =>
          entry.method === "GET" && entry.path === "/api/v1/boards/b-1",
      ),
    ).toBe(false);

    // A completed board refreshes the summary on focus, not every page.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const beforeFocus = server.requests.length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(
        server.requests
          .slice(beforeFocus)
          .some((entry) => entry.path.endsWith("/summary")),
      ).toBe(true),
    );
    expect(
      server.requests
        .slice(beforeFocus)
        .some(
          (entry) =>
            entry.path === "/api/v1/boards/b-1/cards" && entry.method === "GET",
        ),
    ).toBe(false);
  });

  it("re-reads the pages when a newer revision was missed on the stream", async () => {
    const server = new FakeServer([largeBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe(String(CARD_COUNT)),
    );
    expect(screen.getByTestId("title").textContent).toBe("Card 99");

    // A page-2 edit the client never saw: the server revision advanced, but
    // no SSE frame reached this tab. Only a page re-read can refresh it.
    server.advanceRevision("b-1", (board) => {
      board.cards["card-99"] = {
        ...board.cards["card-99"],
        title: "Fresh after refocus",
        updatedAt: board.cards["card-99"].updatedAt + 10,
      };
      return board;
    });
    const beforeFocus = server.requests.length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe(
        "Fresh after refocus",
      ),
    );
    expect(
      server.requests
        .slice(beforeFocus)
        .some(
          (entry) =>
            entry.path === "/api/v1/boards/b-1/cards" && entry.method === "GET",
        ),
    ).toBe(true);
  });

  it("refreshes a detail target when a foreign delete removes a summary source", async () => {
    const board = largeBoard(100);
    board.cards["card-0"].links = [
      { id: "l-0", type: "blocks", targetCardId: "card-99" },
    ];
    const server = new FakeServer([board]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Card 99"),
    );
    await waitFor(() =>
      expect(
        server.requests.some(
          (entry) => entry.path === "/api/v1/boards/b-1/events",
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByTestId("load-detail"));
    await waitFor(() =>
      expect(screen.getByTestId("detail-loaded").textContent).toBe("true"),
    );
    expect(screen.getByTestId("links").textContent).toBe("1");
    expect(screen.getByTestId("blocked").textContent).toBe("true");

    const before = server.requests.length;
    act(() => {
      server.publishCommand("b-1", {
        type: "DELETE_CARD",
        cardId: "card-0",
        at: Date.now(),
      });
    });
    // The deleted source was a summary: the reducer has no incoming rows to
    // update the detail target, so the provider must refresh the summary.
    await waitFor(() =>
      expect(screen.getByTestId("links").textContent).toBe("0"),
    );
    expect(screen.getByTestId("blocked").textContent).toBe("false");
    // The open detail body is kept (no loading skeleton); only its reverse
    // rows are stale, so the next detail read refreshes them.
    expect(screen.getByTestId("detail-loaded").textContent).toBe("true");
    expect(screen.getByTestId("description").textContent).toBe("body-99");
    expect(
      server.requests
        .slice(before)
        .some((entry) => entry.path.endsWith("/summary")),
    ).toBe(true);
    const detailReads = () =>
      server.requests.filter(
        (entry) =>
          entry.method === "GET" &&
          entry.path === "/api/v1/boards/b-1/cards/card-99",
      ).length;
    const readsBefore = detailReads();
    fireEvent.click(screen.getByTestId("load-detail"));
    await waitFor(() => expect(detailReads()).toBe(readsBefore + 1));
    expect(screen.getByTestId("description").textContent).toBe("body-99");
  });

  it("refreshes summary checklist counters after a foreign toggle", async () => {
    const board = largeBoard(3);
    board.cards["card-0"].checklists = [
      {
        id: "cl-0",
        title: "Steps",
        items: [{ id: "i-0", text: "one", done: false }],
      },
    ];
    const server = new FakeServer([board]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("card0-done").textContent).toBe("0"),
    );
    await waitFor(() =>
      expect(
        server.requests.some(
          (entry) => entry.path === "/api/v1/boards/b-1/events",
        ),
      ).toBe(true),
    );

    const before = server.requests.length;
    act(() => {
      server.publishCommand("b-1", {
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId: "card-0",
        checklistId: "cl-0",
        itemId: "i-0",
        done: true,
        at: Date.now(),
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("card0-done").textContent).toBe("1"),
    );
    expect(
      server.requests
        .slice(before)
        .some((entry) => entry.path.endsWith("/summary")),
    ).toBe(true);

    act(() => {
      server.publishCommand("b-1", {
        type: "ADD_CHECKLIST_ITEM",
        cardId: "card-0",
        checklistId: "cl-0",
        newItemId: "i-1",
        text: "two",
        at: Date.now(),
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("card0-total").textContent).toBe("2"),
    );
    act(() => {
      server.publishCommand("b-1", {
        type: "DELETE_CHECKLIST_ITEM",
        cardId: "card-0",
        checklistId: "cl-0",
        itemId: "i-1",
        at: Date.now(),
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("card0-total").textContent).toBe("1"),
    );
  });

  it("falls back to the legacy aggregate when /summary is missing", async () => {
    const server = new FakeServer([largeBoard()]);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://api.test");
        if (url.pathname === "/api/v1/boards/b-1/summary") {
          return new Response(null, { status: 404 });
        }
        return server.handle(input, init);
      },
    );
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe(String(CARD_COUNT)),
    );
    expect(screen.getByTestId("description").textContent).toBe("body-99");
    expect(
      server.requests.some(
        (entry) =>
          entry.method === "GET" && entry.path === "/api/v1/boards/b-1",
      ),
    ).toBe(true);
  });

  it("loads one detail on demand", async () => {
    const server = new FakeServer([largeBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Card 99"),
    );

    fireEvent.click(screen.getByTestId("load-detail"));
    await waitFor(() =>
      expect(screen.getByTestId("description").textContent).toBe("body-99"),
    );
    expect(screen.getByTestId("detail-loaded").textContent).toBe("true");
  });

  it("restores 1000 label assignments when undo races the delete response", async () => {
    const board = largeBoard(1000);
    for (const card of Object.values(board.cards)) {
      card.labelIds = ["label-1"];
    }
    const server = new FakeServer([board]);
    // Simulate a failed page stream: the later cards never reach the client,
    // but the server still deletes the label from them. The response
    // preimage is the only complete undo source.
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://api.test");
        if (
          url.pathname === "/api/v1/boards/b-1/cards" &&
          url.searchParams.has("columnId")
        ) {
          return new Response(null, { status: 500 });
        }
        return server.handle(input, init);
      },
    );
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("readModelPartial").textContent).toBe("true"),
    );
    expect(server.boards.get("b-1")?.cards["card-99"]?.labelIds).toEqual([
      "label-1",
    ]);

    // Hold the delete so the round-trip cannot beat the Ctrl+Z. The undo is
    // gated on the response snapshot; without the gate it would send the
    // loaded first-page subset and lose 950 assignments.
    const release = server.holdNextCommand();
    fireEvent.click(screen.getByTestId("delete-label"));
    fireEvent.click(screen.getByTestId("undo"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      server.requests.some(
        (entry) =>
          (entry.body as { action?: { type?: string } } | undefined)?.action
            ?.type === "RESTORE_LABEL",
      ),
    ).toBe(false);

    release();
    await waitFor(
      () =>
        expect(server.boards.get("b-1")?.cards["card-99"]?.labelIds).toEqual([
          "label-1",
        ]),
      { timeout: 3_000 },
    );
    expect(server.boards.get("b-1")?.cards["card-0"]?.labelIds).toEqual([
      "label-1",
    ]);
    expect(server.boards.get("b-1")?.cards["card-999"]?.labelIds).toEqual([
      "label-1",
    ]);
    const restore = server.requests.find(
      (entry) =>
        (entry.body as { action?: { type?: string } } | undefined)?.action
          ?.type === "RESTORE_LABEL",
    );
    expect(
      (restore?.body as { action?: { assignments?: unknown[] } } | undefined)
        ?.action?.assignments,
    ).toHaveLength(1000);
  });

  it("retries the page stream from the partial banner action", async () => {
    const server = new FakeServer([largeBoard()]);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://api.test");
        if (
          url.pathname === "/api/v1/boards/b-1/cards" &&
          url.searchParams.has("columnId")
        ) {
          return new Response(null, { status: 500 });
        }
        return server.handle(input, init);
      },
    );
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("readModelPartial").textContent).toBe("true"),
    );

    const before = server.requests.length;
    fireEvent.click(screen.getByTestId("retry-read"));
    await waitFor(() =>
      expect(
        server.requests
          .slice(before)
          .some((entry) => entry.path.endsWith("/summary")),
      ).toBe(true),
    );
    // The pages still fail, so the honest partial marker stays.
    await waitFor(() =>
      expect(screen.getByTestId("readModelPartial").textContent).toBe("true"),
    );
  });

  it("amends the redo inverse with the redo response snapshot", async () => {
    const board = largeBoard(3);
    board.cards["card-2"].labelIds = ["label-1"];
    const server = new FakeServer([board]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("3"),
    );

    fireEvent.click(screen.getByTestId("delete-label"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-2"]?.labelIds).toEqual([]),
    );
    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-2"]?.labelIds).toEqual([
        "label-1",
      ]),
    );

    // A new assignment appears outside this client's history between undo
    // and redo. The redo's response snapshot must include it so the next
    // undo restores it too (the original optimistic inverse would not).
    server.overwriteBoard("b-1", (current) => {
      current.cards["card-0"].labelIds = ["label-1"];
      return current;
    });
    fireEvent.click(screen.getByTestId("redo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-0"]?.labelIds).toEqual([]),
    );
    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-0"]?.labelIds).toEqual([
        "label-1",
      ]),
    );
    expect(server.boards.get("b-1")?.cards["card-2"]?.labelIds).toEqual([
      "label-1",
    ]);
  });

  it("falls back to the pre-command assignment read on an older server", async () => {
    const server = new FakeServer([largeBoard()]);
    server.emitLabelPreimage = false;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://api.test");
        if (
          url.pathname === "/api/v1/boards/b-1/cards" &&
          url.searchParams.has("columnId")
        ) {
          return new Response(null, { status: 500 });
        }
        return server.handle(input, init);
      },
    );
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("readModelPartial").textContent).toBe("true"),
    );

    fireEvent.click(screen.getByTestId("delete-label"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-99"]?.labelIds).toEqual([]),
    );
    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-99"]?.labelIds).toEqual([
        "label-1",
      ]),
    );
    // The fallback read must happen before the delete (after it the rows are
    // gone), and the command response itself carries no preimage here.
    const preimageRead = server.requests.findIndex((entry) =>
      entry.path.endsWith("/labels/label-1/assignments"),
    );
    const deleteWrite = server.requests.findIndex(
      (entry) =>
        entry.method === "POST" &&
        (entry.body as { action?: { type?: string } } | undefined)?.action
          ?.type === "DELETE_LABEL",
    );
    expect(preimageRead).toBeGreaterThan(-1);
    expect(deleteWrite).toBeGreaterThan(preimageRead);
  });

  it("drops a queued undo when the label delete fails", async () => {
    const board = largeBoard(3);
    board.cards["card-2"].labelIds = ["label-1"];
    const server = new FakeServer([board]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).toBe("3"),
    );
    fireEvent.click(screen.getByTestId("rename-first"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-0"]?.title).toBe("Renamed"),
    );

    server.failNextCommand(400, { message: "label delete refused" });
    fireEvent.click(screen.getByTestId("delete-label"));
    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(
        server.requests.some(
          (entry) =>
            entry.method === "POST" &&
            (entry.body as { action?: { type?: string } } | undefined)?.action
              ?.type === "DELETE_LABEL",
        ),
      ).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The failed delete was rolled back; the queued undo must not fall
    // through and undo the rename step underneath it.
    expect(server.boards.get("b-1")?.cards["card-0"]?.title).toBe("Renamed");
    expect(server.boards.get("b-1")?.cards["card-2"]?.labelIds).toEqual([
      "label-1",
    ]);
    expect(
      server.requests.some(
        (entry) =>
          (entry.body as { action?: { type?: string } } | undefined)?.action
            ?.type === "RESTORE_LABEL",
      ),
    ).toBe(false);
  });

  it("undoes a summary-card rename without erasing its description", async () => {
    const server = new FakeServer([largeBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Card 99"),
    );

    fireEvent.click(screen.getByTestId("rename-first"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-0"]?.title).toBe("Renamed"),
    );
    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-0"]?.title).toBe("Card 0"),
    );
    expect(server.boards.get("b-1")?.cards["card-0"]?.description).toBe(
      "body-0",
    );
  });

  it("loads a duplicate column's unloaded cards before copying", async () => {
    const server = new FakeServer([largeBoard()]);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://api.test");
        if (
          url.pathname === "/api/v1/boards/b-1/cards" &&
          url.searchParams.has("columnId")
        ) {
          return new Response(null, { status: 500 });
        }
        return server.handle(input, init);
      },
    );
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).not.toBe(
        String(CARD_COUNT),
      ),
    );

    fireEvent.click(screen.getByTestId("duplicate-column"));
    await waitFor(() =>
      expect(screen.getByTestId("copy-column-count").textContent).toBe(
        String(CARD_COUNT),
      ),
    );
  });

  it("loads destructive preimages before recording undo and keeps content on undo", async () => {
    const server = new FakeServer([largeBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Card 99"),
    );
    // Summary only: the delete must fetch detail before its inverse exists.
    expect(screen.getByTestId("description").textContent).toBe("");

    fireEvent.click(screen.getByTestId("delete"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-99"]).toBeUndefined(),
    );
    expect(screen.getByTestId("can-undo").textContent).toBe("true");

    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["card-99"]?.title).toBe("Card 99"),
    );
    expect(server.boards.get("b-1")?.cards["card-99"]?.description).toBe(
      "body-99",
    );
    expect(server.boards.get("b-1")?.cards["card-99"]?.checklists).toHaveLength(
      1,
    );
  });
});
