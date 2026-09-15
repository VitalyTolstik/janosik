import { useCallback, useEffect, useRef, useState } from "react";

import type { Board, BoardAction } from "@/store/board-reducer";
import { BoardHistory } from "@/store/history";
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
}

interface Options {
  /** The board a command targets, as it stands right now. */
  getBoard: (boardId: string) => Board | undefined;
  /** The board undo/redo applies to (the URL's board). */
  getActiveBoardId: () => string | undefined;
  /** Sends a command through the provider's single state funnel. */
  apply: (action: BoardAction) => void;
}

export function useUndoHistory({
  getBoard,
  getActiveBoardId,
  apply,
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
   */
  const run = useCallback(
    (direction: "undo" | "redo") => {
      const boardId = getActiveBoardId();
      if (!boardId) return;
      const stack = historiesRef.current.get(boardId);
      if (!stack) return;
      for (;;) {
        const action = direction === "undo" ? stack.undo() : stack.redo();
        if (action === null) break;
        const before = getBoard(boardId);
        // Undo happens now, so its own clock is now; redo re-sends the
        // original command verbatim (same `at`, so the step is replayed
        // rather than re-dated). Both get a fresh idempotency key — the
        // original one is spent.
        apply({
          ...action,
          ...(direction === "undo" ? { at: Date.now() } : {}),
          commandId: createId(),
        } as BoardAction);
        if (before === undefined || getBoard(boardId) !== before) break;
        if (direction === "undo") stack.dropUndone();
        else stack.dropRedone();
      }
      sync();
    },
    [apply, getBoard, getActiveBoardId, sync],
  );

  const undo = useCallback(() => run("undo"), [run]);
  const redo = useCallback(() => run("redo"), [run]);

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

  return { canUndo, canRedo, record, undo, redo, drop, clear, sync };
}
