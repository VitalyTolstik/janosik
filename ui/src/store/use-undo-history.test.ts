import { act, fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Board, BoardAction } from "@janosik/shared";
import { useUndoHistory } from "@/store/use-undo-history";

/**
 * Tests for the undo/redo hook (T-1) — the last uncovered piece of the
 * undo core: the empty-step discard cycle (`run`), `drop`/`clear`, and the
 * keyboard shortcuts (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y) with the
 * editable-field guard.
 *
 * The hook does not own state; it dispatches through the `apply` funnel it
 * is given. These tests drive it with a mutable board and a configurable
 * `apply`, so "the command changed nothing" is simulated exactly.
 */

function makeBoard(title = "Alpha"): Board {
  return {
    id: "b-1",
    title,
    columns: [{ id: "col-1", title: "To do", cardIds: [], createdAt: 1 }],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

/** A RENAME_BOARD command as the provider dispatches it. */
function renameBoard(title: string, at: number): BoardAction {
  return { type: "RENAME_BOARD", boardId: "b-1", title, at };
}

/** An ADD_COLUMN command; its inverse is a DELETE_COLUMN. */
function addColumn(newColumnId: string, at: number): BoardAction {
  return {
    type: "ADD_COLUMN",
    boardId: "b-1",
    newColumnId,
    title: "New",
    at,
  };
}

/** A hook harness with a mutable board and an observable `apply`. */
function setup(
  applyImpl: (action: BoardAction, state: { current: Board }) => void,
) {
  const state = { current: makeBoard() };
  const apply = vi.fn((action: BoardAction) => applyImpl(action, state));
  const hook = renderHook(() =>
    useUndoHistory({
      getBoard: () => state.current,
      getActiveBoardId: () => "b-1",
      apply,
    }),
  );
  return { ...hook, apply, state };
}

describe("useUndoHistory — empty-step discard (T-1)", () => {
  it("drops a step whose command changed nothing and undoes the next one", () => {
    const { result, apply, state } = setup((action, current) => {
      // The inverse of ADD_COLUMN is DELETE_COLUMN. Simulate a column that
      // is already gone: the reducer returns the same board, so the step
      // turns out empty and must be discarded — not swallowed.
      if (action.type === "DELETE_COLUMN") return;
      current.current = { ...current.current, title: "Undone" };
    });

    act(() => {
      // Step 1: an inverse that does change the board.
      result.current.record("b-1", state.current, renameBoard("First", 1));
      // Step 2 (recorded last, so it is undone first): the empty one.
      result.current.record("b-1", state.current, addColumn("col-new", 2));
    });
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());

    // One press, two dispatches: the empty inverse first (discarded), then
    // the real one — Ctrl+Z is never swallowed by the empty step.
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0][0]).toMatchObject({ type: "DELETE_COLUMN" });
    expect(apply.mock.calls[1][0]).toMatchObject({ type: "RENAME_BOARD" });
    expect(state.current.title).toBe("Undone");
    // The discarded step is gone from both stacks; the real one can redo.
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it("does nothing when there is no history for the active board", () => {
    const { result, apply } = setup((_action, current) => {
      current.current = { ...current.current, title: "Changed" };
    });

    act(() => result.current.undo());
    act(() => result.current.redo());

    expect(apply).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});

describe("useUndoHistory — drop and clear (T-1)", () => {
  it("drop() forgets only the given board's history", () => {
    const { result, apply, state } = setup((_action, current) => {
      current.current = { ...current.current, title: "Changed" };
    });

    act(() => result.current.record("b-1", state.current, renameBoard("B", 1)));
    expect(result.current.canUndo).toBe(true);

    // Another board's history is unrelated to the active one.
    act(() => result.current.drop("b-2"));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.drop("b-1"));
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.undo());
    expect(apply).not.toHaveBeenCalled();
  });

  it("clear() forgets every board's history", () => {
    const { result, state } = setup((_action, current) => {
      current.current = { ...current.current, title: "Changed" };
    });

    act(() => result.current.record("b-1", state.current, renameBoard("B", 1)));
    act(() => result.current.record("b-2", state.current, renameBoard("C", 2)));
    // Only b-1 is active, but both stacks exist; `clear` wipes them all.
    act(() => result.current.drop("b-1"));
    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.record("b-1", state.current, renameBoard("D", 3));
      result.current.clear();
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});

describe("useUndoHistory — keyboard shortcuts (T-1)", () => {
  function setupHotkeys() {
    return setup((_action, current) => {
      current.current = {
        ...current.current,
        updatedAt: current.current.updatedAt + 1,
      };
    });
  }

  it("undoes on Ctrl+Z and Cmd+Z", () => {
    const { result, apply, state } = setupHotkeys();
    act(() => result.current.record("b-1", state.current, renameBoard("B", 1)));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.canRedo).toBe(true);

    // Redo, then unfold again with the macOS Cmd modifier.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(apply).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it("redoes on Ctrl+Shift+Z and Ctrl+Y", () => {
    const { result, apply, state } = setupHotkeys();
    act(() => result.current.record("b-1", state.current, renameBoard("B", 1)));

    act(() => result.current.undo());
    expect(apply).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(result.current.canRedo).toBe(false);

    act(() => result.current.undo());
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(apply).toHaveBeenCalledTimes(4);
  });

  it("ignores the shortcuts while typing in an editable field", () => {
    const { result, apply, state } = setupHotkeys();
    act(() => result.current.record("b-1", state.current, renameBoard("B", 1)));

    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    document.body.append(input, textarea);

    const before = apply.mock.calls.length;
    // Native text undo takes over inside an editable field.
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });
    fireEvent.keyDown(textarea, { key: "z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(input, { key: "y", ctrlKey: true });
    expect(apply.mock.calls.length).toBe(before);
    // The history is still intact — a later real Ctrl+Z works.
    expect(result.current.canUndo).toBe(true);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(apply.mock.calls.length).toBe(before + 1);

    input.remove();
    textarea.remove();
  });

  it("ignores keys pressed without Ctrl or Cmd", () => {
    const { result, apply, state } = setupHotkeys();
    act(() => result.current.record("b-1", state.current, renameBoard("B", 1)));

    fireEvent.keyDown(window, { key: "z" });
    fireEvent.keyDown(window, { key: "Z", shiftKey: true });
    expect(apply).not.toHaveBeenCalled();
  });

  it("is a no-op on an unmounted hook (listener removed)", () => {
    const { result, apply, state, unmount } = setupHotkeys();
    act(() => result.current.record("b-1", state.current, renameBoard("B", 1)));

    unmount();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("useUndoHistory — overlapping presses in server mode", () => {
  it("serializes undo runs: the next press waits for the previous answer", async () => {
    const { boardReducer } = await import("@janosik/shared");
    const state = { current: makeBoard() };
    const apply = (action: BoardAction) => {
      state.current = boardReducer([state.current], action)[0] ?? state.current;
    };
    const answers: Array<(ok: boolean) => void> = [];
    const sent: BoardAction[] = [];
    const send = vi.fn(
      (_boardId: string, action: BoardAction) =>
        new Promise<
          | { ok: true; versions: Record<string, number>; seq: number }
          | { ok: false; failure: { kind: "offline" } }
        >((resolve) => {
          sent.push(action);
          answers.push((ok) =>
            resolve(
              ok
                ? { ok: true, versions: {}, seq: answers.length }
                : { ok: false, failure: { kind: "offline" } },
            ),
          );
        }),
    );
    const { result } = renderHook(() =>
      useUndoHistory({
        getBoard: () => state.current,
        getActiveBoardId: () => "b-1",
        apply,
        send,
      }),
    );

    act(() => {
      const first = renameBoard("First", 1);
      const before1 = state.current;
      apply(first);
      result.current.record("b-1", before1, first);
      const second = renameBoard("Second", 2);
      const before2 = state.current;
      apply(second);
      result.current.record("b-1", before2, second);
    });

    // Two presses back to back (key repeat): the second must not pop and
    // send while the first is still unanswered.
    act(() => {
      result.current.undo();
      result.current.undo();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.current.title).toBe("First");

    // The first undo is refused: it is reverted and its step goes back on
    // top — only then does the second press run, against the right stack.
    await act(async () => {
      answers[0](false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent[1]).toMatchObject({ type: "RENAME_BOARD", title: "First" });
    await act(async () => {
      answers[1](true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(state.current.title).toBe("First");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
  });
});
