import { describe, expect, it } from "vitest";

import {
  compareTableRows,
  type SortState,
  type TableSortRow,
} from "@/components/board/table-parts";
import type { Card } from "@janosik/shared";

/**
 * Table comparators: title/due/created were covered through the rendered
 * table, but column/priority/assignee had no tests at any layer. They are
 * pure functions now, so the invariants are asserted directly (TASK-162
 * review, T-03).
 */

function card(overrides: Partial<Card> & Pick<Card, "id" | "title">): Card {
  return {
    labelIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const rows: TableSortRow[] = [
  {
    card: card({
      id: "b",
      title: "Bravo",
      dueDate: 200,
      priority: "high",
      assigneeId: "u-bob",
      createdAt: 20,
    }),
    column: { id: "col-2" },
  },
  {
    card: card({
      id: "d",
      title: "Delta",
      priority: "blocker",
      createdAt: 40,
    }),
    column: { id: "col-1" },
  },
  {
    card: card({
      id: "a",
      title: "Alpha",
      dueDate: 100,
      priority: "low",
      assigneeId: "u-alice",
      createdAt: 10,
    }),
    column: { id: "col-1" },
  },
  {
    card: card({
      id: "c",
      title: "Charlie",
      priority: "medium",
      createdAt: 30,
    }),
    column: { id: "col-2" },
  },
];

const columnIndex = new Map([
  ["col-1", 0],
  ["col-2", 1],
]);

const assigneeName = (userId: string) =>
  ({ "u-alice": "Alice", "u-bob": "Bob" })[userId] ?? "";

function order(sort: SortState): string[] {
  return [...rows]
    .sort((a, b) =>
      compareTableRows(a, b, sort, columnIndex, assigneeName, "en"),
    )
    .map((row) => row.card.title);
}

describe("compareTableRows", () => {
  it("sorts by column and keeps the stored order inside each column", () => {
    expect(order({ key: "column", dir: 1 })).toEqual([
      "Delta",
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
    expect(order({ key: "column", dir: -1 })).toEqual([
      "Bravo",
      "Charlie",
      "Delta",
      "Alpha",
    ]);
  });

  it("sorts by priority rank, treating an unset priority as medium", () => {
    expect(order({ key: "priority", dir: 1 })).toEqual([
      "Delta", // blocker
      "Bravo", // high
      "Charlie", // medium (explicit)
      "Alpha", // low
    ]);
    expect(order({ key: "priority", dir: -1 })).toEqual([
      "Alpha",
      "Charlie",
      "Bravo",
      "Delta",
    ]);
  });

  it("sorts assignees by name and keeps unassigned rows last in both directions", () => {
    expect(order({ key: "assignee", dir: 1 })).toEqual([
      "Alpha", // Alice
      "Bravo", // Bob
      "Delta", // unassigned
      "Charlie", // unassigned
    ]);
    expect(order({ key: "assignee", dir: -1 })).toEqual([
      "Bravo",
      "Alpha",
      "Delta",
      "Charlie",
    ]);
  });

  it("keeps undated rows last in both due-date directions", () => {
    expect(order({ key: "due", dir: 1 })).toEqual([
      "Alpha",
      "Bravo",
      "Delta",
      "Charlie",
    ]);
    expect(order({ key: "due", dir: -1 })).toEqual([
      "Bravo",
      "Alpha",
      "Delta",
      "Charlie",
    ]);
  });

  it("sorts titles case-insensitively and creation dates numerically", () => {
    expect(order({ key: "title", dir: 1 })).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
      "Delta",
    ]);
    expect(order({ key: "createdAt", dir: 1 })).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
      "Delta",
    ]);
    expect(order({ key: "createdAt", dir: -1 })).toEqual([
      "Delta",
      "Charlie",
      "Bravo",
      "Alpha",
    ]);
  });
});
