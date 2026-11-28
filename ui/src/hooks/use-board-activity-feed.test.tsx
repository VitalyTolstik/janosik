import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityFeedPage, ActivitySseEvent } from "@janosik/shared";

import { api } from "@/api/client";
import { useBoardActivityFeed } from "@/hooks/use-board-activity-feed";
import { BoardLiveProvider, createBoardLive } from "@/store/board-live";

const empty: ActivityFeedPage = { items: [], nextCursor: null };
const boardId = "board";
let live: ReturnType<typeof createBoardLive>;
let hidden: boolean;

function pageWithComment(): ActivityFeedPage {
  return {
    nextCursor: null,
    items: [
      {
        id: "update",
        source: "activity",
        type: "comment_updated",
        actorId: "user",
        at: 5,
        cardId: "card",
        commentId: "comment",
        changes: [{ field: "comment", from: "old", to: "new" }],
      },
    ],
  };
}

function commentDeleted(): ActivitySseEvent {
  return {
    type: "activity",
    id: "delete",
    boardId,
    cardId: "card",
    at: 6,
    kind: "comment_deleted",
    commentId: "comment",
  };
}

function Consumer({
  name,
  active,
  cardId,
}: {
  name: string;
  active: boolean;
  cardId?: string;
}) {
  const { page, error } = useBoardActivityFeed(boardId, { active, cardId });
  return (
    <div data-testid={name}>
      {error ? "error" : page ? `${page.items.length} rows` : "loading"}
    </div>
  );
}

function tree({
  watch = false,
  panel = true,
  cardId,
  active = true,
}: {
  watch?: boolean;
  panel?: boolean;
  cardId?: string;
  active?: boolean;
} = {}) {
  return (
    <StrictMode>
      <BoardLiveProvider live={live}>
        {watch ? <Consumer name="watch" active={active} /> : null}
        {panel ? (
          <Consumer name="panel" active={active} cardId={cardId} />
        ) : null}
      </BoardLiveProvider>
    </StrictMode>
  );
}

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_API_URL", "/api/v1");
  live = createBoardLive();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(api, "boardActivity").mockResolvedValue(empty);
  vi.spyOn(api, "cardActivity").mockResolvedValue(empty);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("shared activity feed", () => {
  it("uses one poll for Watch consumers and reuses a fresh page", async () => {
    const { rerender, unmount } = render(tree({ watch: true }));
    await advance(0);
    expect(api.boardActivity).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("panel")).toHaveTextContent("0 rows");
    expect(screen.getByTestId("watch")).toHaveTextContent("0 rows");

    rerender(tree({ watch: true, panel: false }));
    rerender(tree({ watch: true }));
    await advance(2999);
    expect(api.boardActivity).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(api.boardActivity).toHaveBeenCalledTimes(2);
    rerender(tree({ panel: false }));
    await advance(1000);
    rerender(tree());
    await advance(0);
    expect(api.boardActivity).toHaveBeenCalledTimes(2);
    unmount();
    await advance(9000);
    expect(api.boardActivity).toHaveBeenCalledTimes(2);
  });

  it("coalesces SSE and local commits per scope and ignores events from other boards", async () => {
    const { rerender } = render(tree({ watch: true, cardId: "card" }));
    await advance(0);
    expect(api.boardActivity).toHaveBeenCalledExactlyOnceWith(
      boardId,
      undefined,
      50,
    );
    expect(api.cardActivity).toHaveBeenCalledExactlyOnceWith(
      "card",
      undefined,
      50,
    );

    act(() => {
      live.commits.publish("other-board", ["card"]);
      live.commits.publish(boardId, ["other-card"]);
    });
    await advance(1000);
    expect(api.boardActivity).toHaveBeenCalledTimes(2);
    expect(api.cardActivity).toHaveBeenCalledTimes(1);

    act(() => {
      live.activity.publish({
        type: "activity",
        id: "activity",
        boardId,
        cardId: "card",
        at: 1,
        kind: "comment_added",
      });
      live.commits.publish(boardId, ["card"]);
    });
    await advance(999);
    expect(api.boardActivity).toHaveBeenCalledTimes(2);
    expect(api.cardActivity).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(api.boardActivity).toHaveBeenCalledTimes(3);
    expect(api.cardActivity).toHaveBeenCalledTimes(2);

    rerender(tree({ watch: true, cardId: "second" }));
    await advance(0);
    expect(api.cardActivity).toHaveBeenLastCalledWith("second", undefined, 50);
    expect(api.boardActivity).toHaveBeenCalledTimes(3);
  });

  it("pauses polling and pending SSE refreshes when hidden and resumes once visible", async () => {
    render(tree({ watch: true }));
    await advance(0);
    act(() => {
      live.commits.publish(boardId, ["card"]);
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(9000);
    expect(api.boardActivity).toHaveBeenCalledTimes(1);
    act(() => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(0);
    expect(api.boardActivity).toHaveBeenCalledTimes(2);
    await advance(3000);
    expect(api.boardActivity).toHaveBeenCalledTimes(3);
  });

  it("shares an in-flight request across a close and reopen, then recovers from an error", async () => {
    let reject!: () => void;
    vi.mocked(api.boardActivity).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = () => fail(new Error("offline"));
        }),
    );
    const { rerender } = render(tree());
    expect(screen.getByTestId("panel")).toHaveTextContent("loading");
    rerender(tree({ panel: false }));
    rerender(tree());
    await advance(3000);
    expect(api.boardActivity).toHaveBeenCalledTimes(1);
    await act(async () => reject());
    expect(screen.getByTestId("panel")).toHaveTextContent("error");
    await advance(3000);
    expect(api.boardActivity).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("panel")).toHaveTextContent("0 rows");
  });
  it("pauses while mounted but inactive and refreshes on activation", async () => {
    const { rerender } = render(tree({ panel: true, active: false }));
    await advance(0);
    expect(api.boardActivity).not.toHaveBeenCalled();
    expect(screen.getByTestId("panel")).toHaveTextContent("loading");

    rerender(tree({ panel: true, active: true }));
    await advance(0);
    expect(api.boardActivity).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("panel")).toHaveTextContent("0 rows");

    await advance(3000);
    expect(api.boardActivity).toHaveBeenCalledTimes(2);

    rerender(tree({ panel: true, active: false }));
    await advance(9000);
    expect(api.boardActivity).toHaveBeenCalledTimes(2);
  });

  it("keeps an in-flight idle scope registered when the cache is under pressure", async () => {
    const pending: {
      cardId: string;
      resolve: (page: ActivityFeedPage) => void;
    }[] = [];
    vi.mocked(api.cardActivity).mockImplementation(
      (cardId) =>
        new Promise((resolve) => {
          pending.push({ cardId, resolve });
        }),
    );
    const { rerender } = render(tree({ cardId: "card-0" }));
    await advance(0);
    expect(api.cardActivity).toHaveBeenCalledExactlyOnceWith(
      "card-0",
      undefined,
      50,
    );

    // Push the first scope out of the idle window while its request is still
    // outstanding.
    for (let index = 1; index <= 9; index += 1) {
      rerender(tree({ cardId: `card-${index}` }));
      await advance(0);
    }
    rerender(tree({ cardId: "card-0" }));
    await advance(0);

    expect(
      pending.filter((request) => request.cardId === "card-0"),
    ).toHaveLength(1);
    await act(async () => {
      for (const request of pending) request.resolve(empty);
    });
  });

  it("reconciles a cached page after a deletion while both consumers were closed", async () => {
    vi.mocked(api.boardActivity)
      .mockResolvedValueOnce(pageWithComment())
      .mockResolvedValue(empty);
    const { rerender } = render(tree({ watch: true }));
    await advance(0);
    expect(screen.getByTestId("watch")).toHaveTextContent("1 rows");

    rerender(tree({ panel: false }));
    act(() => {
      live.activity.publish(commentDeleted());
    });

    rerender(tree({ watch: true }));
    // The cached page is reconciled from the shared tombstone map before
    // paint; it must not wait for the next poll.
    expect(screen.getByTestId("watch")).toHaveTextContent("0 rows");
    expect(screen.getByTestId("panel")).toHaveTextContent("0 rows");

    await advance(3000);
    expect(screen.getByTestId("watch")).toHaveTextContent("0 rows");
  });

  it("drops a pre-deletion response that lands after both consumers closed", async () => {
    let resolvePoll!: (page: ActivityFeedPage) => void;
    vi.mocked(api.boardActivity)
      .mockResolvedValueOnce(pageWithComment())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePoll = resolve;
          }),
      );
    const { rerender } = render(tree({ watch: true }));
    await advance(0);
    expect(screen.getByTestId("watch")).toHaveTextContent("1 rows");
    await advance(3000);
    expect(api.boardActivity).toHaveBeenCalledTimes(2);

    rerender(tree({ panel: false }));
    act(() => {
      live.activity.publish(commentDeleted());
    });
    await act(async () => resolvePoll(pageWithComment()));
    rerender(tree({ watch: true }));
    expect(screen.getByTestId("watch")).toHaveTextContent("0 rows");
  });

  it("shows a restored comment from a response that started at the deletion stamp", async () => {
    vi.mocked(api.boardActivity)
      .mockResolvedValueOnce(pageWithComment())
      .mockResolvedValue(pageWithComment());
    render(tree({ watch: true }));
    await advance(0);
    expect(screen.getByTestId("watch")).toHaveTextContent("1 rows");

    act(() => {
      live.activity.publish(commentDeleted());
    });
    expect(screen.getByTestId("watch")).toHaveTextContent("0 rows");

    await advance(1000);
    expect(screen.getByTestId("watch")).toHaveTextContent("1 rows");
  });

  it("keeps deleted comment details out of a late response for both consumers", async () => {
    const old: ActivityFeedPage = {
      nextCursor: null,
      items: [
        {
          id: "update",
          source: "activity",
          type: "comment_updated",
          actorId: "user",
          at: 5,
          cardId: "card",
          commentId: "comment",
          changes: [{ field: "comment", from: "old", to: "new" }],
        },
      ],
    };
    let resolve!: (page: ActivityFeedPage) => void;
    vi.mocked(api.boardActivity)
      .mockResolvedValueOnce(old)
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    render(tree({ watch: true }));
    await advance(0);
    expect(screen.getByTestId("watch")).toHaveTextContent("1 rows");
    await advance(3000);
    act(() => {
      live.activity.publish({
        type: "activity",
        id: "delete",
        boardId,
        cardId: "card",
        at: 6,
        kind: "comment_deleted",
        commentId: "comment",
      });
    });
    expect(screen.getByTestId("watch")).toHaveTextContent("0 rows");
    await act(async () => resolve(old));
    expect(screen.getByTestId("panel")).toHaveTextContent("0 rows");
    await advance(1000);
    expect(api.boardActivity).toHaveBeenCalledTimes(3);
  });
});
