import type { Board, BoardAction } from "@janosik/shared";
import { invert } from "@janosik/shared";

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
 * The step keeps the *oldest* "before" and the *newest* "after" (merged
 * field-wise, since redo replays one command); a touch only moves the
 * clock, and a touch with no run to join is not a step at all.
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
   * Marked by foreign commands (SSE, TASK-30) and by the focus refetch when
   * it finds server state the local board did not have (TASK-29).
   */
  dead?: boolean;
}

/** What a failed send could do about the step it recorded. */
export type RollbackOutcome =
  /** The step was the newest one and was removed; apply `undo` to revert. */
  | { kind: "reverted"; undo: BoardAction }
  /** The step is buried under newer commands — marked dead, nothing applied. */
  | { kind: "dead" }
  /** The command recorded no step (board-level, no inverse) — nothing to do. */
  | { kind: "none" };

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
  /** Dead steps skipped by undo/redo since the last `consumeSkippedDead()`. */
  private skippedDead = 0;

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
      this.markForeign(touchedIds(action));
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
      // A dead step stays dead: it was overtaken by someone else's edit
      // (SSE, TASK-29/30), so the new edit starts a fresh step rather than
      // resurrecting a range whose undo would clobber that edit.
      !previous.dead &&
      this.lastAction !== null &&
      coalescibleCardId(this.lastAction) === cardId;

    if (coalesce && previous) {
      // Keep the oldest "before" (`previous.undo`), take the newest "after".
      // The merge is field-wise: a run can carry a title edit and a
      // description edit, and redo replays a single command. A TOUCH_CARD
      // must not replace the text command at all — replaying it would redo
      // nothing visible (live bug, 2026-09-18) — so it only moves the clock.
      previous.do =
        action.type === "TOUCH_CARD"
          ? ({ ...previous.do, at: action.at } as BoardAction)
          : ({ ...previous.do, ...action } as BoardAction);
    } else if (action.type === "TOUCH_CARD") {
      // A touch with nothing to coalesce into is not a step: it would cost
      // an undo press that only moves a timestamp, and the debounced stamp
      // often lands right after an undo — recording it would wipe the redo
      // stack the user is about to use.
      this.lastAction = null;
      return false;
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
   * The caller dispatches it; if it turns out to change nothing (the entity
   * it touched is gone), `dropUndone()` throws the empty step away so the
   * next press reaches a step that does something.
   */
  undo(): BoardAction | null {
    this.lastAction = null;
    for (;;) {
      const entry = this.past.pop();
      if (entry === undefined) return null;
      // A step someone else has overtaken is dropped, not applied.
      if (entry.dead) {
        this.skippedDead += 1;
        continue;
      }
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
      if (entry.dead) {
        this.skippedDead += 1;
        continue;
      }
      this.past.push(entry);
      return entry.do;
    }
  }

  /**
   * Throw away the step the last `undo()` handed out: its command changed
   * nothing, so there is nothing to redo either. Keeping it would leave a
   * step in the stack that makes `Ctrl+Z` do nothing, press after press.
   */
  dropUndone(): void {
    this.future.pop();
  }

  /** Same for a `redo()` whose command changed nothing. */
  dropRedone(): void {
    this.past.pop();
  }

  /**
   * Take back the step a failed send recorded (TASK-29): the server never
   * stored the command, so undo/redo must not offer it. Only the newest step
   * can be reverted — the inverse was computed while the pre-command board
   * was at hand, so the caller can apply it to restore exact values. When
   * newer commands already sit on top, the step is only marked dead (its
   * optimistic change stays until the board reconciles with the server).
   */
  rollbackStep(action: BoardAction): RollbackOutcome {
    const commandId = (action as { commandId?: string }).commandId;
    const index = this.past.findIndex(
      (entry) =>
        entry.do === action ||
        (commandId !== undefined &&
          (entry.do as { commandId?: string }).commandId === commandId),
    );
    if (index === -1) return { kind: "none" };
    if (index !== this.past.length - 1) {
      this.past[index].dead = true;
      if (this.lastAction === this.past[index].do) this.lastAction = null;
      return { kind: "dead" };
    }
    const entry = this.past.splice(index, 1)[0];
    if (this.lastAction === entry.do) this.lastAction = null;
    return { kind: "reverted", undo: entry.undo };
  }

  /**
   * Put the last undone step back after its undo command never reached the
   * server: the optimistic revert is rolled back, so the stack must match.
   */
  restoreUndone(): void {
    const entry = this.future.pop();
    if (entry !== undefined) this.past.push(entry);
    this.lastAction = null;
  }

  /** Same for a `redo()` whose command the server refused. */
  restoreRedone(): void {
    const entry = this.past.pop();
    if (entry !== undefined) this.future.push(entry);
    this.lastAction = null;
  }

  /**
   * Mark every recorded step that touches any of `ids` dead — a foreign
   * change makes undoing those steps unsafe (§7.0 conflict policy). Called
   * by the focus refetch (TASK-29) and by foreign commands (SSE, TASK-30).
   */
  markForeign(ids: readonly string[]): void {
    const foreign = new Set(ids);
    if (foreign.size === 0) return;
    for (const entry of [...this.past, ...this.future]) {
      if (touchedIds(entry.do).some((id) => foreign.has(id))) {
        entry.dead = true;
      }
    }
    this.lastAction = null;
  }

  /** How many dead steps `undo()`/`redo()` skipped since the last call. */
  consumeSkippedDead(): number {
    const skipped = this.skippedDead;
    this.skippedDead = 0;
    return skipped;
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
    this.skippedDead = 0;
  }

  /** Recorded steps, oldest first — introspection for tests. */
  steps(): readonly HistoryEntry[] {
    return this.past;
  }
}
