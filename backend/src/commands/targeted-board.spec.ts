import type { Prisma } from "@prisma/client";
import {
  loadTargetedBoardAggregate,
  targetedIndexColumnIds,
} from "./targeted-board";

/**
 * TASK-200.7: the targeted loader must produce the same column order and
 * workflow shell as the full aggregate while loading one card's payload and
 * only the indexed columns the intent actually needs.
 */
describe("loadTargetedBoardAggregate", () => {
  function harness() {
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
        id: "doing",
        boardId: "b1",
        title: "Doing",
        position: 1,
        version: 4,
        createdAt: new Date(1),
      },
      {
        id: "done",
        boardId: "b1",
        title: "Done",
        position: 2,
        version: 6,
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
    const indexCalls: Array<{
      where?: {
        columnId?: { in?: string[] };
        column?: { boardId?: string };
      };
    }> = [];
    const db = {
      board: { findFirst: jest.fn().mockResolvedValue(board) },
      column: { findMany: jest.fn().mockResolvedValue(columns) },
      label: { findMany: jest.fn().mockResolvedValue([]) },
      card: {
        findMany: jest.fn().mockImplementation(
          (args: {
            select?: unknown;
            where?: {
              columnId?: { in?: string[] };
              column?: { boardId?: string };
            };
          }) => {
            if (args?.select !== undefined) {
              indexCalls.push(args);
              return Promise.resolve([
                { id: "c1", columnId: "todo" },
                { id: "c2", columnId: "todo" },
                { id: "c3", columnId: "doing" },
                { id: "c4", columnId: "done" },
              ]);
            }
            return Promise.resolve(cards);
          },
        ),
      },
      cardLink: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as Prisma.TransactionClient;
    return { db, indexCalls };
  }

  it("reconstructs only the indexed column orders", async () => {
    const { db, indexCalls } = harness();
    const loaded = await loadTargetedBoardAggregate(db, "b1", {
      cardIds: ["c1"],
      includeTargetColumn: true,
      indexColumnIds: ["doing"],
    });

    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded!.board.cards)).toEqual(["c1"]);
    expect(loaded!.board.columns.map((column) => column.id)).toEqual([
      "todo",
      "doing",
      "done",
    ]);
    expect(loaded!.board.columns.map((column) => column.cardIds)).toEqual([
      ["c1", "c2"],
      ["c3"],
      [],
    ]);
    expect(indexCalls).toHaveLength(1);
    expect(indexCalls[0]!.where?.columnId?.in).toEqual(["doing", "todo"]);
    expect(indexCalls[0]!.where?.column?.boardId).toBe("b1");
    expect(loaded!.board.workflow?.doneColumnIds).toEqual(["done"]);
    expect(loaded!.versions).toEqual({
      "board:b1": 5,
      "column:todo": 3,
      "column:doing": 4,
      "column:done": 6,
      "card:c1": 9,
    });
  });

  it("never indexes a column from another board", async () => {
    const { db, indexCalls } = harness();
    await loadTargetedBoardAggregate(db, "b1", {
      cardIds: ["c1"],
      includeTargetColumn: true,
      indexColumnIds: ["foreign-board-column"],
    });
    expect(indexCalls).toHaveLength(1);
    expect(indexCalls[0]!.where?.columnId?.in).toEqual(["todo"]);
  });

  it("does not issue an index query for a claim/patch read", async () => {
    const { db } = harness();
    const loaded = await loadTargetedBoardAggregate(db, "b1", {
      cardIds: ["c1"],
    });
    expect(loaded!.board.columns[0]!.cardIds).toEqual(["c1"]);
    expect(db.card.findMany).toHaveBeenCalledTimes(1);
  });

  it("indexes only the source and destination columns of a move", () => {
    expect(
      targetedIndexColumnIds([
        {
          type: "MOVE_CARD",
          fromColumnId: "todo",
          toColumnId: "done",
        },
        { type: "UPDATE_CARD", cardId: "c1" },
      ]),
    ).toEqual(["todo", "done"]);
  });
});
