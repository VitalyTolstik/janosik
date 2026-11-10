import type { Board, Card } from "@janosik/shared";
import { boardsEqual, diffBoards } from "./plan-diff";

/**
 * TASK-166.8 diff unit tests: the preview must describe the net change of a
 * plan without echoing the whole board, and a reducer no-op must be visible
 * as "no changes" so the transport can warn instead of silently storing it.
 */

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    title: `Card ${id}`,
    labelIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function board(overrides: Partial<Board> = {}): Board {
  return {
    id: "b1",
    title: "Board",
    columns: [
      { id: "col1", title: "Todo", cardIds: ["c1", "c2"], createdAt: 1 },
      { id: "col2", title: "Done", cardIds: [], createdAt: 1 },
    ],
    cards: { c1: card("c1"), c2: card("c2") },
    labels: [{ id: "l1", name: "Bug", color: "red" }],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("plan diff", () => {
  it("emits only created, deleted and changed entities", () => {
    const before = board();
    const after = board({
      cards: {
        c1: card("c1", { title: "Renamed", description: "notes" }),
        c2: card("c2", { archivedAt: 5 }),
        c3: card("c3", { title: "New" }),
      },
      columns: [
        { id: "col1", title: "Todo", cardIds: ["c3", "c1"], createdAt: 1 },
        { id: "col2", title: "Done", cardIds: [], createdAt: 1 },
      ],
    });

    const changes = diffBoards(before, after);
    const byTouch = new Map(changes.map((change) => [change.touch, change]));

    expect(byTouch.get("card:c1")).toMatchObject({
      kind: "update",
      fields: ["description", "title"],
      before: { title: "Card c1" },
      after: { title: "Renamed", description: "notes" },
    });
    expect(byTouch.get("card:c2")).toMatchObject({
      kind: "update",
      fields: ["archivedAt"],
      after: { archivedAt: 5 },
    });
    expect(byTouch.get("card:c3")).toMatchObject({ kind: "create" });
    expect(byTouch.get("card:c3")?.after).toMatchObject({ title: "New" });
    expect(byTouch.get("column:col1")).toMatchObject({
      kind: "update",
      fields: ["cardIds"],
      after: { cardIds: ["c3", "c1"] },
    });
    expect(byTouch.has("label:l1")).toBe(false);
    expect(byTouch.has("column:col2")).toBe(false);
  });

  it("reports a deleted entity with its full before-state and no after", () => {
    const before = board();
    const after = board({
      cards: { c1: card("c1") },
      columns: [
        { id: "col1", title: "Todo", cardIds: ["c1"], createdAt: 1 },
        { id: "col2", title: "Done", cardIds: [], createdAt: 1 },
      ],
    });

    const changes = diffBoards(before, after);
    const deleted = changes.find((change) => change.touch === "card:c2");
    expect(deleted).toMatchObject({
      kind: "delete",
      after: null,
      before: { id: "c2", title: "Card c2" },
    });
  });

  it("diffs board-level fields and ignores bookkeeping fields", () => {
    const before = board();
    const after = board({
      title: "Renamed board",
      columnStyle: "band",
      updatedAt: 99,
      agentPolicy: {
        schemaVersion: 1,
        destructive: "deny",
        requireApprovalFor: [],
        approverRoles: ["ADMIN"],
        maxCommandsPerRun: 10,
        maxCardsPerRun: 5,
        approvalTtlMinutes: 15,
      },
    });

    const changes = diffBoards(before, after);
    const boardChange = changes.find((change) => change.touch === "board:b1");
    expect(boardChange).toMatchObject({
      kind: "update",
      fields: ["columnStyle", "title"],
    });
    expect(boardChange?.before).toEqual({ title: "Board" });
  });

  it("treats identical aggregates as equal", () => {
    expect(boardsEqual(board(), board())).toBe(true);
    expect(boardsEqual(board(), board({ cards: { c1: card("c1") } }))).toBe(
      false,
    );
    expect(diffBoards(board(), board())).toEqual([]);
  });
});
