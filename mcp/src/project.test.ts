import { describe, expect, it } from "vitest";

import type { Board, Card } from "@janosik/shared";
import { summarizeBoard, summarizeCard } from "./project.js";

function card(overrides: Partial<Card> & { id: string }): Card {
  return {
    title: overrides.id,
    labelIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function board(cards: Card[]): Board {
  return {
    id: "b1",
    title: "Alpha",
    columns: [
      {
        id: "col1",
        title: "Todo",
        cardIds: cards.map((c) => c.id),
        createdAt: 1,
      },
    ],
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    labels: [{ id: "l1", name: "Design", color: "blue" }],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("summarizeBoard", () => {
  it("drops the description but keeps a size hint", () => {
    const description = "x".repeat(64_000);
    const summary = summarizeBoard(
      board([card({ id: "k1", description, labelIds: ["l1"] })]),
    );
    const projected = summary.cards.k1!;
    expect(projected.hasDescription).toBe(true);
    expect(projected.descriptionChars).toBe(64_000);
    expect(projected).not.toHaveProperty("description");
    expect(projected.columnId).toBe("col1");
    expect(projected.labelIds).toEqual(["l1"]);
    // The projection is orders of magnitude smaller than the document.
    expect(JSON.stringify(summary).length).toBeLessThan(2_000);
  });

  it("reports checklist progress without the items", () => {
    const summary = summarizeBoard(
      board([
        card({
          id: "k1",
          checklists: [
            {
              id: "c1",
              title: "DoD",
              items: [
                { id: "i1", text: "a", done: true },
                { id: "i2", text: "b", done: false },
              ],
            },
          ],
        }),
      ]),
    );
    expect(summary.cards.k1!.checklist).toEqual({ done: 1, total: 2 });
  });

  it("marks a card blocked by a live blocks link, ignoring archived sources", () => {
    const summary = summarizeBoard(
      board([
        card({
          id: "k1",
          links: [{ id: "l1", type: "blocks", targetCardId: "k2" }],
        }),
        card({ id: "k2" }),
        card({
          id: "k3",
          archivedAt: 9,
          links: [{ id: "l2", type: "blocks", targetCardId: "k2" }],
        }),
      ]),
    );
    expect(summary.cards.k2!.blocked).toBe(true);
    expect(summary.cards.k1!.blocked).toBe(false);
  });

  it("preserves the board skeleton and column wip limit", () => {
    const source = board([card({ id: "k1" })]);
    source.columns[0]!.wipLimit = 3;
    const summary = summarizeBoard(source);
    expect(summary.id).toBe("b1");
    expect(summary.labels).toEqual(source.labels);
    expect(summary.columns).toEqual([
      { id: "col1", title: "Todo", cardIds: ["k1"], wipLimit: 3 },
    ]);
  });
});

describe("summarizeCard", () => {
  it("defaults an unset priority to medium", () => {
    const projected = summarizeCard(card({ id: "k1" }), "col1", new Set());
    expect(projected.priority).toBe("medium");
    expect(projected.assigneeId).toBeNull();
    expect(projected.claimedBy).toBeNull();
    expect(projected.archived).toBe(false);
  });
});
