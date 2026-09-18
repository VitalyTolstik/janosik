import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board, CommentDto } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { CardComments } from "@/components/board/CardComments";
import { UserProfileProvider } from "@/components/board/UserProfileDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

/**
 * The card comment thread (TASK-37) over the fake API: optimistic send with
 * Enter, own-comment deletion behind a confirmation, cursor pagination and
 * the live arrival of someone else's comment through the SSE bridge.
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
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function renderComments(server: FakeServer, readOnly = false) {
  vi.stubGlobal("fetch", server.handle);
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

/** Wait until the realtime stream is connected (the request is in flight). */
async function waitStream(server: FakeServer) {
  await waitFor(() =>
    expect(server.requests.some((r) => r.path.endsWith("/events"))).toBe(true),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
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
  it("lists the thread and sends a comment with Enter, optimistically", async () => {
    const server = new FakeServer([seedBoard()]);
    server.seedComments("card-1", [comment({ text: "Old note" })]);
    renderComments(server);

    expect(await screen.findByText("Old note")).toBeInTheDocument();

    const input = screen.getByTestId("comment-input");
    fireEvent.change(input, { target: { value: "  Fresh take  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The optimistic row appears before the server answers.
    await waitFor(() =>
      expect(screen.getByText("Fresh take")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText("Fresh take").closest("li")).not.toHaveAttribute(
        "data-pending",
      ),
    );
    expect(input).toHaveValue("");
    expect(
      server.requests.find(
        (request) =>
          request.method === "POST" &&
          request.path === "/api/v1/cards/card-1/comments",
      )?.body,
    ).toEqual({ text: "Fresh take" });
  });

  it("keeps Shift+Enter for newlines and guards the limit", async () => {
    const server = new FakeServer([seedBoard()]);
    renderComments(server);
    const input = await screen.findByTestId("comment-input");

    fireEvent.change(input, { target: { value: "line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(
      server.requests.some(
        (request) =>
          request.method === "POST" &&
          request.path === "/api/v1/cards/card-1/comments",
      ),
    ).toBe(false);

    fireEvent.change(input, { target: { value: "x".repeat(2001) } });
    expect(screen.getByTestId("comment-send")).toBeDisabled();
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
});
