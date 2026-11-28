import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useLayoutEffect, useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";

import type {
  Board,
  BoardAction,
  Card,
  CommandRequest,
  Epic,
} from "@janosik/shared";
import { BOARD_STORAGE_KEY } from "@janosik/shared";
import { api, ApiError } from "@/api/client";
import { I18nProvider } from "@/i18n";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { ToastProvider } from "@/components/Toast";
import { BoardProvider, useBoard } from "@/store/BoardContext";
import { useBoardActions } from "@/store/BoardContext";
import {
  useBoardMember,
  useBoardPresence,
  useEntityAttribution,
} from "@/store/board-live";
import { FakeServer, emptyBoard } from "@/test/fake-server";

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
  const {
    board,
    boards,
    pendingBoardCount,
    syncStatus,
    canUndo,
    canRedo,
    exportBoard,
  } = useBoard();
  const actions = useBoardActions();
  const [exported, setExported] = useState("");
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const presence = useBoardPresence(board?.id);
  const attribution = useEntityAttribution("c-1");
  const newcomer = useBoardMember(board?.id, "user-3");
  const second = boards.find((entry) => entry.id === "b-2");
  return (
    <div>
      <div data-testid="status">{syncStatus}</div>
      <div data-testid="me">{user?.id ?? ""}</div>
      <div data-testid="presence">
        {presence.map((person) => person.displayName).join(",")}
      </div>
      <div data-testid="attr">
        {attribution
          ? `${attribution.userId}:${String(attribution.highlight)}`
          : ""}
      </div>
      <div data-testid="newcomer">{newcomer?.displayName ?? ""}</div>
      <div data-testid="title">{board?.title ?? ""}</div>
      <div data-testid="role">{actions.roleOf(board?.id ?? "") ?? ""}</div>
      <div data-testid="card-title">{board?.cards["c-1"]?.title ?? ""}</div>
      <div data-testid="columns">
        {board?.columns.map((column) => column.title).join(",") ?? ""}
      </div>
      <div data-testid="board-count">{String(boards.length)}</div>
      <div data-testid="pending-board-count">{String(pendingBoardCount)}</div>
      <div data-testid="can-undo">{String(canUndo)}</div>
      <div data-testid="can-redo">{String(canRedo)}</div>
      <div data-testid="second-archived">
        {String(second?.archivedAt !== undefined)}
      </div>
      <button
        type="button"
        data-testid="add-column"
        onClick={() => actions.addColumn("New")}
      />
      <button
        type="button"
        data-testid="refresh-boards"
        onClick={() => {
          void actions.refreshBoards().catch(() => undefined);
        }}
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
      <button
        type="button"
        data-testid="export-board"
        onClick={() => {
          void exportBoard("b-1").then(setExported);
        }}
      />
      <div data-testid="exported">{exported}</div>
      <button
        type="button"
        data-testid="quiet-edit"
        onClick={() =>
          actions.updateCard("c-1", { title: "Mine" }, { quiet: true })
        }
      />
      <button
        type="button"
        data-testid="touch"
        onClick={() => actions.touchCard("c-1")}
      />
      <div data-testid="card-desc">
        {board?.cards["c-1"]?.description ?? ""}
      </div>
      <button
        type="button"
        data-testid="add-two-columns"
        onClick={() => {
          actions.addColumn("One");
          actions.addColumn("Two");
        }}
      />
      <button
        type="button"
        data-testid="quiet-desc"
        onClick={() =>
          actions.updateCard("c-1", { description: "Draft" }, { quiet: true })
        }
      />
      <button
        type="button"
        data-testid="go-b2"
        onClick={() => navigate("/board/b-2")}
      />
      <button
        type="button"
        data-testid="logout"
        onClick={() => {
          void logout();
        }}
      />
      <button type="button" data-testid="undo" onClick={() => actions.undo()} />
      <button type="button" data-testid="redo" onClick={() => actions.redo()} />
      <button
        type="button"
        data-testid="archive-second"
        onClick={() => actions.archiveBoard("b-2")}
      />
      <button
        type="button"
        data-testid="unarchive-second"
        onClick={() => actions.unarchiveBoard("b-2")}
      />
      <button
        type="button"
        data-testid="remove-second"
        onClick={() => {
          void actions.removeBoard("b-2");
        }}
      />
      <button
        type="button"
        data-testid="import-board"
        onClick={() => {
          void actions.importBoards([emptyBoard("imported-1", "Imported")]);
        }}
      />
      <button
        type="button"
        data-testid="leave-b1"
        onClick={() => {
          void actions.leaveBoard("b-1");
        }}
      />
      <button
        type="button"
        data-testid="leave-b2"
        onClick={() => {
          void actions.leaveBoard("b-2");
        }}
      />
    </div>
  );
}

function renderApp(path = "/board/b-1", probe = <Probe />) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <BoardProvider>{probe}</BoardProvider>
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

describe("inline epic creation in server mode", () => {
  const originalEpic: Epic = {
    id: "original-epic",
    title: "Original epic",
    color: "rose",
    status: "active",
    position: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const laterEpic = {
    ...originalEpic,
    id: "later-epic",
    title: "Later epic",
    position: 1,
  };
  const newEpic = {
    ...originalEpic,
    id: "new-epic",
    title: "New epic",
    position: 2,
    createdAt: 10,
    updatedAt: 10,
  };

  function EpicProbe({ signal }: { signal?: AbortSignal }) {
    const { board, dispatch, dispatchEpicCreation } = useBoard();
    return (
      <>
        <output data-testid="epic-id">{board?.cards["c-1"]?.epicId}</output>
        <output data-testid="epics">
          {board?.epics?.map(({ id }) => id).join(",")}
        </output>
        <button
          type="button"
          onClick={() =>
            dispatchEpicCreation(
              { type: "ADD_EPIC", boardId: "b-1", at: 10, epic: newEpic },
              ["c-1"],
              signal,
            )
          }
        >
          Create and assign
        </button>
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: "SET_CARD_EPIC",
              boardId: "b-1",
              cardId: "c-1",
              epicId: laterEpic.id,
              at: 20,
            })
          }
        >
          Assign to later epic
        </button>
      </>
    );
  }

  async function setup(signal?: AbortSignal) {
    const board = seedBoard();
    board.epics = [originalEpic, laterEpic];
    board.cards["c-1"].epicId = originalEpic.id;
    const server = new FakeServer([board]);
    vi.stubGlobal("fetch", server.handle);
    const send = vi.spyOn(api, "sendCommand");
    renderApp(
      "/board/b-1",
      <>
        <Probe />
        <EpicProbe signal={signal} />
      </>,
    );
    await waitReady();
    return {
      server,
      send,
      commands: () => send.mock.calls.map(([, request]) => request.action),
      serverCard: () => server.boards.get("b-1")?.cards["c-1"],
    };
  }

  function chooseLaterEpic() {
    fireEvent.click(
      screen.getByRole("button", { name: "Assign to later epic" }),
    );
    expect(screen.getByTestId("epic-id")).toHaveTextContent(laterEpic.id);
  }

  function createEpic() {
    fireEvent.click(screen.getByRole("button", { name: "Create and assign" }));
    expect(screen.getByTestId("epic-id")).toHaveTextContent(newEpic.id);
  }

  function assignment(epicId: string): Partial<BoardAction> {
    return { type: "SET_CARD_EPIC", cardId: "c-1", epicId };
  }

  it("sends the dependent assignment ahead of a later choice and releases waiting undo after creation", async () => {
    const { server, commands, serverCard } = await setup();
    const release = server.holdNextCommandBeforeCommit();
    createEpic();
    chooseLaterEpic();
    await waitFor(() =>
      expect(commands()).toMatchObject([{ type: "ADD_EPIC" }]),
    );

    fireEvent.click(screen.getByTestId("undo"));
    expect(screen.getByTestId("epic-id")).toHaveTextContent(laterEpic.id);
    expect(serverCard()?.epicId).toBe(originalEpic.id);
    act(release);
    await waitFor(() =>
      expect(commands()).toMatchObject([
        { type: "ADD_EPIC" },
        assignment(newEpic.id),
        assignment(laterEpic.id),
        assignment(newEpic.id),
      ]),
    );
    await waitFor(() => expect(serverCard()?.epicId).toBe(newEpic.id));
    expect(screen.getByTestId("epic-id")).toHaveTextContent(newEpic.id);

    fireEvent.click(screen.getByTestId("redo"));
    await waitFor(() => expect(serverCard()?.epicId).toBe(laterEpic.id));
    expect(screen.getByTestId("epic-id")).toHaveTextContent(laterEpic.id);
  });

  it("skips assignment after refused creation and rebases undo for the later epic choice", async () => {
    const { commands, send, serverCard } = await setup();
    let refuse!: () => void;
    send.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          refuse = () => reject(new ApiError(403, null));
        }),
    );
    createEpic();
    chooseLaterEpic();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("undo"));

    act(refuse);
    await waitFor(() => expect(serverCard()?.epicId).toBe(laterEpic.id));
    await waitFor(() =>
      expect(screen.getByTestId("epics")).not.toHaveTextContent(newEpic.id),
    );
    expect(screen.getByTestId("epic-id")).toHaveTextContent(laterEpic.id);
    expect(commands()).toMatchObject([
      { type: "ADD_EPIC" },
      assignment(laterEpic.id),
    ]);
    expect(screen.getByTestId("can-redo")).toHaveTextContent("false");

    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() => expect(serverCard()?.epicId).toBe(originalEpic.id));
    expect(screen.getByTestId("epic-id")).toHaveTextContent(originalEpic.id);
    expect(screen.getByTestId("can-undo")).toHaveTextContent("false");
    fireEvent.click(screen.getByTestId("redo"));
    await waitFor(() => expect(serverCard()?.epicId).toBe(laterEpic.id));
  });

  it("skips an aborted assignment while keeping the created epic and the later card edit", async () => {
    const controller = new AbortController();
    const { server, commands, serverCard } = await setup(controller.signal);
    const release = server.holdNextCommand();
    createEpic();
    await waitFor(() =>
      expect(server.boards.get("b-1")?.epics).toContainEqual(newEpic),
    );
    fireEvent.click(screen.getByTestId("edit"));
    controller.abort();
    act(release);

    await waitFor(() =>
      expect(screen.getByTestId("epic-id")).toHaveTextContent(originalEpic.id),
    );
    await waitFor(() => expect(serverCard()?.title).toBe("Mine"));
    expect(screen.getByTestId("epics")).toHaveTextContent(newEpic.id);
    expect(screen.getByTestId("card-title")).toHaveTextContent("Mine");
    expect(commands()).toMatchObject([
      { type: "ADD_EPIC" },
      { type: "UPDATE_CARD" },
    ]);
    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() => expect(serverCard()?.title).toBe("Hello"));
    expect(screen.getByTestId("epic-id")).toHaveTextContent(originalEpic.id);
  });
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
    expect(paths).toContain("GET /api/v1/boards/b-1/summary");
  });

  it("exports one board after the pending command queue drains", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("edit"));
    fireEvent.click(screen.getByTestId("export-board"));
    await waitFor(() =>
      expect(screen.getByTestId("exported").textContent).toContain("janosik"),
    );

    const payload = JSON.parse(
      screen.getByTestId("exported").textContent ?? "{}",
    ) as { app: string; boards: Board[] };
    expect(payload.app).toBe("janosik");
    expect(payload.boards).toHaveLength(1);
    expect(payload.boards[0]?.cards["c-1"]?.title).toBe("Mine");
    const paths = server.requests.map((r) => `${r.method} ${r.path}`);
    expect(paths.indexOf("POST /api/v1/boards/b-1/commands")).toBeLessThan(
      paths.indexOf("GET /api/v1/boards/b-1/export"),
    );
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

  it("rolls back a command the busy board timed out and says so", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    server.failNextCommand(503, {
      message: "The board is busy — retry the request",
      code: "board_write_timeout",
    });

    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("add-column"));
    await waitFor(() =>
      expect(screen.getByTestId("columns").textContent).toBe("Todo"),
    );
    expect(
      await screen.findByText(
        "The server is busy — the change was not saved, try again",
      ),
    ).toBeInTheDocument();
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

    // Someone else edits the same card; the focus refetch pulls it in. A real
    // foreign command stamps the card's `updatedAt` too (TASK-150, C14).
    server.overwriteBoard("b-1", (board) => {
      board.cards["c-1"] = {
        ...board.cards["c-1"],
        title: "Theirs",
        updatedAt: Date.now(),
      };
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

  it("sends undo and redo through the command log and keeps their echoes quiet", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("edit"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Mine"),
    );

    // Undo travels the same queue: the inverse reaches the server and the
    // own echo must not flip the restored step again.
    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Hello"),
    );
    expect(screen.getByTestId("card-title").textContent).toBe("Hello");
    expect(screen.getByTestId("can-undo").textContent).toBe("false");

    // Redo re-sends the original command with a fresh idempotency key.
    fireEvent.click(screen.getByTestId("redo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Mine"),
    );
    expect(screen.getByTestId("card-title").textContent).toBe("Mine");
    expect(screen.getByTestId("can-undo").textContent).toBe("true");
  });

  it("redoes a coalesced quiet edit, not its debounced touch stamp", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();

    // The live-edit pattern: a quiet keystroke commit plus the stamp that
    // ends the session — both collapse into one undo step.
    fireEvent.click(screen.getByTestId("quiet-edit"));
    fireEvent.click(screen.getByTestId("touch"));
    expect(screen.getByTestId("card-title").textContent).toBe("Mine");
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Mine"),
    );

    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Hello"),
    );

    // Redo must replay the text edit; replaying the touch alone would only
    // move `updatedAt` and leave the old title (live bug 2026-09-18).
    fireEvent.click(screen.getByTestId("redo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Mine"),
    );
    expect(screen.getByTestId("card-title").textContent).toBe("Mine");
    const redo = server.requests
      .map((request) => request.body as CommandRequest | undefined)
      .filter((body) => body?.action?.type === "UPDATE_CARD")
      .at(-1);
    expect(redo?.action).toMatchObject({ type: "UPDATE_CARD", title: "Mine" });
  });

  it("reverts a redo the server refuses via version preconditions", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("quiet-edit"));
    fireEvent.click(screen.getByTestId("touch"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Mine"),
    );

    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Hello"),
    );

    // A foreign writer moves the card on before the redo: the redo carries
    // the version it last saw and is refused — it must not clobber foreign
    // text just because the original edit was a quiet keystroke.
    server.bumpVersion("b-1", "card:c-1");
    fireEvent.click(screen.getByTestId("redo"));
    await waitFor(() =>
      expect(screen.getByTestId("card-title").textContent).toBe("Hello"),
    );
    expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Hello");
    expect(screen.getByTestId("can-undo").textContent).toBe("false");
    expect(screen.getByTestId("can-redo").textContent).toBe("true");
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
            <MemoryRouter initialEntries={["/"]}>
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
    // The home route redirects to the imported board in a follow-up effect,
    // so the active board lands a tick after hydration reports "ready" — wait
    // for it rather than racing the redirect (the click below needs it).
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Board"),
    );

    // The queue was revived after the cleanup half of the cycle.
    fireEvent.click(screen.getByTestId("add-column"));
    await waitFor(() =>
      expect(
        [...server.boards.values()][0]?.columns.map((c) => c.title),
      ).toEqual(["Todo", "New"]),
    );
  });
});

describe("BoardProvider realtime (SSE, TASK-30)", () => {
  async function waitStreamOpen(server: FakeServer): Promise<void> {
    await waitFor(() =>
      expect(
        server.requests.some(
          (entry) => entry.path === "/api/v1/boards/b-1/events",
        ),
      ).toBe(true),
    );
  }

  it("applies a foreign command live, without a refetch", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitStreamOpen(server);

    act(() => {
      server.publishCommand("b-1", {
        type: "RENAME_BOARD",
        title: "Remote",
        at: Date.now(),
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Remote"),
    );
    // The foreign edit is nobody's undo step in this client.
    expect(screen.getByTestId("can-undo").textContent).toBe("false");
  });

  it("fills the presence roster from the stream, live", async () => {
    const server = new FakeServer([seedBoard()]);
    server.initialPresence = [
      {
        id: "user-2",
        displayName: "Boris",
        avatarColor: null,
        avatarPath: null,
      },
    ];
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("presence").textContent).toBe("Boris"),
    );

    act(() => {
      server.publishPresence("b-1", [
        {
          id: "user-1",
          displayName: "Admin",
          avatarColor: null,
          avatarPath: null,
        },
        {
          id: "user-2",
          displayName: "Boris",
          avatarColor: null,
          avatarPath: null,
        },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByTestId("presence").textContent).toBe("Admin,Boris"),
    );
  });

  it("refreshes the caller's role on a live membership update", async () => {
    const server = new FakeServer([seedBoard()]);
    server.role = "MEMBER";
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitStreamOpen(server);
    expect(screen.getByTestId("role").textContent).toBe("MEMBER");

    server.roles.set("b-1", "VIEWER");
    act(() => {
      server.publishMembership("b-1", "user-1", "updated");
    });

    await waitFor(() =>
      expect(screen.getByTestId("role").textContent).toBe("VIEWER"),
    );
  });

  it("attributes a foreign edit and drops the highlight after 2 s", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitStreamOpen(server);

    act(() => {
      server.publishCommand("b-1", {
        type: "UPDATE_CARD",
        cardId: "c-1",
        title: "Boris edit",
        at: Date.now(),
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("attr").textContent).toBe("user-2:true"),
    );
    // The store clears the ring on its own 2 s clock; the author stays.
    await waitFor(
      () => expect(screen.getByTestId("attr").textContent).toBe("user-2:false"),
      { timeout: 4_000 },
    );
  });

  it("attributes my own edit without a highlight", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("me").textContent).toBe("user-1"),
    );
    await waitStreamOpen(server);

    fireEvent.click(screen.getByTestId("edit"));

    await waitFor(() =>
      expect(screen.getByTestId("attr").textContent).toBe("user-1:false"),
    );
  });

  it("accepts an actor-less master activity frame without stamping attribution", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitStreamOpen(server);
    expect(screen.getByTestId("attr").textContent).toBe("");

    // TASK-185.2: a master deletion omits `actorId`; even a comment_added
    // frame without one must not reach `attribution.stamp` with undefined.
    act(() => {
      server.publishActivity("b-1", {
        type: "activity",
        id: "activity-master",
        boardId: "b-1",
        cardId: "c-1",
        at: Date.now(),
        kind: "comment_added",
        commentId: "comment-master",
      });
      server.publishActivity("b-1", {
        type: "activity",
        id: "activity-master-deleted",
        boardId: "b-1",
        cardId: "c-1",
        at: Date.now(),
        kind: "comment_deleted",
        commentId: "comment-master",
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId("attr").textContent).toBe("");
  });

  it("catches up the commands missed while the stream was down", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitStreamOpen(server);

    act(() => {
      server.closeEvents("b-1");
      server.publishCommand("b-1", {
        type: "RENAME_BOARD",
        title: "First",
        at: 1,
      });
      server.publishCommand("b-1", {
        type: "RENAME_BOARD",
        title: "Second",
        at: 2,
      });
    });

    // Reconnect resumes from the last applied seq and replays the delta.
    await waitFor(
      () => expect(screen.getByTestId("title").textContent).toBe("Second"),
      { timeout: 5_000 },
    );
  });

  it("applies a same-account command from another tab", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitStreamOpen(server);

    // The actor id matches the session, but no command of this client ever
    // got acked at this seq: it is the same account in another tab.
    act(() => {
      server.publishCommand(
        "b-1",
        { type: "RENAME_BOARD", title: "Tab B", at: 1 },
        server.account.id,
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Tab B"),
    );
  });

  it("skips its own echo: the undo step stays alive and nothing is doubled", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitStreamOpen(server);

    fireEvent.click(screen.getByTestId("add-column"));
    // The fake echoes our command like the production server; the bridge
    // sees it (possibly before the HTTP ack) and must not treat it as a
    // foreign edit — that would kill the undo step and re-apply the action.
    await waitFor(() => expect(server.seqOf("b-1")).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.getByTestId("columns").textContent).toBe("Todo,New");
    expect(screen.getByTestId("can-undo").textContent).toBe("true");
  });

  it("defers a foreign command until our in-flight command settles", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitStreamOpen(server);

    const release = server.holdNextCommand();
    fireEvent.click(screen.getByTestId("add-column"));
    expect(screen.getByTestId("columns").textContent).toBe("Todo,New");

    // The foreign event arrives while our command is still in flight: it
    // must wait, or it would land on top of optimistic state.
    act(() => {
      server.publishCommand("b-1", {
        type: "RENAME_BOARD",
        title: "Remote",
        at: Date.now(),
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId("title").textContent).toBe("Board");

    act(() => {
      release();
    });
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Remote"),
    );
    // Both changes survive, in server order; our step is still undoable.
    expect(screen.getByTestId("columns").textContent).toBe("Todo,New");
    expect(screen.getByTestId("can-undo").textContent).toBe("true");
  });

  it("marks an undo step foreign from the event's touches, without a refetch", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitStreamOpen(server);

    fireEvent.click(screen.getByTestId("edit"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Mine"),
    );
    expect(screen.getByTestId("can-undo").textContent).toBe("true");
    const snapshots = () =>
      server.requests.filter(
        (entry) =>
          entry.method === "GET" && entry.path === "/api/v1/boards/b-1",
      ).length;
    const refetches = snapshots();

    // Someone else edits the same card. The event carries `touches`
    // (`card:c-1`, TASK-30.1), so the step is marked dead from that list —
    // no whole-board diff, and no snapshot refetch either.
    act(() => {
      server.publishCommand("b-1", {
        type: "UPDATE_CARD",
        cardId: "c-1",
        title: "Theirs",
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("card-title").textContent).toBe("Theirs"),
    );
    expect(screen.getByTestId("can-undo").textContent).toBe("false");
    expect(snapshots()).toBe(refetches);

    // Undo skips the dead step instead of clobbering the other edit.
    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() =>
      expect(screen.getByTestId("card-title").textContent).toBe("Theirs"),
    );
    expect(server.boards.get("b-1")?.cards["c-1"].title).toBe("Theirs");
    expect(
      await screen.findByText("Another member changed this — undo was skipped"),
    ).toBeTruthy();
  });
});

describe("BoardProvider membership revocation (TASK-36)", () => {
  it("drops a revoked board and moves the member to another one", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([
      seedBoard(),
      { ...seedBoard(), id: "b-2", title: "Second" },
    ]);
    vi.stubGlobal("fetch", server.handle);

    renderApp("/board/b-1");
    await waitReady();
    await waitFor(() =>
      expect(
        server.requests.some(
          (entry) => entry.path === "/api/v1/boards/b-1/events",
        ),
      ).toBe(true),
    );

    act(() => {
      server.revokeMembership("b-1");
      server.publishMembership("b-1", server.account.id, "removed");
    });

    // The board leaves the list at once, and the routing effect walks off
    // its now-dead URL onto the surviving board.
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("1"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Second"),
    );
    expect(
      await screen.findByText("You no longer have access to this board"),
    ).toBeTruthy();
  });

  it("says 'You left the board' for a cross-tab voluntary leave", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([
      seedBoard(),
      { ...seedBoard(), id: "b-2", title: "Second" },
    ]);
    vi.stubGlobal("fetch", server.handle);

    renderApp("/board/b-1");
    await waitReady();
    await waitFor(() =>
      expect(
        server.requests.some(
          (entry) => entry.path === "/api/v1/boards/b-1/events",
        ),
      ).toBe(true),
    );

    act(() => {
      server.revokeMembership("b-1");
      server.publishMembership("b-1", server.account.id, "left");
    });

    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("1"),
    );
    expect(await screen.findByText("You left the board")).toBeInTheDocument();
    expect(
      screen.queryByText("You no longer have access to this board"),
    ).not.toBeInTheDocument();
  });

  it("leaves the only board and lands on the empty state", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    fireEvent.click(screen.getByTestId("leave-b1"));

    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("0"),
    );
    expect(screen.getByTestId("title").textContent).toBe("");
    expect(await screen.findByText("You left the board")).toBeInTheDocument();
  });

  it("handles the SSE leave before the DELETE response without a duplicate", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    let resolveLeave!: (value: { status: "ok" }) => void;
    vi.spyOn(api, "leaveBoard").mockReturnValue(
      new Promise((resolve) => {
        resolveLeave = resolve;
      }),
    );

    renderApp();
    await waitReady();
    fireEvent.click(screen.getByTestId("leave-b1"));

    act(() => {
      server.revokeMembership("b-1");
      server.publishMembership("b-1", server.account.id, "left");
    });
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("0"),
    );
    expect(await screen.findByText("You left the board")).toBeInTheDocument();

    act(() => resolveLeave({ status: "ok" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getAllByText("You left the board")).toHaveLength(1);
  });

  it("does not toast an error when the DELETE response is lost after the leave", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    let rejectLeave!: (error: unknown) => void;
    vi.spyOn(api, "leaveBoard").mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLeave = reject;
      }),
    );

    renderApp();
    await waitReady();
    fireEvent.click(screen.getByTestId("leave-b1"));

    act(() => {
      server.revokeMembership("b-1");
      server.publishMembership("b-1", server.account.id, "left");
    });
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("0"),
    );
    expect(await screen.findByText("You left the board")).toBeInTheDocument();

    act(() => rejectLeave(new ApiError(0, null)));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.queryByText("No network connection to the server"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("You left the board")).toHaveLength(1);
  });

  it("treats a 403 stream as revocation and lands on the empty state", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(
        server.requests.some(
          (entry) => entry.path === "/api/v1/boards/b-1/events",
        ),
      ).toBe(true),
    );

    // No frame — the stream simply reconnects after the membership is gone;
    // the guard answers 403 and the bridge reports it as a revocation.
    // The reconnect rides the realtime backoff, hence the longer wait.
    act(() => {
      server.revokeMembership("b-1");
      server.closeEvents("b-1");
    });

    await waitFor(
      () => expect(screen.getByTestId("board-count").textContent).toBe("0"),
      { timeout: 5_000 },
    );
    expect(screen.getByTestId("title").textContent).toBe("");
  });

  it("refreshes the member directory when an invitation is accepted", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([seedBoard()]);
    server.membersByBoard.set("b-1", [
      {
        userId: "user-1",
        displayName: "Admin",
        email: "admin@example.com",
        role: "ADMIN",
        expiresAt: null,
        avatarColor: null,
        avatarPath: null,
      },
    ]);
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(
        server.requests.some(
          (entry) => entry.path === "/api/v1/boards/b-1/events",
        ),
      ).toBe(true),
    );
    expect(screen.getByTestId("newcomer").textContent).toBe("");

    // The invitee accepts on their side: the server announces it and every
    // open list re-reads the directory without a reload.
    act(() => {
      server.membersByBoard.set("b-1", [
        ...(server.membersByBoard.get("b-1") ?? []),
        {
          userId: "user-3",
          displayName: "Vera",
          email: "vera@example.com",
          role: "MEMBER",
          expiresAt: null,
          avatarColor: null,
          avatarPath: null,
        },
      ]);
      server.publishMembership("b-1", "user-3", "accepted");
    });

    await waitFor(() =>
      expect(screen.getByTestId("newcomer").textContent).toBe("Vera"),
    );
    expect(
      server.requests.filter(
        (entry) => entry.path === "/api/v1/boards/b-1/members",
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("BoardProvider server-mode failures and board management", () => {
  it("archives and unarchives a board through commands", async () => {
    const server = new FakeServer([
      seedBoard(),
      { ...seedBoard(), id: "b-2", title: "Second" },
    ]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("archive-second"));
    await waitFor(() =>
      expect(screen.getByTestId("second-archived").textContent).toBe("true"),
    );
    await waitFor(() =>
      expect(typeof server.boards.get("b-2")?.archivedAt).toBe("number"),
    );

    fireEvent.click(screen.getByTestId("unarchive-second"));
    await waitFor(() =>
      expect(screen.getByTestId("second-archived").textContent).toBe("false"),
    );
    expect(server.boards.get("b-2")?.archivedAt).toBeUndefined();
  });

  it("restores the board snapshot when a board-level command is refused", async () => {
    const server = new FakeServer([
      seedBoard(),
      { ...seedBoard(), id: "b-2", title: "Second" },
    ]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    server.failNextRequest(403, { message: "Only an ADMIN can archive" });
    fireEvent.click(screen.getByTestId("archive-second"));
    await waitFor(() =>
      expect(screen.getByTestId("second-archived").textContent).toBe("false"),
    );
    expect(server.boards.get("b-2")?.archivedAt).toBeUndefined();
  });

  it("rolls back and keeps the queue usable when the network drops", async () => {
    const server = new FakeServer([seedBoard()]);
    let dropCommands = false;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (dropCommands && (init?.method ?? "GET") === "POST") {
          throw new TypeError("Failed to fetch");
        }
        return server.handle(input, init);
      },
    );
    renderApp();
    await waitReady();

    dropCommands = true;
    fireEvent.click(screen.getByTestId("add-column"));
    await waitFor(() =>
      expect(screen.getByTestId("columns").textContent).toBe("Todo"),
    );
    expect(screen.getByTestId("can-undo").textContent).toBe("false");
    expect(server.boards.get("b-1")?.columns).toHaveLength(1);

    dropCommands = false;
    fireEvent.click(screen.getByTestId("add-column"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.columns.map((c) => c.title)).toEqual([
        "Todo",
        "New",
      ]),
    );
  });

  it("shows the error state when hydration fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    renderApp();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );
  });

  it("keeps the list unchanged when a REST create fails", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    server.failNextRequest(500, { message: "boom" });
    fireEvent.click(screen.getByTestId("add-board"));
    await waitFor(() =>
      expect(
        server.requests.filter(
          (r) => r.method === "POST" && r.path === "/api/v1/boards",
        ),
      ).toHaveLength(1),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("board-count").textContent).toBe("1");
    expect(server.boards.size).toBe(1);
  });

  it("opens the existing board when a starter response is ambiguous", async () => {
    const server = new FakeServer([seedBoard()]);
    const recovered = { ...seedBoard(), id: "b-rec", title: "Recovered" };
    let boardReads = 0;
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input.toString(),
          "http://api.test",
        );
        if (url.pathname === "/api/v1/boards" && init?.method === "POST") {
          posts += 1;
          return new Response(
            JSON.stringify({
              code: "starter_cleanup_failed",
              retryable: false,
              details: { boardId: "b-rec" },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.pathname === "/api/v1/boards/b-rec") {
          boardReads += 1;
          return new Response(JSON.stringify(recovered), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return server.handle(input, init);
      },
    );
    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("add-board"));
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("2"),
    );
    expect(posts).toBe(1);
    expect(boardReads).toBe(1);
    expect(
      await screen.findByText(
        "The board was created, but the example could not be added.",
      ),
    ).toBeInTheDocument();
  });

  it("recovers a plain create whose first read failed", async () => {
    const server = new FakeServer([seedBoard()]);
    const recovered = { ...seedBoard(), id: "b-read", title: "Read board" };
    let posts = 0;
    let boardReads = 0;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input.toString(),
          "http://api.test",
        );
        if (url.pathname === "/api/v1/boards" && init?.method === "POST") {
          posts += 1;
          return new Response(
            JSON.stringify({
              code: "board_read_failed",
              retryable: false,
              details: { boardId: "b-read" },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.pathname === "/api/v1/boards/b-read") {
          boardReads += 1;
          return new Response(JSON.stringify(recovered), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return server.handle(input, init);
      },
    );
    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("add-board"));
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("2"),
    );
    expect(posts).toBe(1);
    expect(boardReads).toBe(1);
    expect(
      screen.queryByText(
        "The board was created, but it could not be loaded. Reload the page to open it.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "The board was created, but the example could not be added.",
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps the known board when the recovery read also fails", async () => {
    const server = new FakeServer([seedBoard()]);
    let posts = 0;
    let boardReads = 0;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input.toString(),
          "http://api.test",
        );
        if (url.pathname === "/api/v1/boards" && init?.method === "POST") {
          posts += 1;
          return new Response(
            JSON.stringify({
              code: "board_read_failed",
              retryable: false,
              details: { boardId: "b-flaky" },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.pathname === "/api/v1/boards/b-flaky") {
          boardReads += 1;
          return new Response(JSON.stringify({ message: "down" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        return server.handle(input, init);
      },
    );
    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("add-board"));
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("2"),
    );
    expect(posts).toBe(1);
    expect(boardReads).toBe(3);
    expect(
      await screen.findByText(
        "The board was created, but it could not be loaded. Reload the page to open it.",
      ),
    ).toBeInTheDocument();
  });

  it("deletes a board over REST, and keeps it when the server refuses", async () => {
    const server = new FakeServer([
      seedBoard(),
      { ...seedBoard(), id: "b-2", title: "Second" },
    ]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    server.failNextRequest(403, { message: "nope" });
    fireEvent.click(screen.getByTestId("remove-second"));
    await waitFor(() =>
      expect(server.requests.filter((r) => r.method === "DELETE")).toHaveLength(
        1,
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("board-count").textContent).toBe("2");

    fireEvent.click(screen.getByTestId("remove-second"));
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("1"),
    );
    expect(server.boards.size).toBe(1);
  });

  it("leaves a board over REST and drops it from the switcher (TASK-177.2)", async () => {
    const server = new FakeServer([
      seedBoard(),
      { ...seedBoard(), id: "b-2", title: "Second" },
    ]);
    const titlesAfterLeave = new Set<string>();
    function LeaveProbe() {
      const { board, boards } = useBoard();
      // Capture any intermediate commit between removal and navigation.
      useLayoutEffect(() => {
        if (boards.length === 1 && boards[0].id === "b-2") {
          titlesAfterLeave.add(board?.title ?? "");
        }
      }, [board, boards]);
      return <Probe />;
    }

    vi.stubGlobal("fetch", server.handle);
    renderApp("/board/b-1", <LeaveProbe />);
    await waitReady();

    // A refusal — e.g. the last ADMIN — keeps the board and local state.
    server.failNextRequest(409, {
      message: "Cannot leave the last ADMIN of the board",
      code: "last_admin",
    });
    fireEvent.click(screen.getByTestId("leave-b1"));
    expect(
      await screen.findByText(
        "You are the last admin. Make another admin before leaving the board.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("board-count").textContent).toBe("2");
    expect(screen.getByTestId("title").textContent).toBe("Board");

    // A real leave forgets the board, its role and its resume point.
    fireEvent.click(screen.getByTestId("leave-b1"));
    await waitFor(() => {
      expect(screen.getByTestId("board-count").textContent).toBe("1");
      expect(screen.getByTestId("title").textContent).toBe("Second");
    });
    expect([...titlesAfterLeave]).toEqual(["Second"]);
    expect(server.revoked.has("b-1")).toBe(true);
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toContain(
      "DELETE /api/v1/boards/b-1/members/me",
    );
  });

  it("imports boards over REST and re-hydrates, or leaves the list alone on failure", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    server.failNextRequest(500, { message: "boom" });
    fireEvent.click(screen.getByTestId("import-board"));
    await waitFor(() =>
      expect(
        server.requests.filter((r) => r.path === "/api/v1/boards/import"),
      ).toHaveLength(1),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(server.boards.size).toBe(1);

    fireEvent.click(screen.getByTestId("import-board"));
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("2"),
    );
    expect(server.boards.size).toBe(2);
  });

  it("refetches on visibilitychange as well", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    server.overwriteBoard("b-1", (board) => {
      board.title = "Remote title";
      return board;
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Remote title"),
    );
  });
});

describe("BoardProvider realtime review fixes (U-1…U-9)", () => {
  it("keeps a queued optimistic edit and its undo history during a board refresh", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("quiet-edit"));
    expect(screen.getByTestId("card-title").textContent).toBe("Mine");
    expect(screen.getByTestId("can-undo").textContent).toBe("true");
    fireEvent.click(screen.getByTestId("refresh-boards"));
    await waitFor(() =>
      expect(
        server.requests.filter((request) => request.path === "/api/v1/boards"),
      ).toHaveLength(2),
    );
    expect(screen.getByTestId("card-title").textContent).toBe("Mine");
    expect(screen.getByTestId("can-undo").textContent).toBe("true");
  });

  async function waitStream(server: FakeServer, boardId = "b-1") {
    await waitFor(() =>
      expect(
        server.requests.some(
          (entry) => entry.path === `/api/v1/boards/${boardId}/events`,
        ),
      ).toBe(true),
    );
  }

  // A focus/idle refetch goes through the read-model summary (TASK-200.9);
  // an old server fallback and the fatal-stream existence check still use the
  // full aggregate. Count either representation as "one snapshot request".
  const snapshotGets = (server: FakeServer, boardId = "b-1") =>
    server.requests.filter(
      (entry) =>
        entry.method === "GET" &&
        (entry.path === `/api/v1/boards/${boardId}` ||
          entry.path === `/api/v1/boards/${boardId}/summary`),
    ).length;

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it("drains a pending command reconciliation when the browser comes online", async () => {
    const server = new FakeServer([seedBoard()]);
    const online = vi.spyOn(navigator, "onLine", "get");
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const response = await server.handle(input, init);
      if (input.endsWith("/boards/b-1/commands")) {
        online.mockReturnValue(false);
        throw new TypeError("Connection lost after commit");
      }
      return response;
    });
    renderApp();
    await waitReady();
    await waitStream(server);
    const before = snapshotGets(server);

    fireEvent.click(screen.getByTestId("edit"));
    expect(
      await screen.findByText(
        "Could not confirm the change. Syncing with the server.",
      ),
    ).toBeInTheDocument();
    expect(snapshotGets(server)).toBe(before);

    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(snapshotGets(server)).toBe(before + 1);
    expect(screen.getByTestId("card-title")).toHaveTextContent("Mine");

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(snapshotGets(server)).toBe(before + 1);
  });

  it("applies a same-account agent's command held back while our command is in flight (U-1)", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitStream(server);

    // Our command is in flight and not committed yet: the agent — an MCP
    // client on this user's own key, so the *same actor* — commits first
    // and gets the lower seq. The old filter (`actorId === me && seq <=
    // ownSeq`) took its event for our own echo and dropped it for good.
    const release = server.holdNextCommandBeforeCommit();
    fireEvent.click(screen.getByTestId("add-column"));
    act(() => {
      server.publishCommand(
        "b-1",
        { type: "RENAME_BOARD", title: "Agent", at: Date.now() },
        server.account.id,
      );
    });
    await sleep(30);
    // Held back while our optimistic command is unanswered.
    expect(screen.getByTestId("title").textContent).toBe("Board");

    act(() => release());
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Agent"),
    );
    expect(screen.getByTestId("columns").textContent).toBe("Todo,New");
    // The agent's event was ordered before ours: instead of applying it on
    // top of our optimistic state (U-7), the board was re-read once.
    expect(server.boards.get("b-1")?.title).toBe("Agent");
  });

  it("applies the agent's earlier command when our ack beat the stream (U-1, U-7)", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitStream(server);
    const before = snapshotGets(server);

    // The stream is down: our ack arrives first, the events only on the
    // reconnect — the agent's (lower seq, same actor) and then our echo.
    act(() => server.closeEvents("b-1"));
    const release = server.holdNextCommandBeforeCommit();
    fireEvent.click(screen.getByTestId("add-column"));
    act(() => {
      server.publishCommand(
        "b-1",
        { type: "RENAME_BOARD", title: "Agent", at: Date.now() },
        server.account.id,
      );
    });
    act(() => release());
    await waitFor(() =>
      expect(server.boards.get("b-1")?.columns).toHaveLength(2),
    );

    await waitFor(
      () => expect(screen.getByTestId("title").textContent).toBe("Agent"),
      { timeout: 5_000 },
    );
    expect(screen.getByTestId("columns").textContent).toBe("Todo,New");
    expect(snapshotGets(server)).toBeGreaterThan(before);
  });

  it("still recognises its own echo on an older server without commandId", async () => {
    const server = new FakeServer([seedBoard()]);
    server.emitCommandIds = false;
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitStream(server);

    fireEvent.click(screen.getByTestId("add-column"));
    await waitFor(() => expect(server.seqOf("b-1")).toBeGreaterThan(0));
    await sleep(30);
    expect(screen.getByTestId("columns").textContent).toBe("Todo,New");
    expect(screen.getByTestId("can-undo").textContent).toBe("true");
  });

  it("refetches the board when the server sends resync", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitStream(server);

    server.overwriteBoard("b-1", (board) => ({ ...board, title: "Fresh" }));
    act(() => server.publishResync("b-1"));
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Fresh"),
    );
  });

  it("re-reads the board when the catch-up gap is truncated", async () => {
    const server = new FakeServer([seedBoard()]);
    server.maxCatchUp = 1;
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    await waitStream(server);

    act(() => {
      server.closeEvents("b-1");
      for (const title of ["One", "Two", "Three"]) {
        server.publishCommand("b-1", { type: "RENAME_BOARD", title, at: 1 });
      }
    });
    await waitFor(
      () => expect(screen.getByTestId("title").textContent).toBe("Three"),
      { timeout: 5_000 },
    );
  });

  it("single-flights focus and visibilitychange into one snapshot request (U-2)", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();
    const before = snapshotGets(server);

    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(30);
    expect(snapshotGets(server)).toBe(before + 1);
  });

  it("discards a focus snapshot that predates a command sent while it was in flight (U-2)", async () => {
    const server = new FakeServer([seedBoard()]);
    let gate: Promise<void> | null = null;
    let open: () => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        // The fake computes the answer on arrival; holding it back models a
        // slow snapshot taken *before* our command.
        const response = await server.handle(input, init);
        const url = new URL(String(input), "http://api.test");
        if (
          gate !== null &&
          (init?.method ?? "GET") === "GET" &&
          url.pathname === "/api/v1/boards/b-1"
        ) {
          await gate;
        }
        return response;
      },
    );
    renderApp();
    await waitReady();
    const before = snapshotGets(server);

    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(snapshotGets(server)).toBe(before + 1));
    fireEvent.click(screen.getByTestId("add-column"));
    await waitFor(() =>
      expect(server.boards.get("b-1")?.columns).toHaveLength(2),
    );
    gate = null;
    act(() => open());
    await sleep(30);
    // The pre-command snapshot must not erase the acknowledged column.
    expect(screen.getByTestId("columns").textContent).toBe("Todo,New");
  });

  it("discards a snapshot older than the events already applied (U-2)", async () => {
    const server = new FakeServer([seedBoard()]);
    let gate: Promise<void> | null = null;
    let open: () => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await server.handle(input, init);
        const url = new URL(String(input), "http://api.test");
        if (
          gate !== null &&
          (init?.method ?? "GET") === "GET" &&
          url.pathname === "/api/v1/boards/b-1"
        ) {
          await gate;
        }
        return response;
      },
    );
    renderApp();
    await waitReady();
    await waitStream(server);
    const before = snapshotGets(server);

    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(snapshotGets(server)).toBe(before + 1));
    act(() => {
      server.publishCommand("b-1", {
        type: "RENAME_BOARD",
        title: "Live",
        at: Date.now(),
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Live"),
    );
    gate = null;
    act(() => open());
    await sleep(30);
    expect(screen.getByTestId("title").textContent).toBe("Live");
  });

  it("re-reads the board instead of keeping a refused command buried under newer ones (U-4)", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    // Two commands in one go; the first is refused while the second is
    // already applied on top — its step is "dead" and cannot be reverted.
    server.failNextCommand(409, { conflict: "wip", currentVersion: 0 });
    fireEvent.click(screen.getByTestId("add-two-columns"));
    expect(screen.getByTestId("columns").textContent).toBe("Todo,One,Two");
    await waitFor(() =>
      expect(screen.getByTestId("columns").textContent).toBe("Todo,Two"),
    );
    expect(server.boards.get("b-1")?.columns.map((c) => c.title)).toEqual([
      "Todo",
      "Two",
    ]);
  });

  it("revokes the board the user navigated to, not the one the stream started on (U-5)", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([
      seedBoard(),
      { ...seedBoard(), id: "b-2", title: "Second" },
    ]);
    vi.stubGlobal("fetch", server.handle);
    renderApp("/board/b-1");
    await waitReady();
    await waitStream(server, "b-1");
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("2"),
    );

    fireEvent.click(screen.getByTestId("go-b2"));
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Second"),
    );
    await waitStream(server, "b-2");

    act(() => {
      server.revokeMembership("b-2");
      server.publishMembership("b-2", server.account.id, "removed");
    });
    // The handler sees the *current* route and walks off the dead board.
    await waitFor(() =>
      expect(screen.getByTestId("title").textContent).toBe("Board"),
    );
  });

  it("flushes coalesced edits on pagehide (U-3)", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("quiet-desc"));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    // Sent at once — not after the 400 ms coalescing window.
    await waitFor(
      () =>
        expect(server.boards.get("b-1")?.cards["c-1"].description).toBe(
          "Draft",
        ),
      { timeout: 200 },
    );
  });

  it("sends pending edits before logging out (U-3)", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderApp();
    await waitReady();

    fireEvent.click(screen.getByTestId("quiet-desc"));
    fireEvent.click(screen.getByTestId("logout"));
    await waitFor(() =>
      expect(
        server.requests.some((entry) => entry.path === "/api/v1/auth/logout"),
      ).toBe(true),
    );
    const paths = server.requests.map((entry) => entry.path);
    const command = paths.lastIndexOf("/api/v1/boards/b-1/commands");
    expect(command).toBeGreaterThan(-1);
    expect(command).toBeLessThan(paths.indexOf("/api/v1/auth/logout"));
    expect(server.boards.get("b-1")?.cards["c-1"].description).toBe("Draft");
  });

  it("hydrates the routed board first and the rest in the background (U-9)", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([
      seedBoard(),
      { ...seedBoard(), id: "b-2", title: "Second" },
      { ...seedBoard(), id: "b-3", title: "Third" },
    ]);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://api.test");
        if (
          url.pathname === "/api/v1/boards/b-1/summary" ||
          url.pathname === "/api/v1/boards/b-3/summary" ||
          url.pathname === "/api/v1/boards/b-1" ||
          url.pathname === "/api/v1/boards/b-3"
        ) {
          await gate;
        }
        return server.handle(input, init);
      },
    );
    renderApp("/board/b-2");
    // Ready with the routed board alone, while the others are still loading.
    await waitReady();
    expect(screen.getByTestId("title").textContent).toBe("Second");
    expect(screen.getByTestId("board-count").textContent).toBe("1");
    expect(screen.getByTestId("pending-board-count").textContent).toBe("2");

    act(() => open());
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("3"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("pending-board-count").textContent).toBe("0"),
    );
  });

  it("clears pending rows when a re-hydration fails before its own count", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([
      seedBoard(),
      { ...seedBoard(), id: "b-2", title: "Second" },
      { ...seedBoard(), id: "b-3", title: "Third" },
    ]);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let failList = false;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://api.test");
        if (
          url.pathname === "/api/v1/boards" &&
          (init?.method ?? "GET") === "GET" &&
          failList
        ) {
          return new Response(JSON.stringify({ message: "down" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (
          url.pathname === "/api/v1/boards/b-1/summary" ||
          url.pathname === "/api/v1/boards/b-3/summary" ||
          url.pathname === "/api/v1/boards/b-1" ||
          url.pathname === "/api/v1/boards/b-3"
        ) {
          await gate;
        }
        return server.handle(input, init);
      },
    );
    renderApp("/board/b-2");
    await waitReady();
    expect(screen.getByTestId("pending-board-count").textContent).toBe("2");

    failList = true;
    fireEvent.click(screen.getByTestId("refresh-boards"));

    await waitFor(() =>
      expect(screen.getByTestId("pending-board-count").textContent).toBe("0"),
    );
    // The failed refresh did not drop the already-rendered routed board.
    expect(screen.getByTestId("board-count").textContent).toBe("1");

    act(() => open());
  });

  it("re-reads a long-idle board as one snapshot instead of replaying its backlog (U-9)", async () => {
    localStorage.removeItem(BOARD_STORAGE_KEY);
    const server = new FakeServer([
      seedBoard(),
      { ...seedBoard(), id: "b-2", title: "Second" },
    ]);
    const eventUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/events")) eventUrls.push(url);
        return server.handle(input, init);
      },
    );
    renderApp("/board/b-1");
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("board-count").textContent).toBe("2"),
    );

    // b-2 moves on for a long time while nobody watches it.
    for (let index = 1; index <= 40; index += 1) {
      server.publishCommand("b-2", {
        type: "RENAME_BOARD",
        title: `Renamed ${index}`,
        at: index,
      });
    }
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 10 * 60_000);
    try {
      fireEvent.click(screen.getByTestId("go-b2"));
      await waitFor(() =>
        expect(screen.getByTestId("title").textContent).toBe("Renamed 40"),
      );
      await waitFor(() =>
        expect(eventUrls.some((url) => url.includes("/b-2/events"))).toBe(true),
      );
    } finally {
      clock.mockRestore();
    }
    // The stream resumed from the snapshot: nothing left to replay.
    const b2 = eventUrls.find((url) => url.includes("/b-2/events")) ?? "";
    expect(b2).toContain("since=40");
  });
});

describe("fatal stream 404 recovery (TASK-156 review)", () => {
  /**
   * A fetch wrapper that answers 404 for exactly the armed paths (once
   * each) and defers everything else to the fake server. Armed only when
   * the test says so, so the first hydration and stream stay healthy.
   */
  function failingPaths(server: FakeServer) {
    const pending: string[] = [];
    const fail = (...paths: string[]): void => {
      pending.push(...paths);
    };
    const handle = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(String(input), "http://api.test");
      const index = pending.indexOf(url.pathname);
      if (index !== -1) {
        pending.splice(index, 1);
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return server.handle(input, init);
    };
    return { fail, handle };
  }

  it("re-attaches the stream when a transient 404 hits a live board", async () => {
    const server = new FakeServer([seedBoard()]);
    const flaky = failingPaths(server);
    vi.stubGlobal("fetch", flaky.handle);

    renderApp();
    await waitReady();
    await waitFor(() => expect(server.hasEventStream("b-1")).toBe(true));

    // The stream drops; the reconnect is answered by a proxy 404 — fatal
    // for the connection, but the snapshot re-read confirms the board is
    // alive, so the bridge must watch it again instead of going quiet.
    flaky.fail("/api/v1/boards/b-1/events");
    server.closeEvents("b-1");

    await waitFor(() => expect(server.hasEventStream("b-1")).toBe(true), {
      timeout: 5_000,
    });
    // The board survived the transient answer…
    expect(screen.getByTestId("title").textContent).toBe("Board");
    expect(screen.getByTestId("board-count").textContent).toBe("1");
    // …and the re-attached stream is live: a pushed roster still lands.
    server.publishPresence("b-1", [
      {
        id: "user-2",
        displayName: "Boris",
        avatarColor: null,
        avatarPath: null,
      },
    ]);
    await waitFor(() =>
      expect(screen.getByTestId("presence").textContent).toContain("Boris"),
    );
  });

  it("still revokes the board when the snapshot confirms it is gone", async () => {
    const server = new FakeServer([seedBoard()]);
    const flaky = failingPaths(server);
    vi.stubGlobal("fetch", flaky.handle);

    renderApp();
    await waitReady();
    await waitFor(() => expect(server.hasEventStream("b-1")).toBe(true));

    // The stream 404s and so does the snapshot re-read: the board really
    // was deleted — it must leave the store, not come back as a zombie.
    flaky.fail("/api/v1/boards/b-1/events", "/api/v1/boards/b-1");
    server.closeEvents("b-1");

    await waitFor(
      () => expect(screen.getByTestId("board-count").textContent).toBe("0"),
      { timeout: 5_000 },
    );
    // No stream is (re-)opened for the revoked board afterwards.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(server.hasEventStream("b-1")).toBe(false);
  });
});
