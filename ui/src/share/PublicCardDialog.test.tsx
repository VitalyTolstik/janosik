import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type {
  AttachmentDto,
  Board,
  Card,
  CommentDto,
  CommentPage,
} from "@janosik/shared";
import { I18nProvider } from "@/i18n";
import { PublicCardDialog } from "./PublicCardDialog";

/**
 * The public card panel (TASK-58) is read-only and runs without a session.
 * These regressions cover the two QA findings around long descriptions and
 * the comment page cap: the comments API is newest-first with an opaque
 * `nextCursor`, and the dialog used to discard it after the first 50 rows.
 */

const LONG_LINK = `https://example.test/${"a".repeat(120)}`;

function board(cardOverrides: Partial<Card> = {}): Board {
  return {
    id: "b1",
    title: "Shared board",
    columns: [{ id: "c1", title: "Todo", cardIds: ["k1"], createdAt: 1 }],
    cards: {
      k1: {
        id: "k1",
        title: "Read me",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        ...cardOverrides,
      },
    },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function comment(index: number): CommentDto {
  return {
    id: `comment-${index}`,
    cardId: "k1",
    authorId: "u1",
    authorName: "Ann",
    text: `QA-COMMENT-${index}`,
    kind: "note",
    actorType: "human",
    createdAt: index,
  };
}

function commentPage(items: CommentDto[], nextCursor: string | null): Response {
  return new Response(
    JSON.stringify({ items, nextCursor } satisfies CommentPage),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function renderDialog(
  cardBoard: Board,
  {
    includeComments = false,
    includeAttachments = false,
  }: { includeComments?: boolean; includeAttachments?: boolean } = {},
) {
  return render(
    <I18nProvider>
      <PublicCardDialog
        token="tok"
        board={cardBoard}
        members={[]}
        cardId="k1"
        includeComments={includeComments}
        includeAttachments={includeAttachments}
        onClose={() => {}}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PublicCardDialog", () => {
  it("keeps a long unbroken description inside the 390 px dialog", () => {
    // jsdom has no layout engine, so pin the QA width and guard the wrapping
    // classes that keep the measured 1084 px row from blowing out the 356 px
    // dialog. `wrap-anywhere` is the anywhere-semantics utility; plain
    // `break-words` would lose to it/emit differently in the cascade.
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    try {
      renderDialog(board({ description: LONG_LINK }));

      const description = screen.getByTestId("public-description");
      expect(description).toHaveTextContent(LONG_LINK);
      expect(description).toHaveClass(
        "min-w-0",
        "max-w-full",
        "whitespace-pre-wrap",
        "wrap-anywhere",
        "text-ui-body",
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  });

  it("renders a mention as plain @name without the raw token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        commentPage(
          [
            {
              ...comment(1),
              text: "Hi [@Ann](https://janosik.invalid/mention/u1)!",
            },
          ],
          null,
        ),
      ),
    );

    renderDialog(board(), { includeComments: true });

    const list = await screen.findByTestId("public-comments");
    expect(within(list).getByText("Hi @Ann!")).toBeVisible();
    expect(within(list).queryByText(/janosik\.invalid/)).toBeNull();
  });

  it("loads older public comments instead of stopping at the first 50", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      comment(54 - index),
    );
    const olderPage = Array.from({ length: 5 }, (_, index) =>
      comment(4 - index),
    );
    let releaseOlder!: () => void;
    const olderGate = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.get("cursor") === null) {
        return commentPage(firstPage, "older-cursor");
      }
      await olderGate;
      return commentPage(olderPage, null);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDialog(board(), { includeComments: true });

    const list = await screen.findByTestId("public-comments");
    expect(within(list).getAllByRole("listitem")).toHaveLength(50);
    expect(screen.getByTestId("public-comments-count")).toHaveTextContent(
      "50 shown",
    );

    await userEvent.click(screen.getByTestId("public-comments-more"));
    expect(screen.getByTestId("public-comments-more")).toHaveTextContent(
      "Loading…",
    );

    await act(async () => releaseOlder());

    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(55),
    );
    expect(screen.getByTestId("public-comments-count")).toHaveTextContent(
      "55 shown",
    );
    expect(screen.queryByTestId("public-comments-more")).toBeNull();
    expect(within(list).getByText("QA-COMMENT-0")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(secondUrl.pathname).toBe("/api/v1/share/tok/cards/k1/comments");
    expect(secondUrl.searchParams.get("cursor")).toBe("older-cursor");
    expect(secondUrl.searchParams.get("limit")).toBe("50");
  });

  it("shows an alert and keeps the retry when older comments fail", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      comment(54 - index),
    );
    const olderPage = Array.from({ length: 5 }, (_, index) =>
      comment(4 - index),
    );
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
      if (calls === 1) return Promise.resolve(commentPage(firstPage, "cursor"));
      if (calls === 2) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "down" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(commentPage(olderPage, null));
    });

    renderDialog(board(), { includeComments: true });
    const list = await screen.findByTestId("public-comments");
    await userEvent.click(screen.getByTestId("public-comments-more"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load older comments.",
    );
    expect(screen.getByTestId("public-comments-more")).toHaveTextContent(
      "Load older comments",
    );

    await userEvent.click(screen.getByTestId("public-comments-more"));
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(55),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(calls).toBe(3);
  });

  it("wraps long titles, checklist lines and attachment names", async () => {
    const longTitle = `https://title.test/${"t".repeat(120)}`;
    const longChecklist = `https://check.test/${"c".repeat(120)}`;
    const longFileName = `https://file.test/${"f".repeat(120)}.txt`;
    const attachment: AttachmentDto = {
      id: "a1",
      cardId: "k1",
      fileName: longFileName,
      mimeType: "text/plain",
      sizeBytes: 1,
      uploadedById: "u1",
      createdAt: 1,
      transcodeStatus: "none",
      hasThumbnail: false,
      hasPoster: false,
    };
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify([attachment]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    renderDialog(
      board({
        title: longTitle,
        checklists: [
          {
            id: "cl1",
            title: "Checklist",
            items: [{ id: "i1", text: longChecklist, done: false }],
          },
        ],
      }),
      { includeAttachments: true },
    );

    const title = screen.getByText(longTitle);
    expect(title).toHaveClass("min-w-0", "max-w-full", "wrap-anywhere");

    const item = screen.getByText(longChecklist);
    expect(item).toHaveClass("min-w-0", "wrap-anywhere");

    const fileName = await screen.findByText(longFileName);
    expect(fileName).toHaveClass("min-w-0", "wrap-anywhere");
  });

  it("shows a retry when the initial comment load fails", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? new Response(JSON.stringify({ message: "down" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            })
          : commentPage([comment(1)], null),
      );
    });

    renderDialog(board(), { includeComments: true });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load comments.",
    );
    await userEvent.click(screen.getByTestId("public-comments-retry"));

    expect(await screen.findByTestId("public-comments")).toHaveTextContent(
      "QA-COMMENT-1",
    );
    expect(calls).toBe(2);
  });
});
