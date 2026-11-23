import { describe, expect, it } from "vitest";

import {
  boardReducer,
  initialBoardState,
  type BoardAction,
} from "./board-reducer";
import type { Board, Card, CardReadModelMeta } from "../types/kanban";
import {
  BOARD_CARD_DETAIL_BATCH_MAX,
  BOARD_CARD_PAGE_LIMIT_DEFAULT,
  BOARD_CARD_PAGE_LIMIT_MAX,
  BOARD_READ_MODEL_HEADER,
  BOARD_READ_MODEL_VERSION,
} from "../api";

/**
 * TASK-200.9 read-model behavior in the pure reducer: list-facing facts kept
 * current from commands, HYDRATE_CARDS precedence and the shared capability
 * constants. The UI store tests cover the adapter; these pin the domain rules.
 */

const SEED = initialBoardState()[0];
const SEED_CARD = SEED.cards["card-1"];
let clock = 2_000_000;

function meta(overrides: Partial<CardReadModelMeta> = {}): CardReadModelMeta {
  return {
    descriptionChars: 0,
    checklistItemCount: 0,
    checklistDoneCount: 0,
    linkCount: 0,
    blocked: false,
    detailLoaded: false,
    ...overrides,
  };
}

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    ...SEED_CARD,
    id,
    title: id,
    labelIds: [],
    createdAt: 1,
    updatedAt: 10,
    ...overrides,
  };
}

/** A one-column board holding exactly `cards` (unless told otherwise). */
function board(
  cards: readonly Card[],
  options: { archived?: string[]; listed?: string[] } = {},
): Board {
  const listed =
    options.listed ??
    cards.filter((c) => c.archivedAt === undefined).map((c) => c.id);
  return {
    ...SEED,
    columns: [
      { id: "col-backlog", title: "Backlog", cardIds: listed, createdAt: 1 },
    ],
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    ...(options.archived !== undefined
      ? { archivedCardIds: options.archived }
      : {}),
  };
}

function reduce(initial: Board, action: Record<string, unknown>): Board {
  clock += 1;
  return boardReducer([initial], {
    at: clock,
    ...action,
  } as unknown as BoardAction)[0];
}

function hydrate(initial: Board, cards: Card[], atSeq?: number): Board {
  return boardReducer([initial], {
    type: "HYDRATE_CARDS",
    boardId: initial.id,
    cards,
    atSeq,
  } as BoardAction)[0];
}

describe("TASK-200.9 capability constants", () => {
  it("pins the read-model header, version and page bounds", () => {
    expect(BOARD_READ_MODEL_HEADER).toBe("X-Janosik-Read-Model");
    expect(BOARD_READ_MODEL_VERSION).toBe("v1");
    expect(BOARD_CARD_PAGE_LIMIT_DEFAULT).toBe(50);
    expect(BOARD_CARD_PAGE_LIMIT_MAX).toBe(100);
    expect(BOARD_CARD_DETAIL_BATCH_MAX).toBe(50);
  });
});

describe("HYDRATE_CARDS", () => {
  it("never hydrates an id the summary does not place", () => {
    const initial = board([card("card-a")], { listed: [] });
    expect(hydrate(initial, [card("card-b")])).toBe(initial);
  });

  it("fills a card the summary places but has not hydrated yet", () => {
    const initial = board([], { listed: ["card-x"] });
    const next = hydrate(initial, [card("card-x")]);
    expect(next.cards["card-x"]?.title).toBe("card-x");
  });

  it("keeps the loaded activity when detail arrives without it", () => {
    const activity = [
      { id: "a1", type: "created", at: 1, actorId: "user-1" },
    ] as Card["activity"];
    const existing = card("card-a", {
      activity,
      readModel: meta({ detailLoaded: true }),
    });
    const next = hydrate(board([existing]), [
      card("card-a", { readModel: meta({ detailLoaded: true }) }),
    ]);
    expect(next.cards["card-a"]?.activity).toBe(activity);
  });

  it("ignores a late detail older than the cached card", () => {
    const existing = card("card-a", {
      updatedAt: 20,
      readModel: meta({ detailLoaded: true }),
    });
    const initial = board([existing]);
    expect(
      hydrate(initial, [
        card("card-a", {
          updatedAt: 10,
          readModel: meta({ detailLoaded: true }),
        }),
      ]),
    ).toBe(initial);
  });

  it("ignores an identical detail response", () => {
    const existing = card("card-a", {
      readModel: meta({ detailLoaded: true, linkCount: 1 }),
    });
    const initial = board([existing]);
    const same = card("card-a", {
      readModel: meta({ detailLoaded: true, linkCount: 1 }),
    });
    expect(hydrate(initial, [same])).toBe(initial);
  });

  it("replaces detail whose reverse link rows changed", () => {
    const existing = card("card-a", {
      readModel: meta({ detailLoaded: true, linkCount: 1 }),
      incomingLinks: [],
    });
    const next = hydrate(board([existing]), [
      card("card-a", {
        readModel: meta({ detailLoaded: true, linkCount: 1 }),
        incomingLinks: [
          {
            id: "l1",
            type: "blocks",
            fromCardId: "card-src",
            fromArchived: false,
          },
        ],
      }),
    ]);
    expect(next.cards["card-a"]?.incomingLinks).toHaveLength(1);
  });

  it("replaces an identical detail whose reverse rows are stale", () => {
    const existing = card("card-a", {
      readModel: meta({
        detailLoaded: true,
        linkCount: 1,
        reverseLinksStale: true,
      }),
    });
    const next = hydrate(board([existing]), [
      card("card-a", {
        readModel: meta({ detailLoaded: true, linkCount: 1 }),
      }),
    ]);
    expect(next.cards["card-a"]?.readModel?.reverseLinksStale).toBeUndefined();
  });

  it("does not downgrade a cached detail with an older summary", () => {
    const existing = card("card-a", {
      updatedAt: 20,
      readModel: meta({ detailLoaded: true, descriptionChars: 12 }),
    });
    const initial = board([existing]);
    expect(
      hydrate(initial, [
        card("card-a", {
          updatedAt: 10,
          readModel: meta({ linkCount: 3 }),
        }),
      ]),
    ).toBe(initial);
  });

  it("keeps detail facts from a page older than the detail read", () => {
    const existing = card("card-a", {
      readModel: meta({
        detailLoaded: true,
        linkCount: 1,
        factsAtSeq: 30,
      }),
    });
    const initial = board([existing]);
    expect(
      hydrate(
        initial,
        [
          card("card-a", {
            readModel: meta({ linkCount: 2, blocked: true }),
          }),
        ],
        20,
      ),
    ).toBe(initial);
  });

  it("merges a same-stamp fact change without dropping the body", () => {
    const existing = card("card-a", {
      description: "full body",
      readModel: meta({
        detailLoaded: true,
        linkCount: 1,
        factsAtSeq: 30,
        descriptionChars: 9,
      }),
      incomingLinks: [
        {
          id: "l1",
          type: "relates_to",
          fromCardId: "card-b",
          fromArchived: false,
        },
      ],
    });
    const next = hydrate(
      board([existing]),
      [card("card-a", { readModel: meta({ linkCount: 2 }) })],
      40,
    );
    const merged = next.cards["card-a"];
    expect(merged?.description).toBe("full body");
    expect(merged?.readModel).toMatchObject({
      detailLoaded: true,
      linkCount: 2,
      reverseLinksStale: true,
      factsAtSeq: 40,
      descriptionChars: 9,
    });
    expect(merged?.incomingLinks).toBeUndefined();
  });

  it("merges a same-stamp fact change when no revision is known", () => {
    const existing = card("card-a", {
      readModel: meta({ detailLoaded: true, linkCount: 1 }),
    });
    const next = hydrate(board([existing]), [
      card("card-a", { readModel: meta({ linkCount: 2 }) }),
    ]);
    expect(next.cards["card-a"]?.readModel).toMatchObject({
      linkCount: 2,
      reverseLinksStale: true,
    });
    expect(next.cards["card-a"]?.readModel?.factsAtSeq).toBeUndefined();
  });

  it("marks reverse rows stale when the same facts arrive at a newer revision", () => {
    const existing = card("card-a", {
      description: "body",
      readModel: meta({
        detailLoaded: true,
        linkCount: 2,
        factsAtSeq: 30,
      }),
      incomingLinks: [
        {
          id: "l1",
          type: "relates_to",
          fromCardId: "card-b",
          fromArchived: false,
        },
      ],
    });
    const next = hydrate(
      board([existing]),
      [card("card-a", { readModel: meta({ linkCount: 2 }) })],
      40,
    );
    expect(next.cards["card-a"]?.description).toBe("body");
    expect(next.cards["card-a"]?.incomingLinks).toBeUndefined();
    expect(next.cards["card-a"]?.readModel?.reverseLinksStale).toBe(true);
  });

  it("keeps an unchanged fact-free detail", () => {
    const existing = card("card-a", {
      readModel: meta({ detailLoaded: true, factsAtSeq: 30 }),
    });
    const initial = board([existing]);
    expect(hydrate(initial, [card("card-a", { readModel: meta() })], 40)).toBe(
      initial,
    );
  });

  it("replaces a cached detail with a newer summary", () => {
    const existing = card("card-a", {
      description: "old body",
      updatedAt: 10,
      readModel: meta({ detailLoaded: true, descriptionChars: 8 }),
    });
    const next = hydrate(board([existing]), [
      card("card-a", {
        description: undefined,
        updatedAt: 20,
        readModel: meta({ descriptionChars: 8 }),
      }),
    ]);
    expect(next.cards["card-a"]?.readModel?.detailLoaded).toBe(false);
    expect(next.cards["card-a"]?.description).toBeUndefined();
  });

  it("hydrates a newer summary over a summary and ignores an older one", () => {
    const existing = card("card-a", { readModel: meta({ linkCount: 1 }) });
    const newer = hydrate(board([existing]), [
      card("card-a", {
        title: "new",
        updatedAt: 20,
        readModel: meta({ linkCount: 2 }),
      }),
    ]);
    expect(newer.cards["card-a"]?.title).toBe("new");
    const initial = board([existing]);
    expect(
      hydrate(initial, [
        card("card-a", {
          title: "old",
          updatedAt: 5,
          readModel: meta({ linkCount: 3 }),
        }),
      ]),
    ).toBe(initial);
  });

  it("does not overwrite a full-aggregate card at the same stamp", () => {
    const existing = card("card-a");
    const initial = board([existing]);
    expect(
      hydrate(initial, [card("card-a", { readModel: meta({ linkCount: 1 }) })]),
    ).toBe(initial);
  });

  it("replaces a full-aggregate card with a newer summary", () => {
    const existing = card("card-a", { updatedAt: 10 });
    const next = hydrate(board([existing]), [
      card("card-a", { updatedAt: 20, readModel: meta({ linkCount: 2 }) }),
    ]);
    expect(next.cards["card-a"]?.readModel?.linkCount).toBe(2);
  });

  it("treats a full-aggregate card as detail and ignores an older one", () => {
    const existing = card("card-a", {
      activity: [{ id: "a1", type: "created", at: 1 }] as Card["activity"],
      readModel: meta({ detailLoaded: true }),
    });
    const fuller = hydrate(board([existing]), [
      card("card-a", { title: "full" }),
    ]);
    expect(fuller.cards["card-a"]?.readModel).toBeUndefined();
    expect(fuller.cards["card-a"]?.activity).toHaveLength(1);
    const initial = board([existing]);
    expect(hydrate(initial, [card("card-a", { updatedAt: 5 })])).toBe(initial);
  });
});

describe("read-model facts on card commands", () => {
  it("keeps the description counter current", () => {
    const existing = card("card-a", {
      readModel: meta({ descriptionChars: 3 }),
    });
    expect(
      reduce(board([existing]), {
        type: "UPDATE_CARD",
        cardId: "card-a",
        description: "hello",
      }).cards["card-a"]?.readModel?.descriptionChars,
    ).toBe(5);
    expect(
      reduce(board([existing]), {
        type: "UPDATE_CARD",
        cardId: "card-a",
        title: "renamed",
      }).cards["card-a"]?.readModel?.descriptionChars,
    ).toBe(3);
  });

  it("recomputes checklist counters on a detail card", () => {
    const existing = card("card-a", {
      checklists: [
        {
          id: "cl-1",
          title: "Done?",
          items: [
            { id: "i1", text: "one", done: true },
            { id: "i2", text: "two", done: false },
          ],
        },
      ],
      readModel: meta({
        detailLoaded: true,
        checklistItemCount: 2,
        checklistDoneCount: 1,
      }),
    });
    const next = reduce(board([existing]), {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-a",
      checklistId: "cl-1",
      newItemId: "i3",
      text: "three",
    });
    expect(next.cards["card-a"]?.readModel).toMatchObject({
      checklistItemCount: 3,
      checklistDoneCount: 1,
    });
  });

  it("applies the command delta to summary checklist counters", () => {
    const existing = card("card-a", {
      readModel: meta({ checklistItemCount: 3, checklistDoneCount: 2 }),
    });
    const added = reduce(board([existing]), {
      type: "ADD_CHECKLIST",
      cardId: "card-a",
      newChecklistId: "cl-1",
      title: "New",
    });
    // No items added: the server counters stand.
    expect(added.cards["card-a"]?.readModel).toMatchObject({
      checklistItemCount: 3,
      checklistDoneCount: 2,
    });
    const item = reduce(added, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-a",
      checklistId: "cl-1",
      newItemId: "i1",
      text: "one",
    });
    expect(item.cards["card-a"]?.readModel).toMatchObject({
      checklistItemCount: 4,
      checklistDoneCount: 2,
    });
  });

  it("clears a summary target's blocked fact when the last link goes", () => {
    const source = card("card-source", {
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
      readModel: meta({ linkCount: 1 }),
    });
    const target = card("card-target", {
      readModel: meta({ linkCount: 1, blocked: true }),
    });
    const next = reduce(board([source, target]), {
      type: "DELETE_CARD",
      cardId: "card-source",
    });
    expect(next.cards["card-target"]?.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
    expect(next.archivedCardIds).toBeUndefined();
  });

  it("keeps a summary target conservative while other links remain", () => {
    const source = card("card-source", {
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ linkCount: 2, blocked: true }),
    });
    const next = reduce(board([source, target]), {
      type: "DELETE_CARD",
      cardId: "card-source",
    });
    expect(next.cards["card-target"]?.readModel).toMatchObject({
      linkCount: 1,
      blocked: true,
    });
  });

  it("recomputes a detail target's blocked fact from its rows", () => {
    const source = card("card-source", {
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ detailLoaded: true, linkCount: 1, blocked: true }),
      incomingLinks: [
        {
          id: "l1",
          type: "blocks",
          fromCardId: "card-source",
          fromArchived: false,
        },
      ],
    });
    const next = reduce(board([source, target]), {
      type: "DELETE_CARD",
      cardId: "card-source",
    });
    expect(next.cards["card-target"]?.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
    expect(next.cards["card-target"]?.incomingLinks).toEqual([]);
  });

  it("keeps a detail target blocked by another surviving blocker", () => {
    const source = card("card-source", {
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
    });
    const other = card("card-other", {
      links: [{ id: "l2", type: "blocks", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ detailLoaded: true, linkCount: 2, blocked: true }),
      incomingLinks: [
        {
          id: "l1",
          type: "blocks",
          fromCardId: "card-source",
          fromArchived: false,
        },
        {
          id: "l2",
          type: "blocks",
          fromCardId: "card-other",
          fromArchived: false,
        },
      ],
    });
    const next = reduce(board([source, other, target]), {
      type: "DELETE_CARD",
      cardId: "card-source",
    });
    expect(next.cards["card-target"]?.readModel).toMatchObject({
      linkCount: 1,
      blocked: true,
    });
  });

  it("drops the deleted card's id from the archive list", () => {
    const archived = card("card-a", { archivedAt: 5 });
    const next = reduce(
      board([archived], { archived: ["card-a", "card-b"], listed: [] }),
      { type: "DELETE_CARD", cardId: "card-a" },
    );
    expect(next.archivedCardIds).toEqual(["card-b"]);
  });

  it("takes degree off the sources of a deleted target", () => {
    const source = card("card-source", {
      readModel: meta({ detailLoaded: true, linkCount: 1 }),
    });
    const target = card("card-target", {
      readModel: meta({ detailLoaded: true, linkCount: 1 }),
      incomingLinks: [
        {
          id: "l1",
          type: "relates_to",
          fromCardId: "card-source",
          fromArchived: false,
        },
      ],
    });
    const next = reduce(board([source, target]), {
      type: "DELETE_CARD",
      cardId: "card-target",
    });
    expect(next.cards["card-source"]?.readModel?.linkCount).toBe(0);
  });

  it("archives a blocker: a single-link summary target unblocks", () => {
    const source = card("card-source", {
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ linkCount: 1, blocked: true }),
    });
    const initial = board([source, target], { archived: [] });
    const next = reduce(initial, {
      type: "ARCHIVE_CARD",
      cardId: "card-source",
    });
    expect(next.cards["card-target"]?.readModel?.blocked).toBe(false);
    expect(next.archivedCardIds).toEqual(["card-source"]);
    const back = reduce(next, {
      type: "UNARCHIVE_CARD",
      cardId: "card-source",
      columnId: "col-backlog",
    });
    expect(back.cards["card-target"]?.readModel?.blocked).toBe(true);
    expect(back.archivedCardIds).toEqual([]);
  });

  it("archives a blocker: a multi-link summary target stays conservative", () => {
    const source = card("card-source", {
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ linkCount: 2, blocked: true }),
    });
    const next = reduce(board([source, target], { archived: [] }), {
      type: "ARCHIVE_CARD",
      cardId: "card-source",
    });
    expect(next.cards["card-target"]?.readModel?.blocked).toBe(true);
  });

  it("updates a detail target's reverse rows on archive and unarchive", () => {
    const source = card("card-source", {
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ detailLoaded: true, linkCount: 1, blocked: true }),
      incomingLinks: [
        {
          id: "l1",
          type: "blocks",
          fromCardId: "card-source",
          fromArchived: false,
        },
      ],
    });
    const initial = board([source, target], { archived: [] });
    const archived = reduce(initial, {
      type: "ARCHIVE_CARD",
      cardId: "card-source",
    });
    expect(
      archived.cards["card-target"]?.incomingLinks?.[0]?.fromArchived,
    ).toBe(true);
    expect(archived.cards["card-target"]?.readModel?.blocked).toBe(false);
    const back = reduce(archived, {
      type: "UNARCHIVE_CARD",
      cardId: "card-source",
      columnId: "col-backlog",
    });
    expect(back.cards["card-target"]?.readModel?.blocked).toBe(true);
  });

  it("archives a whole column's blocker facts", () => {
    const source = card("card-source", {
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ linkCount: 1, blocked: true }),
      archivedAt: 2,
    });
    const initial = board([source, target], {
      archived: ["card-target"],
      listed: ["card-source"],
    });
    const next = reduce(initial, {
      type: "ARCHIVE_COLUMN_CARDS",
      columnId: "col-backlog",
    });
    expect(next.cards["card-target"]?.readModel?.blocked).toBe(false);
    expect(next.archivedCardIds).toEqual(["card-target", "card-source"]);
  });

  it("restores a column's cards and their target facts", () => {
    const source = card("card-source", {
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ linkCount: 1, blocked: false }),
      archivedAt: 2,
    });
    const initial = board([source, target], {
      archived: ["card-source", "card-target"],
      listed: [],
    });
    const next = reduce(initial, {
      type: "RESTORE_COLUMN_CARDS",
      columnId: "col-backlog",
      cardIds: ["card-source", "card-target"],
      cards: [source, target],
    });
    // The degree never changed with the archive; the live blocker blocks again.
    expect(next.cards["card-target"]?.readModel).toMatchObject({
      linkCount: 1,
      blocked: true,
    });
    expect(next.archivedCardIds).toEqual(["card-target"]);
  });

  it("restores a deleted card's links and archive membership", () => {
    const source = card("card-source", {
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ detailLoaded: true, linkCount: 1 }),
      incomingLinks: [
        {
          id: "l1",
          type: "blocks",
          fromCardId: "card-source",
          fromArchived: false,
        },
      ],
    });
    const initial = board([target], { archived: ["card-source"] });
    const archivedBack = reduce(initial, {
      type: "RESTORE_CARD",
      card: { ...source, archivedAt: 5 },
    });
    // The restored row is archived, so it counts for degree but not for block.
    expect(archivedBack.cards["card-target"]?.readModel?.linkCount).toBe(2);
    expect(archivedBack.cards["card-target"]?.readModel?.blocked).toBe(false);
    expect(archivedBack.archivedCardIds).toEqual(["card-source"]);

    const liveBack = reduce(initial, {
      type: "RESTORE_CARD",
      card: source,
      columnId: "col-backlog",
    });
    expect(liveBack.cards["card-target"]?.readModel?.linkCount).toBe(2);
    expect(liveBack.cards["card-target"]?.readModel?.blocked).toBe(true);
    expect(liveBack.archivedCardIds).toEqual([]);
  });

  it("puts a restored column's link degree back", () => {
    const restored = card("card-source", {
      title: "Restored",
      links: [{ id: "l1", type: "relates_to", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ detailLoaded: true, linkCount: 0 }),
      incomingLinks: [
        {
          id: "l1",
          type: "relates_to",
          fromCardId: "card-source",
          fromArchived: false,
        },
      ],
    });
    const next = reduce(board([target], { archived: [] }), {
      type: "RESTORE_COLUMN",
      column: {
        id: "col-restored",
        title: "Restored",
        cardIds: ["card-source"],
        createdAt: 1,
      },
      index: 1,
      cards: [restored],
    });
    expect(next.cards["card-target"]?.readModel?.linkCount).toBe(1);
    expect(next.columns.some((c) => c.id === "col-restored")).toBe(true);
  });

  it("starts a duplicated card without inherited link facts", () => {
    const source = card("card-source", {
      readModel: meta({ detailLoaded: true, linkCount: 2, blocked: true }),
      incomingLinks: [
        {
          id: "l1",
          type: "blocks",
          fromCardId: "card-other",
          fromArchived: false,
        },
      ],
    });
    const next = reduce(board([source], { archived: [] }), {
      type: "DUPLICATE_CARD",
      cardId: "card-source",
      newCardId: "card-copy",
    });
    expect(next.cards["card-copy"]?.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
    expect(next.cards["card-copy"]?.incomingLinks).toBeUndefined();
  });

  it("starts duplicated column cards without inherited link facts", () => {
    const source = card("card-source", {
      readModel: meta({ detailLoaded: true, linkCount: 3, blocked: true }),
      incomingLinks: [
        {
          id: "l1",
          type: "blocks",
          fromCardId: "card-other",
          fromArchived: false,
        },
      ],
    });
    const next = reduce(board([source], { archived: [] }), {
      type: "DUPLICATE_COLUMN",
      columnId: "col-backlog",
      newColumnId: "col-copy",
      newCardIds: ["card-copy"],
    });
    expect(next.cards["card-copy"]?.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
    expect(next.cards["card-copy"]?.incomingLinks).toBeUndefined();
  });
});

describe("read-model facts on links", () => {
  it("adds degree and block facts to both ends", () => {
    const source = card("card-source", { readModel: meta({ linkCount: 1 }) });
    const target = card("card-target", {
      readModel: meta({ detailLoaded: true, linkCount: 1 }),
      incomingLinks: [],
    });
    const next = reduce(board([source, target]), {
      type: "ADD_CARD_LINK",
      cardId: "card-source",
      linkId: "l1",
      targetCardId: "card-target",
      linkType: "blocks",
    });
    expect(next.cards["card-source"]?.readModel?.linkCount).toBe(2);
    expect(next.cards["card-target"]?.readModel).toMatchObject({
      linkCount: 2,
      blocked: true,
    });
    expect(next.cards["card-target"]?.incomingLinks).toHaveLength(1);
  });

  it("does not block for an archived source", () => {
    const source = card("card-source", {
      archivedAt: 3,
      readModel: meta({ linkCount: 0 }),
    });
    const target = card("card-target", {
      readModel: meta({ detailLoaded: true, linkCount: 0 }),
      incomingLinks: [],
    });
    const next = reduce(
      board([source, target], { archived: ["card-source"] }),
      {
        type: "ADD_CARD_LINK",
        cardId: "card-source",
        linkId: "l1",
        targetCardId: "card-target",
        linkType: "blocks",
      },
    );
    expect(next.cards["card-target"]?.readModel?.blocked).toBe(false);
    expect(next.cards["card-target"]?.incomingLinks?.[0]?.fromArchived).toBe(
      true,
    );
  });

  it("removes degree and reverse rows from both ends", () => {
    const source = card("card-source", {
      readModel: meta({ linkCount: 1 }),
      links: [{ id: "l1", type: "blocks", targetCardId: "card-target" }],
    });
    const target = card("card-target", {
      readModel: meta({ detailLoaded: true, linkCount: 1, blocked: true }),
      incomingLinks: [
        {
          id: "l1",
          type: "blocks",
          fromCardId: "card-source",
          fromArchived: false,
        },
      ],
    });
    const next = reduce(board([source, target]), {
      type: "REMOVE_CARD_LINK",
      cardId: "card-source",
      linkId: "l1",
      targetCardId: "card-target",
      linkType: "blocks",
    });
    expect(next.cards["card-source"]?.readModel?.linkCount).toBe(0);
    expect(next.cards["card-target"]?.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
    expect(next.cards["card-target"]?.incomingLinks).toEqual([]);
  });

  it("removes a link from a summary source that never loaded its rows", () => {
    const source = card("card-source", { readModel: meta({ linkCount: 1 }) });
    const target = card("card-target", {
      readModel: meta({ linkCount: 1, blocked: true }),
    });
    const next = reduce(board([source, target]), {
      type: "REMOVE_CARD_LINK",
      cardId: "card-source",
      linkId: "l1",
      targetCardId: "card-target",
      linkType: "blocks",
    });
    expect(next.cards["card-source"]?.readModel?.linkCount).toBe(0);
    expect(next.cards["card-target"]?.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
    expect(next.cards["card-source"]?.links).toBeUndefined();
  });

  it("ignores an unknown link on a full-aggregate source", () => {
    const source = card("card-source");
    const target = card("card-target");
    const initial = board([source, target]);
    expect(
      reduce(initial, {
        type: "REMOVE_CARD_LINK",
        cardId: "card-source",
        linkId: "missing",
        targetCardId: "card-target",
        linkType: "blocks",
      }),
    ).toBe(initial);
  });
});
