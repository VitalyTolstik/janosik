import type { Board, BoardAction } from "@/store/board-reducer";
import { invert } from "@/store/invert";

/**
 * Undo/redo history for a single board — a stack of *commands*, not of
 * board snapshots (TASK-21.7d).
 *
 * The provider keeps one `BoardHistory` per board id, so undo/redo always
 * operates on the active board only. Before a dispatched command changes
 * the board, the provider hands it here together with the board it is
 * about to change; the history pairs it with its inverse (`invert()`) and
 * keeps the two actions. Undo then hands back a command to dispatch —
 * a compensation that touches only what the original command touched.
 *
 * Why not snapshots: 50 steps × a full board is tens of megabytes of live
 * objects, and restoring one in a shared board erases every edit someone
 * else made in between. A command pair is a few hundred bytes and only
 * ever undoes its own change.
 *
 * Coalescing: consecutive UPDATE_CARD / TOUCH_CARD commands for the *same*
 * card collapse into a single step, so typing a long title (plus the
 * debounced quiet-edit commit) produces one undo, not one per keystroke.
 * The step keeps the *oldest* "before" and the *newest* "after", which is
 * exactly the whole typing session.
 */

/** One undoable step: what happened, and the command that takes it back. */
export interface HistoryEntry {
  /** The command as it was dispatched (redo re-sends it). */
  do: BoardAction;
  /** The command that undoes it, computed when it was still possible. */
  undo: BoardAction;
  /**
   * Set when another writer has since changed something this step touches:
   * undoing it would silently overwrite their work, so the step is skipped.
   * Groundwork for the shared board — nothing marks steps dead until
   * commands start arriving over SSE (TASK-29/30).
   */
  dead?: boolean;
}

/** Commands whose repeats for one card belong to a single undo step. */
function coalescibleCardId(action: BoardAction): string | null {
  return action.type === "UPDATE_CARD" || action.type === "TOUCH_CARD"
    ? action.cardId
    : null;
}

/**
 * The entities a command changes, as plain ids. Used to decide whether a
 * foreign command has invalidated a recorded step.
 */
function touchedIds(action: BoardAction): string[] {
  const ids: string[] = [];
  for (const key of [
    "cardId",
    "newCardId",
    "columnId",
    "toColumnId",
    "fromColumnId",
    "newColumnId",
    "labelId",
    "checklistId",
    "itemId",
  ] as const) {
    const value = (action as unknown as Record<string, unknown>)[key];
    if (typeof value === "string") ids.push(value);
  }
  return ids;
}

const DEFAULT_LIMIT = 50;

export class BoardHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private lastAction: BoardAction | null = null;

  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /**
   * Record a command that changed `before`. Returns `false` when the
   * command has no inverse and therefore no undo step (imports, board
   * bookkeeping).
   *
   * A foreign command (someone else's, arriving over SSE) never enters the
   * undo stack — undo must only take back the user's own work. It does
   * break the current coalescing run and marks every recorded step that
   * touches the same entity dead, since undoing those would now clobber
   * the other writer's change.
   */
  push(
    before: Board,
    action: BoardAction,
    options?: { foreign?: boolean },
  ): boolean {
    if (options?.foreign) {
      this.markDead(action);
      this.lastAction = null;
      // Someone else's command is not a step of *this* user's history, so
      // it leaves the redo stack alone.
      return false;
    }

    const undoAction = invert(before, action);
    if (undoAction === null) return false;

    const cardId = coalescibleCardId(action);
    const previous = this.past[this.past.length - 1];
    const coalesce =
      cardId !== null &&
      previous !== undefined &&
      this.lastAction !== null &&
      coalescibleCardId(this.lastAction) === cardId;

    if (coalesce && previous) {
      // Keep the oldest "before" (`previous.undo`), take the newest "after".
      previous.do = action;
      delete previous.dead;
    } else {
      this.past.push({ do: action, undo: undoAction });
      if (this.past.length > this.limit) this.past.shift();
    }

    // The user's own new step invalidates the redo stack.
    this.future = [];
    this.lastAction = action;
    return true;
  }

  /**
   * The command that undoes the last step, or `null` when there is none.
   * The caller dispatches it; if it turns out to change nothing (a limit
   * refuses the restore), `revertUndo()` puts the step back.
   */
  undo(): BoardAction | null {
    this.lastAction = null;
    for (;;) {
      const entry = this.past.pop();
      if (entry === undefined) return null;
      // A step someone else has overtaken is dropped, not applied.
      if (entry.dead) continue;
      this.future.push(entry);
      return entry.undo;
    }
  }

  /**
   * The command that re-applies the last undone step. It is the original
   * command verbatim — the caller gives it a fresh `commandId`, since the
   * old one is spent as an idempotency key.
   */
  redo(): BoardAction | null {
    this.lastAction = null;
    for (;;) {
      const entry = this.future.pop();
      if (entry === undefined) return null;
      if (entry.dead) continue;
      this.past.push(entry);
      return entry.do;
    }
  }

  /** Take back the last `undo()` — its command changed nothing. */
  revertUndo(): void {
    const entry = this.future.pop();
    if (entry !== undefined) this.past.push(entry);
  }

  /** Take back the last `redo()` — its command changed nothing. */
  revertRedo(): void {
    const entry = this.past.pop();
    if (entry !== undefined) this.future.push(entry);
  }

  canUndo(): boolean {
    return this.past.some((entry) => !entry.dead);
  }

  canRedo(): boolean {
    return this.future.some((entry) => !entry.dead);
  }

  /** Forget all history (e.g. after importing a different data set). */
  reset(): void {
    this.past = [];
    this.future = [];
    this.lastAction = null;
  }

  /** Recorded steps, oldest first — introspection for tests. */
  steps(): readonly HistoryEntry[] {
    return this.past;
  }

  /** Mark every step a foreign command has overtaken. */
  private markDead(action: BoardAction): void {
    const foreign = new Set(touchedIds(action));
    if (foreign.size === 0) return;
    for (const entry of [...this.past, ...this.future]) {
      if (touchedIds(entry.do).some((id) => foreign.has(id))) {
        entry.dead = true;
      }
    }
  }
}
