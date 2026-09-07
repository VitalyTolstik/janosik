import type { BoardAction, BoardState } from "@/store/board-reducer";

/**
 * Undo/redo history built on top of the pure reducer.
 *
 * Before a dispatched action mutates the state, the provider hands the
 * current state to `push`, and `undo`/`redo` hand back complete snapshots
 * that the reducer restores verbatim.
 *
 * Coalescing: consecutive UPDATE_CARD actions for the *same* card collapse
 * into a single history step, so typing a long title produces one undo,
 * not one per keystroke.
 */

const DEFAULT_LIMIT = 50;

export class BoardHistory {
  private past: BoardState[] = [];
  private future: BoardState[] = [];
  private lastAction: BoardAction | null = null;

  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /** Record the state that `action` is about to replace. */
  push(previous: BoardState, action: BoardAction): void {
    const coalesce =
      this.lastAction !== null &&
      this.lastAction.type === "UPDATE_CARD" &&
      action.type === "UPDATE_CARD" &&
      this.lastAction.cardId === action.cardId;

    if (!coalesce) {
      this.past.push(previous);
      if (this.past.length > this.limit) this.past.shift();
    }

    // A fresh step invalidates the redo stack.
    this.future = [];
    this.lastAction = action;
  }

  /** Revert to the last recorded state; returns null when there is none. */
  undo(current: BoardState): BoardState | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(current);
    this.lastAction = null;
    return previous;
  }

  /** Re-apply the state that was undone; returns null when there is none. */
  redo(current: BoardState): BoardState | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    this.lastAction = null;
    return next;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Forget all history (e.g. after importing a different data set). */
  reset(): void {
    this.past = [];
    this.future = [];
    this.lastAction = null;
  }
}