import type {
  Board,
  BoardCardDetailDto,
  BoardCardSummaryDto,
  BoardReadColumnDto,
  BoardReadSummaryDto,
  Card,
  Epic,
  EpicProgress,
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

// Keep the authoritative rollup while the card pages are still arriving,
// without embedding read metadata in the portable board model.
const summaryProgress = new WeakMap<
  Epic[],
  ReadonlyMap<string, EpicProgress>
>();

export function epicSummaryProgress(
  epics: Epic[],
): ReadonlyMap<string, EpicProgress> | undefined {
  return summaryProgress.get(epics);
}

/** True when every detail field of the card is already in the store. */
export function hasCardDetail(card: Card | undefined): boolean {
  return (
    card !== undefined &&
    (card.readModel === undefined || card.readModel.detailLoaded)
  );
}

/**
 * Own-property card lookup. Card ids can arrive from `?card=` (deep links) or
 * a command payload; a bare `cards[id]` would resolve `constructor` or
 * `__proto__` to a function/object and make an unknown id look loaded.
 */
export function cardById(
  cards: Board["cards"] | undefined,
  cardId: string | null | undefined,
): Card | undefined {
  if (cards === undefined || cardId === null || cardId === undefined) {
    return undefined;
  }
  return Object.hasOwn(cards, cardId) ? cards[cardId] : undefined;
}

/**
 * Description presence for a card face. A detail-loaded card uses the real
 * body so clearing it immediately removes the badge; a summary uses the
 * server counter without downloading the text.
 */
export function cardHasDescription(card: Card): boolean {
  if (card.readModel?.detailLoaded === true) {
    return Boolean(card.description?.trim());
  }
  if (card.readModel !== undefined) return card.readModel.descriptionChars > 0;
  return Boolean(card.description?.trim());
}

/** Checklist progress for a card face/table cell. */
export function cardChecklistProgress(card: Card): {
  done: number;
  total: number;
} {
  if (card.readModel?.detailLoaded !== true && card.readModel !== undefined) {
    return {
      done: card.readModel.checklistDoneCount,
      total: card.readModel.checklistItemCount,
    };
  }
  const items = (card.checklists ?? []).flatMap((list) => list.items);
  return {
    done: items.filter((item) => item.done).length,
    total: items.length,
  };
}

/** Convert one summary/page card to the frontend model. */
export function cardFromSummary(dto: BoardCardSummaryDto): Card {
  return {
    id: dto.id,
    title: dto.title,
    ...(dto.epicId !== undefined ? { epicId: dto.epicId } : {}),
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
    ...(dto.incomingLinks !== undefined && dto.incomingLinks.length > 0
      ? { incomingLinks: dto.incomingLinks.map((link) => ({ ...link })) }
      : {}),
    readModel: {
      descriptionChars: (card.description ?? "").length,
      checklistItemCount: items.length,
      checklistDoneCount: items.filter((item) => item.done).length,
      linkCount: dto.linkCount,
      blocked: dto.blocked,
      detailLoaded: true,
      factsAtSeq: dto.atSeq,
    },
  };
}

/**
 * TASK-200.9: mark cached detail's reverse rows stale, keeping the body and
 * `detailLoaded`. Used when a newer summary/page cannot prove the incoming
 * set is unchanged (same count/blocked but a possible reverse-set swap).
 */
function markReverseLinksStale(existing: Card): Card {
  if (
    existing.readModel === undefined ||
    existing.readModel.detailLoaded !== true ||
    existing.readModel.reverseLinksStale === true
  ) {
    return existing;
  }
  const merged: Card = {
    ...existing,
    readModel: { ...existing.readModel, reverseLinksStale: true },
  };
  delete merged.incomingLinks;
  return merged;
}

/**
 * TASK-200.9: a summary carries newer link facts for a card whose cached
 * detail text is still current (links do not stamp the target's `updatedAt`).
 * Keep the body and `detailLoaded`, replace the facts, drop the now-unreliable
 * reverse rows, and mark them stale so opening the card/popover refetches
 * exactly those rows.
 */
function mergeFreshLinkFacts(
  existing: Card,
  incoming: BoardCardSummaryDto,
  atSeq: number,
): Card {
  const merged: Card = {
    ...existing,
    readModel: {
      ...existing.readModel!,
      linkCount: incoming.linkCount,
      blocked: incoming.blocked,
      reverseLinksStale: true,
      factsAtSeq: atSeq,
    },
  };
  delete merged.incomingLinks;
  return merged;
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
    // Link facts live on the summary and, unlike the card's text, are not
    // stamped onto the target card's `updatedAt`: a foreign link change can
    // arrive with an identical stamp. Never let cached detail freeze them,
    // but never downgrade the open dialog either: merge the facts, keep the
    // body, and mark the reverse rows stale for the next detail read.
    const factsChanged =
      existing?.readModel !== undefined &&
      (existing.readModel.linkCount !== incoming.linkCount ||
        existing.readModel.blocked !== incoming.blocked);
    if (
      existing !== undefined &&
      hasCardDetail(existing) &&
      existing.updatedAt >= incoming.updatedAt
    ) {
      // Full-aggregate cards (create/import/legacy) have no readModel but a
      // complete body; keep it rather than returning to a loading skeleton.
      if (existing.readModel === undefined) {
        cards[id] = existing;
        continue;
      }
      // A page/summary from an older board revision must not overwrite a
      // detail read that already saw newer facts for the same card stamp.
      if (
        existing.readModel.factsAtSeq !== undefined &&
        summary.atSeq < existing.readModel.factsAtSeq
      ) {
        cards[id] = existing;
        continue;
      }
      if (factsChanged) {
        cards[id] = mergeFreshLinkFacts(existing, incoming, summary.atSeq);
        continue;
      }
      // Same facts at a newer revision: the summary cannot reveal a
      // same-count reverse-set swap, so refresh the rows lazily.
      if (
        existing.readModel.factsAtSeq !== undefined &&
        summary.atSeq > existing.readModel.factsAtSeq &&
        (incoming.linkCount > 0 || incoming.blocked)
      ) {
        cards[id] = markReverseLinksStale(existing);
        continue;
      }
      cards[id] = existing;
      continue;
    }
    cards[id] = cardFromSummary(incoming);
  }

  const epics = summary.epics?.length
    ? summary.epics.map(({ progress: _progress, ...epic }) => epic)
    : undefined;
  if (epics) {
    summaryProgress.set(
      epics,
      new Map(summary.epics.map(({ id, progress }) => [id, progress])),
    );
  }

  return {
    id: meta.id,
    title: meta.title,
    columns: summary.columns.map(toColumn),
    cards,
    labels: summary.labels.map((label) => ({ ...label })),
    ...(epics ? { epics } : {}),
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
    // Present (even empty) on every read-model board so the reducer can
    // maintain it through archive/unarchive/delete actions.
    archivedCardIds: [...summary.archivedCardIds],
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
