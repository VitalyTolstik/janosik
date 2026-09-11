import type { Board, BoardAction } from "@/store/board-reducer";

/**
 * Undo/redo history for a single board, built on top of the pure reducer.
 *
 * The provider keeps one `BoardHistory` per board id, so undo/redo always
 * operates on the active board only. Before a dispatched action mutates the
 * board, the provider hands the current board to `push`, and `undo`/`redo`
 * hand back complete board snapshots that the reducer restores verbatim.
 *
 * Coalescing: consecutive UPDATE_CARD actions for the *same* card collapse
 * into a single history step, so typing a long title produces one undo,
 * not one per keystroke.
 */

const DEFAULT_LIMIT = 50;

export class BoardHistory {
  private past: Board[] = [];
  private future: Board[] = [];
  private lastAction: BoardAction | null = null;

  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /** Record the board that `action` is about to replace. */
  push(previous: Board, action: BoardAction): void {
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
  undo(current: Board): Board | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(current);
    this.lastAction = null;
    return previous;
  }

  /** Re-apply the state that was undone; returns null when there is none. */
  redo(current: Board): Board | null {
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
