import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board, BoardAction, BoardMemberDto } from "@janosik/shared";

import {
  AttributionStore,
  BoardLiveProvider,
  FOREIGN_HIGHLIGHT_MS,
  MembersStore,
  PresenceStore,
  cardIdsTouchedBy,
  createBoardLive,
  useBoardMember,
  useBoardPresence,
  useEntityAttribution,
} from "@/store/board-live";

/**
 * The live collaboration stores (TASK-36): rosters, attribution, the member
 * directory and the command → card-id mapping that feeds them.
 */

const alice = { id: "u-alice", displayName: "Alice", avatarColor: null };
const bob = { id: "u-bob", displayName: "Bob", avatarColor: null };

function member(overrides: Partial<BoardMemberDto> = {}): BoardMemberDto {
  return {
    userId: "u-bob",
    displayName: "Bob",
    email: "bob@example.com",
    role: "MEMBER",
    expiresAt: null,
    avatarColor: null,
    ...overrides,
  };
}

function board(): Board {
  return {
    id: "b-1",
    title: "Board",
    columns: [],
    cards: {
      "c-1": {
        id: "c-1",
        title: "One",
        labelIds: [],
        createdAt: 1,
        updatedAt: 40,
        lastActorId: "u-bob",
      },
      "c-2": {
        id: "c-2",
        title: "Two",
        labelIds: [],
        createdAt: 2,
        updatedAt: 2,
      },
    },
    labels: [],
    createdAt: 1,
    updatedAt: 50,
  };
}

function wrapper(live: ReturnType<typeof createBoardLive>) {
  return ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <BoardLiveProvider live={live}>{children}</BoardLiveProvider>
    </StrictMode>
  );
}

describe("cardIdsTouchedBy", () => {
  const action = (body: Record<string, unknown>): BoardAction =>
    ({ at: 1, ...body }) as unknown as BoardAction;

  it("maps card-shaped commands onto their card ids", () => {
    expect(
      cardIdsTouchedBy(action({ type: "UPDATE_CARD", cardId: "c-1" })),
    ).toEqual(["c-1"]);
    expect(
      cardIdsTouchedBy(
        action({ type: "SET_CARD_LABEL", cardId: "c-1", labelId: "l" }),
      ),
    ).toEqual(["c-1"]);
    expect(
      cardIdsTouchedBy(action({ type: "ADD_CHECKLIST", cardId: "c-1" })),
    ).toEqual(["c-1"]);
    expect(
      cardIdsTouchedBy(
        action({ type: "MOVE_CARD", cardId: "c-1", toColumnId: "x" }),
      ),
    ).toEqual(["c-1"]);
  });

  it("stamps only the copy for duplicates and the snapshot for restores", () => {
    expect(
      cardIdsTouchedBy(
        action({ type: "DUPLICATE_CARD", cardId: "c-1", newCardId: "c-9" }),
      ),
    ).toEqual(["c-9"]);
    expect(
      cardIdsTouchedBy(
        action({ type: "RESTORE_CARD", card: { id: "c-1" }, columnId: "x" }),
      ),
    ).toEqual(["c-1"]);
    expect(
      cardIdsTouchedBy(
        action({
          type: "RESTORE_COLUMN_CARDS",
          columnId: "x",
          cards: [{ id: "c-1" }, { id: "c-2" }],
        }),
      ),
    ).toEqual(["c-1", "c-2"]);
  });

  it("leaves bookkeeping reorders unstamped, like the writers do", () => {
    expect(
      cardIdsTouchedBy(
        action({
          type: "SET_COLUMN_CARD_ORDER",
          columnId: "x",
          cardIds: ["c-1"],
        }),
      ),
    ).toEqual([]);
    expect(
      cardIdsTouchedBy(action({ type: "SORT_COLUMN", columnId: "x" })),
    ).toEqual([]);
    expect(
      cardIdsTouchedBy(action({ type: "RENAME_BOARD", title: "T" })),
    ).toEqual([]);
  });
});

describe("PresenceStore", () => {
  it("replaces a roster only when it actually changed", () => {
    const store = new PresenceStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set("b-1", [alice]);
    expect(store.get("b-1")).toEqual([alice]);
    store.set("b-1", [alice]);
    expect(listener).toHaveBeenCalledTimes(1);

    store.set("b-1", [alice, bob]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get("b-2")).toEqual([]);
    store.clear();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("AttributionStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("remembers the author and clears the highlight on its own clock", () => {
    const store = new AttributionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe("c-1", listener);

    store.stamp("b-1", "u-bob", ["c-1"], { at: 100, highlight: true });
    expect(store.get("c-1")).toEqual({
      boardId: "b-1",
      userId: "u-bob",
      at: 100,
      highlight: true,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(FOREIGN_HIGHLIGHT_MS));
    expect(store.get("c-1")?.highlight).toBe(false);
    expect(store.get("c-1")?.userId).toBe("u-bob");
    expect(listener).toHaveBeenCalledTimes(2);

    // Nothing changed: no extra notifications.
    store.stamp("b-1", "u-bob", ["c-1"], { at: 100 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("a newer write cancels the previous highlight timer", () => {
    const store = new AttributionStore();
    store.stamp("b-1", "u-bob", ["c-1"], { highlight: true });
    store.stamp("b-1", "u-alice", ["c-1"], { highlight: false });
    act(() => vi.advanceTimersByTime(FOREIGN_HIGHLIGHT_MS * 2));
    expect(store.get("c-1")).toEqual({
      boardId: "b-1",
      userId: "u-alice",
      at: expect.any(Number),
      highlight: false,
    });
  });

  it("seeds from an aggregate without highlighting, updatedAt as the time", () => {
    const store = new AttributionStore();
    store.seed(board());
    expect(store.get("c-1")).toEqual({
      boardId: "b-1",
      userId: "u-bob",
      at: 40,
      highlight: false,
    });
    expect(store.get("c-2")).toBeUndefined();
    store.clear();
    expect(store.get("c-1")).toBeUndefined();
  });
});

describe("MembersStore", () => {
  it("serves profiles per board and bumps its version on writes", () => {
    const store = new MembersStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getVersion();

    store.set("b-1", [member()]);
    expect(store.getVersion()).toBeGreaterThan(before);
    expect(store.get("b-1", "u-bob")?.displayName).toBe("Bob");
    expect(store.get("b-2", "u-bob")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("live hooks", () => {
  it("read the provider's stores and tolerate a missing provider", () => {
    const live = createBoardLive();
    live.presence.set("b-1", [alice, bob]);
    live.attribution.stamp("b-1", "u-bob", ["c-1"], { at: 5 });
    live.members.set("b-1", [member()]);

    const presence = renderHook(() => useBoardPresence("b-1"), {
      wrapper: wrapper(live),
    });
    expect(presence.result.current).toEqual([alice, bob]);

    const attribution = renderHook(() => useEntityAttribution("c-1"), {
      wrapper: wrapper(live),
    });
    expect(attribution.result.current?.userId).toBe("u-bob");

    const membership = renderHook(() => useBoardMember("b-1", "u-bob"), {
      wrapper: wrapper(live),
    });
    expect(membership.result.current?.displayName).toBe("Bob");

    // The provider updates propagate.
    act(() => live.presence.set("b-1", [alice]));
    expect(presence.result.current).toEqual([alice]);

    // Outside a provider every hook stays quiet instead of throwing.
    const orphan = renderHook(() => useBoardPresence("b-1"));
    expect(orphan.result.current).toEqual([]);
    const orphanAttr = renderHook(() => useEntityAttribution("c-1"));
    expect(orphanAttr.result.current).toBeUndefined();
    const orphanMember = renderHook(() => useBoardMember("b-1", "u-bob"));
    expect(orphanMember.result.current).toBeUndefined();
  });
});
