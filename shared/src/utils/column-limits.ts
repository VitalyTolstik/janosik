import { LIMITS, type Column } from "../types/kanban";

/**
 * Whether the column cannot take another card: the hard `cardsPerColumn`
 * limit, or its own WIP limit is reached. The reducer refuses the add
 * either way — the UI disables its entry points up front instead of
 * letting the user type into a composer that will silently do nothing.
 */
export function isColumnFull(
  column: Pick<Column, "cardIds" | "wipLimit">,
): boolean {
  return (
    column.cardIds.length >= LIMITS.cardsPerColumn ||
    (column.wipLimit !== undefined && column.cardIds.length >= column.wipLimit)
  );
}

/**
 * The single WIP-refusal predicate shared by the client and the future
 * backend (§7.4): a column refuses a new card (add/duplicate/move in) once
 * that card would push it past its WIP limit. A column already over its
 * limit — limit lowered under the current count, undo, import — refuses
 * everything new. The hard `cardsPerColumn` cap lives in `isColumnFull`.
 */
export function atWipLimit(column: Column, isMovingIn: boolean): boolean {
  if (column.wipLimit === undefined) return false;
  const count = column.cardIds.length + (isMovingIn ? 1 : 0);
  return count > column.wipLimit;
}
