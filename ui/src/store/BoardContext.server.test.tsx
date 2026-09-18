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

import type { Board, Card, CommandRequest } from "@janosik/shared";
import { BOARD_STORAGE_KEY } from "@janosik/shared";
import { api } from "@/api/client";
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
  const { board, boards, syncStatus, canUndo, canRedo } = useBoard();
  const actions = useBoardActions();
  const { user } = useAuth();
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
      <div data-testid="card-title">{board?.cards["c-1"]?.title ?? ""}</div>
      <div data-testid="columns">
        {board?.columns.map((column) => column.title).join(",") ?? ""}
      </div>
      <div data-testid="board-count">{String(boards.length)}</div>
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
    </div>
  );
}

function renderApp(path = "/board/b-1") {
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
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
      { id: "user-2", displayName: "Boris", avatarColor: null },
    ];
    vi.stubGlobal("fetch", server.handle);

    renderApp();
    await waitReady();
    await waitFor(() =>
      expect(screen.getByTestId("presence").textContent).toBe("Boris"),
    );

    act(() => {
      server.publishPresence("b-1", [
        { id: "user-1", displayName: "Admin", avatarColor: null },
        { id: "user-2", displayName: "Boris", avatarColor: null },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByTestId("presence").textContent).toBe("Admin,Boris"),
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
