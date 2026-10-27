/**
 * Board lookups the command actions need: a move command must name the card's
 * current column and index, and column reordering needs the column's index.
 * Reading the aggregate first keeps the tool layer honest about what the
 * command API expects.
 */

import type { Board, Column } from "@janosik/shared";

/** Where a card currently sits, or `null` when it is not on the board. */
export function findCardLocation(
  board: Board,
  cardId: string,
): { column: Column; index: number } | null {
  for (const column of board.columns) {
    const index = column.cardIds.indexOf(cardId);
    if (index !== -1) return { column, index };
  }
  return null;
}

/** Index of a column among the board's columns, or `-1`. */
export function findColumnIndex(board: Board, columnId: string): number {
  return board.columns.findIndex((column) => column.id === columnId);
}
