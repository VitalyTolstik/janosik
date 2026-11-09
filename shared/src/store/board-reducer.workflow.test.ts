import { describe, expect, it } from "vitest";

import { boardReducer, type BoardAction } from "./board-reducer";
import type { BoardWorkflow } from "../workflow";
import type { Board, Card, Column } from "../types/kanban";

const AT = 1_700_000_000_000;

function card(id: string, patch: Partial<Card> = {}): Card {
  return {
    id,
    title: id,
    labelIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function column(id: string, cardIds: string[] = []): Column {
  return { id, title: id, cardIds, createdAt: 1 };
}

function workflow(
  transitions: BoardWorkflow["transitions"],
  patch: Partial<BoardWorkflow> = {},
): BoardWorkflow {
  return {
    schemaVersion: 1,
    enabled: true,
    doneColumnIds: ["done"],
    transitions,
    ...patch,
  };
}

function board(workflowConfig?: BoardWorkflow): Board {
  return {
    id: "b1",
    title: "Board",
    columns: [column("backlog", ["c1"]), column("doing"), column("done")],
    cards: { c1: card("c1") },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    ...(workflowConfig ? { workflow: workflowConfig } : {}),
  };
}

function reduce(
  state: Board,
  action: BoardAction,
  withActivity = false,
): Board {
  return boardReducer([state], action, { withActivity })[0];
}

function move(
  fromColumnId: string,
  toColumnId: string,
  patch: Partial<Extract<BoardAction, { type: "MOVE_CARD" }>> = {},
): BoardAction {
  return {
    type: "MOVE_CARD",
    boardId: "b1",
    cardId: "c1",
    fromColumnId,
    fromIndex: 0,
    toColumnId,
    toIndex: 0,
    at: AT,
    ...patch,
  };
}

describe("board reducer workflow guard", () => {
  it("moves a card along an allowed transition", () => {
    const before = board(
      workflow([{ id: "a", fromColumnId: "backlog", toColumnId: "doing" }]),
    );
    const after = reduce(before, move("backlog", "doing"));
    expect(after.columns.find((col) => col.id === "doing")?.cardIds).toEqual([
      "c1",
    ]);
  });

  it("refuses a transition the config does not allow", () => {
    const before = board(
      workflow([{ id: "a", fromColumnId: "backlog", toColumnId: "doing" }]),
    );
    const after = reduce(before, move("backlog", "done"));
    expect(after).toBe(before);
  });

  it("refuses a move when a card condition fails", () => {
    const before = board(
      workflow([
        {
          id: "a",
          fromColumnId: "backlog",
          toColumnId: "doing",
          conditions: ["requireAssignee"],
        },
      ]),
    );
    expect(reduce(before, move("backlog", "doing"))).toBe(before);

    const assigned = {
      ...before,
      cards: { c1: card("c1", { assigneeId: "u1" }) },
    };
    expect(
      reduce(assigned, move("backlog", "doing")).columns.find(
        (col) => col.id === "doing",
      )?.cardIds,
    ).toEqual(["c1"]);
  });

  it("applies an inverse move in the reducer (the server decides)", () => {
    const before = board(
      workflow([{ id: "a", fromColumnId: "backlog", toColumnId: "doing" }]),
    );
    // Simulate the board after a move, then undo into a forbidden direction.
    const moved = reduce(before, move("backlog", "doing"));
    const undo = move("doing", "backlog", { inverse: true });
    const undone = reduce(moved, undo);
    expect(undone.columns.find((col) => col.id === "backlog")?.cardIds).toEqual(
      ["c1"],
    );
  });

  it("keeps the legacy behaviour on a disabled workflow", () => {
    const before = board(workflow([], { enabled: false }));
    const after = reduce(before, move("backlog", "done"));
    expect(after.columns.find((col) => col.id === "done")?.cardIds).toEqual([
      "c1",
    ]);
  });

  it("stores, replaces and clears the workflow", () => {
    const before = board();
    const config = workflow([
      { id: "a", fromColumnId: "backlog", toColumnId: "doing" },
    ]);
    const set = reduce(before, {
      type: "SET_BOARD_WORKFLOW",
      boardId: "b1",
      workflow: config,
      at: AT,
    });
    expect(set.workflow).toEqual(config);

    const cleared = reduce(set, {
      type: "SET_BOARD_WORKFLOW",
      boardId: "b1",
      at: AT + 1,
    });
    expect(cleared.workflow).toBeUndefined();
    expect(cleared).not.toBe(set);
  });

  it("ignores an invalid workflow action", () => {
    const before = board();
    const after = reduce(before, {
      type: "SET_BOARD_WORKFLOW",
      boardId: "b1",
      workflow: { schemaVersion: 9 } as unknown as BoardWorkflow,
      at: AT,
    });
    expect(after).toBe(before);
  });

  it("keeps the workflow when a column is deleted and revives it on restore", () => {
    const config = workflow([
      { id: "a", fromColumnId: "backlog", toColumnId: "done" },
    ]);
    const before = board(config);
    const deleted = reduce(before, {
      type: "DELETE_COLUMN",
      boardId: "b1",
      columnId: "done",
      at: AT,
    });
    expect(deleted.workflow).toEqual(config);
    // The dangling reference is ignored by the evaluator: no edge remains.
    const blocked = reduce(deleted, move("backlog", "doing"));
    expect(blocked).toBe(deleted);

    const restored = reduce(deleted, {
      type: "RESTORE_COLUMN",
      boardId: "b1",
      column: column("done"),
      index: 2,
      cards: [],
      boardUpdatedAt: before.updatedAt,
      at: AT,
    });
    expect(restored.workflow).toEqual(config);
    const allowed = reduce(restored, move("backlog", "done"));
    expect(allowed.columns.find((col) => col.id === "done")?.cardIds).toEqual([
      "c1",
    ]);
  });
});
