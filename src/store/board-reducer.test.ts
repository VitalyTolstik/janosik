import { describe, expect, it } from "vitest";

import {
  boardReducer,
  initialBoardState,
  type BoardAction,
} from "@/store/board-reducer";
import type { Board } from "@/types/kanban";

/**
 * Tests for the pure board reducer — the core move logic (cards within and
 * across columns, column reordering), plus the CRUD actions. Each test
 * reduces a fresh seed board and inspects the returned state (never mutating
 * the input).
 */

function freshBoard(): Board {
  return initialBoardState()[0];
}

function reduceBoard(seed: Board, action: BoardAction): Board {
  return boardReducer([seed], action)[0];
}

describe("boardReducer — columns", () => {
  it("adds a column at the end", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ADD_COLUMN",
      title: "Testing",
    });
    expect(board.columns.map((c) => c.title)).toEqual([
      "Backlog",
      "In Progress",
      "Done",
      "Testing",
    ]);
  });

  it("renames a column", () => {
    const board = reduceBoard(freshBoard(), {
      type: "RENAME_COLUMN",
      columnId: "col-backlog",
      title: "Ideas",
    });
    expect(board.columns[0].title).toBe("Ideas");
  });

  it("deletes a column and cascades to its cards", () => {
    const board = reduceBoard(freshBoard(), {
      type: "DELETE_COLUMN",
      columnId: "col-backlog",
    });
    expect(board.columns.map((c) => c.id)).toEqual([
      "col-progress",
      "col-done",
    ]);
    // card-1 / card-2 / card-6 lived in the deleted column.
    expect(board.cards["card-1"]).toBeUndefined();
    expect(board.cards["card-2"]).toBeUndefined();
    expect(board.cards["card-3"]).toBeDefined();
  });
});

describe("boardReducer — board", () => {
  it("renames the board title", () => {
    const board = reduceBoard(freshBoard(), {
      type: "RENAME_BOARD",
      title: "Launch 2.0",
    });
    expect(board.title).toBe("Launch 2.0");
  });

  it("trims the title and rejects empty names", () => {
    const trimmed = reduceBoard(freshBoard(), {
      type: "RENAME_BOARD",
      title: "  Launch 2.0  ",
    });
    expect(trimmed.title).toBe("Launch 2.0");

    const empty = reduceBoard(freshBoard(), {
      type: "RENAME_BOARD",
      title: "   ",
    });
    expect(empty.title).toBe("Product Launch");
  });
});

describe("boardReducer — cards", () => {
  it("adds a card to the end of a column", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ADD_CARD",
      columnId: "col-done",
      title: "Ship it",
    });
    const done = board.columns.find((c) => c.id === "col-done");
    expect(done).toBeDefined();
    expect(done?.cardIds.at(-1)).toBeDefined();
    expect(board.cards[done?.cardIds.at(-1) ?? ""]?.title).toBe("Ship it");
  });

  it("attaches labels to a card created with labelIds", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ADD_CARD",
      columnId: "col-done",
      title: "Buy milk",
      labelIds: ["label-urgent", "label-later"],
    });
    const done = board.columns.find((c) => c.id === "col-done");
    const id = done?.cardIds.at(-1) ?? "";
    const card = board.cards[id];
    expect(card).toBeDefined();
    expect(card?.labelIds).toEqual(["label-urgent", "label-later"]);
  });

  it("creates a card without labels when labelIds is omitted", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ADD_CARD",
      columnId: "col-done",
      title: "No labels",
    });
    const done = board.columns.find((c) => c.id === "col-done");
    expect(board.cards[done?.cardIds.at(-1) ?? ""]?.labelIds).toEqual([]);
  });

  it("updates a card title", () => {
    const board = reduceBoard(freshBoard(), {
      type: "UPDATE_CARD",
      cardId: "card-5",
      title: "Fix auth bug (urgent)",
    });
    expect(board.cards["card-5"].title).toBe("Fix auth bug (urgent)");
  });

  it("deletes a card and removes it from its column", () => {
    const board = reduceBoard(freshBoard(), {
      type: "DELETE_CARD",
      cardId: "card-5",
    });
    expect(board.cards["card-5"]).toBeUndefined();
    const progress = board.columns.find((c) => c.id === "col-progress");
    expect(progress?.cardIds).toEqual(["card-4"]);
  });

  it("toggles a label on and off a card", () => {
    const board = reduceBoard(freshBoard(), {
      type: "TOGGLE_CARD_LABEL",
      cardId: "card-2",
      labelId: "label-urgent",
    });
    expect(board.cards["card-2"].labelIds).toContain("label-urgent");

    const cleared = reduceBoard(board, {
      type: "TOGGLE_CARD_LABEL",
      cardId: "card-2",
      labelId: "label-urgent",
    });
    expect(cleared.cards["card-2"].labelIds).not.toContain("label-urgent");
  });

  it("ignores toggles for unknown labels", () => {
    const board = freshBoard();
    const next = reduceBoard(board, {
      type: "TOGGLE_CARD_LABEL",
      cardId: "card-2",
      labelId: "no-such-label",
    });
    // Seed card-2 already carries the Development label — unchanged.
    expect(next.cards["card-2"].labelIds).toEqual(["label-dev"]);
  });
});

describe("boardReducer — LABEL management", () => {
  it("adds a label", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ADD_LABEL",
      label: { id: "label-new", name: "Docs", color: "blue" },
    });
    expect(board.labels.some((l) => l.id === "label-new")).toBe(true);
  });

  it("renames a label", () => {
    const board = reduceBoard(freshBoard(), {
      type: "RENAME_LABEL",
      labelId: "label-design",
      name: "UX",
    });
    expect(board.labels.find((l) => l.id === "label-design")?.name).toBe("UX");
  });

  it("recolors a label", () => {
    const board = reduceBoard(freshBoard(), {
      type: "SET_LABEL_COLOR",
      labelId: "label-design",
      color: "pink",
    });
    expect(board.labels.find((l) => l.id === "label-design")?.color).toBe(
      "pink",
    );
  });

  it("deletes a label and strips it from every card", () => {
    const board = freshBoard();
    // card-5 has Urgent from the seed; give card-1 the label too.
    expect(board.cards["card-5"].labelIds).toContain("label-urgent");
    const withLabel = reduceBoard(board, {
      type: "TOGGLE_CARD_LABEL",
      cardId: "card-1",
      labelId: "label-urgent",
    });
    expect(withLabel.cards["card-1"].labelIds).toContain("label-urgent");

    const next = reduceBoard(withLabel, {
      type: "DELETE_LABEL",
      labelId: "label-urgent",
    });
    expect(next.labels.some((l) => l.id === "label-urgent")).toBe(false);
    expect(next.cards["card-1"].labelIds).not.toContain("label-urgent");
    expect(next.cards["card-5"].labelIds).not.toContain("label-urgent");
  });
});

describe("boardReducer — MOVE_CARD", () => {
  const ids = (board: Board, columnId: string) =>
    board.columns.find((c) => c.id === columnId)?.cardIds;

  it("reorders a card within the same column", () => {
    const board = reduceBoard(freshBoard(), {
      type: "MOVE_CARD",
      cardId: "card-1",
      fromColumnId: "col-backlog",
      toColumnId: "col-backlog",
      toIndex: 1, // arrayMove semantics: final position of the card
    });
    expect(ids(board, "col-backlog")).toEqual(["card-2", "card-1", "card-6"]);
  });

  it("moves a card to the end of another column", () => {
    const board = reduceBoard(freshBoard(), {
      type: "MOVE_CARD",
      cardId: "card-1",
      fromColumnId: "col-backlog",
      toColumnId: "col-progress",
      toIndex: 2, // beyond the 2 existing cards → clamped to end
    });
    expect(ids(board, "col-backlog")).toEqual(["card-2", "card-6"]);
    expect(ids(board, "col-progress")).toEqual(["card-4", "card-5", "card-1"]);
  });

  it("moves a card to the middle of another column", () => {
    const board = reduceBoard(freshBoard(), {
      type: "MOVE_CARD",
      cardId: "card-6",
      fromColumnId: "col-backlog",
      toColumnId: "col-progress",
      toIndex: 1,
    });
    expect(ids(board, "col-progress")).toEqual(["card-4", "card-6", "card-5"]);
  });

  it("is a no-op when the target position is unchanged", () => {
    const board = freshBoard();
    const next = reduceBoard(board, {
      type: "MOVE_CARD",
      cardId: "card-1",
      fromColumnId: "col-backlog",
      toColumnId: "col-backlog",
      toIndex: 0,
    });
    expect(next.columns).toEqual(board.columns);
  });

  it("ignores unknown card ids", () => {
    const board = freshBoard();
    const next = reduceBoard(board, {
      type: "MOVE_CARD",
      cardId: "ghost",
      fromColumnId: "col-backlog",
      toColumnId: "col-done",
      toIndex: 0,
    });
    expect(next).toEqual(board);
  });
});

describe("boardReducer — MOVE_COLUMN", () => {
  const ids = (board: Board) => board.columns.map((c) => c.id);

  it("moves a column forward", () => {
    const board = reduceBoard(freshBoard(), {
      type: "MOVE_COLUMN",
      columnId: "col-backlog",
      fromIndex: 0,
      toIndex: 2,
    });
    expect(ids(board)).toEqual(["col-progress", "col-done", "col-backlog"]);
  });

  it("moves a column backward", () => {
    const board = reduceBoard(freshBoard(), {
      type: "MOVE_COLUMN",
      columnId: "col-done",
      fromIndex: 2,
      toIndex: 0,
    });
    expect(ids(board)).toEqual(["col-done", "col-backlog", "col-progress"]);
  });

  it("moves a column to an adjacent position", () => {
    const board = reduceBoard(freshBoard(), {
      type: "MOVE_COLUMN",
      columnId: "col-progress",
      fromIndex: 1,
      toIndex: 2,
    });
    expect(ids(board)).toEqual(["col-backlog", "col-done", "col-progress"]);
  });

  it("is a no-op for an unchanged position or unknown column", () => {
    const board = freshBoard();
    const same = reduceBoard(board, {
      type: "MOVE_COLUMN",
      columnId: "col-progress",
      fromIndex: 1,
      toIndex: 1,
    });
    expect(same.columns).toEqual(board.columns);

    const unknown = reduceBoard(board, {
      type: "MOVE_COLUMN",
      columnId: "col-ghost",
      fromIndex: 1,
      toIndex: 2,
    });
    expect(unknown.columns).toEqual(board.columns);
  });
});

describe("boardReducer — UPDATE_CARD patch", () => {
  it("updates only the title when description is not provided", () => {
    const board = reduceBoard(freshBoard(), {
      type: "UPDATE_CARD",
      cardId: "card-2", // a card without a seed description
      title: "New title",
    });
    expect(board.cards["card-2"].title).toBe("New title");
    expect(board.cards["card-2"].description).toBeUndefined();
  });

  it("updates only the description when title is not provided", () => {
    const board = reduceBoard(freshBoard(), {
      type: "UPDATE_CARD",
      cardId: "card-1",
      description: "Detailed notes",
    });
    expect(board.cards["card-1"].title).toBe("Design the new onboarding flow");
    expect(board.cards["card-1"].description).toBe("Detailed notes");
  });

  it("clears an existing description with an empty string", () => {
    const withDesc = reduceBoard(freshBoard(), {
      type: "UPDATE_CARD",
      cardId: "card-1",
      description: "Some notes",
    });
    expect(withDesc.cards["card-1"].description).toBe("Some notes");

    const cleared = reduceBoard(withDesc, {
      type: "UPDATE_CARD",
      cardId: "card-1",
      description: "",
    });
    expect(cleared.cards["card-1"].description).toBeUndefined();
  });

  it("is a no-op when nothing changes", () => {
    const board = freshBoard();
    const next = reduceBoard(board, {
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: board.cards["card-1"].title,
    });
    expect(next).toEqual(board);
  });
});

describe("boardReducer — RESTORE_BOARD and IMPORT_BOARDS", () => {
  it("restores an exact board snapshot and keeps other boards", () => {
    const seed = freshBoard();
    const restored: Board = {
      ...seed,
      title: "Restored",
      updatedAt: 1234, // untouched by restore
    };
    const two = [seed, { ...seed, id: "board-2", title: "Second" }];
    const next = boardReducer(two, { type: "RESTORE_BOARD", board: restored });
    expect(next[0].title).toBe("Restored");
    expect(next[0].updatedAt).toBe(1234);
    expect(next[1]?.id).toBe("board-2");
  });

  it("imports a completely new state", () => {
    const seed = freshBoard();
    const imported: Board = {
      ...seed,
      id: "board-imported",
      title: "Imported",
    };
    const next = boardReducer([seed], {
      type: "IMPORT_BOARDS",
      boards: [imported],
    });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("board-imported");
  });
});
