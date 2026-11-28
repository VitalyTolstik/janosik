import { describe, expect, it } from "vitest";
import {
  boardReducer,
  type Board,
  type BoardAction,
  type BoardCardDetailDto,
  type BoardCardSummaryDto,
  type BoardReadSummaryDto,
  type Card,
} from "@janosik/shared";
import { collectBacklogEpics } from "@/utils/backlog-rows";
import { cardLinkIndex } from "@/utils/links";
import {
  boardFromSummary,
  cardById,
  cardChecklistProgress,
  cardFromDetail,
  cardFromSummary,
  cardHasDescription,
  epicSummaryProgress,
  hasCardDetail,
} from "./read-model";

function summaryCard(
  id: string,
  overrides: Partial<BoardCardSummaryDto> = {},
): BoardCardSummaryDto {
  return {
    id,
    title: id,
    columnId: "col-1",
    position: 0,
    version: 1,
    descriptionChars: 12,
    checklistItemCount: 4,
    checklistDoneCount: 1,
    linkCount: 2,
    blocked: true,
    labelIds: [],
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

function summary(
  overrides: Partial<BoardReadSummaryDto> = {},
): BoardReadSummaryDto {
  return {
    board: {
      id: "b-1",
      title: "Board",
      createdAt: 1,
      updatedAt: 2,
      role: "MEMBER",
    },
    columns: [
      {
        id: "col-1",
        title: "Todo",
        count: 3,
        archivedCount: 1,
        wipLimit: null,
        createdAt: 1,
        cardIds: ["c-1", "c-2", "c-3"],
        cards: [summaryCard("c-1")],
        nextCursor: "next",
        hasMore: true,
      },
    ],
    labels: [],
    epics: [],
    limits: { cardsPerColumn: 1000, columns: 12 },
    archivedCardIds: ["c-arch"],
    archivedCards: [summaryCard("c-arch", { archivedAt: 5 })],
    archivedNextCursor: null,
    firstPageLimit: 1,
    seq: 7,
    atSeq: 7,
    aggregateRevision: 9,
    readModel: "v1",
    ...overrides,
  };
}

describe("read-model adapters (TASK-200.9)", () => {
  it("turns a summary card into the normalized model without detail bodies", () => {
    const card = cardFromSummary(summaryCard("c-1"));
    expect(card).toMatchObject({
      id: "c-1",
      title: "c-1",
      labelIds: [],
      readModel: {
        descriptionChars: 12,
        checklistItemCount: 4,
        checklistDoneCount: 1,
        linkCount: 2,
        blocked: true,
        detailLoaded: false,
      },
    });
    expect(card).not.toHaveProperty("description");
    expect(card).not.toHaveProperty("checklists");
    expect(card).not.toHaveProperty("links");
    expect(hasCardDetail(card)).toBe(false);
  });

  it("merges full detail into an existing summary and marks it loaded", () => {
    const full: Card = {
      id: "c-1",
      title: "Detail",
      description: "body",
      checklists: [
        {
          id: "cl",
          title: "Steps",
          items: [{ id: "i", text: "x", done: true }],
        },
      ],
      links: [{ id: "l", type: "blocks", targetCardId: "c-2" }],
      labelIds: [],
      createdAt: 10,
      updatedAt: 20,
    };
    const detail: BoardCardDetailDto = {
      boardId: "b-1",
      columnId: "col-1",
      card: full,
      version: 1,
      linkCount: 1,
      blocked: false,
      incomingLinks: [],
      seq: 7,
      atSeq: 7,
      aggregateRevision: 9,
    };
    const card = cardFromDetail(detail);
    expect(card.description).toBe("body");
    expect(card.checklists).toHaveLength(1);
    expect(card.links).toHaveLength(1);
    expect(card.readModel).toMatchObject({
      descriptionChars: 4,
      checklistItemCount: 1,
      checklistDoneCount: 1,
      linkCount: 1,
      detailLoaded: true,
    });
    expect(hasCardDetail(card)).toBe(true);
  });

  it("keeps the summary's complete id order while only first-page bodies load", () => {
    const board = boardFromSummary(summary());
    expect(board.columns[0].cardIds).toEqual(["c-1", "c-2", "c-3"]);
    expect(Object.keys(board.cards).sort()).toEqual(["c-1", "c-arch"]);
    expect(board.cards["c-2"]).toBeUndefined();
    expect(board.cards["c-arch"]?.archivedAt).toBe(5);
  });

  it("keeps the server's epic rollup until the live card placements are hydrated", () => {
    const dto = summary({
      epics: [
        {
          id: "epic-1",
          title: "Epic",
          color: "rose",
          status: "active",
          position: 0,
          createdAt: 1,
          updatedAt: 1,
          progress: { total: 3, done: 2, open: 1 },
        },
      ],
    });
    dto.columns[0].cards[0].epicId = "epic-1";
    const board = boardFromSummary(dto);
    const progress = epicSummaryProgress(board.epics!);
    expect(board.epics?.[0]).not.toHaveProperty("progress");
    expect(collectBacklogEpics(board, progress).get("epic-1")).toMatchObject({
      total: 3,
      done: 2,
      childIds: ["c-1"],
    });

    board.cards["c-2"] = cardFromSummary(summaryCard("c-2"));
    board.cards["c-3"] = cardFromSummary(summaryCard("c-3"));
    expect(collectBacklogEpics(board, progress).get("epic-1")).toMatchObject({
      total: 1,
      done: 1,
      childIds: ["c-1"],
    });
  });

  it("preserves a loaded detail across a refetch of the same card", () => {
    const previous = boardFromSummary(summary());
    previous.cards["c-1"] = {
      ...previous.cards["c-1"],
      description: "full body",
      readModel: { ...previous.cards["c-1"].readModel!, detailLoaded: true },
    };
    const next = boardFromSummary(summary(), previous);
    expect(next.cards["c-1"].description).toBe("full body");
    expect(next.cards["c-1"].readModel?.detailLoaded).toBe(true);
  });

  it("drops cards the new summary no longer contains (deleted elsewhere)", () => {
    const previous = boardFromSummary(summary());
    const next = boardFromSummary(
      summary({
        columns: [
          {
            ...summary().columns[0],
            cardIds: ["c-1"],
            cards: [summaryCard("c-1")],
          },
        ],
        archivedCardIds: [],
        archivedCards: [],
      }),
      previous,
    );
    expect(Object.keys(next.cards)).toEqual(["c-1"]);
  });

  it("keeps a 1 000-card summary well below the v1 payload budget (mock)", () => {
    const ids = Array.from({ length: 1000 }, (_, index) => `mock-${index}`);
    const firstPage = ids
      .slice(0, 50)
      .map((id) => summaryCard(id, { descriptionChars: 64_000 }));
    const payload = summary({
      columns: [
        {
          id: "col-1",
          title: "Todo",
          count: 1000,
          archivedCount: 0,
          wipLimit: null,
          createdAt: 1,
          cardIds: ids,
          cards: firstPage,
          nextCursor: "next",
          hasMore: true,
        },
      ],
    });
    const bytes = JSON.stringify(payload).length;
    // The 2 MB DoD is for the initial view; 1 000 ids + 50 summaries stay far
    // below it even when the source cards have maximum-length descriptions.
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
    expect(JSON.stringify(payload)).not.toContain('"description":');
  });

  it("merges detail incoming rows for the blocked-by side", () => {
    const card = cardFromDetail({
      boardId: "b-1",
      columnId: "col-1",
      card: {
        id: "b",
        title: "b",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      version: 1,
      linkCount: 1,
      blocked: true,
      incomingLinks: [
        {
          id: "l",
          type: "blocks",
          fromCardId: "a",
          fromArchived: false,
        },
      ],
      seq: 1,
      atSeq: 1,
      aggregateRevision: 1,
    });
    const a: Card = {
      id: "a",
      title: "a",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const facts = cardLinkIndex({ a, b: card }).factsOf("b");
    expect(facts.incoming).toEqual([
      { fromCardId: "a", link: { id: "l", type: "blocks", targetCardId: "b" } },
    ]);
    expect(facts.degree).toBe(1);
    expect(facts.blocked).toBe(true);
    expect(card.links).toBeUndefined();
  });

  it("does not double-count a loaded detail card's link degree", () => {
    const detail = cardFromDetail({
      boardId: "b-1",
      columnId: "col-1",
      card: {
        id: "a",
        title: "a",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        links: [{ id: "l", type: "blocks", targetCardId: "b" }],
      },
      version: 1,
      linkCount: 1,
      blocked: false,
      incomingLinks: [],
      seq: 1,
      atSeq: 1,
      aggregateRevision: 1,
    });
    const b: Card = {
      id: "b",
      title: "b",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const index = cardLinkIndex({ a: detail, b });
    expect(index.factsOf("a").degree).toBe(1);
    expect(index.factsOf("a").outgoing).toHaveLength(1);
  });

  it("uses real fields for badges after a detail edit", () => {
    const card = cardFromDetail({
      boardId: "b-1",
      columnId: "col-1",
      card: {
        id: "a",
        title: "a",
        labelIds: [],
        createdAt: 1,
        updatedAt: 2,
        checklists: [{ id: "cl", title: "s", items: [] }],
      },
      version: 1,
      linkCount: 0,
      blocked: false,
      incomingLinks: [],
      seq: 1,
      atSeq: 1,
      aggregateRevision: 1,
    });
    expect(cardHasDescription(card)).toBe(false);
    expect(cardChecklistProgress(card)).toEqual({ done: 0, total: 0 });
  });

  it("replaces cached detail when summary link facts changed", () => {
    const detail: Card = {
      id: "c-1",
      title: "Cached detail",
      description: "body",
      labelIds: [],
      createdAt: 10,
      updatedAt: 20,
      readModel: {
        descriptionChars: 4,
        checklistItemCount: 0,
        checklistDoneCount: 0,
        linkCount: 1,
        blocked: false,
        detailLoaded: true,
      },
    };
    const previous: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
      cards: { "c-1": detail },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    // Same `updatedAt`: link rows do not stamp the target card.
    const dto = summary({
      columns: [
        {
          id: "col-1",
          title: "Todo",
          count: 1,
          archivedCount: 0,
          wipLimit: null,
          createdAt: 1,
          cardIds: ["c-1"],
          cards: [
            summaryCard("c-1", { updatedAt: 20, linkCount: 2, blocked: true }),
          ],
          nextCursor: null,
          hasMore: false,
        },
      ],
      archivedCardIds: [],
      archivedCards: [],
      archivedNextCursor: null,
    });

    const next = boardFromSummary(dto, previous);
    expect(next.cards["c-1"].readModel).toMatchObject({
      linkCount: 2,
      blocked: true,
      detailLoaded: true,
      reverseLinksStale: true,
    });
    // The dialog must not be downgraded to a loading skeleton.
    expect(next.cards["c-1"].description).toBe("body");
    expect(next.cards["c-1"].incomingLinks).toBeUndefined();
    expect(hasCardDetail(next.cards["c-1"])).toBe(true);
  });

  it("hydrate replaces stale detail on the same link-fact change", () => {
    const detail: Card = {
      id: "c-1",
      title: "Cached detail",
      description: "body",
      labelIds: [],
      createdAt: 10,
      updatedAt: 20,
      readModel: {
        descriptionChars: 4,
        checklistItemCount: 0,
        checklistDoneCount: 0,
        linkCount: 1,
        blocked: false,
        detailLoaded: true,
      },
    };
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
      cards: { "c-1": detail },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const incoming = cardFromSummary(
      summaryCard("c-1", { updatedAt: 20, linkCount: 2, blocked: true }),
    );
    const after = boardReducer([board], {
      type: "HYDRATE_CARDS",
      boardId: "b-1",
      cards: [incoming],
    } as BoardAction)[0];
    expect(after.cards["c-1"].readModel).toMatchObject({
      linkCount: 2,
      blocked: true,
      detailLoaded: true,
      reverseLinksStale: true,
    });
    expect(after.cards["c-1"].description).toBe("body");
    expect(after.cards["c-1"].incomingLinks).toBeUndefined();
  });

  it("never lets an older page replace newer local detail", () => {
    const detail: Card = {
      id: "c-1",
      title: "Local edit",
      description: "body",
      labelIds: [],
      createdAt: 10,
      updatedAt: 30,
      readModel: {
        descriptionChars: 4,
        checklistItemCount: 0,
        checklistDoneCount: 0,
        linkCount: 1,
        blocked: true,
        detailLoaded: true,
      },
    };
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
      cards: { "c-1": detail },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const older = cardFromSummary(
      summaryCard("c-1", {
        updatedAt: 20,
        title: "stale page",
        linkCount: 2,
        blocked: false,
      }),
    );
    const after = boardReducer([board], {
      type: "HYDRATE_CARDS",
      boardId: "b-1",
      cards: [older],
    } as BoardAction)[0];
    expect(after.cards["c-1"]).toBe(detail);
  });

  it("applies a same-stamp detail whose reverse rows changed identity", () => {
    const detail = (linkId: string, fromCardId: string): Card =>
      cardFromDetail({
        boardId: "b-1",
        columnId: "col-1",
        card: {
          id: "c-1",
          title: "Cached detail",
          labelIds: [],
          createdAt: 10,
          updatedAt: 20,
        },
        version: 1,
        linkCount: 1,
        blocked: true,
        incomingLinks: [
          {
            id: linkId,
            type: "blocks",
            fromCardId,
            fromArchived: false,
          },
        ],
        seq: 1,
        atSeq: 1,
        aggregateRevision: 1,
      });
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
      cards: { "c-1": detail("l-old", "source-old") },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const fresh = detail("l-new", "source-new");
    const after = boardReducer([board], {
      type: "HYDRATE_CARDS",
      boardId: "b-1",
      cards: [fresh],
    } as BoardAction)[0];
    expect(after.cards["c-1"].incomingLinks).toEqual([
      {
        id: "l-new",
        type: "blocks",
        fromCardId: "source-new",
        fromArchived: false,
      },
    ]);
  });

  it("keeps a full-aggregate card body on a summary refresh", () => {
    const full: Card = {
      id: "c-1",
      title: "Full body",
      description: "full aggregate text",
      labelIds: [],
      createdAt: 10,
      updatedAt: 20,
    };
    const previous: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
      cards: { "c-1": full },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const dto = summary({
      columns: [
        {
          id: "col-1",
          title: "Todo",
          count: 1,
          archivedCount: 0,
          wipLimit: null,
          createdAt: 1,
          cardIds: ["c-1"],
          cards: [
            summaryCard("c-1", {
              title: "Summary body",
              updatedAt: 20,
              linkCount: 1,
            }),
          ],
          nextCursor: null,
          hasMore: false,
        },
      ],
      archivedCardIds: [],
      archivedCards: [],
      archivedNextCursor: null,
    });

    const next = boardFromSummary(dto, previous);
    // No readModel on a full aggregate card, but it is complete detail: the
    // dialog must keep its body instead of falling back to a skeleton.
    expect(next.cards["c-1"]).toBe(full);
    expect(next.cards["c-1"].description).toBe("full aggregate text");
    expect(next.cards["c-1"].readModel).toBeUndefined();
  });

  it("ignores an older page's facts for the same-stamp detail", () => {
    const fresh = cardFromDetail({
      boardId: "b-1",
      columnId: "col-1",
      card: {
        id: "c-1",
        title: "Cached detail",
        description: "body",
        labelIds: [],
        createdAt: 10,
        updatedAt: 20,
        links: [{ id: "l-old", type: "blocks", targetCardId: "target" }],
      },
      version: 1,
      linkCount: 1,
      blocked: true,
      incomingLinks: [
        {
          id: "l-old",
          type: "blocks",
          fromCardId: "source",
          fromArchived: false,
        },
      ],
      seq: 11,
      atSeq: 10,
      aggregateRevision: 10,
    });
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
      cards: { "c-1": fresh },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const stalePage = cardFromSummary(
      summaryCard("c-1", { updatedAt: 20, linkCount: 2, blocked: false }),
    );
    const older = boardReducer([board], {
      type: "HYDRATE_CARDS",
      boardId: "b-1",
      cards: [stalePage],
      atSeq: 9,
    } as BoardAction)[0];
    expect(older.cards["c-1"]).toBe(fresh);
    expect(older.cards["c-1"].readModel).toMatchObject({
      linkCount: 1,
      blocked: true,
    });

    const newer = boardReducer([board], {
      type: "HYDRATE_CARDS",
      boardId: "b-1",
      cards: [stalePage],
      atSeq: 12,
    } as BoardAction)[0];
    expect(newer.cards["c-1"].readModel).toMatchObject({
      linkCount: 2,
      blocked: false,
      reverseLinksStale: true,
      factsAtSeq: 12,
    });
  });

  it("marks the reverse rows stale on a same-count summary swap", () => {
    const previous: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
      cards: {
        "c-1": cardFromDetail({
          boardId: "b-1",
          columnId: "col-1",
          card: {
            id: "c-1",
            title: "Cached detail",
            description: "body",
            labelIds: [],
            createdAt: 10,
            updatedAt: 20,
          },
          version: 1,
          linkCount: 1,
          blocked: true,
          incomingLinks: [
            {
              id: "l-old",
              type: "blocks",
              fromCardId: "source-old",
              fromArchived: false,
            },
          ],
          seq: 11,
          atSeq: 10,
          aggregateRevision: 10,
        }),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const dto = summary({
      atSeq: 12,
      columns: [
        {
          id: "col-1",
          title: "Todo",
          count: 1,
          archivedCount: 0,
          wipLimit: null,
          createdAt: 1,
          cardIds: ["c-1"],
          cards: [
            summaryCard("c-1", { updatedAt: 20, linkCount: 1, blocked: true }),
          ],
          nextCursor: null,
          hasMore: false,
        },
      ],
      archivedCardIds: [],
      archivedCards: [],
      archivedNextCursor: null,
    });

    const next = boardFromSummary(dto, previous);
    // The summary cannot reveal which source remains; refresh rows lazily.
    expect(next.cards["c-1"].readModel).toMatchObject({
      linkCount: 1,
      blocked: true,
      detailLoaded: true,
      reverseLinksStale: true,
    });
    expect(next.cards["c-1"].incomingLinks).toBeUndefined();
    expect(next.cards["c-1"].description).toBe("body");
  });

  it("clears stale reverse rows when a detail read has none", () => {
    const stale: Card = {
      id: "c-1",
      title: "Cached detail",
      description: "body",
      labelIds: [],
      createdAt: 10,
      updatedAt: 20,
      readModel: {
        descriptionChars: 4,
        checklistItemCount: 0,
        checklistDoneCount: 0,
        linkCount: 1,
        blocked: true,
        detailLoaded: true,
        reverseLinksStale: true,
        factsAtSeq: 10,
      },
    };
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
      cards: { "c-1": stale },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const fresh = cardFromDetail({
      boardId: "b-1",
      columnId: "col-1",
      card: {
        id: "c-1",
        title: "Cached detail",
        description: "body",
        labelIds: [],
        createdAt: 10,
        updatedAt: 20,
      },
      version: 1,
      linkCount: 0,
      blocked: false,
      incomingLinks: [],
      seq: 11,
      atSeq: 11,
      aggregateRevision: 11,
    });
    const after = boardReducer([board], {
      type: "HYDRATE_CARDS",
      boardId: "b-1",
      cards: [fresh],
    } as BoardAction)[0];
    expect(after.cards["c-1"].readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
      detailLoaded: true,
      factsAtSeq: 11,
    });
    expect(after.cards["c-1"].readModel?.reverseLinksStale).toBeUndefined();
    expect(after.cards["c-1"].incomingLinks).toBeUndefined();
  });

  it("keeps a full-aggregate card on same-stamp hydration", () => {
    const full: Card = {
      id: "c-1",
      title: "Full body",
      description: "full aggregate text",
      labelIds: [],
      createdAt: 10,
      updatedAt: 20,
    };
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
      cards: { "c-1": full },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const after = boardReducer([board], {
      type: "HYDRATE_CARDS",
      boardId: "b-1",
      cards: [cardFromSummary(summaryCard("c-1", { updatedAt: 20 }))],
      atSeq: 20,
    } as BoardAction)[0];
    expect(after.cards["c-1"]).toBe(full);
  });

  it("hydrates only ids still in the summary scope and keeps newer cards", () => {
    const newer: Card = {
      id: "a",
      title: "local",
      labelIds: [],
      createdAt: 1,
      updatedAt: 30,
      readModel: {
        descriptionChars: 1,
        checklistItemCount: 0,
        checklistDoneCount: 0,
        linkCount: 0,
        blocked: false,
        detailLoaded: true,
      },
    };
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["a"], createdAt: 1 }],
      cards: { a: newer },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const stale: Card = {
      ...newer,
      title: "late detail",
      updatedAt: 10,
      readModel: { ...newer.readModel!, detailLoaded: true },
    };
    const unplaced: Card = {
      ...newer,
      id: "not-in-column",
      title: "tombstone",
    };
    const after = boardReducer([board], {
      type: "HYDRATE_CARDS",
      boardId: "b-1",
      cards: [stale, unplaced],
    } as BoardAction)[0];
    expect(after.cards.a.title).toBe("local");
    expect(after.cards["not-in-column"]).toBeUndefined();
  });

  it("maintains archivedCardIds through archive and unarchive", () => {
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["a"], createdAt: 1 }],
      cards: {
        a: cardFromSummary(summaryCard("a")),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const archived = boardReducer([board], {
      type: "ARCHIVE_CARD",
      boardId: "b-1",
      cardId: "a",
      at: 30,
    } as BoardAction)[0];
    expect(archived.archivedCardIds).toEqual(["a"]);
    const restored = boardReducer([archived], {
      type: "UNARCHIVE_CARD",
      boardId: "b-1",
      cardId: "a",
      columnId: "col-1",
      at: 40,
    } as BoardAction)[0];
    expect(restored.archivedCardIds).toEqual([]);
  });

  it("keeps link counters current on add/remove and resets a duplicate", () => {
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        { id: "col-1", title: "Todo", cardIds: ["a", "b"], createdAt: 1 },
      ],
      cards: {
        a: cardFromSummary(summaryCard("a", { linkCount: 0, blocked: false })),
        b: cardFromSummary(summaryCard("b", { linkCount: 0, blocked: false })),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const added = boardReducer([board], {
      type: "ADD_CARD_LINK",
      boardId: "b-1",
      cardId: "a",
      linkId: "l",
      targetCardId: "b",
      linkType: "blocks",
      at: 30,
    } as BoardAction)[0];
    expect(added.cards.a.readModel?.linkCount).toBe(1);
    expect(added.cards.b.readModel).toMatchObject({
      linkCount: 1,
      blocked: true,
    });
    const removed = boardReducer([added], {
      type: "REMOVE_CARD_LINK",
      boardId: "b-1",
      cardId: "a",
      linkId: "l",
      targetCardId: "b",
      linkType: "blocks",
      at: 40,
    } as BoardAction)[0];
    expect(removed.cards.a.readModel?.linkCount).toBe(0);
    expect(removed.cards.b.readModel?.linkCount).toBe(0);
    const duplicated = boardReducer([added], {
      type: "DUPLICATE_CARD",
      boardId: "b-1",
      cardId: "a",
      newCardId: "copy",
      at: 50,
    } as BoardAction)[0];
    expect(duplicated.cards.copy.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
  });

  it("uses summary link facts for DnD badges/filters without double-counting", () => {
    const a = cardFromSummary(
      summaryCard("a", { linkCount: 2, blocked: true }),
    );
    const b: Card = {
      id: "b",
      title: "b",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
      links: [{ id: "l", type: "blocks", targetCardId: "a" }],
    };
    const index = cardLinkIndex({ a, b });
    expect(index.factsOf("a").degree).toBe(2);
    expect(index.factsOf("a").blocked).toBe(true);
    expect(index.factsOf("b").degree).toBe(1);
    expect(index.factsOf("b").outgoing).toHaveLength(1);
  });

  it("updates a target when a summary source has no loaded row", () => {
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        { id: "col-1", title: "Todo", cardIds: ["a", "b"], createdAt: 1 },
      ],
      cards: {
        // Source: a summary card (counter only, no `links` rows).
        a: cardFromSummary(summaryCard("a", { linkCount: 1, blocked: false })),
        b: cardFromSummary(summaryCard("b", { linkCount: 1, blocked: true })),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const after = boardReducer([board], {
      type: "REMOVE_CARD_LINK",
      boardId: "b-1",
      cardId: "a",
      linkId: "l-remote",
      targetCardId: "b",
      linkType: "blocks",
      at: 30,
    } as BoardAction)[0];
    expect(after.cards.a.readModel?.linkCount).toBe(0);
    expect(after.cards.b.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
    // No invented row on the summary source.
    expect(after.cards.a.links).toBeUndefined();
  });

  it("keeps reverse facts when the deleted card was a target", () => {
    const target = cardFromDetail({
      boardId: "b-1",
      columnId: "col-1",
      card: {
        id: "d",
        title: "d",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      version: 1,
      linkCount: 1,
      blocked: true,
      incomingLinks: [
        { id: "l-in", type: "blocks", fromCardId: "s", fromArchived: false },
      ],
      seq: 1,
      atSeq: 1,
      aggregateRevision: 1,
    });
    const source = cardFromDetail({
      boardId: "b-1",
      columnId: "col-1",
      card: {
        id: "s",
        title: "s",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        links: [{ id: "l-in", type: "blocks", targetCardId: "d" }],
      },
      version: 1,
      linkCount: 1,
      blocked: false,
      incomingLinks: [],
      seq: 1,
      atSeq: 1,
      aggregateRevision: 1,
    });
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        { id: "col-1", title: "Todo", cardIds: ["d", "s"], createdAt: 1 },
      ],
      cards: { d: target, s: source },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const deleted = boardReducer([board], {
      type: "DELETE_CARD",
      boardId: "b-1",
      cardId: "d",
      at: 30,
    } as BoardAction)[0];
    expect(deleted.cards.d).toBeUndefined();
    expect(deleted.cards.s.readModel?.linkCount).toBe(0);
    // The dangling row stays on the source until the user removes it.
    expect(deleted.cards.s.links).toHaveLength(1);

    const restored = boardReducer([deleted], {
      type: "RESTORE_CARD",
      boardId: "b-1",
      card: target,
      columnId: "col-1",
      index: 0,
      at: 40,
    } as BoardAction)[0];
    expect(restored.cards.s.readModel?.linkCount).toBe(1);
  });

  it("updates the surviving sources of a deleted column's targets", () => {
    const incoming = (from: string, id: string) => ({
      id,
      type: "blocks" as const,
      fromCardId: from,
      fromArchived: false,
    });
    const target = (id: string, links: ReturnType<typeof incoming>[]) =>
      cardFromDetail({
        boardId: "b-1",
        columnId: "col-1",
        card: {
          id,
          title: id,
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
        version: 1,
        linkCount: links.length,
        blocked: links.length > 0,
        incomingLinks: links,
        seq: 1,
        atSeq: 1,
        aggregateRevision: 1,
      });
    const source = (
      id: string,
      links: Array<{ id: string; targetCardId: string }>,
    ) =>
      cardFromDetail({
        boardId: "b-1",
        columnId: "col-2",
        card: {
          id,
          title: id,
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
          links: links.map((link) => ({ ...link, type: "blocks" as const })),
        },
        version: 1,
        linkCount: links.length,
        blocked: false,
        incomingLinks: [],
        seq: 1,
        atSeq: 1,
        aggregateRevision: 1,
      });
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        { id: "col-1", title: "Todo", cardIds: ["d1", "d2"], createdAt: 1 },
        { id: "col-2", title: "Doing", cardIds: ["s1", "s2"], createdAt: 1 },
      ],
      cards: {
        d1: target("d1", [incoming("s1", "l-1")]),
        d2: target("d2", [incoming("s1", "l-2"), incoming("s2", "l-3")]),
        s1: source("s1", [
          { id: "l-1", targetCardId: "d1" },
          { id: "l-2", targetCardId: "d2" },
        ]),
        s2: source("s2", [{ id: "l-3", targetCardId: "d2" }]),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const deleted = boardReducer([board], {
      type: "DELETE_COLUMN",
      boardId: "b-1",
      columnId: "col-1",
      at: 30,
    } as BoardAction)[0];
    expect(deleted.cards.d1).toBeUndefined();
    expect(deleted.cards.d2).toBeUndefined();
    expect(deleted.cards.s1.readModel?.linkCount).toBe(0);
    expect(deleted.cards.s2.readModel?.linkCount).toBe(0);
  });

  it("keeps surviving targets' facts current across card delete and restore", () => {
    const source = cardFromDetail({
      boardId: "b-1",
      columnId: "col-1",
      card: {
        id: "a",
        title: "a",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        links: [{ id: "l-1", type: "blocks", targetCardId: "b" }],
      },
      version: 1,
      linkCount: 1,
      blocked: false,
      incomingLinks: [],
      seq: 1,
      atSeq: 1,
      aggregateRevision: 1,
    });
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        { id: "col-1", title: "Todo", cardIds: ["a", "b"], createdAt: 1 },
      ],
      cards: {
        a: source,
        b: cardFromSummary(summaryCard("b", { linkCount: 1, blocked: true })),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const deleted = boardReducer([board], {
      type: "DELETE_CARD",
      boardId: "b-1",
      cardId: "a",
      at: 30,
    } as BoardAction)[0];
    expect(deleted.cards.a).toBeUndefined();
    expect(deleted.cards.b.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
    const restored = boardReducer([deleted], {
      type: "RESTORE_CARD",
      boardId: "b-1",
      card: source,
      columnId: "col-1",
      index: 0,
      at: 40,
    } as BoardAction)[0];
    expect(restored.cards.b.readModel).toMatchObject({
      linkCount: 1,
      blocked: true,
    });
  });

  it("does not decrement a target deleted with the same column", () => {
    const source = cardFromDetail({
      boardId: "b-1",
      columnId: "col-1",
      card: {
        id: "a",
        title: "a",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        links: [
          { id: "l-in", type: "blocks", targetCardId: "c" },
          { id: "l-out", type: "relates_to", targetCardId: "b" },
        ],
      },
      version: 1,
      linkCount: 1,
      blocked: false,
      incomingLinks: [],
      seq: 1,
      atSeq: 1,
      aggregateRevision: 1,
    });
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        { id: "col-1", title: "Todo", cardIds: ["a", "c"], createdAt: 1 },
        { id: "col-2", title: "Doing", cardIds: ["b"], createdAt: 1 },
      ],
      cards: {
        a: source,
        b: cardFromSummary(summaryCard("b", { linkCount: 1, blocked: false })),
        c: cardFromSummary(summaryCard("c", { linkCount: 1, blocked: true })),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const deleted = boardReducer([board], {
      type: "DELETE_COLUMN",
      boardId: "b-1",
      columnId: "col-1",
      at: 30,
    } as BoardAction)[0];
    expect(deleted.cards.a).toBeUndefined();
    expect(deleted.cards.c).toBeUndefined();
    expect(deleted.cards.b.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
  });

  it("keeps a summary target conservative while another blocker may exist", () => {
    const detail = (id: string, linkId: string): Card =>
      cardFromDetail({
        boardId: "b-1",
        columnId: "col-1",
        card: {
          id,
          title: id,
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
          links: [{ id: linkId, type: "blocks", targetCardId: "b" }],
        },
        version: 1,
        linkCount: 1,
        blocked: false,
        incomingLinks: [],
        seq: 1,
        atSeq: 1,
        aggregateRevision: 1,
      });
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        {
          id: "col-1",
          title: "Todo",
          cardIds: ["a1", "a2", "b"],
          createdAt: 1,
        },
      ],
      cards: {
        a1: detail("a1", "l-1"),
        a2: detail("a2", "l-2"),
        b: cardFromSummary(summaryCard("b", { linkCount: 2, blocked: true })),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const first = boardReducer([board], {
      type: "REMOVE_CARD_LINK",
      boardId: "b-1",
      cardId: "a1",
      linkId: "l-1",
      targetCardId: "b",
      linkType: "blocks",
      at: 30,
    } as BoardAction)[0];
    expect(first.cards.b.readModel).toMatchObject({
      linkCount: 1,
      blocked: true,
    });
    const second = boardReducer([first], {
      type: "REMOVE_CARD_LINK",
      boardId: "b-1",
      cardId: "a2",
      linkId: "l-2",
      targetCardId: "b",
      linkType: "blocks",
      at: 40,
    } as BoardAction)[0];
    expect(second.cards.b.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
  });

  it("keeps a summary target blocked by a mixed non-blocker relation", () => {
    const link = (
      source: string,
      linkId: string,
      type: "blocks" | "relates_to",
    ): Card =>
      cardFromDetail({
        boardId: "b-1",
        columnId: "col-1",
        card: {
          id: source,
          title: source,
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
          links: [{ id: linkId, type, targetCardId: "b" }],
        },
        version: 1,
        linkCount: 1,
        blocked: false,
        incomingLinks: [],
        seq: 1,
        atSeq: 1,
        aggregateRevision: 1,
      });
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        {
          id: "col-1",
          title: "Todo",
          cardIds: ["blocker", "related", "b"],
          createdAt: 1,
        },
      ],
      cards: {
        blocker: link("blocker", "l-1", "blocks"),
        related: link("related", "l-2", "relates_to"),
        b: cardFromSummary(summaryCard("b", { linkCount: 2, blocked: true })),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const withoutBlocker = boardReducer([board], {
      type: "REMOVE_CARD_LINK",
      boardId: "b-1",
      cardId: "blocker",
      linkId: "l-1",
      targetCardId: "b",
      linkType: "blocks",
      at: 30,
    } as BoardAction)[0];
    expect(withoutBlocker.cards.b.readModel).toMatchObject({
      linkCount: 1,
      blocked: true,
    });
    const withoutLast = boardReducer([withoutBlocker], {
      type: "REMOVE_CARD_LINK",
      boardId: "b-1",
      cardId: "related",
      linkId: "l-2",
      targetCardId: "b",
      linkType: "relates_to",
      at: 40,
    } as BoardAction)[0];
    expect(withoutLast.cards.b.readModel).toMatchObject({
      linkCount: 0,
      blocked: false,
    });
  });

  it("clears blocked when the only blocker is archived or all leave a column", () => {
    const detail = (id: string, linkId: string): Card =>
      cardFromDetail({
        boardId: "b-1",
        columnId: "col-1",
        card: {
          id,
          title: id,
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
          links: [{ id: linkId, type: "blocks", targetCardId: "b" }],
        },
        version: 1,
        linkCount: 1,
        blocked: false,
        incomingLinks: [],
        seq: 1,
        atSeq: 1,
        aggregateRevision: 1,
      });
    const single: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        { id: "col-1", title: "Todo", cardIds: ["a", "b"], createdAt: 1 },
      ],
      cards: {
        a: detail("a", "l-1"),
        b: cardFromSummary(summaryCard("b", { linkCount: 1, blocked: true })),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const archived = boardReducer([single], {
      type: "ARCHIVE_CARD",
      boardId: "b-1",
      cardId: "a",
      at: 30,
    } as BoardAction)[0];
    expect(archived.cards.b.readModel).toMatchObject({
      linkCount: 1,
      blocked: false,
    });

    const target = cardFromDetail({
      boardId: "b-1",
      columnId: "col-2",
      card: {
        id: "b",
        title: "b",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      version: 1,
      linkCount: 2,
      blocked: true,
      incomingLinks: [
        { id: "l-1", type: "blocks", fromCardId: "a1", fromArchived: false },
        { id: "l-2", type: "blocks", fromCardId: "a2", fromArchived: false },
      ],
      seq: 1,
      atSeq: 1,
      aggregateRevision: 1,
    });
    const multi: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        { id: "col-1", title: "Todo", cardIds: ["a1", "a2"], createdAt: 1 },
        { id: "col-2", title: "Doing", cardIds: ["b"], createdAt: 1 },
      ],
      cards: {
        a1: detail("a1", "l-1"),
        a2: detail("a2", "l-2"),
        b: target,
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const columnGone = boardReducer([multi], {
      type: "ARCHIVE_COLUMN_CARDS",
      boardId: "b-1",
      columnId: "col-1",
      at: 40,
    } as BoardAction)[0];
    expect(columnGone.cards.b.readModel).toMatchObject({
      linkCount: 2,
      blocked: false,
    });
    expect(
      columnGone.cards.b.incomingLinks?.every((link) => link.fromArchived),
    ).toBe(true);
  });

  it("keeps description and checklist counters current on edits", () => {
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: ["a"], createdAt: 1 }],
      cards: {
        a: cardFromSummary(summaryCard("a", { descriptionChars: 12 })),
      },
      archivedCardIds: [],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const body = boardReducer([board], {
      type: "UPDATE_CARD",
      boardId: "b-1",
      cardId: "a",
      description: "hello",
      at: 30,
    } as BoardAction)[0];
    expect(body.cards.a.readModel?.descriptionChars).toBe(5);
    const renamed = boardReducer([body], {
      type: "UPDATE_CARD",
      boardId: "b-1",
      cardId: "a",
      title: "renamed",
      at: 40,
    } as BoardAction)[0];
    expect(renamed.cards.a.readModel?.descriptionChars).toBe(5);
    const list = boardReducer([renamed], {
      type: "ADD_CHECKLIST",
      boardId: "b-1",
      cardId: "a",
      newChecklistId: "cl-new",
      title: "Steps",
      at: 45,
    } as BoardAction)[0];
    const item = boardReducer([list], {
      type: "ADD_CHECKLIST_ITEM",
      boardId: "b-1",
      cardId: "a",
      checklistId: "cl-new",
      newItemId: "item-new",
      text: "one",
      at: 46,
    } as BoardAction)[0];
    expect(item.cards.a.readModel).toMatchObject({
      checklistItemCount: 5,
      checklistDoneCount: 1,
    });

    const detail = cardFromDetail({
      boardId: "b-1",
      columnId: "col-1",
      card: {
        id: "b",
        title: "b",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        checklists: [
          {
            id: "cl",
            title: "Steps",
            items: [{ id: "i-1", text: "one", done: false }],
          },
        ],
      },
      version: 1,
      linkCount: 0,
      blocked: false,
      incomingLinks: [],
      seq: 1,
      atSeq: 1,
      aggregateRevision: 1,
    });
    const withDetail: Board = {
      ...board,
      columns: [{ id: "col-1", title: "Todo", cardIds: ["b"], createdAt: 1 }],
      cards: { b: detail },
    };
    const done = boardReducer([withDetail], {
      type: "SET_CHECKLIST_ITEM_DONE",
      boardId: "b-1",
      cardId: "b",
      checklistId: "cl",
      itemId: "i-1",
      done: true,
      at: 50,
    } as BoardAction)[0];
    expect(done.cards.b.readModel).toMatchObject({
      checklistItemCount: 1,
      checklistDoneCount: 1,
    });
    const removed = boardReducer([done], {
      type: "DELETE_CHECKLIST_ITEM",
      boardId: "b-1",
      cardId: "b",
      checklistId: "cl",
      itemId: "i-1",
      at: 60,
    } as BoardAction)[0];
    expect(removed.cards.b.readModel).toMatchObject({
      checklistItemCount: 0,
      checklistDoneCount: 0,
    });
  });

  it("maintains archivedCardIds when column cards are restored", () => {
    const archived: Card = {
      ...cardFromSummary(summaryCard("a")),
      archivedAt: 10,
    };
    const board: Board = {
      id: "b-1",
      title: "Board",
      columns: [{ id: "col-1", title: "Todo", cardIds: [], createdAt: 1 }],
      cards: { a: archived },
      archivedCardIds: ["a"],
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const live: Card = { ...archived };
    delete live.archivedAt;
    const restored = boardReducer([board], {
      type: "RESTORE_COLUMN_CARDS",
      boardId: "b-1",
      columnId: "col-1",
      cardIds: ["a"],
      cards: [live],
      at: 30,
    } as BoardAction)[0];
    expect(restored.archivedCardIds).toEqual([]);
    expect(restored.columns[0].cardIds).toEqual(["a"]);
  });
});

describe("cardById", () => {
  it("resolves only own card ids, never prototype members", () => {
    const card = cardFromSummary(summaryCard("card-1"));
    const cards: Board["cards"] = { "card-1": card };
    expect(cardById(cards, "card-1")).toBe(card);
    expect(cardById(cards, "constructor")).toBeUndefined();
    expect(cardById(cards, "__proto__")).toBeUndefined();
    expect(cardById(cards, "toString")).toBeUndefined();
    expect(cardById(undefined, "card-1")).toBeUndefined();
    expect(cardById(cards, null)).toBeUndefined();
  });
});
