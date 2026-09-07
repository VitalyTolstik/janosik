import type { Board, Card } from "@/types/kanban";
import type { BoardState } from "@/store/board-reducer";

/**
 * Migration for boards saved by older versions of the app.
 *
 * v1 → v2: cards had a single `labelId: string | null`; now they carry
 * `labelIds: string[]`. Any persisted data (localStorage `janosik-boards`)
 * written before this change is normalized here so the rest of the app can
 * rely on the current shape.
 */

type LegacyCard = Card & { labelId?: unknown; labelIds?: unknown };

function toLabelIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === "string");
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
}

function normalizeCard(card: LegacyCard): Card {
  const { labelId, labelIds, ...rest } = card;
  return { ...rest, labelIds: toLabelIds(labelIds ?? labelId) };
}

export function normalizeBoard(board: Board): Board {
  return {
    ...board,
    cards: Object.fromEntries(
      Object.entries(board.cards).map(([id, card]) => [
        id,
        normalizeCard(card),
      ]),
    ),
  };
}

/** Normalize every board in the state array (no-op when already current). */
export function normalizeBoards(state: BoardState): BoardState {
  return state.map((board) => {
    const needsFix = Object.values(board.cards).some(
      (card) => !Array.isArray((card as LegacyCard).labelIds),
    );
    return needsFix ? normalizeBoard(board) : board;
  });
}
