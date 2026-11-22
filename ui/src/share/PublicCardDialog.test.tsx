import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Board, CommentDto, CommentPage } from "@janosik/shared";
import { I18nProvider } from "@/i18n";
import { PublicCardDialog } from "./PublicCardDialog";

/**
 * The public card panel (TASK-58) is read-only and runs without a session.
 * These regressions cover the two QA findings around long descriptions and
 * the comment page cap: the comments API is newest-first with an opaque
 * `nextCursor`, and the dialog used to discard it after the first 50 rows.
 */

const LONG_LINK = `https://example.test/${"a".repeat(120)}`;

function board(description?: string): Board {
  return {
    id: "b1",
    title: "Shared board",
    columns: [{ id: "c1", title: "Todo", cardIds: ["k1"], createdAt: 1 }],
    cards: {
      k1: {
        id: "k1",
        title: "Read me",
        ...(description === undefined ? {} : { description }),
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
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
  { includeComments = false }: { includeComments?: boolean } = {},
) {
  return render(
    <I18nProvider>
      <PublicCardDialog
        token="tok"
        board={cardBoard}
        members={[]}
        cardId="k1"
        includeComments={includeComments}
        includeAttachments={false}
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
    // dialog. `overflow-wrap:anywhere` is the active rule; `break-words` is
    // the same family the comments block already uses.
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    try {
      renderDialog(board(LONG_LINK));

      const description = screen.getByTestId("public-description");
      expect(description).toHaveTextContent(LONG_LINK);
      expect(description).toHaveClass(
        "min-w-0",
        "max-w-full",
        "whitespace-pre-wrap",
        "break-words",
        "text-sm",
      );
      expect(description.className).toContain("[overflow-wrap:anywhere]");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  });

  it("loads older public comments instead of stopping at the first 50", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      comment(54 - index),
    );
    const olderPage = Array.from({ length: 5 }, (_, index) =>
      comment(4 - index),
    );
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return Promise.resolve(
        url.searchParams.get("cursor") === null
          ? commentPage(firstPage, "older-cursor")
          : commentPage(olderPage, null),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDialog(board(), { includeComments: true });

    const list = await screen.findByTestId("public-comments");
    expect(within(list).getAllByRole("listitem")).toHaveLength(50);
    expect(screen.getByTestId("public-comments-count")).toHaveTextContent(
      "50 shown",
    );

    await userEvent.click(screen.getByTestId("public-comments-more"));

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
});
