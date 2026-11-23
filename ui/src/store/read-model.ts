import type {
  Board,
  BoardCardDetailDto,
  BoardCardSummaryDto,
  BoardReadColumnDto,
  BoardReadSummaryDto,
  Card,
} from "@janosik/shared";

/**
 * TASK-200.9 read-model adapters.
 *
 * The server's summary/page DTOs deliberately omit description bodies,
 * checklists and links. A summary card therefore carries a small
 * `readModel` metadata object (counts + `detailLoaded: false`) in the same
 * normalized `Card` slot the rest of the UI already understands. Opening the
 * dialog or asking for an undo preimage replaces it with the full card from
 * `GET /boards/:id/cards/:cardId`.
 */

/** True when every detail field of the card is already in the store. */
export function hasCardDetail(card: Card | undefined): boolean {
  return (
    card !== undefined &&
    (card.readModel === undefined || card.readModel.detailLoaded)
  );
}

/** Convert one summary/page card to the frontend model. */
export function cardFromSummary(dto: BoardCardSummaryDto): Card {
  return {
    id: dto.id,
    title: dto.title,
    ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate } : {}),
    ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
    ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
    ...(dto.claimedBy !== undefined ? { claimedBy: dto.claimedBy } : {}),
    ...(dto.claimedByTokenId !== undefined
      ? { claimedByTokenId: dto.claimedByTokenId }
      : {}),
    ...(dto.claimedBySessionId !== undefined
      ? { claimedBySessionId: dto.claimedBySessionId }
      : {}),
    ...(dto.leaseUntil !== undefined ? { leaseUntil: dto.leaseUntil } : {}),
    ...(dto.cover !== undefined ? { cover: dto.cover } : {}),
    labelIds: [...dto.labelIds],
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    ...(dto.lastActorId !== undefined ? { lastActorId: dto.lastActorId } : {}),
    ...(dto.attachmentCount !== undefined
      ? { attachmentCount: dto.attachmentCount }
      : {}),
    ...(dto.archivedAt !== undefined
      ? {
          archivedAt: dto.archivedAt,
          ...(dto.archivedFromColumnId !== undefined
            ? { archivedFromColumnId: dto.archivedFromColumnId }
            : {}),
        }
      : {}),
    readModel: {
      descriptionChars: dto.descriptionChars,
      checklistItemCount: dto.checklistItemCount,
      checklistDoneCount: dto.checklistDoneCount,
      linkCount: dto.linkCount,
      blocked: dto.blocked,
      detailLoaded: false,
    },
  };
}

/** Convert a full-detail response to the frontend model. */
export function cardFromDetail(dto: BoardCardDetailDto): Card {
  const card = dto.card;
  const items = (card.checklists ?? []).flatMap((checklist) => checklist.items);
  return {
    ...card,
    readModel: {
      descriptionChars: (card.description ?? "").length,
      checklistItemCount: items.length,
      checklistDoneCount: items.filter((item) => item.done).length,
      linkCount: dto.linkCount,
      blocked: dto.blocked,
      detailLoaded: true,
    },
  };
}

/**
 * Build the normalized board from a summary, merging detail the store
 * already has. `previous` keeps an open dialog's full card (and any other
 * loaded detail) alive across a refetch; cards missing from the summary's
 * complete id sets are dropped as deleted.
 */
export function boardFromSummary(
  summary: BoardReadSummaryDto,
  previous?: Board,
): Board {
  const meta = summary.board;
  const pageCards = new Map<string, BoardCardSummaryDto>();
  for (const column of summary.columns) {
    for (const card of column.cards) pageCards.set(card.id, card);
  }
  for (const card of summary.archivedCards) pageCards.set(card.id, card);
  const allIds = new Set<string>([
    ...summary.columns.flatMap((column) => column.cardIds),
    ...summary.archivedCardIds,
  ]);

  const cards: Board["cards"] = {};
  for (const id of allIds) {
    const incoming = pageCards.get(id);
    const existing = previous?.cards[id];
    if (incoming === undefined) {
      if (existing !== undefined) cards[id] = existing;
      continue;
    }
    if (
      existing !== undefined &&
      hasCardDetail(existing) &&
      existing.updatedAt >= incoming.updatedAt
    ) {
      cards[id] = existing;
      continue;
    }
    cards[id] = cardFromSummary(incoming);
  }

  return {
    id: meta.id,
    title: meta.title,
    columns: summary.columns.map(toColumn),
    cards,
    labels: summary.labels.map((label) => ({ ...label })),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    ...(meta.columnStyle !== undefined
      ? { columnStyle: meta.columnStyle }
      : {}),
    ...(meta.workflow !== undefined ? { workflow: meta.workflow } : {}),
    ...(meta.workflowInvalid === true ? { workflowInvalid: true } : {}),
    ...(meta.agentPolicy !== undefined
      ? { agentPolicy: meta.agentPolicy }
      : {}),
    ...(meta.agentsPausedAt !== undefined
      ? {
          agentsPausedAt: meta.agentsPausedAt,
          ...(meta.agentsPausedBy !== undefined
            ? { agentsPausedBy: meta.agentsPausedBy }
            : {}),
          ...(meta.agentsPauseReason !== undefined
            ? { agentsPauseReason: meta.agentsPauseReason }
            : {}),
        }
      : {}),
    ...(meta.archivedAt !== undefined ? { archivedAt: meta.archivedAt } : {}),
    ...(summary.archivedCardIds.length > 0
      ? { archivedCardIds: [...summary.archivedCardIds] }
      : {}),
  };
}

function toColumn(column: BoardReadColumnDto): Board["columns"][number] {
  return {
    id: column.id,
    title: column.title,
    cardIds: [...column.cardIds],
    ...(column.wipLimit !== null ? { wipLimit: column.wipLimit } : {}),
    ...(column.accent !== undefined ? { accent: column.accent } : {}),
    createdAt: column.createdAt,
  };
}
