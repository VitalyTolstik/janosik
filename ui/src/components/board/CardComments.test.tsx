import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board, CommentDto } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { CardComments } from "@/components/board/CardComments";
import { UserProfileProvider } from "@/components/board/UserProfileDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

// The real composer/body are MDXEditor (lazy chunk, jsdom-heavy); the
// thread behaviour under test is the data flow, not the editor internals.
vi.mock("@/components/editor/CommentEditor", () => ({
  CommentComposerEditor: ({
    value,
    onChange,
    onSubmit,
    onCancel,
    placeholder,
  }: {
    value?: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel?: () => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="comment-input"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          onSubmit();
        }
        if (event.key === "Escape" && onCancel !== undefined) {
          onCancel();
        }
      }}
    />
  ),
  CommentBody: ({ text }: { text: string }) => <p>{text}</p>,
}));

/**
 * The card comment thread (TASK-37) over the fake API: optimistic send via
 * Save or Ctrl/Cmd+Enter, Cancel clearing the draft, own-comment deletion
 * behind a confirmation, cursor pagination and the live arrival of someone
 * else's comment through the SSE bridge.
 */

function seedBoard(): Board {
  return {
    id: "b-1",
    title: "Board",
    columns: [],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function comment(overrides: Partial<CommentDto> = {}): CommentDto {
  return {
    id: "comment-1",
    cardId: "card-1",
    authorId: "user-1",
    text: "First!",
    kind: "note",
    actorType: "human",
    apiTokenId: null,
    agentSessionId: null,
    agentName: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function renderComments(
  server: FakeServer,
  readOnly = false,
  handler: FetchHandler = server.handle,
) {
  vi.stubGlobal("fetch", handler);
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/board/b-1"]}>
            <TooltipProvider>
              <BoardProvider>
                <UserProfileProvider boardId="b-1">
                  <CardComments
                    cardId="card-1"
                    boardId="b-1"
                    readOnly={readOnly}
                  />
                </UserProfileProvider>
              </BoardProvider>
            </TooltipProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

/**
 * Wait until the realtime stream is actually open (the request is in flight
 * *and* the reader is attached), not just a fixed sleep — so a frame
 * published afterwards is never missed under load.
 */
async function waitStream(server: FakeServer, boardId = "b-1") {
  await waitFor(() =>
    expect(server.requests.some((r) => r.path.endsWith("/events"))).toBe(true),
  );
  await waitFor(() => expect(server.hasEventStream(boardId)).toBe(true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

describe("CardComments", () => {
  it("shows a busy skeleton until the first page arrives", async () => {
    const server = new FakeServer();
    server.commentsByCard.set("card-1", [comment()]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler: FetchHandler = async (input, init) => {
      await gate;
      return server.handle(input, init);
    };

    renderComments(server, false, handler);

    const skeleton = await screen.findByTestId("card-comments-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(within(skeleton).getByRole("status")).toHaveTextContent(
      "Loading comments…",
    );
    expect(screen.queryByText("No comments yet")).not.toBeInTheDocument();

    act(() => release());

    expect(await screen.findByTestId("comment")).toHaveTextContent("First!");
    expect(
      screen.queryByTestId("card-comments-skeleton"),
    ).not.toBeInTheDocument();
  });

  it("lists the thread and sends a comment via Save, optimistically", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [comment({ text: "Old note" })]);
    renderComments(server);

    expect(await screen.findByText("Old note")).toBeInTheDocument();

    // The composer is lazy (MDXEditor chunk), so it resolves a tick later.
    const input = await screen.findByTestId("comment-input");
    fireEvent.change(input, { target: { value: "  Fresh take  " } });
    fireEvent.click(screen.getByTestId("comment-send"));

    // The optimistic row appears before the server answers.
    await waitFor(() =>
      expect(screen.getByText("Fresh take")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText("Fresh take").closest("li")).not.toHaveAttribute(
        "data-pending",
      ),
    );
    // A sent draft resets the editor by remounting it.
    expect(await screen.findByTestId("comment-input")).toHaveValue("");
    expect(
      server.requests.find(
        (request) =>
          request.method === "POST" &&
          request.path === "/api/v1/cards/card-1/comments",
      )?.body,
      // TASK-99: the POST carries an idempotency key alongside the text.
    ).toEqual({
      text: "Fresh take",
      commandId: expect.any(String),
    });
  });

  it("labels an agent comment with its token and session (TASK-166.13)", async () => {
    const server = new FakeServer();
    server.commentsByCard.set("card-1", [
      comment({
        actorType: "agent",
        apiTokenId: "token-qa-123456",
        agentSessionId: "session-abcdef",
        agentName: "QA agent",
      }),
    ]);
    renderComments(server);

    const row = await screen.findByTestId("comment");
    expect(within(row).getByTestId("comment-agent-badge")).toHaveTextContent(
      "AI",
    );
    expect(within(row).getByTestId("agent-attribution")).toHaveTextContent(
      "QA agent",
    );
    expect(
      within(row).getByTestId("agent-attribution-token"),
    ).toHaveTextContent("token-qa");
  });

  it("renders a kind badge for a typed comment", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ text: "Stuck on the schema", kind: "blocker" }),
    ]);
    renderComments(server);
    expect(await screen.findByText("Stuck on the schema")).toBeInTheDocument();
    expect(screen.getByTestId("comment-kind-badge")).toHaveTextContent(
      /blocker/i,
    );
  });

  it("offers the comment kinds in a themed radio picker", async () => {
    const server = new FakeServer([seedBoard()]);
    renderComments(server);

    fireEvent.click(await screen.findByTestId("comment-kind"));
    const group = screen.getByRole("radiogroup", { name: "Comment kind" });
    expect(within(group).getAllByRole("radio")).toHaveLength(6);
    expect(screen.getByTestId("comment-kind-option-note")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByTestId("comment-kind-option-question"));
    expect(screen.getByTestId("comment-kind")).toHaveTextContent("Question");
  });

  it("sends the chosen comment kind", async () => {
    const server = new FakeServer([seedBoard()]);
    renderComments(server);
    const input = await screen.findByTestId("comment-input");
    fireEvent.change(input, { target: { value: "Blocked" } });
    fireEvent.click(await screen.findByTestId("comment-kind"));
    fireEvent.click(await screen.findByTestId("comment-kind-option-blocker"));
    fireEvent.click(screen.getByTestId("comment-send"));
    await waitFor(() =>
      expect(
        server.requests.find(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/cards/card-1/comments",
        )?.body,
      ).toEqual({
        text: "Blocked",
        commandId: expect.any(String),
        kind: "blocker",
      }),
    );
  });

  it("submits with Ctrl/Cmd+Enter and keeps plain Enter harmless", async () => {
    const server = new FakeServer([seedBoard()]);
    renderComments(server);
    const input = await screen.findByTestId("comment-input");

    fireEvent.change(input, { target: { value: "Keyboard one" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      server.requests.some(
        (request) =>
          request.method === "POST" &&
          request.path === "/api/v1/cards/card-1/comments",
      ),
    ).toBe(false);

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(
        server.requests.some(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/cards/card-1/comments",
        ),
      ).toBe(true),
    );
  });

  it("disables Save on an empty draft (Cancel always rendered)", async () => {
    const server = new FakeServer([seedBoard()]);
    renderComments(server);
    const input = await screen.findByTestId("comment-input");
    const send = screen.getByTestId("comment-send");

    // Empty: Save is disabled, Cancel too (nothing to cancel).
    expect(send).toBeDisabled();
    expect(screen.getByTestId("comment-cancel")).toBeDisabled();

    // Over the hard limit: still disabled.
    fireEvent.change(input, {
      target: { value: "x".repeat(LIMITS.comment + 1) },
    });
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: "ok" } });
    expect(send).toBeEnabled();
  });

  it("clears the draft with Cancel and sends nothing", async () => {
    const server = new FakeServer([seedBoard()]);
    renderComments(server);
    const input = await screen.findByTestId("comment-input");

    fireEvent.change(input, { target: { value: "To be discarded" } });
    fireEvent.click(screen.getByTestId("comment-cancel"));

    // Cancel resets the editor by remounting it.
    expect(await screen.findByTestId("comment-input")).toHaveValue("");
    // Save is disabled on the empty draft again…
    expect(screen.getByTestId("comment-send")).toBeDisabled();
    // …and no request went out.
    expect(
      server.requests.some(
        (request) =>
          request.method === "POST" &&
          request.path === "/api/v1/cards/card-1/comments",
      ),
    ).toBe(false);
  });

  it("deletes an own comment after the confirmation", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [comment({ text: "Mine" })]);
    renderComments(server);

    fireEvent.click(await screen.findByTestId("comment-delete"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.queryByText("Mine")).not.toBeInTheDocument(),
    );
    expect(
      server.requests.some(
        (request) =>
          request.method === "DELETE" &&
          request.path === "/api/v1/comments/comment-1",
      ),
    ).toBe(true);
  });

  it("offers no delete on someone else's comment and none in read-only", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-9", authorId: "user-2", text: "Foreign" }),
    ]);
    const { unmount } = renderComments(server);
    expect(await screen.findByText("Foreign")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-delete")).toBeNull();
    unmount();

    const readOnlyServer = new FakeServer([seedBoard()]);
    readOnlyServer.seedComments("card-1", [comment()]);
    renderComments(readOnlyServer, true);
    expect(await screen.findByText("First!")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-input")).toBeNull();
    expect(screen.queryByTestId("comment-delete")).toBeNull();
  });

  it("pages older comments with the opaque cursor", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments(
      "card-1",
      Array.from({ length: 51 }, (_, index) =>
        comment({
          id: `comment-${index}`,
          text: `Comment ${index}`,
          createdAt: 1_700_000_000_000 + index,
        }),
      ),
    );
    renderComments(server);
    await screen.findByText("Comment 0");

    const older = await screen.findByTestId("comments-show-older");
    fireEvent.click(older);

    expect(await screen.findByText("Comment 50")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("comments-show-older")).toBeNull(),
    );
  });

  it("pulls in someone else's comment the moment it arrives", async () => {
    const server = new FakeServer([seedBoard()]);
    renderComments(server);
    await waitStream(server);

    act(() => {
      server.seedComments("card-1", [
        comment({ id: "comment-7", authorId: "user-2", text: "Live one" }),
      ]);
      server.publishActivity("b-1", {
        type: "activity",
        id: "activity-1",
        boardId: "b-1",
        cardId: "card-1",
        actorId: "user-2",
        at: Date.now(),
        kind: "comment_added",
        detail: "comment-7",
      });
    });

    expect(await screen.findByText("Live one")).toBeInTheDocument();
  });

  it("drops a comment deleted elsewhere", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-7", text: "Doomed" }),
    ]);
    renderComments(server);
    await screen.findByText("Doomed");
    await waitStream(server);

    act(() => {
      server.publishActivity("b-1", {
        type: "activity",
        id: "activity-2",
        boardId: "b-1",
        cardId: "card-1",
        actorId: "user-1",
        at: Date.now(),
        kind: "comment_deleted",
        detail: "comment-7",
      });
    });

    await waitFor(() =>
      expect(screen.queryByText("Doomed")).not.toBeInTheDocument(),
    );
  });

  it("offers Edit only on the author's own comment and never in read-only", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-9", authorId: "user-2", text: "Foreign" }),
    ]);
    const { unmount } = renderComments(server);
    expect(await screen.findByText("Foreign")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-edit")).toBeNull();
    unmount();

    const readOnlyServer = new FakeServer([seedBoard()]);
    readOnlyServer.seedComments("card-1", [comment()]);
    renderComments(readOnlyServer, true);
    expect(await screen.findByText("First!")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-edit")).toBeNull();
  });

  it("edits an own comment in place, keeps its position and marks it edited", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-1", text: "First!" }),
      comment({ id: "comment-2", text: "Second" }),
    ]);
    renderComments(server);
    await screen.findByText("First!");

    fireEvent.click(screen.getAllByTestId("comment-edit")[0]);
    const editingRow = screen.getAllByTestId("comment")[0];
    const input = await within(editingRow).findByTestId("comment-input");
    expect(input).toHaveValue("First!");
    fireEvent.change(input, { target: { value: "First, edited" } });
    fireEvent.click(screen.getByTestId("comment-edit-save"));

    await waitFor(() => {
      const rows = screen.getAllByTestId("comment");
      expect(rows[0]).toHaveTextContent("First, edited");
      expect(rows[1]).toHaveTextContent("Second");
      expect(within(rows[0]).getByTestId("comment-edited")).toBeInTheDocument();
      // The editor is gone: the text above is the rendered body, not the
      // textarea's value.
      expect(
        within(rows[0]).queryByTestId("comment-edit-save"),
      ).not.toBeInTheDocument();
    });
    expect(
      server.requests.find(
        (request) =>
          request.method === "PATCH" &&
          request.path === "/api/v1/comments/comment-1",
      )?.body,
    ).toEqual({ text: "First, edited" });
  });

  it("cancels the inline edit with Escape without sending", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [comment({ text: "Unchanged" })]);
    renderComments(server);
    await screen.findByText("Unchanged");

    fireEvent.click(screen.getByTestId("comment-edit"));
    const row = screen.getByTestId("comment");
    const input = await within(row).findByTestId("comment-input");
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(await screen.findByText("Unchanged")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-edit-save")).toBeNull();
    expect(
      server.requests.filter(
        (request) =>
          request.method === "PATCH" &&
          request.path === "/api/v1/comments/comment-1",
      ),
    ).toEqual([]);
  });

  it("keeps the draft open and the stored row intact when saving fails", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [comment({ text: "Stored" })]);
    renderComments(server, false, async (input, init) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ message: "nope" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return server.handle(input, init);
    });
    await screen.findByText("Stored");

    fireEvent.click(screen.getByTestId("comment-edit"));
    const row = screen.getByTestId("comment");
    const input = await within(row).findByTestId("comment-input");
    fireEvent.change(input, { target: { value: "Attempt" } });
    fireEvent.click(screen.getByTestId("comment-edit-save"));

    expect(
      await screen.findByText("Could not save the comment"),
    ).toBeInTheDocument();
    // The draft survives the failure…
    expect(
      within(screen.getByTestId("comment")).getByTestId("comment-input"),
    ).toHaveValue("Attempt");
    // …and cancelling shows the original stored text again.
    fireEvent.click(screen.getByTestId("comment-edit-cancel"));
    expect(await screen.findByText("Stored")).toBeInTheDocument();
  });

  it("updates an edited comment from a second tab through comment_updated", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-7", text: "Before" }),
    ]);
    renderComments(server);
    await screen.findByText("Before");
    await waitStream(server);

    act(() => {
      server.seedComments("card-1", [
        comment({
          id: "comment-7",
          text: "After",
          editedAt: Date.now(),
        }),
      ]);
      server.publishActivity("b-1", {
        type: "activity",
        id: "activity-3",
        boardId: "b-1",
        cardId: "card-1",
        actorId: "user-1",
        at: Date.now(),
        kind: "comment_updated",
        detail: "comment-7",
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("comment")).toHaveTextContent("After"),
    );
    expect(screen.getByTestId("comment-edited")).toBeInTheDocument();
    expect(screen.queryByText("Before")).not.toBeInTheDocument();
  });
});
