import { useCallback, useEffect, useRef, useState } from "react";

import type { Board, BoardAction } from "@janosik/shared";
import { invert } from "@janosik/shared";
import { BoardHistory, type RollbackOutcome } from "@/store/history";
import type { SendFailure, SendOutcome } from "@/store/server-sync";
import { createId } from "@/utils/id";

/**
 * Undo/redo wiring, one stack per board (TASK-21.7d — extracted from
 * `BoardContext` so the provider is left with state, persistence and
 * routing; §7.5 wants this seam in place before the collaborative store
 * lands).
 *
 * The hook owns the stacks, the two availability flags the header renders,
 * and the keyboard shortcuts. It does not own state: it dispatches through
 * the `apply` funnel it is given, exactly like a user command, so undo
 * goes through the same reducer, persistence and backup path.
 */

export interface UndoHistory {
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Record a command that changed `before`. Skip commands that changed
   * nothing — a no-op must not cost the user an undo press.
   */
  record: (
    boardId: string,
    before: Board,
    action: BoardAction,
    options?: { foreign?: boolean },
  ) => void;
  undo: () => void;
  redo: () => void;
  /** Forget one board's history (the board is gone). */
  drop: (boardId: string) => void;
  /** Forget every history (a new data set replaced everything). */
  clear: () => void;
  /** Re-publish availability — the active board changed. */
  sync: () => void;
  /**
   * Take back a step whose command the server refused (TASK-29): the
   * opposite side (`undo` inside `do`) is returned for the caller to apply,
   * or the step is only marked dead when newer commands sit on top.
   */
  rollback: (boardId: string, action: BoardAction) => RollbackOutcome;
  /**
   * Mark steps invalidated by a foreign change (focus refetch, TASK-29) —
   * undo will skip them instead of clobbering the other writer's edit.
   */
  markForeign: (boardId: string, ids: readonly string[]) => void;
}

interface Options {
  /** The board a command targets, as it stands right now. */
  getBoard: (boardId: string) => Board | undefined;
  /** The board undo/redo applies to (the URL's board). */
  getActiveBoardId: () => string | undefined;
  /** Sends a command through the provider's single state funnel. */
  apply: (action: BoardAction) => void;
  /** Server send for undo/redo commands; absent in local mode. */
  send?: (boardId: string, action: BoardAction) => Promise<SendOutcome>;
  /** Called when an undo/redo command failed on the server (toast hook). */
  onSendFailed?: (failure: SendFailure) => void;
  /** Called when undo skipped steps a foreign change had overtaken. */
  onForeignSkipped?: () => void;
}

export function useUndoHistory({
  getBoard,
  getActiveBoardId,
  apply,
  send,
  onSendFailed,
  onForeignSkipped,
}: Options): UndoHistory {
  // One undo/redo stack per board; created lazily, dropped on remove/import.
  const historiesRef = useRef(new Map<string, BoardHistory>());

  // Undo availability, mirrored into state: `BoardHistory` is mutable, so
  // reading it during render would be both impure and invisible to React.
  // Every mutation path calls `sync()` right after touching a stack.
  // Two booleans rather than one object: React compares primitives, so an
  // unchanged flag bails out exactly and the context value above keeps its
  // identity. (An updater returning a fresh object is re-run by React —
  // eagerly and again while rendering — and each fresh object counts as a
  // change, costing the header an extra render on every flip.)
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const sync = useCallback(() => {
    const boardId = getActiveBoardId();
    const stack = boardId ? historiesRef.current.get(boardId) : undefined;
    setCanUndo(stack?.canUndo() ?? false);
    setCanRedo(stack?.canRedo() ?? false);
  }, [getActiveBoardId]);

  const stackFor = useCallback((boardId: string): BoardHistory => {
    let stack = historiesRef.current.get(boardId);
    if (!stack) {
      stack = new BoardHistory();
      historiesRef.current.set(boardId, stack);
    }
    return stack;
  }, []);

  const record = useCallback<UndoHistory["record"]>(
    (boardId, before, action, options) => {
      stackFor(boardId).push(before, action, options);
      sync();
    },
    [stackFor, sync],
  );

  /**
   * Dispatch one side of a step, and keep going until the board actually
   * changes: a press of Ctrl+Z either undoes something visible or there is
   * genuinely nothing left to undo. A step can only turn out empty when the
   * thing it touched is gone (limits never refuse an inverse — see
   * `BoardScopedAction.inverse`), and such a step is worth nothing to
   * anybody, so it is dropped rather than left to swallow the next press.
   *
   * On the server (TASK-29) the command is sent after the optimistic apply;
   * a refusal reverts the apply (the inverse of the inverse is the original
   * command, computed against the pre-apply board), puts the stack entry
   * back where it came from and reports the failure for a toast — undo/redo
   * silently succeeding locally while the server rejected it would desync
   * the board.
   */
  const run = useCallback(
    (direction: "undo" | "redo") => {
      const boardId = getActiveBoardId();
      if (!boardId) return;
      const stack = historiesRef.current.get(boardId);
      if (!stack) return;
      void (async () => {
        for (;;) {
          const action = direction === "undo" ? stack.undo() : stack.redo();
          if (action === null) break;
          const before = getBoard(boardId);
          // Undo happens now, so its own clock is now; redo re-sends the
          // original command verbatim (same `at`, so the step is replayed
          // rather than re-dated). Both get a fresh idempotency key — the
          // original one is spent.
          const applied = {
            ...action,
            ...(direction === "undo" ? { at: Date.now() } : {}),
            commandId: createId(),
          } as BoardAction;
          apply(applied);
          if (before !== undefined && getBoard(boardId) !== before) {
            if (send !== undefined) {
              const outcome = await send(boardId, applied);
              if (!outcome.ok) {
                const revert = invert(before, applied);
                if (revert !== null) apply(revert);
                if (direction === "undo") stack.restoreUndone();
                else stack.restoreRedone();
                onSendFailed?.(outcome.failure);
                sync();
                return;
              }
            }
            break;
          }
          if (direction === "undo") stack.dropUndone();
          else stack.dropRedone();
        }
        // Skipping happens when a foreign change overtook a step: the user
        // gets told why Ctrl+Z skipped their edit instead of undoing it.
        if (stack.consumeSkippedDead() > 0) onForeignSkipped?.();
        sync();
      })();
    },
    [
      apply,
      getBoard,
      getActiveBoardId,
      sync,
      send,
      onSendFailed,
      onForeignSkipped,
    ],
  );

  const undo = useCallback(() => run("undo"), [run]);
  const redo = useCallback(() => run("redo"), [run]);

  const rollback = useCallback(
    (boardId: string, action: BoardAction): RollbackOutcome => {
      const outcome = stackFor(boardId).rollbackStep(action);
      // The step is gone: the header's undo button must not offer it.
      sync();
      return outcome;
    },
    [stackFor, sync],
  );

  const markForeign = useCallback(
    (boardId: string, ids: readonly string[]) => {
      historiesRef.current.get(boardId)?.markForeign(ids);
      sync();
    },
    [sync],
  );

  const drop = useCallback(
    (boardId: string) => {
      historiesRef.current.delete(boardId);
      sync();
    },
    [sync],
  );

  const clear = useCallback(() => {
    historiesRef.current.clear();
    sync();
  }, [sync]);

  // Hotkeys: Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl+Y redo. Skip while the
  // user is typing inside an editable field (native text undo takes over).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return {
    canUndo,
    canRedo,
    record,
    undo,
    redo,
    drop,
    clear,
    sync,
    rollback,
    markForeign,
  };
}
