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
import type { Board, BoardMemberDto, CommentDto } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { CardComments } from "@/components/board/CardComments";
import type { ActivityCount } from "@/components/board/card-activity-count";
import { UserProfileProvider } from "@/components/board/UserProfileDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { defaultI18n, ensureLocale } from "@/i18n/i18n";
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
      defaultValue={value}
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

function member(overrides: Partial<BoardMemberDto> = {}): BoardMemberDto {
  return {
    userId: "user-1",
    displayName: "Admin",
    email: "admin@example.com",
    role: "ADMIN",
    expiresAt: null,
    avatarColor: null,
    avatarPath: null,
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
  cardId = "card-1",
  onCountChange?: (count: ActivityCount | null | undefined) => void,
) {
  vi.stubGlobal("fetch", handler);
  const tree = (open: boolean) => (
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/board/b-1"]}>
            <TooltipProvider>
              <BoardProvider>
                <UserProfileProvider boardId="b-1">
                  {open && (
                    <CardComments
                      cardId={cardId}
                      boardId="b-1"
                      readOnly={readOnly}
                      onCountChange={onCountChange}
                    />
                  )}
                </UserProfileProvider>
              </BoardProvider>
            </TooltipProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>
  );
  const result = render(tree(true));
  return { ...result, setOpen: (open: boolean) => result.rerender(tree(open)) };
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

  it("keeps the author's name from the DTO after they leave the board", async () => {
    const server = new FakeServer([seedBoard()]);
    // The roster still has the caller only; the comment author has left.
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
    server.seedComments("card-1", [
      comment({
        authorId: "user-9",
        authorName: "Lena",
        authorEmail: "lena@example.com",
        text: "Left but still named",
      }),
    ]);
    renderComments(server);

    const row = await screen.findByTestId("comment");
    expect(within(row).getByText("Lena")).toBeInTheDocument();
    expect(row).not.toHaveTextContent("?");
  });

  it.each(["success", "failure", "newer draft"] as const)(
    "settles an in-flight send after reopening (%s)",
    async (outcome) => {
      const server = new FakeServer([seedBoard()]);
      const cardId = `pending-${outcome}`;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const handler: FetchHandler = async (input, init) => {
        if (init?.method === "POST" && String(input).endsWith("/comments")) {
          await gate;
          if (outcome === "failure") {
            return Response.json({ message: "Send failed" }, { status: 500 });
          }
        }
        return server.handle(input, init);
      };
      const text = "  Keep the exact draft  ";
      const thread = renderComments(server, false, handler, cardId);
      fireEvent.change(await screen.findByTestId("comment-input"), {
        target: { value: text },
      });
      fireEvent.click(screen.getByTestId("comment-kind"));
      fireEvent.click(
        await screen.findByTestId("comment-kind-option-question"),
      );
      fireEvent.click(screen.getByTestId("comment-send"));

      expect(screen.getByTestId("comment-input")).toHaveValue(text);
      expect(screen.getByTestId("comment-send")).toBeDisabled();
      thread.setOpen(false);

      thread.setOpen(true);
      expect(await screen.findByTestId("comment-input")).toHaveValue(text);
      expect(screen.getByTestId("comment-kind")).toHaveTextContent("Question");
      expect(screen.getByTestId("comment-send")).toBeDisabled();
      if (outcome === "newer draft") {
        fireEvent.change(screen.getByTestId("comment-input"), {
          target: { value: "The next comment" },
        });
      }

      await act(async () => release());
      const expected =
        outcome === "success"
          ? ""
          : outcome === "failure"
            ? text
            : "The next comment";
      const expectedKind = outcome === "success" ? "Note" : "Question";
      expect(screen.getByTestId("comment-input")).toHaveValue(expected);
      expect(screen.getByTestId("comment-kind")).toHaveTextContent(
        expectedKind,
      );
      if (outcome === "failure") {
        expect(screen.getByTestId("comment-send")).toBeEnabled();
        expect(
          await screen.findByText("Could not send the comment"),
        ).toBeVisible();
      }

      thread.setOpen(false);
      thread.setOpen(true);
      expect(await screen.findByTestId("comment-input")).toHaveValue(expected);
      expect(screen.getByTestId("comment-kind")).toHaveTextContent(
        expectedKind,
      );
    },
  );

  it.each([403, 404])(
    "keeps a draft hidden when reopening a card that returns %s",
    async (status) => {
      const server = new FakeServer([seedBoard()]);
      const cardId = `unavailable-${status}`;
      let unavailable = false;
      let answer!: () => void;
      const gate = new Promise<void>((resolve) => {
        answer = resolve;
      });
      const handler: FetchHandler = async (input, init) => {
        if (unavailable && String(input).includes(`/${cardId}/comments`)) {
          await gate;
          return Response.json({ message: "Card unavailable" }, { status });
        }
        return server.handle(input, init);
      };
      const thread = renderComments(server, false, handler, cardId);
      fireEvent.change(await screen.findByTestId("comment-input"), {
        target: { value: "Draft for this card" },
      });
      thread.setOpen(false);
      unavailable = true;
      thread.setOpen(true);
      await screen.findByTestId("card-comments-skeleton");
      expect(screen.queryByTestId("comment-input")).not.toBeInTheDocument();

      await act(async () => answer());
      expect(await screen.findByText("Could not load comments")).toBeVisible();
      expect(screen.queryByTestId("comment-input")).not.toBeInTheDocument();
    },
  );

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
      server.requests.filter(
        (request) =>
          request.method === "DELETE" &&
          request.path === "/api/v1/comments/comment-1",
      ),
    ).toHaveLength(1);
  });

  it("sends exactly one DELETE when the confirmation is activated twice", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [comment({ text: "Once" })]);
    renderComments(server);

    fireEvent.click(await screen.findByTestId("comment-delete"));
    const confirm = await screen.findByRole("button", { name: "Delete" });
    act(() => {
      confirm.click();
      confirm.click();
    });

    await waitFor(() =>
      expect(screen.queryByText("Once")).not.toBeInTheDocument(),
    );
    expect(
      server.requests.filter(
        (request) =>
          request.method === "DELETE" &&
          request.path === "/api/v1/comments/comment-1",
      ),
    ).toHaveLength(1);
  });

  it("starts a second comment delete while the first DELETE is in flight", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-1", text: "First" }),
      comment({ id: "comment-2", text: "Second" }),
    ]);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    renderComments(server, false, async (input, init) => {
      if (
        init?.method === "DELETE" &&
        String(input).includes("/comments/comment-1")
      ) {
        await firstGate;
      }
      return server.handle(input, init);
    });
    await screen.findByText("First");

    const first = screen
      .getAllByTestId("comment")
      .find((row) => row.dataset.commentId === "comment-1");
    fireEvent.click(within(first as HTMLElement).getByTestId("comment-delete"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByText("First")).not.toBeInTheDocument(),
    );

    const second = screen
      .getAllByTestId("comment")
      .find((row) => row.dataset.commentId === "comment-2");
    fireEvent.click(
      within(second as HTMLElement).getByTestId("comment-delete"),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByText("Second")).not.toBeInTheDocument(),
    );

    await act(async () => releaseFirst());
    await waitFor(() =>
      expect(
        server.requests.filter((request) => request.method === "DELETE"),
      ).toHaveLength(2),
    );
    expect(screen.queryByTestId("comment")).not.toBeInTheDocument();
  });

  it("restores a failed delete at its old index without resetting loaded pages", async () => {
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
    let deleteCalls = 0;
    renderComments(server, false, async (input, init) => {
      if (init?.method === "DELETE") {
        deleteCalls += 1;
        return new Response(JSON.stringify({ message: "delete failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return server.handle(input, init);
    });
    await screen.findByText("Comment 0");

    fireEvent.click(await screen.findByTestId("comments-show-older"));
    expect(await screen.findByText("Comment 50")).toBeInTheDocument();
    const doomed = screen
      .getAllByTestId("comment")
      .find((row) => row.dataset.commentId === "comment-50");
    expect(doomed).toBeDefined();
    fireEvent.click(
      within(doomed as HTMLElement).getByTestId("comment-delete"),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    expect(
      await screen.findByText("Could not delete the comment"),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getAllByTestId("comment")).toHaveLength(51),
    );
    expect(screen.getAllByTestId("comment").at(-1)).toHaveAttribute(
      "data-comment-id",
      "comment-50",
    );
    // The page-2 row and its position survive the error; a page-1 reset would
    // bring the "Show older comments" control back.
    expect(screen.queryByTestId("comments-show-older")).not.toBeInTheDocument();
    expect(deleteCalls).toBe(1);
  });

  it("keeps an already-deleted comment removed on 404 and updates the count", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-1", text: "Already gone" }),
      comment({ id: "comment-2", text: "Still here" }),
    ]);
    const onCountChange = vi.fn();
    let deleteCalls = 0;
    renderComments(
      server,
      false,
      async (input, init) => {
        if (init?.method === "DELETE") {
          deleteCalls += 1;
          return new Response(JSON.stringify({ message: "not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        return server.handle(input, init);
      },
      "card-1",
      onCountChange,
    );
    await screen.findByText("Already gone");
    await waitFor(() =>
      expect(onCountChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ visible: 2 }),
      ),
    );

    const doomed = screen
      .getAllByTestId("comment")
      .find((row) => row.dataset.commentId === "comment-1");
    fireEvent.click(
      within(doomed as HTMLElement).getByTestId("comment-delete"),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.queryByText("Already gone")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(onCountChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ visible: 1 }),
      ),
    );
    expect(
      screen.queryByText("Could not delete the comment"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Still here")).toBeInTheDocument();
    expect(screen.getAllByTestId("comment")).toHaveLength(1);
    expect(deleteCalls).toBe(1);
  });

  it("shows the member author and exact excerpt in the delete confirmation", async () => {
    const server = new FakeServer([seedBoard()]);
    server.membersByBoard.set("b-1", [
      member({ displayName: "Vera", email: "vera@example.com" }),
    ]);
    server.seedComments("card-1", [
      comment({
        text: "  **Rename** the\n`migration` table\tbefore the release  ",
      }),
    ]);
    renderComments(server);

    fireEvent.click(await screen.findByTestId("comment-delete"));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("Author: Vera")).toBeVisible();
    const excerpt = within(dialog).getByTestId("comment-delete-excerpt");
    // Exact textContent, not the whitespace-normalizing matcher.
    expect(excerpt.textContent).toBe(
      "**Rename** the `migration` table before the release",
    );
    expect(excerpt).toHaveAttribute("dir", "auto");
    expect(within(dialog).getByText(/cannot be undone/i)).toBeVisible();
    expect(
      within(dialog).getByRole("heading", { name: /Delete Vera/ }),
    ).toBeVisible();
  });

  it("falls back to the author email when the member directory is missing", async () => {
    const server = new FakeServer([seedBoard()]);
    server.account.displayName = null;
    server.seedComments("card-1", [comment({ text: "Email fallback" })]);
    renderComments(server);

    fireEvent.click(await screen.findByTestId("comment-delete"));
    const dialog = await screen.findByRole("dialog");

    expect(
      await within(dialog).findByText("Author: admin@example.com"),
    ).toBeVisible();
  });

  it("keeps a right-to-left excerpt intact for dir=auto", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ text: "  שלום עולם\nمرحبا بالعالم  " }),
    ]);
    renderComments(server);

    fireEvent.click(await screen.findByTestId("comment-delete"));
    const dialog = await screen.findByRole("dialog");
    const excerpt = within(dialog).getByTestId("comment-delete-excerpt");

    expect(excerpt.textContent).toBe("שלום עולם مرحبا بالعالم");
    expect(excerpt).toHaveAttribute("dir", "auto");
  });

  it("keeps the comment when the delete confirmation is cancelled", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [comment({ text: "Keep me" })]);
    renderComments(server);

    fireEvent.click(await screen.findByTestId("comment-delete"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Keep me")).toBeInTheDocument();
    expect(
      server.requests.filter(
        (request) =>
          request.method === "DELETE" &&
          request.path === "/api/v1/comments/comment-1",
      ),
    ).toHaveLength(0);
  });

  it("gives both comment actions 44 px touch targets and a focus ring", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [comment({ text: "Touch me" })]);
    renderComments(server);

    const trigger = await screen.findByTestId("comment-delete");
    const edit = screen.getByTestId("comment-edit");
    for (const button of [edit, trigger]) {
      expect(button).toHaveClass(
        "max-md:h-11",
        "max-md:w-11",
        "no-hover:h-11",
        "no-hover:w-11",
        "focus-visible:ring-2",
        "focus-visible:ring-ring",
      );
    }
    // The buttons live in a hover-revealed action strip; touch must keep the
    // strip visible, and keyboard focus must reveal it too.
    expect(screen.getByTestId("comment-actions")).toHaveClass(
      "focus-within:opacity-100",
      "no-hover:opacity-100",
    );

    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Delete" })).toHaveClass(
      "max-md:min-h-11",
      "no-hover:min-h-11",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveClass(
      "max-md:min-h-11",
      "no-hover:min-h-11",
    );
  });

  it("does not offer undo because a deleted comment has no restore endpoint", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [comment({ text: "Gone" })]);
    renderComments(server);

    fireEvent.click(await screen.findByTestId("comment-delete"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.queryByText("Gone")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /undo/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/restored/i)).not.toBeInTheDocument();
  });

  it("renders the delete confirmation in Russian", async () => {
    await ensureLocale("ru");
    await act(async () => {
      await defaultI18n.changeLanguage("ru");
    });
    try {
      const server = new FakeServer([seedBoard()]);
      server.membersByBoard.set("b-1", [member()]);
      server.seedComments("card-1", [comment({ text: "Удалить меня" })]);
      renderComments(server);

      fireEvent.click(await screen.findByTestId("comment-delete"));
      const dialog = await screen.findByRole("dialog");

      expect(await within(dialog).findByText("Автор: Admin")).toBeVisible();
      expect(
        within(dialog).getByTestId("comment-delete-excerpt").textContent,
      ).toBe("Удалить меня");
      expect(
        within(dialog).getByRole("heading", {
          name: "Удалить комментарий Admin?",
        }),
      ).toBeVisible();
      expect(
        within(dialog).getByText(
          "Комментарий исчезнет у всех. Это действие нельзя отменить.",
        ),
      ).toBeVisible();
      expect(
        within(dialog).getByRole("button", { name: "Удалить" }),
      ).toBeVisible();
    } finally {
      await act(async () => {
        await defaultI18n.changeLanguage("en");
      });
    }
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
      server.seedComments("card-1", []);
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

  it("keeps the last comment at the bottom when a delete makes 51 comments fit on one page", async () => {
    const server = new FakeServer([seedBoard()]);
    const comments = Array.from({ length: 51 }, (_, index) =>
      comment({ id: `comment-${index}`, text: `Comment ${index}` }),
    );
    const [deleted, ...remaining] = comments;
    server.seedComments("card-1", comments);
    renderComments(server);
    await screen.findByTestId("comments-show-older");
    expect(screen.getAllByTestId("comment")).toHaveLength(50);
    await waitStream(server);

    act(() => {
      server.seedComments("card-1", remaining);
      server.publishActivity("b-1", {
        type: "activity",
        id: "activity-delete",
        boardId: "b-1",
        cardId: "card-1",
        actorId: "user-1",
        at: Date.now(),
        kind: "comment_deleted",
        detail: deleted.id,
      });
    });

    await screen.findByText("Comment 50");
    expect(
      screen.getAllByTestId("comment").map((row) => row.dataset.commentId),
    ).toEqual(remaining.map((row) => row.id));
    expect(screen.queryByTestId("comments-show-older")).not.toBeInTheDocument();
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

  it("saves with Ctrl+Enter and disables Save for blank, unchanged and over-limit text", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [comment({ text: "Keyboard edit" })]);
    renderComments(server);
    await screen.findByText("Keyboard edit");

    fireEvent.click(screen.getByTestId("comment-edit"));
    const row = screen.getByTestId("comment");
    const input = await within(row).findByTestId("comment-input");
    const save = screen.getByTestId("comment-edit-save");
    // Open with the stored text: there is nothing to save yet.
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.change(input, {
      target: { value: "x".repeat(LIMITS.comment + 1) },
    });
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: "Saved with the keyboard" } });
    expect(save).toBeEnabled();
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByTestId("comment")).toHaveTextContent(
        "Saved with the keyboard",
      );
      expect(screen.queryByTestId("comment-edit-save")).toBeNull();
    });
  });

  it("filters the thread by kind through the server query", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-n", text: "A note", kind: "note" }),
      comment({
        id: "comment-b",
        text: "A blocker",
        kind: "blocker",
        createdAt: 1_700_000_000_100,
      }),
      comment({
        id: "comment-q",
        text: "A question",
        kind: "question",
        createdAt: 1_700_000_000_200,
      }),
    ]);
    const kindQueries: Array<string | null> = [];
    renderComments(server, false, async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/comments")) {
        kindQueries.push(url.searchParams.get("kind"));
      }
      return server.handle(input, init);
    });
    await screen.findByText("A note");

    const group = screen.getByTestId("comment-kind-filters");
    expect(group).toHaveAttribute("aria-label", "Filter comments by kind");
    expect(within(group).getAllByRole("button")).toHaveLength(7);
    const all = screen.getByTestId("comment-filter-all");
    const blocker = screen.getByTestId("comment-filter-blocker");
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(blocker).toHaveAttribute("aria-pressed", "false");
    // 44 px touch target, not just a colour cue.
    expect(blocker).toHaveClass("min-h-11");
    const live = screen.getByTestId("comment-filter-live");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveTextContent("Showing all comments");

    fireEvent.click(blocker);
    expect(await screen.findByText("A blocker")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("A note")).not.toBeInTheDocument(),
    );
    expect(blocker).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
    expect(kindQueries).toContain("blocker");
    expect(screen.getByTestId("comment-filter-live")).toHaveTextContent(
      "Showing Blocker comments",
    );

    // A kind with no rows keeps the chip and answers with a specific empty
    // state instead of the generic "No comments yet".
    fireEvent.click(screen.getByTestId("comment-filter-handoff"));
    expect(await screen.findByText("No Handoff comments")).toBeInTheDocument();
    expect(screen.queryByText("No comments yet")).not.toBeInTheDocument();
    expect(kindQueries).toContain("handoff");

    fireEvent.click(all);
    expect(await screen.findByText("A note")).toBeInTheDocument();
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(kindQueries.at(-1)).toBeNull();
  });

  it("keeps the previous chip and offers a retry when a filter load fails", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-n", text: "A note", kind: "note" }),
      comment({
        id: "comment-b",
        text: "A blocker",
        kind: "blocker",
        createdAt: 1_700_000_000_100,
      }),
    ]);
    let failBlocker = true;
    renderComments(server, false, async (input, init) => {
      const url = new URL(String(input));
      if (
        failBlocker &&
        url.pathname.endsWith("/comments") &&
        url.searchParams.get("kind") === "blocker"
      ) {
        failBlocker = false;
        return Response.json({ message: "boom" }, { status: 500 });
      }
      return server.handle(input, init);
    });
    await screen.findByText("A note");

    fireEvent.click(screen.getByTestId("comment-filter-blocker"));
    expect(
      await screen.findByText("Could not apply this filter"),
    ).toBeInTheDocument();
    // The failed request never claims the chip: All is still applied, the
    // note is still visible and no filtered-empty copy is shown.
    expect(screen.getByTestId("comment-filter-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("comment-filter-blocker")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("A note")).toBeInTheDocument();
    expect(screen.queryByText("No Blocker comments")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("A blocker")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("A note")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("comment-filter-blocker")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByTestId("comment-filter-error"),
    ).not.toBeInTheDocument();
  });

  it("keeps the unfiltered Comments count truthful under a filter", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({
        id: "comment-b",
        text: "Filtered blocker",
        kind: "blocker",
        createdAt: 1_700_000_000_100,
      }),
      comment({ id: "comment-n", text: "Other note", createdAt: 1 }),
    ]);
    const counts: Array<ActivityCount | null | undefined> = [];
    renderComments(server, false, server.handle, "card-1", (count) => {
      counts.push(count);
    });
    await waitFor(() => expect(counts.at(-1)).toMatchObject({ visible: 2 }));

    fireEvent.click(screen.getByTestId("comment-filter-blocker"));
    expect(await screen.findByText("Filtered blocker")).toBeInTheDocument();
    // Loading a filtered page must not flash the visible-page size (1) into
    // the Comments tab: the unfiltered snapshot (2) stays put.
    expect(counts.at(-1)).toMatchObject({ visible: 2 });

    // A create while filtered adjusts the snapshot by +1.
    fireEvent.click(screen.getByTestId("comment-kind"));
    fireEvent.click(await screen.findByTestId("comment-kind-option-blocker"));
    expect(screen.getByTestId("comment-kind")).toHaveAttribute(
      "aria-label",
      "Comment kind: Blocker",
    );
    fireEvent.change(screen.getByTestId("comment-input"), {
      target: { value: "Fresh blocker" },
    });
    expect(screen.getByTestId("comment-send")).toBeEnabled();
    fireEvent.click(screen.getByTestId("comment-send"));
    await waitFor(() =>
      expect(
        server.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/cards/card-1/comments",
        ),
      ).toHaveLength(1),
    );
    expect(await screen.findByText("Fresh blocker")).toBeInTheDocument();
    await waitFor(() => expect(counts.at(-1)).toMatchObject({ visible: 3 }));

    // A delete while filtered adjusts it back down.
    const created = screen.getByText("Fresh blocker").closest("li");
    fireEvent.click(
      within(created as HTMLElement).getByTestId("comment-delete"),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByText("Fresh blocker")).not.toBeInTheDocument(),
    );
    expect(counts.at(-1)).toMatchObject({ visible: 2 });
  });

  it("recovers the All revert after a failed request when sending another kind", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({
        id: "comment-b",
        text: "Filtered blocker",
        kind: "blocker",
      }),
    ]);
    let failAll = false;
    renderComments(server, false, async (input, init) => {
      const url = new URL(String(input));
      if (
        failAll &&
        url.pathname.endsWith("/comments") &&
        url.searchParams.get("kind") === null
      ) {
        failAll = false;
        return Response.json({ message: "boom" }, { status: 500 });
      }
      return server.handle(input, init);
    });
    await screen.findByText("Filtered blocker");
    const all = screen.getByTestId("comment-filter-all");
    const blocker = screen.getByTestId("comment-filter-blocker");
    const busyRoot = screen
      .getByTestId("comment-list")
      .closest("[aria-busy]") as HTMLElement;

    fireEvent.click(blocker);
    await waitFor(() =>
      expect(blocker).toHaveAttribute("aria-pressed", "true"),
    );

    // The revert to All fails: Blocker stays applied with a retry line, so
    // `requestedKind` is left at All even though All is not loaded.
    failAll = true;
    fireEvent.click(all);
    expect(
      await screen.findByText("Could not apply this filter"),
    ).toBeInTheDocument();
    expect(all).toHaveAttribute("aria-pressed", "false");
    expect(blocker).toHaveAttribute("aria-pressed", "true");
    expect(busyRoot).toHaveAttribute("aria-busy", "false");

    // Sending a note (a kind the Blocker chip excludes) must force the All
    // reload instead of relying on a no-op state setter.
    fireEvent.change(await screen.findByTestId("comment-input"), {
      target: { value: "New note" },
    });
    expect(screen.getByTestId("comment-send")).toBeEnabled();
    fireEvent.click(screen.getByTestId("comment-send"));
    await waitFor(() =>
      expect(
        server.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/cards/card-1/comments",
        ),
      ).toHaveLength(1),
    );
    expect(await screen.findByText("New note")).toBeInTheDocument();
    await waitFor(() => expect(all).toHaveAttribute("aria-pressed", "true"));
    expect(blocker).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(busyRoot).toHaveAttribute("aria-busy", "false"));
    expect(
      screen.queryByTestId("comment-filter-error"),
    ).not.toBeInTheDocument();
  });

  it("reads the requested kind after a gated save", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-b", text: "Filtered blocker", kind: "blocker" }),
    ]);
    let failAll = false;
    let postStarted = false;
    let releasePost!: () => void;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    renderComments(server, false, async (input, init) => {
      const url = new URL(String(input));
      if (
        init?.method === "POST" &&
        url.pathname === "/api/v1/cards/card-1/comments"
      ) {
        postStarted = true;
        await postGate;
      }
      if (
        failAll &&
        (init?.method ?? "GET") === "GET" &&
        url.pathname.endsWith("/comments") &&
        url.searchParams.get("kind") === null
      ) {
        failAll = false;
        return Response.json({ message: "boom" }, { status: 500 });
      }
      return server.handle(input, init);
    });
    await screen.findByText("Filtered blocker");
    const all = screen.getByTestId("comment-filter-all");
    const blocker = screen.getByTestId("comment-filter-blocker");
    const busyRoot = screen
      .getByTestId("comment-list")
      .closest("[aria-busy]") as HTMLElement;

    fireEvent.click(blocker);
    await waitFor(() =>
      expect(blocker).toHaveAttribute("aria-pressed", "true"),
    );

    // Hold the POST, then fail the All revert while the save is in flight.
    failAll = true;
    fireEvent.change(await screen.findByTestId("comment-input"), {
      target: { value: "New note" },
    });
    expect(screen.getByTestId("comment-send")).toBeEnabled();
    fireEvent.click(screen.getByTestId("comment-send"));
    await waitFor(() => expect(postStarted).toBe(true));
    fireEvent.click(all);
    expect(
      await screen.findByText("Could not apply this filter"),
    ).toBeInTheDocument();
    expect(blocker).toHaveAttribute("aria-pressed", "true");
    expect(busyRoot).toHaveAttribute("aria-busy", "false");

    // Releasing the save must observe the latest requested kind (All, though
    // its fetch failed) and issue a matching reload instead of going dead.
    act(() => releasePost());
    await waitFor(() => expect(all).toHaveAttribute("aria-pressed", "true"));
    expect(blocker).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(busyRoot).toHaveAttribute("aria-busy", "false"));
    expect(screen.getByText("New note")).toBeInTheDocument();
    expect(
      screen.queryByTestId("comment-filter-error"),
    ).not.toBeInTheDocument();
  });

  it("pages a filtered thread with the kind query", async () => {
    const server = new FakeServer([seedBoard()]);
    const blockers = Array.from({ length: 55 }, (_, index) =>
      comment({
        id: `comment-${index}`,
        text: `Blocker ${index}`,
        kind: "blocker",
        createdAt: 1_700_000_000_000 + index,
      }),
    );
    server.seedComments("card-1", [
      comment({ id: "comment-note", text: "A note", kind: "note" }),
      ...blockers,
    ]);
    const queries: URL[] = [];
    renderComments(server, false, async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/comments")) queries.push(url);
      return server.handle(input, init);
    });
    await screen.findByText("Blocker 0");

    fireEvent.click(screen.getByTestId("comment-filter-blocker"));
    expect(await screen.findByText("Blocker 0")).toBeInTheDocument();
    expect(screen.queryByText("A note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("comments-show-older"));
    await waitFor(() =>
      expect(
        queries.some(
          (url) =>
            url.searchParams.get("kind") === "blocker" &&
            url.searchParams.get("cursor") === "50",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("Blocker 54")).toBeInTheDocument();
  });

  it("lets the author change the kind while editing", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-k", text: "Blocked here", kind: "blocker" }),
    ]);
    renderComments(server);
    const row = await screen.findByTestId("comment");
    expect(within(row).getByTestId("comment-kind-badge")).toHaveTextContent(
      "Blocker",
    );

    fireEvent.click(within(row).getByTestId("comment-edit"));
    const picker = await within(row).findByTestId("comment-edit-kind");
    expect(picker).toHaveAttribute("aria-label", "Comment kind: Blocker");
    expect(within(row).getByTestId("comment-edit-save")).toBeDisabled();

    fireEvent.click(picker);
    fireEvent.click(
      await screen.findByTestId("comment-edit-kind-option-question"),
    );
    // The text is untouched; retyping the kind alone is enough to save.
    expect(within(row).getByTestId("comment-edit-save")).toBeEnabled();
    fireEvent.click(within(row).getByTestId("comment-edit-save"));

    await waitFor(() => {
      const saved = screen.getByTestId("comment");
      expect(within(saved).getByTestId("comment-kind-badge")).toHaveTextContent(
        "Question",
      );
      expect(within(saved).getByTestId("comment-edited")).toBeInTheDocument();
      expect(saved).toHaveTextContent("Blocked here");
    });
    expect(
      server.requests.find(
        (request) =>
          request.method === "PATCH" &&
          request.path === "/api/v1/comments/comment-k",
      )?.body,
    ).toEqual({ kind: "question" });
  });

  it("drops an edited comment from the active kind filter", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [
      comment({ id: "comment-f", text: "Only blocker", kind: "blocker" }),
    ]);
    renderComments(server);
    await screen.findByText("Only blocker");

    fireEvent.click(screen.getByTestId("comment-filter-blocker"));
    expect(await screen.findByText("Only blocker")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("comment-edit"));
    fireEvent.click(await screen.findByTestId("comment-edit-kind"));
    fireEvent.click(
      await screen.findByTestId("comment-edit-kind-option-evidence"),
    );
    fireEvent.click(screen.getByTestId("comment-edit-save"));

    expect(await screen.findByText("No Blocker comments")).toBeInTheDocument();
    expect(screen.queryByText("Only blocker")).not.toBeInTheDocument();
    expect(server.commentsByCard.get("card-1")?.[0]?.kind).toBe("evidence");
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

  it("refreshes an edited comment that lives on a loaded older page (L36)", async () => {
    const server = new FakeServer([seedBoard()]);
    const seeded = Array.from({ length: 60 }, (_, index) =>
      comment({
        id: `comment-${index}`,
        text: `Comment ${index}`,
        createdAt: 1_700_000_000_000 + index,
      }),
    );
    server.seedComments("card-1", seeded);
    renderComments(server);
    await screen.findByText("Comment 0");

    fireEvent.click(await screen.findByTestId("comments-show-older"));
    expect(await screen.findByText("Comment 59")).toBeInTheDocument();
    await waitStream(server);

    act(() => {
      server.seedComments(
        "card-1",
        seeded.map((row) =>
          row.id === "comment-55"
            ? { ...row, text: "Edited on page two", editedAt: Date.now() }
            : row,
        ),
      );
      server.publishActivity("b-1", {
        type: "activity",
        id: "activity-4",
        boardId: "b-1",
        cardId: "card-1",
        actorId: "user-1",
        at: Date.now(),
        kind: "comment_updated",
        detail: "comment-55",
      });
    });

    expect(await screen.findByText("Edited on page two")).toBeInTheDocument();
    expect(screen.queryByText("Comment 55")).not.toBeInTheDocument();
  });
});
