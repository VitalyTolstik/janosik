import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityFeedEntry, CommentDto } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { CardActivity } from "@/components/board/CardActivity";
import { UserProfileProvider } from "@/components/board/UserProfileDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ensureLocale, I18nProvider } from "@/i18n";
import { defaultI18n } from "@/i18n/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

// Same trade as CardComments.test: the thread behaviour under test is the
// data flow, not the MDXEditor internals.
vi.mock("@/components/editor/CommentEditor", () => ({
  CommentComposerEditor: ({
    onChange,
    onSubmit,
    placeholder,
  }: {
    onChange: (value: string) => void;
    onSubmit: () => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="comment-input"
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          onSubmit();
        }
      }}
    />
  ),
  CommentBody: ({ text }: { text: string }) => <p>{text}</p>,
}));

/**
 * The Activity section (TASK-37): both tab counts render as soon as the
 * dialog opens — the hidden view stays mounted and keeps loading, so no
 * click is needed to see the History badge.
 */

const AT = 1_760_000_000_000;

function comment(id: string): CommentDto {
  return {
    id,
    cardId: "card-1",
    authorId: "user-1",
    text: `Note ${id}`,
    kind: "note",
    actorType: "human",
    apiTokenId: null,
    agentSessionId: null,
    agentName: null,
    createdAt: AT,
  };
}

function renderActivity() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/board/b-1"]}>
            <TooltipProvider>
              <BoardProvider>
                <UserProfileProvider boardId="b-1">
                  <CardActivity cardId="card-1" boardId="b-1" updatedAt={AT} />
                </UserProfileProvider>
              </BoardProvider>
            </TooltipProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>,
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

describe("CardActivity", () => {
  it("shows both tab counts without clicking any tab", async () => {
    const server = new FakeServer();
    server.seedComments("card-1", [comment("c-1"), comment("c-2")]);
    server.seedActivity("card-1", [
      {
        source: "command",
        id: "cmd-1",
        seq: 1,
        at: AT,
        type: "UPDATE_CARD",
        actorId: "user-2",
        cardId: "card-1",
      },
      {
        source: "activity",
        id: "act-1",
        at: AT - 1_000,
        type: "comment_added",
        actorId: "user-3",
        cardId: "card-1",
      },
    ]);
    vi.stubGlobal("fetch", server.handle);
    renderActivity();

    await waitFor(() => {
      expect(
        screen.getByTestId("activity-tab-comments-count"),
      ).toHaveTextContent("2");
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("activity-tab-history-count"),
      ).toHaveTextContent(/^2 rows$/);
    });

    // Switching to History works and the comments tab keeps its state.
    fireEvent.click(screen.getByTestId("activity-tab-history"));
    expect(screen.getByTestId("history-list")).toBeTruthy();
    fireEvent.click(screen.getByTestId("activity-tab-comments"));
    expect(screen.getByTestId("comment-input")).toBeTruthy();
  });

  it("shows 50+ for a 65-comment thread and its exact count after loading the last page", async () => {
    const server = new FakeServer();
    server.seedComments(
      "card-1",
      Array.from({ length: 65 }, (_, index) => comment(`c-${index}`)),
    );
    vi.stubGlobal("fetch", server.handle);
    renderActivity();

    const badge = await screen.findByTestId("activity-tab-comments-count");
    expect(badge).toHaveTextContent(/^50\+$/);
    expect(screen.getAllByTestId("comment")).toHaveLength(50);
    fireEvent.click(screen.getByTestId("comments-show-older"));

    await waitFor(() => expect(badge).toHaveTextContent(/^65$/));
    expect(screen.getAllByTestId("comment")).toHaveLength(65);
    expect(screen.queryByTestId("comments-show-older")).not.toBeInTheDocument();
  });

  it("reopens pagination when a live update leaves a gap after the newest page", async () => {
    const server = new FakeServer([
      {
        id: "b-1",
        title: "Board",
        columns: [],
        cards: {},
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    const original = comment("original");
    server.seedComments("card-1", [original]);
    vi.stubGlobal("fetch", server.handle);
    renderActivity();

    const badge = await screen.findByTestId("activity-tab-comments-count");
    expect(badge).toHaveTextContent(/^1$/);
    await waitFor(() => expect(server.hasEventStream("b-1")).toBe(true));
    act(() => {
      const added = Array.from({ length: 65 }, (_, index) =>
        comment(`new-${index}`),
      );
      server.seedComments("card-1", [...added, original]);
      server.publishActivity("b-1", {
        type: "activity",
        id: "activity-new",
        boardId: "b-1",
        cardId: "card-1",
        actorId: "user-2",
        at: AT,
        kind: "comment_added",
        detail: added[0].id,
      });
    });

    await waitFor(() => expect(badge).toHaveTextContent(/^50\+$/));
    fireEvent.click(screen.getByTestId("comments-show-older"));
    await waitFor(() => expect(badge).toHaveTextContent(/^66$/));
    expect(screen.getAllByTestId("comment")).toHaveLength(66);
  });

  it.each([
    {
      lang: "en",
      withTotal: false,
      comments: "50+",
      partial: "1 row · 50+ events",
      complete: "1 row",
    },
    {
      lang: "en",
      withTotal: true,
      comments: "50 of 65",
      partial: "1 row · 50 of 65 events",
      complete: "1 row · 65 of 65 events",
    },
    {
      lang: "ru",
      withTotal: true,
      comments: "50 из 65",
      partial: "1 строка · 50 из 65 событий",
      complete: "1 строка · 65 из 65 событий",
    },
  ] as const)(
    "counts folded history rows and describes feed coverage ($lang, total supplied: $withTotal)",
    async ({ lang, withTotal, comments, partial, complete }) => {
      await ensureLocale(lang);
      await defaultI18n.changeLanguage(lang);
      const server = new FakeServer();
      server.seedComments(
        "card-1",
        Array.from({ length: 65 }, (_, index) => comment(`c-${index}`)),
      );
      const history = Array.from(
        { length: 65 },
        (_, index): ActivityFeedEntry => ({
          source: "command",
          id: `cmd-${index}`,
          at: AT - index,
          type: index < 50 ? "UPDATE_CARD" : "TOUCH_CARD",
          actorId: "user-2",
        }),
      );
      server.seedActivity("card-1", history);
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const response = await server.handle(input, init);
          const { pathname, searchParams } = new URL(String(input));
          if (
            withTotal &&
            !searchParams.has("cursor") &&
            (pathname.endsWith("/card-1/comments") ||
              pathname.endsWith("/card-1/activity"))
          ) {
            const page = await response.json();
            return Response.json({ ...page, total: 65 });
          }
          return response;
        },
      );
      const activity = renderActivity();

      try {
        const commentBadge = await screen.findByTestId(
          "activity-tab-comments-count",
        );
        expect(commentBadge.textContent).toBe(comments);
        const historyBadge = await screen.findByTestId(
          "activity-tab-history-count",
        );
        expect(historyBadge.textContent).toBe(partial);

        fireEvent.click(screen.getByTestId("activity-tab-history"));
        expect(screen.getAllByTestId("history-entry")).toHaveLength(1);
        fireEvent.click(screen.getByTestId("history-show-older"));
        await waitFor(() => expect(historyBadge.textContent).toBe(complete));
        expect(screen.getAllByTestId("history-entry")).toHaveLength(1);
        expect(
          screen.queryByTestId("history-show-older"),
        ).not.toBeInTheDocument();
      } finally {
        activity.unmount();
        await defaultI18n.changeLanguage("en");
      }
    },
  );
});
