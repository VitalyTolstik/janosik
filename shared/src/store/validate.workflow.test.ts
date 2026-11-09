import { describe, expect, it } from "vitest";

import { validateBoardAction, validateImportedBoards } from "./validate";

const validWorkflow = {
  schemaVersion: 1,
  enabled: true,
  initialColumnId: "col-a",
  doneColumnIds: ["col-b"],
  transitions: [
    {
      id: "tr-1",
      fromColumnId: "col-a",
      toColumnId: "col-b",
      allowedRoles: ["ADMIN", "MEMBER"],
      conditions: ["requireAssignee", "requireChecklistsDone"],
    },
  ],
};

describe("SET_BOARD_WORKFLOW validation", () => {
  it("accepts a canonical config and rebuilds only known fields", () => {
    const result = validateBoardAction({
      type: "SET_BOARD_WORKFLOW",
      boardId: "b1",
      at: 1,
      workflow: { ...validWorkflow, unknown: "dropped" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toMatchObject({
        type: "SET_BOARD_WORKFLOW",
        workflow: validWorkflow,
      });
      expect(
        (result.action as { workflow?: Record<string, unknown> }).workflow,
      ).not.toHaveProperty("unknown");
    }
  });

  it("accepts an omitted workflow as the clear command", () => {
    const result = validateBoardAction({
      type: "SET_BOARD_WORKFLOW",
      boardId: "b1",
      at: 1,
    });
    expect(result).toEqual({
      ok: true,
      action: { type: "SET_BOARD_WORKFLOW", boardId: "b1", at: 1 },
    });
  });

  it("reports the field of a malformed transition", () => {
    const result = validateBoardAction({
      type: "SET_BOARD_WORKFLOW",
      boardId: "b1",
      at: 1,
      workflow: {
        ...validWorkflow,
        transitions: [{ id: "tr-1", fromColumnId: "", toColumnId: "col-b" }],
      },
    });
    expect(result).toMatchObject({
      ok: false,
      field: "action.workflow.transitions[0].fromColumnId",
    });
  });
});

describe("imported board workflow validation", () => {
  const board = {
    id: "b1",
    title: "Board",
    columns: [
      { id: "col-a", title: "A", cardIds: [], createdAt: 1 },
      { id: "col-b", title: "B", cardIds: [], createdAt: 1 },
    ],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };

  it("accepts a board without a workflow (legacy export)", () => {
    expect(validateImportedBoards([board]).ok).toBe(true);
  });

  it("accepts a well-formed workflow", () => {
    expect(
      validateImportedBoards([{ ...board, workflow: validWorkflow }]).ok,
    ).toBe(true);
  });

  it("fails a malformed workflow with a field path", () => {
    const result = validateImportedBoards([
      {
        ...board,
        workflow: { ...validWorkflow, transitions: "nope" },
      },
    ]);
    expect(result).toMatchObject({
      ok: false,
      field: "boards[0].workflow.transitions",
    });
  });

  it("tolerates a dangling column reference until the import remapper", () => {
    const result = validateImportedBoards([
      {
        ...board,
        workflow: {
          ...validWorkflow,
          transitions: [
            {
              id: "tr-1",
              fromColumnId: "deleted",
              toColumnId: "col-a",
            },
          ],
        },
      },
    ]);
    expect(result.ok).toBe(true);
  });
});
