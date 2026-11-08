import { describe, expect, it } from "vitest";

import { allBoardsArchived } from "./board-list";

describe("allBoardsArchived", () => {
  it("is true only when there is at least one board and every board is archived", () => {
    expect(allBoardsArchived([{ archivedAt: 1 }, { archivedAt: 2 }])).toBe(
      true,
    );
    expect(allBoardsArchived([{ archivedAt: 1 }, {}])).toBe(false);
    expect(allBoardsArchived([])).toBe(false);
  });
});
