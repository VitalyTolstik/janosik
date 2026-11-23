import { describe, expect, it } from "vitest";
import type {
  BoardCardDetailDto,
  BoardCardSummaryDto,
  BoardReadSummaryDto,
  Card,
} from "@janosik/shared";
import { cardLinkIndex } from "@/utils/links";
import {
  boardFromSummary,
  cardFromDetail,
  cardFromSummary,
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
});
