import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Board, Card } from "@janosik/shared";
import { BOARD_STORAGE_KEY } from "@janosik/shared";
import { api } from "@/api/client";
import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { BoardProvider, useBoard } from "@/store/BoardContext";
import { useBoardActions } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

/**
 * Server-mode integration (TASK-29) against the in-memory fake API: the
 * board is hydrated from `GET /boards`, commands are optimistic and roll
 * back on refusal, the focus refetch marks foreign edits dead and undo
 * refuses to clobber them, and the first login migrates localStorage.
 */

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "c-1",
    title: "Hello",
    labelIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function seedBoard(): Board {
  return {
    id: "b-1",
    title: "Board",
    columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
    cards: { "c-1": card() },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function Probe() {
  const { board, boards, syncStatus, canUndo } = useBoard();
  const actions = useBoardActions();
  return (
    <div>
      <div data-testid="status">{syncStatus}</div>
      <div data-testid="title">{board?.title ?? ""}</div>
      <div data-testid="card-title">{board?.cards["c-1"]?.title ?? ""}</div>
      <div data-testid="columns">
        {board?.columns.map((column) => column.title).join(",") ?? ""}
      </div>
      <div data-testid="board-count">{String(boards.length)}</div>
      <div data-testid="can-undo">{String(canUndo)}</div>
      <button
        type="button"
        data-testid="add-column"
        onClick={() => actions.addColumn("New")}
      />
      <button
        type="button"
        data-testid="add-board"
        onClick={() => {
          void actions.addBoard("Second");
        }}
      />
      <button
        type="button"
        data-testid="edit"
        onClick={() => actions.updateCard("c-1", { title: "Mine" })}
      />
      <button type="button" data-testid="undo" onClick={() => actions.undo()} />
    </div>
  );
}

function renderApp(path = "/board/b-1") {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <BoardProvider>
            <Probe />
          </BoardProvider>
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>,
  );
}

async function waitReady() {
  await waitFor(() =>
    expect(screen.getByTestId("status").textContent).toBe("ready"),
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  api.clearAccessToken();
  api.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("BoardProvider in server mode", () => {
  it("hydrates every board from the API", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();

    expect(screen.getByTestId("title").textContent).toBe("Board");
    expect(screen.getByTestId("card-title").textContent).toBe("Hello");
    const paths = server.requests.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain("GET /api/v1/boards");
    expect(paths).toContain("GET /api/v1/boards/b-1");
  });

  it("applies a command optimistically and stores it on the server", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("add-column"));
    // Instant feedback, before the request completes.
    expect(screen.getByTestId("columns").textContent).toBe("Todo,New");
    await waitFor(() =>
      expect(server.boards.get("b-1")?.columns.map((c) => c.title)).toEqual([
        "Todo",
        "New",
      ]),
    );
  });

  it("rolls an optimistic command back when the server refuses it", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    server.failNextCommand(409, { conflict: "wip", currentVersion: 0 });

    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("add-column"));
    await waitFor(() =>
      expect(screen.getByTestId("columns").textContent).toBe("Todo"),
    );
    expect(server.boards.get("b-1")?.columns.map((c) => c.title)).toEqual([
      "Todo",
    ]);
    // The refused command left no undo step behind.
    expect(screen.getByTestId("can-undo").textContent).toBe("false");
  });

  it("migrates localStorage boards on the first login, archived cards included", async () => {
    const server = new FakeServer([]);
    vi.stubGlobal("fetch", server.handle);
    const legacy: Board = {
      ...seedBoard(),
      id: "legacy-1",
      cards: {
        "c-1": card(),
        "c-arch": card({ id: "c-arch", title: "Archived", archivedAt: 123 }),
      },
    };
    localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify([legacy]));

    renderApp();
    await waitReady();

    await waitFor(() => expect(server.boards.size).toBe(1));
    expect(localStorage.getItem(BOARD_STORAGE_KEY)).toBeNull();
    const imported = [...server.boards.values()][0];
    expect(imported.title).toBe("Board");
    const archived = Object.values(imported.cards).find(
      (entry) => entry.title === "Archived",
    );
    expect(archived?.archivedAt).toBe(123);
  });

  it("refetches on focus and refuses to undo over a foreign edit", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("edit"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Mine"),
    );
    expect(screen.getByTestId("can-undo").textContent).toBe("true");

    // Someone else edits the same card; the focus refetch pulls it in.
    server.overwriteBoard("b-1", (board) => {
      board.cards["c-1"] = { ...board.cards["c-1"], title: "Theirs" };
      board.updatedAt = 2;
      return board;
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("card-title").textContent).toBe("Theirs"),
    );
    // The overtaken step is dead: undo skips it instead of clobbering text.
    expect(screen.getByTestId("can-undo").textContent).toBe("false");
    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(screen.getByTestId("card-title").textContent).toBe("Theirs"),
    );
    expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Theirs");
  });

  it("reverts an undo the server refuses via version preconditions", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("edit"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Mine"),
    );

    // A foreign writer moved the card on without the client seeing it: the
    // undo carries the version it last saw and the server answers 409.
    server.bumpVersion("b-1", "card:c-1");
    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(screen.getByTestId("card-title").textContent).toBe("Mine"),
    );
    expect(screen.getByTestId("can-undo").textContent).toBe("true");
    expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Mine");
  });

  it("creates a board over REST", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("add-board"));
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("2"),
    );
    expect(server.boards.size).toBe(2);
    expect(
      server.requests.some(
        (r) => r.method === "POST" && r.path === "/api/v1/boards",
      ),
    ).toBe(true);
  });

  it("hydrates once and stays usable under StrictMode's double mount", async () => {
    const server = new FakeServer([]);
    vi.stubGlobal("fetch", server.handle);
    localStorage.setItem(
      BOARD_STORAGE_KEY,
      JSON.stringify([{ ...seedBoard(), id: "legacy-1" }]),
    );

    render(
      <StrictMode>
        <I18nProvider>
          <ToastProvider>
            <MemoryRouter initialEntries={["/board/legacy-1"]}>
              <BoardProvider>
                <Probe />
              </BoardProvider>
            </MemoryRouter>
          </ToastProvider>
        </I18nProvider>
      </StrictMode>,
    );
    await waitReady();

    // One import, not one per mount: the in-flight hydration is shared.
    const imports = server.requests.filter((r) =>
      r.path.endsWith("/boards/import"),
    );
    expect(imports).toHaveLength(1);
    expect(server.boards.size).toBe(1);
    expect(screen.getByTestId("title").textContent).toBe("Board");

    // The queue was revived after the cleanup half of the cycle.
    fireEvent.click(screen.getByTestId("add-column"));
    await waitFor(() =>
      expect(
        [...server.boards.values()][0]?.columns.map((c) => c.title),
      ).toEqual(["Todo", "New"]),
    );
  });
});
