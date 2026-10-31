import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WatchView } from "@/components/board/WatchView";
import { I18nProvider } from "@/i18n";
import {
  BoardLiveProvider,
  createBoardLive,
  type BoardLive,
} from "@/store/board-live";
import type { Board, Card } from "@janosik/shared";

/**
 * TASK-142 Watch view: the bare swarm observer. It must render the board
 * status and the live feed, and — the point of the view — mount no cards and
 * no drag & drop at all.
 */

const hoisted = vi.hoisted(() => {
  const cards: Record<string, Card> = {
    "card-1": {
      id: "card-1",
      title: "Fix layout",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
    "card-2": {
      id: "card-2",
      title: "Retry SSE",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  };
  const board: Board = {
    id: "b-watch",
    title: "Swarm",
    columns: [
      { id: "col-1", title: "To do", cardIds: ["card-1"], createdAt: 1 },
      { id: "col-2", title: "In progress", cardIds: ["card-2"], createdAt: 1 },
    ],
    cards,
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    board,
    enabled: { value: false },
    boardActivity: vi.fn(),
  };
});

vi.mock("@/api/client", () => ({
  isApiEnabled: () => hoisted.enabled.value,
  api: { boardActivity: hoisted.boardActivity },
}));

vi.mock("@/store/BoardContext", () => ({
  useBoard: () => ({ board: hoisted.board }),
}));

const BOARD_ID = "b-watch";

function seededLive(): BoardLive {
  const live = createBoardLive();
  live.members.set(BOARD_ID, [
    {
      userId: "u-1",
      displayName: "Ada",
      email: "ada@example.com",
      role: "MEMBER",
      expiresAt: null,
      avatarColor: null,
      avatarPath: null,
    },
    {
      userId: "u-2",
      displayName: "Grace",
      email: "grace@example.com",
      role: "MEMBER",
      expiresAt: null,
      avatarColor: null,
      avatarPath: null,
    },
  ]);
  live.presence.apply(BOARD_ID, {
    type: "presence",
    op: "sync",
    users: [
      { id: "u-1", displayName: "Ada", avatarColor: null, avatarPath: null },
    ],
  });
  return live;
}

function renderWatch(live: BoardLive = seededLive()) {
  return render(
    <I18nProvider>
      <BoardLiveProvider live={live}>
        <WatchView boardId={BOARD_ID} />
      </BoardLiveProvider>
    </I18nProvider>,
  );
}

describe("WatchView (TASK-142)", () => {
  beforeEach(() => {
    hoisted.enabled.value = false;
    hoisted.boardActivity.mockReset();
  });

  it("renders the big board status and the column/online rails", () => {
    renderWatch();

    const view = screen.getByTestId("watch-view");
    // The CSS kill-switch for animations/transitions keys off this attribute.
    expect(view).toHaveAttribute("data-watch");
    expect(screen.getByTestId("watch-cards")).toHaveTextContent("2");
    expect(screen.getByTestId("watch-columns")).toHaveTextContent("2");
    expect(screen.getByTestId("watch-online")).toHaveTextContent("1");

    const columns = screen.getByTestId("watch-column-list");
    expect(columns).toHaveTextContent("To do");
    expect(columns).toHaveTextContent("In progress");
    expect(screen.getByTestId("watch-presence-list")).toHaveTextContent("Ada");
  });

  it("mounts no cards and no drag & drop — it is a pure observer", () => {
    const { container } = renderWatch();

    expect(container.querySelectorAll("article")).toHaveLength(0);
    expect(screen.queryByTestId("card-title")).toBeNull();
    // The board/calendar/table views own these; the watch view must not.
    expect(container.querySelector("[data-card-cursor]")).toBeNull();
  });

  it("shows the feed hint in local mode (no board activity endpoint)", () => {
    renderWatch();
    expect(screen.getByText(/server mode/i)).toBeInTheDocument();
    expect(screen.queryByTestId("watch-feed")).toBeNull();
  });

  it("renders the live feed with actor, card title and inline diff", async () => {
    hoisted.enabled.value = true;
    const now = Date.now();
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "command",
          id: "c-1",
          seq: 10,
          at: now,
          type: "MOVE_CARD",
          actorId: "u-1",
          cardId: "card-1",
          changes: [{ field: "column", from: "To do", to: "In progress" }],
        },
        {
          source: "activity",
          id: "a-1",
          at: now - 1000,
          type: "comment_added",
          actorId: "u-2",
          cardId: "card-2",
          changes: [{ field: "comment", from: null, to: "Looks good" }],
        },
      ],
      nextCursor: null,
    });

    renderWatch();

    await waitFor(() =>
      expect(screen.getAllByTestId("watch-entry")).toHaveLength(2),
    );
    const feed = screen.getByTestId("watch-feed");
    expect(feed).toHaveTextContent("Ada");
    expect(feed).toHaveTextContent("Grace");
    expect(feed).toHaveTextContent("Fix layout");
    expect(feed).toHaveTextContent("Retry SSE");
    // The Jira-style from → to diff, not just "someone moved a card".
    expect(feed).toHaveTextContent("To do");
    expect(feed).toHaveTextContent("In progress");
    // A comment renders its text in quotes.
    expect(feed).toHaveTextContent("Looks good");
  });

  it("pages the feed with numbered page buttons", async () => {
    hoisted.enabled.value = true;
    const now = Date.now();
    hoisted.boardActivity.mockImplementation(
      async (_boardId: string, cursor?: string) => {
        if (!cursor) {
          return {
            items: [
              {
                source: "command",
                id: "c-new",
                at: now,
                type: "CREATE_CARD",
                actorId: "u-1",
                cardId: "card-1",
              },
            ],
            nextCursor: "cur-1",
          };
        }
        return {
          items: [
            {
              source: "command",
              id: "c-old",
              at: now - 60_000,
              type: "CREATE_CARD",
              actorId: "u-2",
              cardId: "card-2",
            },
          ],
          nextCursor: null,
        };
      },
    );

    renderWatch();

    // Page 1 is live and the chain exposes a page 2.
    expect(await screen.findByTestId("watch-page-2")).toBeInTheDocument();
    expect(screen.getByTestId("watch-feed")).toHaveTextContent("Fix layout");
    expect(screen.getByTestId("watch-prev")).toBeDisabled();

    fireEvent.click(screen.getByTestId("watch-page-2"));

    await waitFor(() =>
      expect(screen.getByTestId("watch-feed")).toHaveTextContent("Retry SSE"),
    );
    expect(screen.getByTestId("watch-page-2")).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The last page disables Next.
    expect(screen.getByTestId("watch-next")).toBeDisabled();
  });

  it("changes the page size and refetches the first page", async () => {
    hoisted.enabled.value = true;
    hoisted.boardActivity.mockResolvedValue({ items: [], nextCursor: null });

    renderWatch();
    await waitFor(() => expect(hoisted.boardActivity).toHaveBeenCalled());
    hoisted.boardActivity.mockClear();

    fireEvent.click(screen.getByTestId("watch-page-size-20"));

    await waitFor(() =>
      expect(hoisted.boardActivity).toHaveBeenCalledWith(
        BOARD_ID,
        undefined,
        20,
      ),
    );
  });

  it("hides entries with no story (TOUCH_CARD, bare UPDATE_CARD)", async () => {
    hoisted.enabled.value = true;
    const now = Date.now();
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "command",
          id: "t-1",
          at: now,
          type: "TOUCH_CARD",
          actorId: "u-1",
          cardId: "card-1",
        },
        {
          source: "command",
          id: "u-1",
          at: now - 1,
          type: "UPDATE_CARD",
          actorId: "u-1",
          cardId: "card-1",
        },
        {
          source: "command",
          id: "c-1",
          at: now - 2,
          type: "CREATE_CARD",
          actorId: "u-1",
          cardId: "card-2",
        },
      ],
      nextCursor: null,
    });

    renderWatch();

    await waitFor(() =>
      expect(screen.getAllByTestId("watch-entry")).toHaveLength(1),
    );
    expect(screen.getByTestId("watch-feed")).toHaveTextContent("Retry SSE");
  });

  it("labels board-level commands instead of the card fallback", async () => {
    hoisted.enabled.value = true;
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "command",
          id: "col-1",
          at: Date.now(),
          type: "ADD_COLUMN",
          actorId: "u-1",
        },
      ],
      nextCursor: null,
    });

    renderWatch();

    await waitFor(() =>
      expect(screen.getAllByTestId("watch-entry")).toHaveLength(1),
    );
    expect(screen.getByTestId("watch-feed")).toHaveTextContent(
      "Added a column",
    );
  });

  it("lists recently-active agents apart from the humans online", async () => {
    hoisted.enabled.value = true;
    const now = Date.now();
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "command",
          id: "a-1",
          seq: 12,
          at: now,
          type: "MOVE_CARD",
          actorId: "u-2",
          actorType: "agent",
          cardId: "card-1",
        },
        {
          source: "command",
          id: "a-2",
          seq: 11,
          at: now - 1000,
          type: "CREATE_CARD",
          actorId: "u-2",
          actorType: "agent",
          cardId: "card-2",
        },
        {
          source: "command",
          id: "h-1",
          seq: 10,
          at: now - 500,
          type: "CREATE_CARD",
          actorId: "u-1",
          actorType: "human",
          cardId: "card-1",
        },
      ],
      nextCursor: null,
    });

    renderWatch();

    const agents = await screen.findByTestId("watch-agents-list");
    // u-2 (Grace) is an agent; u-1 (Ada) is a person and stays out.
    expect(agents).toHaveTextContent("Grace");
    expect(agents).not.toHaveTextContent("Ada");
    expect(screen.getByTestId("watch-agents")).toHaveTextContent("1");
    // The human is in the presence roster; the agent never opens a stream.
    expect(screen.getByTestId("watch-presence-list")).toHaveTextContent("Ada");
    expect(screen.getByTestId("watch-presence-list")).not.toHaveTextContent(
      "Grace",
    );
  });
});
