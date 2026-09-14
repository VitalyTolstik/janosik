import { describe, expect, it } from "vitest";

import { LIMITS, type Column } from "@/types/kanban";
import { isColumnFull } from "@/utils/column-limits";

function columnWith(count: number, wipLimit?: number): Column {
  return {
    id: "col-1",
    title: "Column",
    cardIds: Array.from({ length: count }, (_, i) => `card-${i}`),
    wipLimit,
    createdAt: 0,
  };
}

describe("isColumnFull", () => {
  it("is false while the column is under the hard limit", () => {
    expect(isColumnFull(columnWith(LIMITS.cardsPerColumn - 1))).toBe(false);
  });

  it("is true at the hard cardsPerColumn limit", () => {
    expect(isColumnFull(columnWith(LIMITS.cardsPerColumn))).toBe(true);
  });

  it("is true when the WIP limit is reached", () => {
    expect(isColumnFull(columnWith(3, 3))).toBe(true);
    expect(isColumnFull(columnWith(2, 3))).toBe(false);
  });
});
