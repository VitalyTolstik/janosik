import type { Board, CardLinkType } from "../types/kanban";
import { CARD_LINK_TYPES } from "../types/kanban";

/**
 * The card-link invariants (TASK-46), in one place.
 *
 * A `CardLink` row is directional and lives on its source card. Three rules
 * govern it, and all three used to be re-implemented per consumer — the
 * reducer, the UI picker and the server's command guards each carried their
 * own copy of the same depth-first search. They are exported from here
 * instead, so a change to the rule cannot land on two of the three.
 *
 * The rules:
 * - a link row names a type the app knows (`isCardLinkType`);
 * - an unordered pair holds at most one link, whatever the direction or
 *   type (`linkPairKey`, `hasLinkedPair`);
 * - `blocks` edges must stay acyclic (`blocksReaches`).
 *
 * Every helper works on a `Board["cards"]` record so the client can call it
 * with local state and the server with a loaded aggregate.
 */

type Cards = Board["cards"];

/** Is `value` one of the link types this version of the app understands? */
export function isCardLinkType(value: unknown): value is CardLinkType {
  return (
    typeof value === "string" &&
    (CARD_LINK_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Canonical key of an unordered card pair — a pair can hold at most one
 * link, regardless of type or which end stores the row.
 */
export function linkPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Is the unordered pair {a, b} already linked, in either direction and of
 * any type? Dangling rows count: the pair is occupied until the row itself
 * is removed, which is also what the row cap assumes.
 */
export function hasLinkedPair(cards: Cards, a: string, b: string): boolean {
  const key = linkPairKey(a, b);
  for (const card of Object.values(cards)) {
    for (const link of card.links ?? []) {
      if (linkPairKey(card.id, link.targetCardId) === key) return true;
    }
  }
  return false;
}

/**
 * Is `goal` reachable from `start` over the existing `blocks` edges (each
 * card's outgoing links of that type)? Depth-first search — adding an edge
 * `start -blocks-> goal` closes a cycle exactly when this answers yes.
 * Deleted targets are skipped: a dangling row is legal and leads nowhere.
 */
export function blocksReaches(
  cards: Cards,
  start: string,
  goal: string,
): boolean {
  if (start === goal) return true;
  const stack = [start];
  const seen = new Set<string>([start]);
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const link of cards[current]?.links ?? []) {
      if (link.type !== "blocks") continue;
      if (link.targetCardId === goal) return true;
      if (!(link.targetCardId in cards) || seen.has(link.targetCardId)) {
        continue;
      }
      seen.add(link.targetCardId);
      stack.push(link.targetCardId);
    }
  }
  return false;
}

/**
 * Would adding a link of `linkType` from `fromCardId` to `targetCardId`
 * close a circular `blocks` dependency? The question every consumer really
 * asks — a non-`blocks` type can never close one.
 */
export function wouldCloseBlocksCycle(
  cards: Cards,
  fromCardId: string,
  targetCardId: string,
  linkType: CardLinkType,
): boolean {
  if (linkType !== "blocks") return false;
  return blocksReaches(cards, targetCardId, fromCardId);
}

/**
 * Ids of every card the given one already links with, in either direction.
 * Built in a single pass over the board so callers can test many candidates
 * without rescanning per candidate (the autocomplete's hot path).
 */
export function linkedNeighbourIds(cards: Cards, cardId: string): Set<string> {
  const neighbours = new Set<string>();
  for (const card of Object.values(cards)) {
    for (const link of card.links ?? []) {
      if (card.id === cardId) neighbours.add(link.targetCardId);
      else if (link.targetCardId === cardId) neighbours.add(card.id);
    }
  }
  return neighbours;
}
