/**
 * Read projections (TASK-157, E16). A card description may now be 64k
 * characters, so an agent that only needs ids, status and badges — a swarm
 * scanning a board for work — must be able to skip the heavy per-card payload.
 * `summarizeBoard` returns the same board skeleton with a lean card projection
 * (no description, checklists, links or activity); the description is replaced
 * by a size hint, so the caller still learns a card *has* a document.
 */

import {
  DEFAULT_CARD_PRIORITY,
  type Board,
  type Card,
  type CardPriority,
  type Label,
} from "@janosik/shared";

/** A card without its document: identity, status and size hints only. */
export interface CardSummary {
  id: string;
  title: string;
  columnId: string;
  priority: CardPriority;
  assigneeId: string | null;
  dueDate: number | null;
  claimedBy: string | null;
  leaseUntil: number | null;
  labelIds: string[];
  archived: boolean;
  /** True when the card carries a description (its text is omitted). */
  hasDescription: boolean;
  /** Characters in the description — a size hint without the payload. */
  descriptionChars: number;
  checklist: { done: number; total: number };
  /** True when a live, non-archived card holds a `blocks` link to this one. */
  blocked: boolean;
}

/** A board read without the per-card documents. */
export interface BoardSummary {
  id: string;
  title: string;
  columns: Array<{
    id: string;
    title: string;
    cardIds: string[];
    wipLimit?: number;
  }>;
  cards: Record<string, CardSummary>;
  labels: Label[];
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

/** Ids of every card that a live `blocks` link points at (TASK-46). */
export function blockedIds(board: Board): Set<string> {
  const blocked = new Set<string>();
  for (const card of Object.values(board.cards)) {
    if (card.archivedAt !== undefined || !card.links) continue;
    for (const link of card.links) {
      if (link.type === "blocks") blocked.add(link.targetCardId);
    }
  }
  return blocked;
}

function checklistProgress(card: Card): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const list of card.checklists ?? []) {
    for (const item of list.items) {
      total += 1;
      if (item.done) done += 1;
    }
  }
  return { done, total };
}

/** Project one card; `columnId` is the column the caller read it from. */
export function summarizeCard(
  card: Card,
  columnId: string,
  blocked: Set<string>,
): CardSummary {
  return {
    id: card.id,
    title: card.title,
    columnId,
    priority: card.priority ?? DEFAULT_CARD_PRIORITY,
    assigneeId: card.assigneeId ?? null,
    dueDate: card.dueDate ?? null,
    claimedBy: card.claimedBy ?? null,
    leaseUntil: card.leaseUntil ?? null,
    labelIds: card.labelIds,
    archived: card.archivedAt !== undefined,
    hasDescription: (card.description?.length ?? 0) > 0,
    descriptionChars: card.description?.length ?? 0,
    checklist: checklistProgress(card),
    blocked: blocked.has(card.id),
  };
}

/** Project a whole board read. */
export function summarizeBoard(board: Board): BoardSummary {
  const blocked = blockedIds(board);
  const columnOf = new Map<string, string>();
  for (const column of board.columns) {
    for (const cardId of column.cardIds) columnOf.set(cardId, column.id);
  }
  const cards: Record<string, CardSummary> = {};
  for (const [id, card] of Object.entries(board.cards)) {
    cards[id] = summarizeCard(card, columnOf.get(id) ?? "", blocked);
  }
  return {
    id: board.id,
    title: board.title,
    columns: board.columns.map((column) => ({
      id: column.id,
      title: column.title,
      cardIds: column.cardIds,
      ...(column.wipLimit !== undefined ? { wipLimit: column.wipLimit } : {}),
    })),
    cards,
    labels: board.labels,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    ...(board.archivedAt !== undefined ? { archivedAt: board.archivedAt } : {}),
  };
}
