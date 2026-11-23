import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Board } from "@janosik/shared";
import { api } from "@/api/client";
import { I18nProvider } from "@/i18n";
import { AuthProvider } from "@/auth/AuthContext";
import { ToastProvider } from "@/components/Toast";
import { BoardProvider, useBoard } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

const CARD_COUNT = 120;

function largeBoard(): Board {
  const cardIds = Array.from(
    { length: CARD_COUNT },
    (_, index) => `card-${index}`,
  );
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
        labelIds: [],
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
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function Probe() {
  const { board, syncStatus, canUndo, dispatch, loadCardDetail, undo } =
    useBoard();
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
      <button type="button" data-testid="undo" onClick={() => undo()} />
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
