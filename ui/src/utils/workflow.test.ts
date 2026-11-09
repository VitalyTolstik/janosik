import { describe, expect, it } from "vitest";

import type { Board, BoardWorkflow, Card, Column } from "@janosik/shared";
import type { MessageKey } from "@/i18n";
import { blockedMoveMessage, restoreTargetBlockReason } from "@/utils/workflow";

const t = (key: MessageKey, params?: Record<string, string | number>): string =>
  `${key}${params ? `:${Object.values(params).join(",")}` : ""}`;

function column(
  id: string,
  title: string,
  patch: Partial<Column> = {},
): Column {
  return { id, title, cardIds: [], createdAt: 1, ...patch };
}

function fixture(): Board {
  const columns: Column[] = [
    column("backlog", "Backlog", { cardIds: ["c1"] }),
    column("doing", "Doing"),
    column("done", "Done", { cardIds: ["c2"], wipLimit: 1 }),
    column("archive", "Archive"),
  ];
  const cards: Record<string, Card> = {
    c1: {
      id: "c1",
      title: "Task",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
    c2: {
      id: "c2",
      title: "Full",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  };
  const workflow: BoardWorkflow = {
    schemaVersion: 1,
    enabled: true,
    initialColumnId: "backlog",
    doneColumnIds: ["done"],
    transitions: [
      { id: "backlog-doing", fromColumnId: "backlog", toColumnId: "doing" },
      { id: "backlog-done", fromColumnId: "backlog", toColumnId: "done" },
    ],
  };
  return {
    id: "b1",
    title: "Board",
    columns,
    cards,
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    workflow,
  };
}

describe("workflow UI helpers", () => {
  it("does not advertise a WIP-full but workflow-allowed target", () => {
    const board = fixture();
    const target = board.columns.find((entry) => entry.id === "archive")!;
    const message = blockedMoveMessage(board, "c1", target, "MEMBER", t);
    expect(message).toContain("Doing");
    expect(message).not.toContain("Done");
  });

  it("allows an archived card back to its own column and blocks another", () => {
    const board = fixture();
    const card: Card = {
      ...board.cards.c1,
      archivedAt: 2,
      archivedFromColumnId: "backlog",
    };
    const byId = (id: string) =>
      board.columns.find((entry) => entry.id === id)!;
    expect(
      restoreTargetBlockReason(board, card, byId("backlog"), "MEMBER", t),
    ).toBeNull();
    expect(
      restoreTargetBlockReason(board, card, byId("archive"), "MEMBER", t),
    ).toContain("workflow.blocked.transition");
    expect(
      restoreTargetBlockReason(board, card, byId("done"), "MEMBER", t),
    ).toContain("workflow.blocked.wip");
  });
});
