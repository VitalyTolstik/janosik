import { useCallback } from "react";

import type { Card, Column } from "@/types/kanban";

const NO_CARDS: Card[] = [];

/**
 * Last list handed out per column, so an unchanged column keeps its array.
 *
 * Keyed by the **column object**: the reducer replaces `board.cards` on
 * every card edit but leaves `board.columns` alone, so a column object
 * survives edits to its cards and is replaced exactly when its own order
 * changes (a card added, moved, removed, the column renamed). One slot per
 * column is enough — a column renders one list per pass.
 */
const CACHE = new WeakMap<Column, { key: string; list: Card[] }>();

function resolve(
  column: Column,
  cardIds: string[],
  cards: Record<string, Card>,
): Card[] {
  if (cardIds.length === 0) return NO_CARDS;
  const key = cardIds.join(" ");
  const next = cardIds
    .map((cardId) => cards[cardId])
    .filter((card): card is Card => card !== undefined);
  const cached = CACHE.get(column);
  // Same ids and the very same card objects — hand back the previous array
  // so `memo` on the column holds when the edit was somewhere else.
  if (
    cached &&
    cached.key === key &&
    cached.list.length === next.length &&
    cached.list.every((card, i) => card === next[i])
  ) {
    return cached.list;
  }
  CACHE.set(column, { key, list: next });
  return next;
}

/**
 * Resolves a column's card ids into `Card` objects, returning the *same*
 * array while neither the ids nor the cards themselves change (TASK-21.4.1).
 *
 * That identity is what lets `ColumnView` be memoized: the board object is
 * replaced on every keystroke, so a column that looks up cards from the
 * store itself can never skip a render — one edit anywhere re-renders every
 * column, and with it every insert zone, menu and dialog inside them.
 */
export function useCardList(
  cards: Record<string, Card>,
): (column: Column, cardIds: string[]) => Card[] {
  return useCallback(
    (column: Column, cardIds: string[]) => resolve(column, cardIds, cards),
    [cards],
  );
}
