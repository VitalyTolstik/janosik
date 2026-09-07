import { describe, expect, it } from "vitest";

import { BoardHistory } from "@/store/history";
import { initialBoardState, type BoardAction } from "@/store/board-reducer";

/**
 * Tests for the undo/redo history: snapshot push/pop, redo, coalescing of
 * consecutive UPDATE_CARD edits for the same card, the step limit and the
 * invalidation of the redo stack on a fresh action.
 */

function freshState() {
  return initialBoardState();
}

function updateCardAction(cardId: string, title: string): BoardAction {
  return { type: "UPDATE_CARD", cardId, title };
}

describe("BoardHistory", () => {
  it("undo returns the previously recorded state", () => {
    const history = new BoardHistory();
    const first = freshState();
    history.push(first, updateCardAction("card-1", "A"));
    const second = freshState();
    const undone = history.undo(second);
    expect(undone).toEqual(first);
  });

  it("redo re-applies the state that was undone", () => {
    const history = new BoardHistory();
    const first = freshState();
    history.push(first, updateCardAction("card-1", "A"));
    const second = freshState();
    const undone = history.undo(second);
    const redone = history.redo(undone ?? freshState());
    expect(redone).toEqual(second);
  });

  it("returns null when there is nothing to undo", () => {
    const history = new BoardHistory();
    expect(history.undo(freshState())).toBeNull();
    expect(history.canUndo()).toBe(false);
  });

  it("returns null when there is nothing to redo", () => {
    const history = new BoardHistory();
    expect(history.redo(freshState())).toBeNull();
    expect(history.canRedo()).toBe(false);
  });

  it("coalesces consecutive UPDATE_CARD edits for the same card", () => {
    const history = new BoardHistory();
    const first = freshState();
    history.push(first, updateCardAction("card-1", "T"));
    history.push(first, updateCardAction("card-1", "Ty"));
    history.push(first, updateCardAction("card-1", "Typ"));
    // One coalesced undo step for the whole typing session.
    expect(history.canUndo()).toBe(true);
    const undone = history.undo(freshState());
    expect(undone).toEqual(first);
    expect(history.canUndo()).toBe(false);
  });

  it("does not coalesce edits for different cards", () => {
    const history = new BoardHistory();
    const first = freshState();
    history.push(first, updateCardAction("card-1", "A"));
    history.push(first, updateCardAction("card-2", "B"));
    expect(history.canUndo()).toBe(true);
    history.undo(freshState());
    expect(history.canUndo()).toBe(true);
  });

  it("does not coalesce non-UPDATE_CARD actions", () => {
    const history = new BoardHistory();
    const first = freshState();
    history.push(first, updateCardAction("card-1", "A"));
    history.push(first, { type: "ADD_CARD", columnId: "col-done", title: "X" });
    history.undo(freshState());
    expect(history.canUndo()).toBe(true);
  });

  it("respects the step limit", () => {
    const history = new BoardHistory(3);
    const state = freshState();
    for (let i = 0; i < 5; i++) {
      history.push(state, updateCardAction("card-1", `T${i}`));
    }
    // Only 3 steps survive the limit.
    expect(history.canUndo()).toBe(true);
    history.undo(state);
    history.undo(state);
    history.undo(state);
    expect(history.canUndo()).toBe(false);
  });

  it("a fresh action clears the redo stack", () => {
    const history = new BoardHistory();
    const first = freshState();
    history.push(first, updateCardAction("card-1", "A"));
    const second = freshState();
    history.undo(second);
    expect(history.canRedo()).toBe(true);

    history.push(second, updateCardAction("card-2", "B"));
    expect(history.canRedo()).toBe(false);
  });

  it("reset forgets everything", () => {
    const history = new BoardHistory();
    history.push(freshState(), updateCardAction("card-1", "A"));
    history.reset();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});