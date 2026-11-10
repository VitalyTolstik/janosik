import { describe, expect, it } from "vitest";

import { estimateBoardExportBytes } from "./export-size";

const board = (description: string) =>
  [
    {
      id: "b1",
      title: "Board",
      createdAt: 1,
      updatedAt: 1,
      columns: [{ id: "c1", title: "Todo", cardIds: ["card-1"], createdAt: 1 }],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Card",
          description,
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      labels: [],
    },
  ] as never;

describe("estimateBoardExportBytes (TASK-166.6)", () => {
  it("grows with the description and flags a huge board cheaply", () => {
    const small = estimateBoardExportBytes(board("x"));
    const huge = estimateBoardExportBytes(board("x".repeat(25 * 1024 * 1024)));
    expect(small).toBeLessThan(10_000);
    expect(huge).toBeGreaterThan(25 * 1024 * 1024);
  });
});
