import { LIMITS, type Column } from "@/types/kanban";

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
