import { beforeAll, describe, expect, it } from "vitest";

import {
  boardReducer,
  initialBoardState,
  type BoardAction,
  type BoardState,
} from "@/store/board-reducer";
import type { Board, Card } from "@/types/kanban";
import { LIMITS } from "@/types/kanban";

/**
 * Tests for the pure board reducer — the core move logic (cards within and
 * across columns, column reordering), plus the CRUD actions. Each test
 * reduces a fresh seed board and inspects the returned state (never mutating
 * the input).
 */

function freshBoard(): Board {
  return initialBoardState()[0];
}

/**
 * Fields the reducer no longer invents (TASK-21.7a): the command clock and
 * the ids of whatever a command creates. A test that does not care about
 * the exact value leaves them out and the helpers below stamp one; a test
 * that asserts on them passes them explicitly and the stamp steps aside.
 */
type Stamped =
  | "at"
  | "commandId"
  | "activityIds"
  | "fromIndex"
  | "newCardId"
  | "newCardIds"
  | "newColumnId"
  | "newChecklistId"
  | "newItemId";

type Unstamped<A> = A extends unknown
  ? Omit<A, Stamped> & Partial<Pick<A, Extract<keyof A, Stamped>>>
  : never;

/** A command as a test writes it: only what the test actually cares about. */
type TestAction = Unstamped<BoardAction>;

// Later than the seed board's own timestamps, so "bumped the stamp"
// assertions stay true, and one millisecond per command so repeats keep
// their order.
const CLOCK = Date.now();
let commands = 0;

function stamp(action: TestAction): BoardAction {
  commands += 1;
  const filled = { at: CLOCK + commands, ...action } as Record<
    string,
    unknown
  > & { type: string };
  const id = (kind: string) => `${kind}-${commands}`;
  if (filled.type === "ADD_COLUMN") filled.newColumnId ??= id("new-col");
  if (filled.type === "ADD_CARD") filled.newCardId ??= id("new-card");
  if (filled.type === "DUPLICATE_CARD") filled.newCardId ??= id("copy-card");
  if (filled.type === "DUPLICATE_COLUMN") {
    filled.newColumnId ??= id("copy-col");
    // Positional ids for the copies; the reducer uses as many as the source
    // column has cards and ignores the rest.
    filled.newCardIds ??= Array.from(
      { length: LIMITS.cardsPerColumn },
      (_, i) => `${id("copy-card")}-${i}`,
    );
  }
  if (filled.type === "ADD_CHECKLIST") {
    filled.newChecklistId ??= id("new-checklist");
  }
  if (filled.type === "ADD_CHECKLIST_ITEM") filled.newItemId ??= id("new-item");
  // The reducer moves a card by id; the index only matters to the inverse.
  if (filled.type === "MOVE_CARD") filled.fromIndex ??= 0;
  return filled as unknown as BoardAction;
}

function reduceState(state: BoardState, action: TestAction): BoardState {
  return boardReducer(state, stamp(action));
}

function reduceBoard(seed: Board, action: TestAction): Board {
  return reduceState([seed], action)[0];
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

  it("does not write a step when a column rename changes nothing", () => {
    const board = freshBoard();
    // Renaming to the current title leaves the board object untouched.
    const same = reduceState([board], {
      type: "RENAME_COLUMN",
      columnId: "col-backlog",
      title: board.columns[0].title,
    })[0];
    expect(same).toBe(board);

    // A missing column is a no-op too, not a fresh board.
    const missing = reduceState([board], {
      type: "RENAME_COLUMN",
      columnId: "col-missing",
      title: "Ideas",
    })[0];
    expect(missing).toBe(board);
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

  it("inserts a card at atIndex (inline hover-zone add)", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ADD_CARD",
      columnId: "col-done",
      title: "First!",
      atIndex: 0,
    });
    const done = board.columns.find((c) => c.id === "col-done");
    const newId = done?.cardIds[0] ?? "";
    expect(board.cards[newId]?.title).toBe("First!");
  });

  it("clamps atIndex beyond the column length to an append", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ADD_CARD",
      columnId: "col-done",
      title: "Too far",
      atIndex: 99,
    });
    const done = board.columns.find((c) => c.id === "col-done");
    expect(board.cards[done?.cardIds.at(-1) ?? ""]?.title).toBe("Too far");
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

  it("attaches and detaches a label on a card", () => {
    const board = reduceBoard(freshBoard(), {
      type: "SET_CARD_LABEL",
      cardId: "card-2",
      labelId: "label-urgent",
      on: true,
    });
    expect(board.cards["card-2"].labelIds).toContain("label-urgent");

    const cleared = reduceBoard(board, {
      type: "SET_CARD_LABEL",
      cardId: "card-2",
      labelId: "label-urgent",
      on: false,
    });
    expect(cleared.cards["card-2"].labelIds).not.toContain("label-urgent");
  });

  it("ignores unknown labels", () => {
    const board = freshBoard();
    const next = reduceBoard(board, {
      type: "SET_CARD_LABEL",
      cardId: "card-2",
      labelId: "no-such-label",
      on: true,
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

  it("does not write a step when a label rename changes nothing", () => {
    const board = freshBoard();
    const label = board.labels[0];

    // Same name.
    const same = reduceState([board], {
      type: "RENAME_LABEL",
      labelId: label.id,
      name: label.name,
    })[0];
    expect(same).toBe(board);

    // Blank input falls back to the current name — still a no-op.
    const blank = reduceState([board], {
      type: "RENAME_LABEL",
      labelId: label.id,
      name: "   ",
    })[0];
    expect(blank).toBe(board);

    // Missing label.
    const missing = reduceState([board], {
      type: "RENAME_LABEL",
      labelId: "label-missing",
      name: "Docs",
    })[0];
    expect(missing).toBe(board);
  });

  it("does not write a step when a label recolor changes nothing", () => {
    const board = freshBoard();
    const label = board.labels[0];

    const same = reduceState([board], {
      type: "SET_LABEL_COLOR",
      labelId: label.id,
      color: label.color,
    })[0];
    expect(same).toBe(board);

    const missing = reduceState([board], {
      type: "SET_LABEL_COLOR",
      labelId: "label-missing",
      color: "pink",
    })[0];
    expect(missing).toBe(board);
  });

  it("deletes a label and strips it from every card", () => {
    const board = freshBoard();
    // card-5 has Urgent from the seed; give card-1 the label too.
    expect(board.cards["card-5"].labelIds).toContain("label-urgent");
    const withLabel = reduceBoard(board, {
      type: "SET_CARD_LABEL",
      cardId: "card-1",
      labelId: "label-urgent",
      on: true,
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

describe("boardReducer — quiet updatedAt (TASK-18)", () => {
  it("keeps updatedAt quiet on live edits marked quiet", () => {
    const board = freshBoard();
    const before = board.cards["card-1"].updatedAt;
    const next = reduceBoard(board, {
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: "Typed live",
      quiet: true,
    });
    expect(next.cards["card-1"].title).toBe("Typed live");
    expect(next.cards["card-1"].updatedAt).toBe(before);
  });

  it("stamps one updatedAt per editing session via TOUCH_CARD", () => {
    const board = freshBoard();
    const before = board.cards["card-1"].updatedAt;
    const typed = reduceBoard(board, {
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: "T",
      quiet: true,
    });
    const typedMore = reduceBoard(typed, {
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: "Ty",
      quiet: true,
    });
    expect(typedMore.cards["card-1"].updatedAt).toBe(before);
    const touched = reduceBoard(typedMore, {
      type: "TOUCH_CARD",
      cardId: "card-1",
      at: 987654,
    });
    expect(touched.cards["card-1"].updatedAt).toBe(987654);
  });

  it("stamps updatedAt from the command clock, not from a clock read", () => {
    const next = reduceBoard(freshBoard(), {
      type: "TOUCH_CARD",
      cardId: "card-1",
      at: 424242,
    });
    expect(next.cards["card-1"].updatedAt).toBe(424242);
  });

  it("ignores TOUCH_CARD for a missing card", () => {
    const board = freshBoard();
    expect(reduceBoard(board, { type: "TOUCH_CARD", cardId: "nope" })).toEqual(
      board,
    );
  });
});

describe("boardReducer — card archive (TASK-18.1)", () => {
  it("archives a card: off the column, kept in board.cards", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ARCHIVE_CARD",
      cardId: "card-1",
    });
    expect(board.columns[0].cardIds).not.toContain("card-1");
    const card = board.cards["card-1"];
    expect(card).toBeDefined();
    expect(card.archivedAt).toBeGreaterThan(0);
    expect(card.activity?.at(-1)?.type).toBe("archived");
  });

  it("is a no-op when the card is already archived", () => {
    const once = reduceBoard(freshBoard(), {
      type: "ARCHIVE_CARD",
      cardId: "card-1",
    });
    expect(reduceBoard(once, { type: "ARCHIVE_CARD", cardId: "card-1" })).toBe(
      once,
    );
  });

  it("restores an archived card to the end of the picked column", () => {
    const archived = reduceBoard(freshBoard(), {
      type: "ARCHIVE_CARD",
      cardId: "card-1",
    });
    const restored = reduceBoard(archived, {
      type: "UNARCHIVE_CARD",
      cardId: "card-1",
      columnId: "col-done",
    });
    expect(restored.columns[2].cardIds).toContain("card-1");
    expect(restored.cards["card-1"].archivedAt).toBeUndefined();
    expect(restored.cards["card-1"].activity?.at(-1)?.type).toBe("unarchived");
  });

  it("is a no-op when restoring a card that is not archived", () => {
    const board = freshBoard();
    expect(
      reduceBoard(board, {
        type: "UNARCHIVE_CARD",
        cardId: "card-1",
        columnId: "col-done",
      }),
    ).toBe(board);
  });

  it("refuses a restore into a column at its WIP limit", () => {
    let board = reduceBoard(freshBoard(), {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-done",
      wipLimit: 1,
    });
    board = reduceBoard(board, { type: "ARCHIVE_CARD", cardId: "card-1" });
    // The archive dialog's own restore respects the limit (the UI shows the
    // full column disabled).
    expect(
      reduceBoard(board, {
        type: "UNARCHIVE_CARD",
        cardId: "card-1",
        columnId: "col-done",
      }),
    ).toBe(board);

    // The same command as an *undo* of the archive is never refused: the
    // card goes back where it was, limit or no limit.
    const undone = reduceBoard(board, {
      type: "UNARCHIVE_CARD",
      cardId: "card-1",
      columnId: "col-done",
      index: 0,
      inverse: true,
    });
    expect(undone.columns[2].cardIds).toEqual(["card-1", "card-3"]);
  });

  it("archives every card of a column in one step", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ARCHIVE_COLUMN_CARDS",
      columnId: "col-backlog",
      at: 555_000,
    });
    expect(board.columns[0].cardIds).toEqual([]);
    for (const id of ["card-1", "card-2", "card-6"]) {
      // One archive stamp for the whole command.
      expect(board.cards[id]?.archivedAt).toBe(555_000);
    }
    // Cards of other columns stay untouched.
    expect(board.columns[1].cardIds.length).toBeGreaterThan(0);
  });

  it("is a no-op for an empty or missing column", () => {
    const seed = freshBoard();
    const empty = reduceBoard(seed, {
      type: "ARCHIVE_COLUMN_CARDS",
      columnId: "col-backlog",
    });
    // Nothing to archive on a second pass — state identity preserved.
    expect(
      reduceBoard(empty, {
        type: "ARCHIVE_COLUMN_CARDS",
        columnId: "col-backlog",
      }),
    ).toBe(empty);
    expect(
      reduceBoard(seed, {
        type: "ARCHIVE_COLUMN_CARDS",
        columnId: "nope",
      }),
    ).toBe(seed);
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
    const next = reduceState(two, { type: "RESTORE_BOARD", board: restored });
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
    const next = reduceState([seed], {
      type: "IMPORT_BOARDS",
      boards: [imported],
    });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("board-imported");
  });
});

describe("boardReducer — checklists", () => {
  /** Add a checklist to card-1 and return the board with its id resolved. */
  function withChecklist(title = "Steps") {
    const board = reduceBoard(freshBoard(), {
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      title,
    });
    const checklist = board.cards["card-1"].checklists?.[0];
    expect(checklist).toBeDefined();
    return { board, checklistId: checklist!.id };
  }

  it("adds a checklist to a card", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      title: "  Steps  ",
    });
    expect(board.cards["card-1"].checklists).toHaveLength(1);
    expect(board.cards["card-1"].checklists?.[0].title).toBe("Steps");
    expect(board.cards["card-1"].checklists?.[0].items).toEqual([]);
  });

  it("does not mutate the source card", () => {
    const seed = freshBoard();
    const next = reduceBoard(seed, {
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      title: "Steps",
    });
    expect(seed.cards["card-1"].checklists).toBeUndefined();
    expect(next).not.toBe(seed);
  });

  it("rejects an empty checklist title", () => {
    const next = reduceBoard(freshBoard(), {
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      title: "   ",
    });
    expect(next.cards["card-1"].checklists).toBeUndefined();
  });

  it("ignores checklists for unknown cards", () => {
    const board = freshBoard();
    const next = reduceBoard(board, {
      type: "ADD_CHECKLIST",
      cardId: "no-such-card",
      title: "Steps",
    });
    expect(next).toBe(board);
  });

  it("renames a checklist", () => {
    const { board, checklistId } = withChecklist();
    const next = reduceBoard(board, {
      type: "RENAME_CHECKLIST",
      cardId: "card-1",
      checklistId,
      title: "Launch steps",
    });
    expect(next.cards["card-1"].checklists?.[0].title).toBe("Launch steps");
  });

  it("keeps the old title when the rename is empty", () => {
    const { board, checklistId } = withChecklist();
    const next = reduceBoard(board, {
      type: "RENAME_CHECKLIST",
      cardId: "card-1",
      checklistId,
      title: "   ",
    });
    expect(next.cards["card-1"].checklists?.[0].title).toBe("Steps");
  });

  it("deletes a checklist", () => {
    const { board, checklistId } = withChecklist();
    const next = reduceBoard(board, {
      type: "DELETE_CHECKLIST",
      cardId: "card-1",
      checklistId,
    });
    // The field is dropped entirely once the last checklist is gone.
    expect(next.cards["card-1"].checklists).toBeUndefined();
  });

  it("adds items and toggles them done", () => {
    const { board, checklistId } = withChecklist();
    const added = reduceBoard(board, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId,
      text: "Write docs",
    });
    const itemId = added.cards["card-1"].checklists?.[0].items[0].id ?? "";
    expect(added.cards["card-1"].checklists?.[0].items).toEqual([
      { id: itemId, text: "Write docs", done: false },
    ]);

    const toggled = reduceBoard(added, {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "card-1",
      checklistId,
      itemId,
      done: true,
    });
    expect(toggled.cards["card-1"].checklists?.[0].items[0].done).toBe(true);

    const untoggled = reduceBoard(toggled, {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "card-1",
      checklistId,
      itemId,
      done: false,
    });
    expect(untoggled.cards["card-1"].checklists?.[0].items[0].done).toBe(false);
  });

  it("rejects an empty item text and unknown checklists", () => {
    const { board, checklistId } = withChecklist();
    const empty = reduceBoard(board, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId,
      text: "  ",
    });
    expect(empty.cards["card-1"].checklists?.[0].items).toEqual([]);

    const unknown = reduceBoard(board, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId: "no-such-checklist",
      text: "Write docs",
    });
    expect(unknown.cards["card-1"].checklists?.[0].items).toEqual([]);
  });

  it("renames and deletes items", () => {
    const { board, checklistId } = withChecklist();
    const added = reduceBoard(board, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId,
      text: "Write docs",
    });
    const itemId = added.cards["card-1"].checklists?.[0].items[0].id ?? "";

    const renamed = reduceBoard(added, {
      type: "RENAME_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId,
      itemId,
      text: "Review docs",
    });
    expect(renamed.cards["card-1"].checklists?.[0].items[0].text).toBe(
      "Review docs",
    );

    // Empty rename keeps the old text.
    const empty = reduceBoard(renamed, {
      type: "RENAME_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId,
      itemId,
      text: "",
    });
    expect(empty.cards["card-1"].checklists?.[0].items[0].text).toBe(
      "Review docs",
    );

    const deleted = reduceBoard(renamed, {
      type: "DELETE_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId,
      itemId,
    });
    expect(deleted.cards["card-1"].checklists?.[0].items).toEqual([]);
  });

  it("checking an unknown item is a no-op", () => {
    const { board, checklistId } = withChecklist();
    const next = reduceBoard(board, {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "card-1",
      checklistId,
      itemId: "no-such-item",
      done: true,
    });
    expect(next.cards["card-1"]).toBe(board.cards["card-1"]);
  });
});

describe("boardReducer — due dates", () => {
  it("sets a due date and bumps the card's updatedAt", () => {
    const seed = freshBoard();
    const due = seed.cards["card-1"].createdAt + 86_400_000;
    const next = reduceBoard(seed, {
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate: due,
    });
    expect(next.cards["card-1"].dueDate).toBe(due);
    expect(next.cards["card-1"].updatedAt).toBeGreaterThanOrEqual(
      seed.cards["card-1"].updatedAt,
    );
  });

  it("clears the due date by dropping the field entirely", () => {
    const seed = freshBoard();
    const withDue = reduceBoard(seed, {
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate: 1234567890,
    });
    const cleared = reduceBoard(withDue, {
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate: undefined,
    });
    expect(cleared.cards["card-1"].dueDate).toBeUndefined();
    expect("dueDate" in cleared.cards["card-1"]).toBe(false);
  });

  it("setting the same due date is a no-op", () => {
    const seed = freshBoard();
    const due = 1234567890;
    const withDue = reduceBoard(seed, {
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate: due,
    });
    const again = reduceBoard(withDue, {
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate: due,
    });
    expect(again.cards["card-1"]).toBe(withDue.cards["card-1"]);
  });

  it("ignores unknown cards and non-finite timestamps", () => {
    const board = freshBoard();
    const unknown = reduceBoard(board, {
      type: "SET_CARD_DUE_DATE",
      cardId: "no-such-card",
      dueDate: 1234567890,
    });
    expect(unknown).toBe(board);

    const garbage = reduceBoard(board, {
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate: Number.NaN,
    });
    expect(garbage.cards["card-1"].dueDate).toBeUndefined();
    expect("dueDate" in garbage.cards["card-1"]).toBe(false);
  });
});

describe("boardReducer — covers", () => {
  it("sets a color cover and bumps the card's updatedAt", () => {
    const seed = freshBoard();
    const next = reduceBoard(seed, {
      type: "SET_CARD_COVER",
      cardId: "card-1",
      cover: { type: "color", value: "teal" },
    });
    expect(next.cards["card-1"].cover).toEqual({
      type: "color",
      value: "teal",
    });
    expect(next.cards["card-1"].updatedAt).toBeGreaterThanOrEqual(
      seed.cards["card-1"].updatedAt,
    );
  });

  it("replaces a color with a gradient", () => {
    const seed = freshBoard();
    const colored = reduceBoard(seed, {
      type: "SET_CARD_COVER",
      cardId: "card-1",
      cover: { type: "color", value: "red" },
    });
    const gradiented = reduceBoard(colored, {
      type: "SET_CARD_COVER",
      cardId: "card-1",
      cover: { type: "gradient", value: "sunset" },
    });
    expect(gradiented.cards["card-1"].cover).toEqual({
      type: "gradient",
      value: "sunset",
    });
  });

  it("clears the cover by dropping the field entirely", () => {
    const seed = freshBoard();
    const withCover = reduceBoard(seed, {
      type: "SET_CARD_COVER",
      cardId: "card-1",
      cover: { type: "gradient", value: "ocean" },
    });
    const cleared = reduceBoard(withCover, {
      type: "SET_CARD_COVER",
      cardId: "card-1",
      cover: undefined,
    });
    expect(cleared.cards["card-1"].cover).toBeUndefined();
    expect("cover" in cleared.cards["card-1"]).toBe(false);
  });

  it("setting the same cover is a no-op", () => {
    const seed = freshBoard();
    const withCover = reduceBoard(seed, {
      type: "SET_CARD_COVER",
      cardId: "card-1",
      cover: { type: "color", value: "blue" },
    });
    const again = reduceBoard(withCover, {
      type: "SET_CARD_COVER",
      cardId: "card-1",
      cover: { type: "color", value: "blue" },
    });
    expect(again.cards["card-1"]).toBe(withCover.cards["card-1"]);
  });

  it("ignores unknown cards and malformed covers", () => {
    const board = freshBoard();
    const unknown = reduceBoard(board, {
      type: "SET_CARD_COVER",
      cardId: "no-such-card",
      cover: { type: "color", value: "red" },
    });
    expect(unknown).toBe(board);

    const badType = reduceBoard(board, {
      type: "SET_CARD_COVER",
      cardId: "card-1",
      // @ts-expect-error — malformed payload from a hand-edited import.
      cover: { type: "image", value: "x" },
    });
    expect("cover" in badType.cards["card-1"]).toBe(false);

    const badValue = reduceBoard(board, {
      type: "SET_CARD_COVER",
      cardId: "card-1",
      // @ts-expect-error — malformed payload from a hand-edited import.
      cover: { type: "color", value: "chartreuse" },
    });
    expect("cover" in badValue.cards["card-1"]).toBe(false);
  });
});

describe("boardReducer — DUPLICATE_CARD", () => {
  it("duplicates a card right below the original with a copy title", () => {
    const seed = freshBoard();
    const next = reduceBoard(seed, {
      type: "DUPLICATE_CARD",
      cardId: "card-1",
      title: "Copy of card 1",
    });
    const column = next.columns.find((c) => c.id === "col-backlog")!;
    expect(column.cardIds).toHaveLength(4);
    expect(column.cardIds[1]).not.toBe("card-1");
    const copy = next.cards[column.cardIds[1]];
    expect(copy.title).toBe("Copy of card 1");
    // Content is copied, ids/timestamps are fresh.
    expect(copy.labelIds).toEqual(["label-design"]);
    expect(copy.id).not.toBe("card-1");
    expect(copy.createdAt).toBeGreaterThanOrEqual(
      seed.cards["card-1"].createdAt,
    );
    expect(copy.updatedAt).toBe(copy.createdAt);
    // The original is untouched.
    expect(next.cards["card-1"]).toEqual(seed.cards["card-1"]);
  });

  it("copies description, checklists, due date and cover", () => {
    const now = Date.now();
    const seed = freshBoard();
    seed.cards["card-1"] = {
      ...seed.cards["card-1"],
      description: "Some notes",
      checklists: [
        {
          id: "cl-1",
          title: "Steps",
          items: [{ id: "cli-1", text: "First", done: false }],
        },
      ],
      dueDate: now + 86_400_000,
      cover: { type: "color", value: "blue" },
    };
    const next = reduceBoard(seed, {
      type: "DUPLICATE_CARD",
      cardId: "card-1",
    });
    const column = next.columns.find((c) => c.cardIds.length === 4)!;
    const copy = next.cards[column.cardIds[1]];
    expect(copy.description).toBe("Some notes");
    expect(copy.checklists).toEqual(seed.cards["card-1"].checklists);
    expect(copy.dueDate).toBe(seed.cards["card-1"].dueDate);
    expect(copy.cover).toEqual({ type: "color", value: "blue" });
    // Nested structures must not alias the source card.
    expect(copy.checklists).not.toBe(seed.cards["card-1"].checklists);
  });

  it("keeps the source title when no copy title is provided", () => {
    const next = reduceBoard(freshBoard(), {
      type: "DUPLICATE_CARD",
      cardId: "card-1",
    });
    const column = next.columns.find((c) => c.id === "col-backlog")!;
    expect(next.cards[column.cardIds[1]].title).toBe(
      "Design the new onboarding flow",
    );
  });

  it("ignores unknown card ids", () => {
    const board = freshBoard();
    expect(reduceBoard(board, { type: "DUPLICATE_CARD", cardId: "nope" })).toBe(
      board,
    );
  });
});

describe("boardReducer — DUPLICATE_COLUMN", () => {
  it("duplicates a column with all cards placed to its right", () => {
    const seed = freshBoard();
    const next = reduceBoard(seed, {
      type: "DUPLICATE_COLUMN",
      columnId: "col-backlog",
      title: "Copy of Backlog",
    });
    expect(next.columns).toHaveLength(4);
    expect(next.columns[1].title).toBe("Copy of Backlog");
    expect(next.columns[1].id).not.toBe("col-backlog");
    // Every card is copied with a fresh id, same title and labels.
    const source = seed.columns[0];
    const copy = next.columns[1];
    expect(copy.cardIds).toHaveLength(source.cardIds.length);
    copy.cardIds.forEach((id, index) => {
      const sourceCard = seed.cards[source.cardIds[index]];
      const copied = next.cards[id];
      expect(copied.title).toBe(sourceCard.title);
      expect(copied.labelIds).toEqual(sourceCard.labelIds);
      expect(id).not.toBe(sourceCard.id);
    });
    // Original cards stay referenced by the original column only.
    expect(next.columns[0].cardIds).toEqual(["card-1", "card-2", "card-6"]);
  });

  it("ignores unknown column ids", () => {
    const board = freshBoard();
    expect(
      reduceBoard(board, { type: "DUPLICATE_COLUMN", columnId: "nope" }),
    ).toBe(board);
  });
});

describe("boardReducer — multi-board routing", () => {
  function secondBoard(): Board {
    return {
      ...freshBoard(),
      id: "board-2",
      title: "Second",
      columns: [],
      cards: {},
    };
  }

  it("routes a board-scoped action to the board with the matching boardId", () => {
    const first = freshBoard();
    const second = secondBoard();
    const next = reduceState([first, second], {
      type: "ADD_COLUMN",
      title: "Only on second",
      boardId: "board-2",
    });
    // First board untouched, second got the column.
    expect(next[0]).toBe(first);
    expect(next[1].columns.map((c) => c.title)).toEqual(["Only on second"]);
  });

  it("applies actions without boardId to the first board", () => {
    const first = freshBoard();
    const second = secondBoard();
    const next = reduceState([first, second], {
      type: "ADD_COLUMN",
      title: "On first",
    });
    expect(next[1]).toBe(second);
    expect(next[0].columns).toHaveLength(freshBoard().columns.length + 1);
  });

  it("ignores board-scoped actions with an unknown boardId", () => {
    const state = reduceState([freshBoard()], {
      type: "ADD_COLUMN",
      title: "Nowhere",
      boardId: "ghost",
    });
    expect(state).toHaveLength(1);
    expect(state[0].columns).toHaveLength(freshBoard().columns.length);
  });

  it("ADD_BOARD appends a board with a fresh id", () => {
    const board = secondBoard();
    const next = reduceState([freshBoard()], {
      type: "ADD_BOARD",
      board,
    });
    expect(next).toHaveLength(2);
    expect(next[1].id).toBe("board-2");
    expect(next[1].columns).toEqual([]);
  });

  it("ADD_BOARD ignores a duplicate board id", () => {
    const seed = freshBoard();
    const next = reduceState([seed], {
      type: "ADD_BOARD",
      board: { ...seed },
    });
    expect(next).toHaveLength(1);
  });

  it("REMOVE_BOARD removes the targeted board and keeps the rest", () => {
    const next = reduceState([freshBoard(), secondBoard()], {
      type: "REMOVE_BOARD",
      boardId: "board-2",
    });
    expect(next).toHaveLength(1);
    expect(next[0].id).not.toBe("board-2");
  });

  it("REMOVE_BOARD refuses to remove the last remaining board", () => {
    const seed = freshBoard();
    const next = reduceState([seed], {
      type: "REMOVE_BOARD",
      boardId: seed.id,
    });
    expect(next).toEqual([seed]);
  });

  it("ARCHIVE_BOARD sets archivedAt and keeps all board data", () => {
    const seed = freshBoard();
    const next = reduceState([seed], {
      type: "ARCHIVE_BOARD",
      boardId: seed.id,
    });
    expect(next[0].archivedAt).toBeGreaterThan(0);
    // Nothing was destroyed — the board content is untouched.
    expect(next[0].columns).toEqual(seed.columns);
    expect(next[0].cards).toEqual(seed.cards);
    expect(next[0].labels).toEqual(seed.labels);
  });

  it("ARCHIVE_BOARD is idempotent (does not move the timestamp)", () => {
    const seed = { ...freshBoard(), archivedAt: 42 };
    const next = reduceState([seed], {
      type: "ARCHIVE_BOARD",
      boardId: seed.id,
    });
    expect(next[0].archivedAt).toBe(42);
  });

  it("UNARCHIVE_BOARD clears archivedAt", () => {
    const seed = { ...freshBoard(), archivedAt: 42 };
    const next = reduceState([seed], {
      type: "UNARCHIVE_BOARD",
      boardId: seed.id,
    });
    expect(next[0].archivedAt).toBeUndefined();
    expect("archivedAt" in next[0]).toBe(false);
  });

  it("UNARCHIVE_BOARD on a non-archived board is a no-op", () => {
    const seed = freshBoard();
    const next = reduceState([seed], {
      type: "UNARCHIVE_BOARD",
      boardId: seed.id,
    });
    expect(next[0]).toEqual(seed);
  });

  it("RESTORE_BOARD restores the snapshot into the targeted board slot", () => {
    const first = freshBoard();
    const second = secondBoard();
    const snapshot = { ...second, title: "Restored" };
    const next = reduceState([first, second], {
      type: "RESTORE_BOARD",
      boardId: "board-2",
      board: snapshot,
    });
    expect(next[0]).toBe(first);
    expect(next[1].title).toBe("Restored");
  });
});

describe("boardReducer — SORT_COLUMN", () => {
  const { now } = { now: 1_700_000_000_000 };
  function card(
    id: string,
    title: string,
    createdAt: number,
    dueDate?: number,
  ) {
    return {
      id,
      title,
      labelIds: [] as string[],
      createdAt,
      updatedAt: createdAt,
      ...(dueDate !== undefined ? { dueDate } : {}),
    };
  }
  /** Board with one column holding cards c1..c3 in that (manual) order. */
  function seededBoard(): Board {
    return {
      ...freshBoard(),
      columns: [
        { id: "col-x", title: "X", cardIds: ["c1", "c2", "c3"], createdAt: 1 },
      ],
      cards: {
        c1: card("c1", "Banana", now + 300, now + 900),
        c2: card("c2", "apple", now + 100, now + 500),
        c3: card("c3", "Cherry", now + 200),
      },
      labels: [],
    };
  }

  it("sorts by title case-insensitively", () => {
    const next = reduceBoard(seededBoard(), {
      type: "SORT_COLUMN",
      columnId: "col-x",
      sortBy: "title",
    });
    expect(next.columns[0].cardIds).toEqual(["c2", "c1", "c3"]);
  });

  it("sorts by creation date ascending", () => {
    const next = reduceBoard(seededBoard(), {
      type: "SORT_COLUMN",
      columnId: "col-x",
      sortBy: "createdAt",
    });
    expect(next.columns[0].cardIds).toEqual(["c2", "c3", "c1"]);
  });

  it("sorts by due date and floats undated cards to the bottom", () => {
    const next = reduceBoard(seededBoard(), {
      type: "SORT_COLUMN",
      columnId: "col-x",
      sortBy: "dueDate",
    });
    // c2 (earliest) → c1 (later) → c3 (no date, last).
    expect(next.columns[0].cardIds).toEqual(["c2", "c1", "c3"]);
  });

  it("keeps cards when the column already matches the order", () => {
    const seed = seededBoard();
    const once = reduceBoard(seed, {
      type: "SORT_COLUMN",
      columnId: "col-x",
      sortBy: "title",
    });
    const twice = reduceBoard(once, {
      type: "SORT_COLUMN",
      columnId: "col-x",
      sortBy: "title",
    });
    expect(twice).toBe(once);
  });

  it("is undone by RESTORE_BOARD (part of per-board history)", () => {
    const seed = seededBoard();
    const sorted = reduceBoard(seed, {
      type: "SORT_COLUMN",
      columnId: "col-x",
      sortBy: "title",
    });
    expect(sorted.columns[0].cardIds).not.toEqual(seed.columns[0].cardIds);
    // The history snapshot mechanism stores the pre-sort board — restoring
    // it brings the manual order back.
    const restored = reduceState([sorted], {
      type: "RESTORE_BOARD",
      board: seed,
    })[0];
    expect(restored.columns[0].cardIds).toEqual(["c1", "c2", "c3"]);
  });

  it("does not touch other columns", () => {
    const seed = {
      ...seededBoard(),
      columns: [
        { id: "col-x", title: "X", cardIds: ["c1", "c2", "c3"], createdAt: 1 },
        { id: "col-y", title: "Y", cardIds: [], createdAt: 2 },
      ],
    };
    const next = reduceState([seed], {
      type: "SORT_COLUMN",
      columnId: "col-x",
      sortBy: "title",
    })[0];
    expect(next.columns[1]).toEqual(seed.columns[1]);
  });
});

describe("boardReducer — card activity (TASK-12)", () => {
  it("adds a 'created' event when a card is added", () => {
    const board = reduceBoard(freshBoard(), {
      type: "ADD_CARD",
      columnId: "col-backlog",
      title: "New card",
    });
    const card = Object.values(board.cards).find(
      (c) => c.title === "New card",
    )!;
    expect(card.activity).toHaveLength(1);
    expect(card.activity![0].type).toBe("created");
    expect(card.activity![0].actorId).toBeNull();
  });

  it("appends 'renamed' / 'description-changed' events on update", () => {
    const board = reduceBoard(freshBoard(), {
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: "Renamed",
      description: "New text",
    });
    const types = board.cards["card-1"].activity!.map((e) => e.type);
    expect(types).toEqual(["renamed", "description-changed"]);
  });

  it("does not append an event when nothing changed", () => {
    const seed = freshBoard();
    const same = reduceBoard(seed, {
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: seed.cards["card-1"].title,
    });
    expect(same.cards["card-1"].activity).toBeUndefined();
  });

  it("coalesces rapid same-type edits into one event", () => {
    let state = reduceState([freshBoard()], {
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: "First",
    });
    state = reduceState(state, {
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: "Second",
    });
    const activity = state[0].cards["card-1"].activity!;
    expect(activity).toHaveLength(1);
    expect(activity[0].type).toBe("renamed");
  });

  it("records label changes with a name snapshot", () => {
    // card-1 already wears "label-design" — attach one it doesn't have.
    const labelId = "label-dev";
    const added = reduceBoard(freshBoard(), {
      type: "SET_CARD_LABEL",
      cardId: "card-1",
      labelId,
      on: true,
    });
    const addEvent = added.cards["card-1"].activity!.at(-1)!;
    expect(addEvent.type).toBe("label-added");
    expect(addEvent.detail).toBe("Development");
    const removed = reduceBoard(added, {
      type: "SET_CARD_LABEL",
      cardId: "card-1",
      labelId,
      on: false,
    });
    expect(removed.cards["card-1"].activity!.at(-1)!.type).toBe(
      "label-removed",
    );
  });

  it("records due date set/remove", () => {
    const set = reduceBoard(freshBoard(), {
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate: 1700000000000,
    });
    expect(set.cards["card-1"].activity!.at(-1)!.type).toBe("due-date-set");
    const removed = reduceBoard(set, {
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
    });
    expect(removed.cards["card-1"].activity!.at(-1)!.type).toBe(
      "due-date-removed",
    );
  });

  it("records cross-column moves with the target column title, not reorders", () => {
    const moved = reduceBoard(freshBoard(), {
      type: "MOVE_CARD",
      cardId: "card-1",
      fromColumnId: "col-backlog",
      toColumnId: "col-progress",
      toIndex: 0,
    });
    const moveEvent = moved.cards["card-1"].activity!.at(-1)!;
    expect(moveEvent.type).toBe("moved");
    expect(moveEvent.detail).toBe("In Progress");
    const reordered = reduceBoard(freshBoard(), {
      type: "MOVE_CARD",
      cardId: "card-1",
      fromColumnId: "col-backlog",
      toColumnId: "col-backlog",
      toIndex: 1,
    });
    expect(reordered.cards["card-1"].activity).toBeUndefined();
  });

  it("duplicates start a fresh history", () => {
    const seed = freshBoard();
    const board = reduceBoard(seed, {
      type: "DUPLICATE_CARD",
      cardId: "card-1",
    });
    // The copy is the one card id the seed didn't have.
    const copyId = Object.keys(board.cards).find((id) => !(id in seed.cards))!;
    expect(board.cards[copyId].activity).toHaveLength(1);
    expect(board.cards[copyId].activity![0].type).toBe("created");
  });

  it("caps the feed at MAX_CARD_ACTIVITY events", async () => {
    const { MAX_CARD_ACTIVITY } = await import("@/types/kanban");
    let state = [freshBoard()];
    // Due-date flips are never coalesced — one distinct event per pass.
    for (let i = 0; i < MAX_CARD_ACTIVITY + 5; i++) {
      state = reduceState(state, {
        type: "SET_CARD_DUE_DATE",
        cardId: "card-1",
        dueDate: 1700000000000 + i,
      });
    }
    const activity = state[0].cards["card-1"].activity!;
    expect(activity).toHaveLength(MAX_CARD_ACTIVITY);
    expect(activity.at(-1)!.type).toBe("due-date-set");
  });
});

describe("boardReducer — input limits (TASK-20)", () => {
  const long = (n: number) => "x".repeat(n);

  it("clamps card titles to LIMITS.cardTitle", async () => {
    const { LIMITS } = await import("@/types/kanban");
    const board = reduceBoard(freshBoard(), {
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: long(LIMITS.cardTitle + 50),
    });
    expect(board.cards["card-1"].title).toHaveLength(LIMITS.cardTitle);
  });

  it("clamps card descriptions to LIMITS.description", async () => {
    const { LIMITS } = await import("@/types/kanban");
    const board = reduceBoard(freshBoard(), {
      type: "UPDATE_CARD",
      cardId: "card-1",
      description: long(LIMITS.description + 500),
    });
    expect(board.cards["card-1"].description).toHaveLength(LIMITS.description);
  });

  it("clamps and trims column titles; whitespace-only is a no-op", async () => {
    const { LIMITS } = await import("@/types/kanban");
    const board = reduceBoard(freshBoard(), {
      type: "RENAME_COLUMN",
      columnId: "col-backlog",
      title: `  ${long(LIMITS.columnTitle + 10)}  `,
    });
    expect(board.columns[0].title).toHaveLength(LIMITS.columnTitle);
    const unchanged = reduceBoard(freshBoard(), {
      type: "RENAME_COLUMN",
      columnId: "col-backlog",
      title: "   ",
    });
    expect(unchanged.columns[0].title).toBe("Backlog");
  });

  it("clamps label names on create and rename", async () => {
    const { LIMITS } = await import("@/types/kanban");
    const label = {
      id: "l-new",
      name: long(LIMITS.labelName + 20),
      color: "red" as const,
    };
    const board = reduceBoard(freshBoard(), { type: "ADD_LABEL", label });
    expect(board.labels.find((l) => l.id === "l-new")!.name).toHaveLength(
      LIMITS.labelName,
    );
  });

  it("clamps checklist item text", async () => {
    const { LIMITS } = await import("@/types/kanban");
    const seeded = reduceBoard(freshBoard(), {
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      title: "Steps",
    });
    const checklistId = seeded.cards["card-1"].checklists![0].id;
    const board = reduceBoard(seeded, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId,
      text: long(LIMITS.checklistItem + 30),
    });
    const checklist = board.cards["card-1"].checklists![0];
    expect(checklist.items.at(-1)!.text).toHaveLength(LIMITS.checklistItem);
  });
});

describe("boardReducer — collection limits (TASK-20)", () => {
  let LIMITS: (typeof import("@/types/kanban"))["LIMITS"];
  beforeAll(async () => {
    ({ LIMITS } = await import("@/types/kanban"));
  });

  it("refuses new checklists beyond LIMITS.checklistsPerCard", () => {
    let state = [freshBoard()];
    for (let i = 0; i < LIMITS.checklistsPerCard + 3; i++) {
      state = reduceState(state, {
        type: "ADD_CHECKLIST",
        cardId: "card-1",
        title: `Checklist ${i}`,
      });
    }
    expect(state[0].cards["card-1"].checklists).toHaveLength(
      LIMITS.checklistsPerCard,
    );
  });

  it("refuses new checklist items beyond LIMITS.itemsPerChecklist", () => {
    let state = reduceState([freshBoard()], {
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      title: "Steps",
    });
    const checklistId = state[0].cards["card-1"].checklists![0].id;
    for (let i = 0; i < LIMITS.itemsPerChecklist + 3; i++) {
      state = reduceState(state, {
        type: "ADD_CHECKLIST_ITEM",
        cardId: "card-1",
        checklistId,
        text: `Item ${i}`,
      });
    }
    expect(state[0].cards["card-1"].checklists![0].items).toHaveLength(
      LIMITS.itemsPerChecklist,
    );
  });

  it("refuses adding labels to a card beyond LIMITS.labelsPerCard", () => {
    // 25 board labels, then try to wear them all — the reducer stops at 20.
    let state = [freshBoard()];
    for (let i = 0; i < 25; i++) {
      state = reduceState(state, {
        type: "ADD_LABEL",
        label: { id: `extra-${i}`, name: `Extra ${i}`, color: "red" },
      });
    }
    for (const label of state[0].labels) {
      state = reduceState(state, {
        type: "SET_CARD_LABEL",
        cardId: "card-1",
        labelId: label.id,
        on: true,
      });
    }
    expect(state[0].cards["card-1"].labelIds).toHaveLength(
      LIMITS.labelsPerCard,
    );
  });

  it("refuses new labels on a board beyond LIMITS.labelsPerBoard", async () => {
    let state = [freshBoard()];
    const base = state[0].labels.length;
    for (let i = 0; i < 5; i++) {
      state = reduceState(state, {
        type: "ADD_LABEL",
        label: { id: `extra-${i}`, name: `Extra ${i}`, color: "red" },
      });
    }
    expect(state[0].labels.length).toBe(
      Math.min(
        base + 5,
        (await import("@/types/kanban")).LIMITS.labelsPerBoard,
      ),
    );
  });

  it("refuses new boards beyond LIMITS.boardsCount", async () => {
    const { LIMITS: L } = await import("@/types/kanban");
    let state = [freshBoard()];
    while (state.length < L.boardsCount) {
      state = reduceState(state, {
        type: "ADD_BOARD",
        board: {
          id: `b-${state.length}`,
          title: `Board ${state.length}`,
          columns: [],
          cards: {},
          labels: [],
          createdAt: 1,
          updatedAt: 1,
        },
      });
    }
    const next = reduceState(state, {
      type: "ADD_BOARD",
      board: {
        id: "overflow",
        title: "Overflow",
        columns: [],
        cards: {},
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    expect(next).toHaveLength(L.boardsCount);
  });
});

describe("boardReducer — SET_COLUMN_WIP_LIMIT (TASK-13)", () => {
  it("sets a limit and keeps the omit-when-unset invariant on clear", () => {
    const set = reduceBoard(freshBoard(), {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-backlog",
      wipLimit: 2,
    });
    expect(set.columns[0].wipLimit).toBe(2);

    const cleared = reduceBoard(set, {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-backlog",
    });
    expect(cleared.columns[0].wipLimit).toBeUndefined();
    expect("wipLimit" in cleared.columns[0]).toBe(false);
  });

  it("clamps out-of-range values into 1…LIMITS.wipLimitMax", () => {
    const board = reduceBoard(freshBoard(), {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-backlog",
      wipLimit: 10000,
    });
    expect(board.columns[0].wipLimit).toBe(LIMITS.wipLimitMax);

    const board2 = reduceBoard(freshBoard(), {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-backlog",
      wipLimit: -5,
    });
    expect(board2.columns[0].wipLimit).toBe(1);
  });

  it("is a no-op when the value or the column is unknown", () => {
    const seed = freshBoard();
    const board = reduceBoard(seed, {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "nope",
      wipLimit: 3,
    });
    expect(board).toBe(seed);
  });

  it("blocks ADD_CARD at the limit but allows it again after clearing", () => {
    let board = reduceBoard(freshBoard(), {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-done",
      wipLimit: 1,
    });
    const blocked = reduceBoard(board, {
      type: "ADD_CARD",
      columnId: "col-done",
      title: "One card too many",
    });
    expect(blocked.columns.find((c) => c.id === "col-done")?.cardIds).toEqual([
      "card-3",
    ]);

    board = reduceBoard(board, {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-done",
    });
    const allowed = reduceBoard(board, {
      type: "ADD_CARD",
      columnId: "col-done",
      title: "Fits now",
    });
    expect(
      allowed.columns.find((c) => c.id === "col-done")?.cardIds,
    ).toHaveLength(2);
  });

  it("blocks DUPLICATE_CARD at the limit", () => {
    const board = reduceBoard(freshBoard(), {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-done",
      wipLimit: 1,
    });
    const next = reduceBoard(board, {
      type: "DUPLICATE_CARD",
      cardId: "card-3",
    });
    expect(next.columns.find((c) => c.id === "col-done")?.cardIds).toHaveLength(
      1,
    );
  });

  it("blocks cross-column MOVE_CARD into a full column, allows within-column moves", () => {
    const board = reduceBoard(freshBoard(), {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-done",
      wipLimit: 1,
    });
    const blocked = reduceBoard(board, {
      type: "MOVE_CARD",
      cardId: "card-1",
      fromColumnId: "col-backlog",
      toColumnId: "col-done",
      toIndex: 1,
    });
    expect(blocked.columns.find((c) => c.id === "col-done")?.cardIds).toEqual([
      "card-3",
    ]);
    expect(
      blocked.columns.find((c) => c.id === "col-backlog")?.cardIds,
    ).toContain("card-1");

    const reordered = reduceBoard(board, {
      type: "MOVE_CARD",
      cardId: "card-1",
      fromColumnId: "col-backlog",
      toColumnId: "col-backlog",
      toIndex: 0,
    });
    expect(
      reordered.columns.find((c) => c.id === "col-backlog")?.cardIds[0],
    ).toBe("card-1");
  });

  it("keeps the limit on DUPLICATE_COLUMN", () => {
    const board = reduceBoard(freshBoard(), {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-done",
      wipLimit: 1,
    });
    const next = reduceBoard(board, {
      type: "DUPLICATE_COLUMN",
      columnId: "col-done",
      title: "Done copy",
    });
    const copy = next.columns.find((c) => c.title === "Done copy");
    expect(copy?.wipLimit).toBe(1);
    expect(copy?.cardIds).toHaveLength(1);
  });
});

/**
 * TASK-21.7b/c — the commands undo is built on: an absolute card order and
 * the restore family. The invariant that they actually invert their
 * counterparts lives in `invert.test.ts`; what matters here is that they
 * respect positions and the same guards as any other command.
 */
describe("boardReducer — explicit card order (TASK-21.7b)", () => {
  it("rewrites a column's order", () => {
    const board = reduceBoard(freshBoard(), {
      type: "SET_COLUMN_CARD_ORDER",
      columnId: "col-backlog",
      cardIds: ["card-6", "card-1", "card-2"],
    });
    expect(board.columns[0].cardIds).toEqual(["card-6", "card-1", "card-2"]);
  });

  it("ignores an order that is not a permutation of the column", () => {
    const board = freshBoard();
    for (const cardIds of [
      ["card-1", "card-2"], // one short
      ["card-1", "card-2", "card-6", "card-3"], // a foreign card
      ["card-1", "card-1", "card-2"], // a duplicate
    ]) {
      expect(
        reduceBoard(board, {
          type: "SET_COLUMN_CARD_ORDER",
          columnId: "col-backlog",
          cardIds,
        }),
      ).toBe(board);
    }
  });
});

describe("boardReducer — restore commands (TASK-21.7c)", () => {
  it("returns a deleted card to its exact position", () => {
    const seed = freshBoard();
    const card = seed.cards["card-1"];
    const deleted = reduceBoard(seed, {
      type: "DELETE_CARD",
      cardId: "card-1",
    });
    expect(deleted.cards["card-1"]).toBeUndefined();

    const restored = reduceBoard(deleted, {
      type: "RESTORE_CARD",
      card,
      columnId: "col-backlog",
      index: 0,
    });
    expect(restored.columns[0].cardIds).toEqual(seed.columns[0].cardIds);
    expect(restored.cards["card-1"]).toEqual(card);
  });

  it("returns an archived card that belonged to no column", () => {
    const seed = reduceBoard(freshBoard(), {
      type: "ARCHIVE_CARD",
      cardId: "card-1",
    });
    const card = seed.cards["card-1"];
    const deleted = reduceBoard(seed, {
      type: "DELETE_CARD",
      cardId: "card-1",
    });
    const restored = reduceBoard(deleted, { type: "RESTORE_CARD", card });
    expect(restored.cards["card-1"]).toEqual(card);
    expect(restored.columns.flatMap((c) => c.cardIds)).not.toContain("card-1");
  });

  it("returns a deleted column with its cards, at its old index", () => {
    const seed = freshBoard();
    const column = seed.columns[0];
    const cards = column.cardIds.map((id) => seed.cards[id]);
    const deleted = reduceBoard(seed, {
      type: "DELETE_COLUMN",
      columnId: column.id,
    });

    const restored = reduceBoard(deleted, {
      type: "RESTORE_COLUMN",
      column,
      index: 0,
      cards,
    });
    expect(restored.columns.map((c) => c.id)).toEqual(
      seed.columns.map((c) => c.id),
    );
    expect(restored.columns[0]).toEqual(column);
    for (const card of cards) expect(restored.cards[card.id]).toEqual(card);
  });

  it("returns a deleted label at its index and where it was worn", () => {
    const seed = freshBoard();
    const label = seed.labels[0]; // label-design, worn by card-1
    const deleted = reduceBoard(seed, {
      type: "DELETE_LABEL",
      labelId: label.id,
    });
    expect(deleted.cards["card-1"].labelIds).not.toContain(label.id);

    const restored = reduceBoard(deleted, {
      type: "RESTORE_LABEL",
      label,
      index: 0,
      assignments: [{ cardId: "card-1", index: 0 }],
    });
    expect(restored.labels[0]).toEqual(label);
    expect(restored.cards["card-1"].labelIds).toEqual(
      seed.cards["card-1"].labelIds,
    );
  });

  it("returns a deleted checklist and item to their positions", () => {
    let board = reduceBoard(freshBoard(), {
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      newChecklistId: "cl-1",
      title: "Steps",
    });
    board = reduceBoard(board, {
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      newChecklistId: "cl-2",
      title: "Later",
    });
    for (const [id, text] of [
      ["it-1", "First"],
      ["it-2", "Second"],
    ]) {
      board = reduceBoard(board, {
        type: "ADD_CHECKLIST_ITEM",
        cardId: "card-1",
        checklistId: "cl-1",
        newItemId: id,
        text,
      });
    }
    const checklists = board.cards["card-1"].checklists!;
    const first = checklists[0];

    const withoutItem = reduceBoard(board, {
      type: "DELETE_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId: "cl-1",
      itemId: "it-1",
    });
    const itemBack = reduceBoard(withoutItem, {
      type: "RESTORE_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId: "cl-1",
      item: first.items[0],
      index: 0,
    });
    expect(itemBack.cards["card-1"].checklists?.[0].items).toEqual(first.items);

    const withoutList = reduceBoard(board, {
      type: "DELETE_CHECKLIST",
      cardId: "card-1",
      checklistId: "cl-1",
    });
    const listBack = reduceBoard(withoutList, {
      type: "RESTORE_CHECKLIST",
      cardId: "card-1",
      checklist: first,
      index: 0,
    });
    expect(listBack.cards["card-1"].checklists).toEqual(checklists);
  });

  it("returns a bulk-archived column, keeping cards added since", () => {
    const seed = freshBoard();
    const column = seed.columns[0];
    const cards = column.cardIds.map((id) => seed.cards[id]);
    let board = reduceBoard(seed, {
      type: "ARCHIVE_COLUMN_CARDS",
      columnId: column.id,
    });
    board = reduceBoard(board, {
      type: "ADD_CARD",
      newCardId: "card-later",
      columnId: column.id,
      title: "Added after the archive",
    });

    const restored = reduceBoard(board, {
      type: "RESTORE_COLUMN_CARDS",
      columnId: column.id,
      cardIds: column.cardIds,
      cards,
    });
    // The archived cards come back in their old order; the newcomer keeps
    // its place at the end instead of being thrown away.
    expect(restored.columns[0].cardIds).toEqual([
      ...column.cardIds,
      "card-later",
    ]);
    for (const card of cards) expect(restored.cards[card.id]).toEqual(card);
  });

  it("refuses a card restore into a column at its WIP limit", () => {
    const board = reduceBoard(freshBoard(), {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: "col-done", // holds card-3
      wipLimit: 1,
    });
    const stranger: Card = {
      id: "card-stranger",
      title: "Stranger",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    expect(
      reduceBoard(board, {
        type: "RESTORE_CARD",
        card: stranger,
        columnId: "col-done",
        index: 0,
      }),
    ).toBe(board);

    // As an undo it goes through — a refused undo loses data for good,
    // a column briefly over its limit does not.
    const undone = reduceBoard(board, {
      type: "RESTORE_CARD",
      card: stranger,
      columnId: "col-done",
      index: 0,
      inverse: true,
    });
    expect(undone.columns[2].cardIds).toEqual(["card-stranger", "card-3"]);
  });

  it("refuses a card restore past LIMITS.cardsPerColumn", () => {
    const cardIds = Array.from(
      { length: LIMITS.cardsPerColumn },
      (_, i) => `p-${i}`,
    );
    const board: Board = {
      id: "b-packed",
      title: "Packed",
      columns: [{ id: "col-packed", title: "Packed", cardIds, createdAt: 1 }],
      cards: Object.fromEntries(
        cardIds.map((id) => [
          id,
          { id, title: id, labelIds: [], createdAt: 1, updatedAt: 1 },
        ]),
      ),
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const card: Card = {
      id: "one-too-many",
      title: "One too many",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    expect(
      reduceBoard(board, {
        type: "RESTORE_CARD",
        card,
        columnId: "col-packed",
        index: 0,
      }),
    ).toBe(board);

    // An undo still goes through: the guard bounds new content, and this
    // card was in the column a moment ago.
    const undone = reduceBoard(board, {
      type: "RESTORE_CARD",
      card,
      columnId: "col-packed",
      index: 0,
      inverse: true,
    });
    expect(undone.columns[0].cardIds).toHaveLength(LIMITS.cardsPerColumn + 1);
  });

  it("refuses a column restore past LIMITS.columnsPerBoard", () => {
    let state = [freshBoard()];
    while (state[0].columns.length < LIMITS.columnsPerBoard) {
      const before = state[0].columns.length;
      state = reduceState(state, {
        type: "ADD_COLUMN",
        title: `Extra ${before}`,
      });
      expect(state[0].columns.length).toBe(before + 1);
    }
    const board = state[0];
    const column = { id: "col-back", title: "Back", cardIds: [], createdAt: 1 };
    expect(
      reduceBoard(board, {
        type: "RESTORE_COLUMN",
        column,
        index: 0,
        cards: [],
      }),
    ).toBe(board);

    const undone = reduceBoard(board, {
      type: "RESTORE_COLUMN",
      column,
      index: 0,
      cards: [],
      inverse: true,
    });
    expect(undone.columns[0].id).toBe("col-back");
    expect(undone.columns).toHaveLength(LIMITS.columnsPerBoard + 1);
  });
});

describe("boardReducer — the activity feed is optional (TASK-21.7a)", () => {
  it("writes no feed at all when withActivity is false", () => {
    const seed = freshBoard();
    const state = boardReducer(
      [seed],
      stamp({
        type: "ADD_CARD",
        newCardId: "card-quiet",
        columnId: "col-done",
        title: "No feed",
      }),
      { withActivity: false },
    );
    // The backend derives card events from the command log (§7.4.1), so
    // the very same reducer must not produce an `activity` array there.
    expect(state[0].cards["card-quiet"]).not.toHaveProperty("activity");

    const renamed = boardReducer(
      state,
      stamp({ type: "UPDATE_CARD", cardId: "card-quiet", title: "Still none" }),
      { withActivity: false },
    );
    expect(renamed[0].cards["card-quiet"].activity).toBeUndefined();
    // With the default options the same command does record the event.
    const loud = reduceState(state, {
      type: "UPDATE_CARD",
      cardId: "card-quiet",
      title: "Recorded",
    });
    expect(loud[0].cards["card-quiet"].activity?.at(-1)?.type).toBe("renamed");
  });
});
