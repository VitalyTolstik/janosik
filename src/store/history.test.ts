import { describe, expect, it } from "vitest";

import { BoardHistory } from "@/store/history";
import {
  boardReducer,
  initialBoardState,
  type BoardAction,
  type Board,
} from "@/store/board-reducer";
import { MAX_CARD_ACTIVITY } from "@/types/kanban";

/**
 * Tests for the undo/redo history after TASK-21.7d: it keeps command pairs
 * (`{do, undo}`) instead of board snapshots. What is asserted here is the
 * bookkeeping — which command comes back out, coalescing, the step limit,
 * the redo stack, foreign commands and the memory promise. That the
 * commands themselves undo what they did is `invert.test.ts`'s job.
 */

const AT = 1_700_000_000_000;

function freshBoard(): Board {
  // A single board (history is per board, not per array).
  return initialBoardState()[0];
}

function apply(board: Board, action: BoardAction): Board {
  return boardReducer([board], action)[0];
}

function updateCard(
  cardId: string,
  title: string,
  extra?: { quiet?: boolean },
): BoardAction {
  return { type: "UPDATE_CARD", cardId, title, at: AT, ...extra };
}

describe("BoardHistory", () => {
  it("hands back the inverse command of the last step", () => {
    const history = new BoardHistory();
    const before = freshBoard();
    const original = before.cards["card-1"].title;

    history.push(before, updateCard("card-1", "Renamed"));

    const undo = history.undo();
    expect(undo).toMatchObject({
      type: "UPDATE_CARD",
      cardId: "card-1",
      title: original,
    });
  });

  it("undo then redo walks the board back and forward", () => {
    const history = new BoardHistory();
    const before = freshBoard();
    const command = updateCard("card-1", "Renamed");

    history.push(before, command);
    const after = apply(before, command);
    expect(after.cards["card-1"].title).toBe("Renamed");

    const undone = apply(after, history.undo()!);
    expect(undone.cards["card-1"].title).toBe(before.cards["card-1"].title);

    // Redo re-sends the original command, so the same edit lands again.
    const redone = apply(undone, history.redo()!);
    expect(redone.cards["card-1"].title).toBe("Renamed");
  });

  it("redo re-sends the original command verbatim", () => {
    const history = new BoardHistory();
    const command = updateCard("card-1", "Renamed");
    history.push(freshBoard(), command);
    history.undo();
    expect(history.redo()).toEqual(command);
  });

  it("returns null when there is nothing to undo or redo", () => {
    const history = new BoardHistory();
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("refuses a command that has no inverse", () => {
    const history = new BoardHistory();
    const recorded = history.push(freshBoard(), {
      type: "IMPORT_BOARDS",
      boards: [freshBoard()],
    });
    expect(recorded).toBe(false);
    expect(history.canUndo()).toBe(false);
  });

  it("coalesces consecutive UPDATE_CARD edits for the same card", () => {
    const history = new BoardHistory();
    const before = freshBoard();
    const original = before.cards["card-1"].title;

    // One typing session: three keystrokes, each pushed with the board it
    // found — the step must keep the *first* board's title as its undo.
    let board = before;
    for (const title of ["T", "Ty", "Typ"]) {
      const command = updateCard("card-1", title);
      history.push(board, command);
      board = apply(board, command);
    }

    expect(history.steps()).toHaveLength(1);
    const undone = apply(board, history.undo()!);
    expect(undone.cards["card-1"].title).toBe(original);
    expect(history.canUndo()).toBe(false);
  });

  it("coalesces the debounced TOUCH_CARD into the editing step", () => {
    const history = new BoardHistory();
    const board = freshBoard();
    history.push(board, updateCard("card-1", "T"));
    history.push(board, updateCard("card-1", "Ty", { quiet: true }));
    history.push(board, { type: "TOUCH_CARD", cardId: "card-1", at: AT });
    expect(history.steps()).toHaveLength(1);
  });

  it("does not coalesce edits for different cards", () => {
    const history = new BoardHistory();
    const board = freshBoard();
    history.push(board, updateCard("card-1", "A"));
    history.push(board, updateCard("card-2", "B"));
    expect(history.steps()).toHaveLength(2);
  });

  it("does not coalesce non-UPDATE_CARD commands", () => {
    const history = new BoardHistory();
    const board = freshBoard();
    history.push(board, updateCard("card-1", "A"));
    history.push(board, {
      type: "ADD_CARD",
      newCardId: "c-new",
      columnId: "col-done",
      title: "X",
      at: AT,
    });
    expect(history.steps()).toHaveLength(2);
  });

  it("respects the step limit", () => {
    const history = new BoardHistory(3);
    const board = freshBoard();
    for (let i = 0; i < 5; i++) {
      // Alternate cards so nothing coalesces.
      history.push(
        board,
        updateCard(i % 2 === 0 ? "card-1" : "card-2", `T${i}`),
      );
    }
    expect(history.steps()).toHaveLength(3);
  });

  it("a fresh step of the user's own clears the redo stack", () => {
    const history = new BoardHistory();
    const board = freshBoard();
    history.push(board, updateCard("card-1", "A"));
    history.undo();
    expect(history.canRedo()).toBe(true);

    history.push(board, updateCard("card-2", "B"));
    expect(history.canRedo()).toBe(false);
  });

  it("reset forgets everything", () => {
    const history = new BoardHistory();
    history.push(freshBoard(), updateCard("card-1", "A"));
    history.reset();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("dropUndone throws away a step whose command changed nothing", () => {
    const history = new BoardHistory();
    const board = freshBoard();
    history.push(board, updateCard("card-1", "A"));
    history.push(board, updateCard("card-2", "B"));

    // The step came out and turned out to be empty: it must not go back to
    // either stack, or Ctrl+Z would keep landing on it and do nothing.
    history.undo();
    history.dropUndone();
    expect(history.canRedo()).toBe(false);
    // The step below it is still there and still undoable.
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toMatchObject({ cardId: "card-1" });
  });

  /**
   * Groundwork for the shared board (TASK-29/30): a command that is not the
   * user's own must never become one of *their* undo steps, must not wipe
   * their redo stack, and invalidates the steps it has overtaken.
   */
  describe("foreign commands", () => {
    it("never enter the undo stack and leave redo alone", () => {
      const history = new BoardHistory();
      const board = freshBoard();
      history.push(board, updateCard("card-1", "Mine"));
      history.undo();
      expect(history.canRedo()).toBe(true);

      const recorded = history.push(board, updateCard("card-2", "Theirs"), {
        foreign: true,
      });
      expect(recorded).toBe(false);
      expect(history.canUndo()).toBe(false);
      // Someone else's edit is not a reason to drop the user's redo.
      expect(history.canRedo()).toBe(true);
    });

    it("mark a step dead when they touch the same entity", () => {
      const history = new BoardHistory();
      const board = freshBoard();
      history.push(board, updateCard("card-1", "Mine"));
      history.push(board, updateCard("card-2", "Also mine"));

      history.push(board, updateCard("card-2", "Theirs"), { foreign: true });

      // The overtaken step is skipped; the untouched one still undoes.
      expect(history.canUndo()).toBe(true);
      expect(history.undo()).toMatchObject({ cardId: "card-1" });
      expect(history.canUndo()).toBe(false);
    });

    it("break the coalescing run", () => {
      const history = new BoardHistory();
      const board = freshBoard();
      history.push(board, updateCard("card-1", "T"));
      history.push(board, updateCard("card-9", "Theirs"), { foreign: true });
      history.push(board, updateCard("card-1", "Ty"));
      // Two steps: the foreign command ended the typing session.
      expect(history.steps()).toHaveLength(2);
    });

    it("never revive a dead step — a new edit starts a fresh one", () => {
      const history = new BoardHistory();
      const board = freshBoard();
      history.push(board, updateCard("card-1", "T"));
      history.push(board, updateCard("card-1", "Theirs"), { foreign: true });
      history.push(board, updateCard("card-1", "Ty"));

      // A fresh second step, not the dead one extended.
      expect(history.steps()).toHaveLength(2);
      // Undo skips the dead step and lands on the new one — the undo of
      // the fresh step (harness feeds one static `before`, so the base
      // title comes back), not the dead step's command.
      expect(history.canUndo()).toBe(true);
      expect(history.undo()).toMatchObject({
        title: "Design the new onboarding flow",
      });
      expect(history.canUndo()).toBe(false);
    });
  });

  it("keeps commands, not boards — 50 steps stay in kilobytes", () => {
    const history = new BoardHistory();
    const board = freshBoard();
    for (let i = 0; i < 50; i++) {
      history.push(board, {
        type: "RENAME_COLUMN",
        columnId: i % 2 === 0 ? "col-backlog" : "col-done",
        title: `Title ${i}`,
        at: AT + i,
      });
    }
    expect(history.steps()).toHaveLength(50);
    for (const step of history.steps()) {
      // No step carries a board: no `columns`/`cards` pair anywhere in it.
      expect(step.do).not.toHaveProperty("columns");
      expect(step.undo).not.toHaveProperty("columns");
      expect(step.do).not.toHaveProperty("board");
      expect(step.undo).not.toHaveProperty("board");
    }
    const bytes = JSON.stringify(history.steps()).length;
    // A single seed board serializes to more than this on its own.
    expect(bytes).toBeLessThan(20_000);
  });

  it("stays in kilobytes even in the worst case for a card's feed", () => {
    // The heaviest step there is: a card command whose inverse carries the
    // card's activity feed back, on a card whose feed is already full, with
    // the types alternating so nothing coalesces into one step.
    const card = {
      id: "card-1",
      title: "Card",
      labelIds: [] as string[],
      createdAt: 1,
      updatedAt: 1,
      activity: Array.from({ length: MAX_CARD_ACTIVITY }, (_, i) => ({
        id: `ev-${i}`,
        type: "renamed" as const,
        at: 1000 + i,
        actorId: null,
      })),
    };
    let board: Board = {
      id: "b-1",
      title: "Board",
      columns: [
        { id: "col-1", title: "Column", cardIds: ["card-1"], createdAt: 1 },
      ],
      cards: { "card-1": card },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const history = new BoardHistory();
    for (let i = 0; i < 50; i++) {
      const at = 2_000_000 + i * 5000;
      const action: BoardAction =
        i % 2 === 0
          ? { type: "SET_CARD_DUE_DATE", cardId: "card-1", dueDate: at, at }
          : { type: "UPDATE_CARD", cardId: "card-1", title: `T${i}`, at };
      history.push(board, action);
      board = boardReducer([board], action)[0];
    }
    expect(history.steps()).toHaveLength(50);
    // Measured: ~167 KB. Fifty snapshots of a large board would be tens of
    // megabytes — that is the whole point of keeping commands instead.
    expect(JSON.stringify(history.steps()).length).toBeLessThan(300_000);
  });
});
