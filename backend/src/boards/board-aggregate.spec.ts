import type { Board as BoardRow } from "@prisma/client";
import { emptyBoardAggregate, loadBoardAggregate } from "./board-aggregate";

const boardRow = {
  id: "board-1",
  title: "Board",
  workflow: null,
  agentPolicy: null,
  columnStyle: null,
  agentsPausedAt: null,
  agentsPausedBy: null,
  agentsPauseReason: null,
  archivedAt: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
} as unknown as BoardRow;

/** TASK-200.4: the transaction's board row is reused, not read twice. */
describe("loadBoardAggregate", () => {
  it("does not re-read Board when the caller already loaded it", async () => {
    const db = {
      board: { findFirst: jest.fn() },
      column: { findMany: jest.fn().mockResolvedValue([]) },
      label: { findMany: jest.fn().mockResolvedValue([]) },
      card: { findMany: jest.fn().mockResolvedValue([]) },
      cardLink: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const aggregate = await loadBoardAggregate(db as never, "board-1", {
      board: boardRow,
    });

    expect(aggregate?.id).toBe("board-1");
    expect(db.board.findFirst).not.toHaveBeenCalled();
    // One query for each entity collection; the board row is the fifth
    // input and came from the caller.
    expect(db.column.findMany).toHaveBeenCalledTimes(1);
    expect(db.label.findMany).toHaveBeenCalledTimes(1);
    expect(db.card.findMany).toHaveBeenCalledTimes(1);
    expect(db.cardLink.findMany).toHaveBeenCalledTimes(1);
  });

  it("still loads the board row itself for the other callers", async () => {
    const db = {
      board: { findFirst: jest.fn().mockResolvedValue(boardRow) },
      column: { findMany: jest.fn().mockResolvedValue([]) },
      label: { findMany: jest.fn().mockResolvedValue([]) },
      card: { findMany: jest.fn().mockResolvedValue([]) },
      cardLink: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await loadBoardAggregate(db as never, "board-1");

    expect(db.board.findFirst).toHaveBeenCalledWith({
      where: { id: "board-1", deletedAt: null },
    });
  });

  it("provides a content-free shell only for policy-only classification", () => {
    expect(emptyBoardAggregate("board-1")).toEqual({
      id: "board-1",
      title: "",
      columns: [],
      cards: {},
      labels: [],
      createdAt: 0,
      updatedAt: 0,
    });
  });
});
