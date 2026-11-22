import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WatchView } from "@/components/board/WatchView";
import { I18nProvider } from "@/i18n";
import {
  BoardLiveProvider,
  createBoardLive,
  type BoardLive,
} from "@/store/board-live";
import type { ActivityFeedEntry, Board, Card } from "@janosik/shared";

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
    // Archived cards live in `board.cards` but not in any column: the status
    // must count only what is on the board right now.
    "card-archived": {
      id: "card-archived",
      title: "Old work",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
      archivedAt: 1,
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
    // `card-archived` is not in any column: the status counts active cards
    // only (the old Math.max with board.cards showed 3).
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

  it("shows an explicit retry when the feed request fails", async () => {
    hoisted.enabled.value = true;
    hoisted.boardActivity.mockRejectedValue(new Error("offline"));
    renderWatch();

    expect(await screen.findByTestId("watch-error")).toHaveTextContent(
      "Could not load the activity feed.",
    );
    expect(screen.getByTestId("watch-retry")).toBeInTheDocument();
  });

  it("shows a busy feed skeleton until the first page arrives", async () => {
    hoisted.enabled.value = true;
    let release!: (page: {
      items: ActivityFeedEntry[];
      nextCursor: string | null;
    }) => void;
    hoisted.boardActivity.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderWatch();

    const skeleton = await screen.findByTestId("watch-feed-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("watch-skeleton-row")).toHaveLength(8);
    expect(screen.queryByText("No activity yet")).toBeNull();

    act(() => release({ items: [], nextCursor: null }));
    await waitFor(() =>
      expect(screen.queryByTestId("watch-feed-skeleton")).toBeNull(),
    );
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
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

  it("renders a deleted comment as a text-free tombstone", async () => {
    hoisted.enabled.value = true;
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "activity",
          id: "deleted",
          at: Date.now(),
          type: "comment_deleted",
          actorId: "u-1",
          cardId: "card-1",
          commentId: "comment-1",
          detail: "comment-1",
          details: { text: "Old body" },
          changes: [{ field: "comment", from: "Old body", to: null }],
        },
      ],
      nextCursor: null,
    });
    renderWatch();
    const entry = await screen.findByTestId("watch-entry");
    expect(entry).toHaveTextContent("Deleted a comment");
    expect(entry.querySelector(".line-through")).toBeNull();
    expect(entry).not.toHaveTextContent("Old body");
    expect(entry).not.toHaveTextContent("comment-1");
    expect(entry).not.toHaveTextContent("Show full values");
  });

  it("invalidates a legacy comment row that only carries detail", async () => {
    hoisted.enabled.value = true;
    const live = createBoardLive();
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "activity",
          id: "legacy-comment",
          at: Date.now(),
          type: "comment_added",
          actorId: "u-1",
          cardId: "card-1",
          detail: "comment-legacy",
          changes: [{ field: "comment", from: null, to: "Legacy body" }],
        },
      ],
      nextCursor: null,
    });
    renderWatch(live);
    expect(await screen.findByText(/Legacy body/)).toBeInTheDocument();

    hoisted.boardActivity.mockResolvedValue({ items: [], nextCursor: null });
    act(() => {
      live.activity.publish({
        type: "activity",
        id: "activity-legacy-deleted",
        boardId: BOARD_ID,
        cardId: "card-1",
        at: Date.now(),
        kind: "comment_deleted",
        detail: "comment-legacy",
      });
    });

    await waitFor(() =>
      expect(screen.queryByText(/Legacy body/)).not.toBeInTheDocument(),
    );
  });

  it("renders a comment edit as a character-level diff and truncates it", async () => {
    hoisted.enabled.value = true;
    const before = `${"Long context ".repeat(20)}old ending`;
    const after = `${"Long context ".repeat(20)}new ending`;
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "activity",
          id: "edit",
          at: Date.now(),
          type: "comment_updated",
          actorId: "u-1",
          cardId: "card-1",
          changes: [{ field: "comment", from: before, to: after }],
        },
      ],
      nextCursor: null,
    });
    renderWatch();
    const entry = await screen.findByTestId("watch-entry");
    expect(entry.querySelector('[data-diff="removed"]')).toHaveTextContent(
      "old",
    );
    expect(entry.querySelector('[data-diff="added"]')).toHaveTextContent("new");
    // The feed is a snippet: the full repeated context is not rendered.
    expect(entry.textContent?.length).toBeLessThan(before.length);
    expect(entry.querySelector(".whitespace-pre-wrap")).not.toBeNull();
  });

  it("keeps a short change as one plain line-through pair", async () => {
    hoisted.enabled.value = true;
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "activity",
          id: "rename",
          at: Date.now(),
          type: "UPDATE_CARD",
          actorId: "u-1",
          cardId: "card-1",
          changes: [
            { field: "title", from: "Initial title", to: "Updated title" },
          ],
        },
      ],
      nextCursor: null,
    });
    renderWatch();
    const entry = await screen.findByTestId("watch-entry");
    // `watch-details.spec` relies on the collapsed row showing the whole
    // stored value once, struck through — no character split.
    expect(entry.querySelectorAll(".line-through")).toHaveLength(1);
    expect(entry.querySelector(".line-through")).toHaveTextContent(
      "Initial title",
    );
    expect(entry.querySelector("[data-diff]")).toBeNull();
    expect(entry).toHaveTextContent("Initial title→Updated title");
  });

  it("never falls back to a raw comment id", async () => {
    hoisted.enabled.value = true;
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "activity",
          id: "update",
          at: Date.now(),
          type: "comment_updated",
          actorId: "u-1",
          cardId: "card-1",
          detail: "comment-raw-id",
        },
      ],
      nextCursor: null,
    });
    renderWatch();
    const entry = await screen.findByTestId("watch-entry");
    expect(entry).not.toHaveTextContent("comment-raw-id");
    expect(entry).toHaveTextContent("Edited a comment");
  });

  it("does not drop fields when an entry has more than three changes", async () => {
    hoisted.enabled.value = true;
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "command",
          id: "many",
          at: Date.now(),
          type: "UPDATE_CARD",
          actorId: "u-1",
          cardId: "card-1",
          changes: ["title", "description", "priority", "label"].map(
            (field, index) => ({
              field,
              from: `old-${index}`,
              to: `new-${index}`,
            }),
          ),
        },
      ],
      nextCursor: null,
    });
    renderWatch();
    const entry = await screen.findByTestId("watch-entry");
    expect(entry).toHaveTextContent("old-3");
    expect(entry).toHaveTextContent("new-3");
  });

  it("names the member alongside their role change", async () => {
    hoisted.enabled.value = true;
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "activity",
          id: "role",
          at: Date.now(),
          type: "member_role_changed",
          actorId: "u-1",
          detail: "member@example.com",
          changes: [{ field: "role", from: "MEMBER", to: "VIEWER" }],
        },
      ],
      nextCursor: null,
    });
    renderWatch();
    const entry = await screen.findByTestId("watch-entry");
    expect(entry).toHaveTextContent("member@example.com");
    expect(entry).toHaveTextContent("MEMBER→VIEWER");
  });

  it("keeps the leaver's display identity when the roster no longer has them", async () => {
    hoisted.enabled.value = true;
    hoisted.boardActivity.mockResolvedValue({
      items: [
        {
          source: "activity",
          id: "left",
          at: Date.now(),
          type: "member_left",
          actorId: "u-3",
          actorName: "Lena",
          actorEmail: "lena@example.com",
        },
      ],
      nextCursor: null,
    });
    renderWatch();
    const entry = await screen.findByTestId("watch-entry");
    expect(entry).toHaveTextContent("Lena");
    expect(entry).not.toHaveTextContent("u-3");
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

  it("keeps two tokens of one account apart and shows their attribution", async () => {
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
          apiTokenId: "token-qa",
          agentSessionId: "session-qa-1",
          runId: "run-qa-1",
          agentName: "QA agent",
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
          apiTokenId: "token-docs",
          agentSessionId: "session-docs-1",
          agentName: "Docs agent",
          cardId: "card-2",
        },
      ],
      nextCursor: null,
    });

    renderWatch();

    const agents = await screen.findByTestId("watch-agents-list");
    expect(agents).toHaveTextContent("QA agent");
    expect(agents).toHaveTextContent("Docs agent");
    expect(screen.getByTestId("watch-agents")).toHaveTextContent("2");

    const qaEntry = screen
      .getAllByTestId("watch-entry")
      .find((entry) => entry.textContent?.includes("QA agent"));
    expect(qaEntry).toBeDefined();
    expect(qaEntry).toHaveTextContent("token-qa");
    expect(qaEntry).toHaveTextContent("session-");
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
