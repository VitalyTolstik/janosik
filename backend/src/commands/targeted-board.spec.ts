import type { Prisma } from "@prisma/client";
import { loadTargetedBoardAggregate } from "./targeted-board";

/**
 * TASK-200.7: the targeted loader must produce the same column order and
 * workflow shell as the full aggregate while loading one card's payload.
 */
describe("loadTargetedBoardAggregate", () => {
  function tx(overrides: Record<string, unknown> = {}) {
    const board = {
      id: "b1",
      title: "Board",
      workflow: {
        schemaVersion: 1,
        enabled: false,
        doneColumnIds: ["done"],
        transitions: [],
      },
      agentPolicy: null,
      version: 5,
      createdAt: new Date(1),
      updatedAt: new Date(2),
    };
    const columns = [
      {
        id: "todo",
        boardId: "b1",
        title: "Todo",
        position: 0,
        version: 3,
        createdAt: new Date(1),
      },
      {
        id: "done",
        boardId: "b1",
        title: "Done",
        position: 1,
        version: 4,
        createdAt: new Date(1),
      },
    ];
    const cards = [
      {
        id: "c1",
        columnId: "todo",
        title: "Card",
        labelIds: [],
        labels: [],
        checklists: [],
        acceptanceCriteria: [],
        definitionOfDone: [],
        version: 9,
        position: 0,
        createdAt: new Date(1),
        updatedAt: new Date(2),
        deletedAt: null,
        archivedAt: null,
        attachmentCount: 0,
      },
    ];
    return {
      board: { findFirst: jest.fn().mockResolvedValue(board) },
      column: { findMany: jest.fn().mockResolvedValue(columns) },
      label: { findMany: jest.fn().mockResolvedValue([]) },
      card: {
        findMany: jest
          .fn()
          .mockImplementation((args: { select?: unknown; where?: unknown }) =>
            args?.select !== undefined
              ? Promise.resolve([
                  { id: "c1", columnId: "todo" },
                  { id: "c2", columnId: "todo" },
                  { id: "c3", columnId: "done" },
                ])
              : Promise.resolve(cards),
          ),
      },
      cardLink: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides,
    } as unknown as Prisma.TransactionClient;
  }

  it("loads the shell and one card, and reconstructs every column order", async () => {
    const loaded = await loadTargetedBoardAggregate(tx(), "b1", {
      cardIds: ["c1"],
      includeCardIndex: true,
    });

    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded!.board.cards)).toEqual(["c1"]);
    expect(loaded!.board.columns.map((column) => column.cardIds)).toEqual([
      ["c1", "c2"],
      ["c3"],
    ]);
    expect(loaded!.board.workflow?.doneColumnIds).toEqual(["done"]);
    expect(loaded!.versions).toEqual({
      "board:b1": 5,
      "column:todo": 3,
      "column:done": 4,
      "card:c1": 9,
    });
  });

  it("does not issue the card-index query when no move needs it", async () => {
    const db = tx();
    const loaded = await loadTargetedBoardAggregate(db, "b1", {
      cardIds: ["c1"],
    });
    expect(loaded!.board.columns[0]!.cardIds).toEqual(["c1"]);
    expect(db.card.findMany).toHaveBeenCalledTimes(1);
  });
});
