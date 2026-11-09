import { describe, expect, it } from "vitest";

import {
  evaluateCardTransition,
  evaluateTransition,
  readBoardWorkflow,
  remapBoardWorkflow,
  suggestWorkflowTemplate,
  validateWorkflowShape,
  workflowDoneColumnIds,
  workflowInitialColumnId,
  workflowReferenceError,
  type BoardWorkflow,
  type WorkflowTransition,
} from "./workflow";
import type { Board, Card, Column } from "./types/kanban";

const ROLE: { ADMIN: "ADMIN"; MEMBER: "MEMBER"; VIEWER: "VIEWER" } = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
};

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

function board(
  workflow?: BoardWorkflow,
  cards: Record<string, Card> = { c1: card("c1") },
): Board {
  return {
    id: "b1",
    title: "Board",
    columns: [column("backlog", ["c1"]), column("doing"), column("done")],
    cards,
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    ...(workflow ? { workflow } : {}),
  };
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

describe("workflow evaluator", () => {
  it("allows every move when the workflow is absent or disabled", () => {
    expect(evaluateTransition(board(), "c1", "done", ROLE.MEMBER).allowed).toBe(
      true,
    );
    expect(
      evaluateTransition(
        board(workflow([], { enabled: false })),
        "c1",
        "done",
        ROLE.MEMBER,
      ).allowed,
    ).toBe(true);
  });

  it("always allows sorting inside the same column", () => {
    const decision = evaluateTransition(
      board(workflow([])),
      "c1",
      "backlog",
      ROLE.MEMBER,
    );
    expect(decision).toMatchObject({ allowed: true, sameColumn: true });
  });

  it("allows a specific edge and lists the other allowed targets", () => {
    const decision = evaluateTransition(
      board(
        workflow([
          { id: "a", fromColumnId: "backlog", toColumnId: "doing" },
          { id: "b", fromColumnId: "backlog", toColumnId: "done" },
        ]),
      ),
      "c1",
      "doing",
      ROLE.MEMBER,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.allowedToColumnIds).toEqual(["doing", "done"]);
  });

  it("does not let a global edge rescue a denied specific pair", () => {
    const decision = evaluateTransition(
      board(
        workflow([
          {
            id: "specific",
            fromColumnId: "backlog",
            toColumnId: "done",
            allowedRoles: ["ADMIN"],
          },
          { id: "global", fromColumnId: null, toColumnId: "done" },
        ]),
      ),
      "c1",
      "done",
      ROLE.MEMBER,
    );
    expect(decision).toMatchObject({
      allowed: false,
      code: "role_not_allowed",
      requiredRoles: ["ADMIN"],
    });
  });

  it("uses a global edge when no specific edge exists", () => {
    const decision = evaluateTransition(
      board(
        workflow([{ id: "global", fromColumnId: null, toColumnId: "done" }]),
      ),
      "c1",
      "done",
      ROLE.MEMBER,
    );
    expect(decision.allowed).toBe(true);
  });

  it("denies a pair without a transition", () => {
    const decision = evaluateTransition(
      board(
        workflow([{ id: "a", fromColumnId: "backlog", toColumnId: "doing" }]),
      ),
      "c1",
      "done",
      ROLE.MEMBER,
    );
    expect(decision).toMatchObject({
      allowed: false,
      code: "transition_not_allowed",
      allowedToColumnIds: ["doing"],
    });
  });

  it("checks every MVP condition with AND semantics", () => {
    const conditions: WorkflowTransition = {
      id: "a",
      fromColumnId: "backlog",
      toColumnId: "doing",
      conditions: [
        "requireAssignee",
        "requireDueDate",
        "requireDescription",
        "requireChecklistsDone",
      ],
    };
    const empty = evaluateCardTransition(
      workflow([conditions]),
      card("c1"),
      "backlog",
      "doing",
      ROLE.MEMBER,
    );
    expect(empty).toMatchObject({
      allowed: false,
      code: "condition_failed",
      failedConditions: [
        "requireAssignee",
        "requireDueDate",
        "requireDescription",
      ],
    });

    const complete = card("c1", {
      assigneeId: "u1",
      dueDate: 1_800_000_000_000,
      description: "Details",
      checklists: [
        {
          id: "cl",
          title: "DoD",
          items: [
            { id: "i1", text: "A", done: true },
            { id: "i2", text: "B", done: true },
          ],
        },
      ],
    });
    expect(
      evaluateCardTransition(
        workflow([conditions]),
        complete,
        "backlog",
        "doing",
        ROLE.MEMBER,
      ).allowed,
    ).toBe(true);
  });

  it("treats no checklists as vacuously done but a blank description as missing", () => {
    const decision = evaluateCardTransition(
      workflow([
        {
          id: "a",
          fromColumnId: "backlog",
          toColumnId: "doing",
          conditions: ["requireDescription", "requireChecklistsDone"],
        },
      ]),
      card("c1", { description: "   " }),
      "backlog",
      "doing",
      ROLE.MEMBER,
    );
    expect(decision).toMatchObject({
      allowed: false,
      failedConditions: ["requireDescription"],
    });
  });

  it("ignores roles when the reducer evaluates without an actor", () => {
    const decision = evaluateCardTransition(
      workflow([
        {
          id: "a",
          fromColumnId: "backlog",
          toColumnId: "doing",
          allowedRoles: ["ADMIN"],
        },
      ]),
      card("c1"),
      "backlog",
      "doing",
    );
    expect(decision.allowed).toBe(true);
  });

  it("ignores disabled transitions", () => {
    const decision = evaluateTransition(
      board(
        workflow([
          {
            id: "a",
            fromColumnId: "backlog",
            toColumnId: "doing",
            enabled: false,
          },
        ]),
      ),
      "c1",
      "doing",
      ROLE.MEMBER,
    );
    expect(decision.allowed).toBe(false);
  });

  it("reports a missing card", () => {
    expect(
      evaluateTransition(board(workflow([])), "nope", "doing", ROLE.MEMBER),
    ).toMatchObject({ allowed: false, code: "card_not_found" });
  });

  it("resolves initial and done columns, with last-column fallback", () => {
    const plain = board();
    expect(workflowInitialColumnId(plain)).toBe("backlog");
    expect(workflowDoneColumnIds(plain)).toEqual(["done"]);
    const configured = board(
      workflow([], {
        initialColumnId: "doing",
        doneColumnIds: ["done", "missing"],
      }),
    );
    expect(workflowInitialColumnId(configured)).toBe("doing");
    expect(workflowDoneColumnIds(configured)).toEqual(["done"]);
  });

  it("builds a template with forward and reverse adjacent edges", () => {
    const template = suggestWorkflowTemplate([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
    expect(template.enabled).toBe(true);
    expect(template.initialColumnId).toBe("a");
    expect(template.doneColumnIds).toEqual(["c"]);
    expect(
      template.transitions.map((entry) => [
        entry.fromColumnId,
        entry.toColumnId,
      ]),
    ).toEqual([
      ["a", "b"],
      ["b", "a"],
      ["b", "c"],
      ["c", "b"],
    ]);
  });
});

describe("workflow shape validation", () => {
  const valid = workflow([
    { id: "a", fromColumnId: "backlog", toColumnId: "doing" },
  ]);

  it("accepts a canonical config and rebuilds it", () => {
    const result = validateWorkflowShape(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workflow).toEqual(valid);
  });

  it.each([
    ["missing schema version", { ...valid, schemaVersion: 2 }, "schemaVersion"],
    ["non-boolean enabled", { ...valid, enabled: "yes" }, "enabled"],
    [
      "duplicate pair",
      {
        ...valid,
        transitions: [
          ...valid.transitions,
          { id: "b", fromColumnId: "backlog", toColumnId: "doing" },
        ],
      },
      "transitions[1].toColumnId",
    ],
    [
      "self edge",
      {
        ...valid,
        transitions: [
          { id: "a", fromColumnId: "backlog", toColumnId: "backlog" },
        ],
      },
      "transitions[0].toColumnId",
    ],
    [
      "empty roles",
      {
        ...valid,
        transitions: [
          {
            id: "a",
            fromColumnId: "backlog",
            toColumnId: "doing",
            allowedRoles: [],
          },
        ],
      },
      "transitions[0].allowedRoles",
    ],
    [
      "unknown condition",
      {
        ...valid,
        transitions: [
          {
            id: "a",
            fromColumnId: "backlog",
            toColumnId: "doing",
            conditions: ["unknown"],
          },
        ],
      },
      "transitions[0].conditions",
    ],
    [
      "enabled without transitions",
      { ...valid, transitions: [] },
      "transitions",
    ],
    [
      "enabled with only disabled transitions",
      {
        ...valid,
        transitions: valid.transitions.map((transition) => ({
          ...transition,
          enabled: false,
        })),
      },
      "transitions",
    ],
  ])("rejects %s", (_name, input, field) => {
    const result = validateWorkflowShape(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toContain(field);
  });

  it("allows a disabled workflow to keep disabled transitions", () => {
    const disabled = {
      ...valid,
      enabled: false,
      transitions: valid.transitions.map((transition) => ({
        ...transition,
        enabled: false,
      })),
    };
    expect(validateWorkflowShape(disabled).ok).toBe(true);
  });

  it("reads malformed stored JSON as absent", () => {
    expect(readBoardWorkflow(null)).toBeUndefined();
    expect(readBoardWorkflow({ nope: true })).toBeUndefined();
    expect(readBoardWorkflow(valid)).toEqual(valid);
  });

  it("checks column references", () => {
    const columns = [{ id: "backlog" }, { id: "doing" }, { id: "done" }];
    expect(workflowReferenceError(valid, columns)).toBeNull();
    expect(
      workflowReferenceError(
        workflow([{ id: "a", fromColumnId: "backlog", toColumnId: "missing" }]),
        columns,
      ),
    ).toMatchObject({ field: "workflow.transitions[0].toColumnId" });
    expect(
      workflowReferenceError(
        workflow([], { initialColumnId: "missing" }),
        columns,
      ),
    ).toMatchObject({ field: "workflow.initialColumnId" });
  });

  it("remaps ids, drops missing endpoints and disables an empty enabled config", () => {
    const idMap = new Map([
      ["backlog", "new-backlog"],
      ["doing", "new-doing"],
      ["done", "new-done"],
    ]);
    const remapped = remapBoardWorkflow(
      workflow([
        { id: "a", fromColumnId: "backlog", toColumnId: "doing" },
        { id: "b", fromColumnId: "doing", toColumnId: "missing" },
      ]),
      idMap,
    );
    expect(remapped.transitions).toHaveLength(1);
    expect(remapped.transitions[0]).toMatchObject({
      fromColumnId: "new-backlog",
      toColumnId: "new-doing",
    });
    expect(remapped.doneColumnIds).toEqual(["new-done"]);
    expect(remapped.initialColumnId).toBeUndefined();

    const dropped = remapBoardWorkflow(valid, new Map());
    expect(dropped.enabled).toBe(false);
    expect(dropped.transitions).toEqual([]);
  });
});
