import type { Board, Card } from "@janosik/shared";

/**
 * A board without per-card attribution (TASK-36).
 *
 * `Card.lastActorId` is a denormalized column written by the per-action
 * writers from the authenticated actor. The pure `boardReducer` knows no
 * actor, so the contract tests (`aggregate == boardReducer`) compare board
 * content with the field stripped and assert attribution explicitly in the
 * dedicated `attribution` suite. Nothing else is removed — writer drift on
 * every other field still fails the byte-equality.
 */
export function stripAttribution(board: Board): Board {
  const cards = Object.fromEntries(
    Object.entries(board.cards).map(([id, card]) => {
      const rest: Card = { ...card };
      delete rest.lastActorId;
      return [id, rest];
    }),
  );
  return { ...board, cards };
}
