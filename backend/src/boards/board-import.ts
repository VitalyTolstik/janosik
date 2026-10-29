import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Board } from "@janosik/shared";

/** Rows per `createMany` (TASK-156). */
const IMPORT_CHUNK = 1_000;

/**
 * Persist a normalized frontend `Board` (from an import envelope) into the
 * §7.3 tables.
 *
 * Import always mints fresh ids for the board and every child and rewrites
 * the references (`column.cardIds`, `card.labelIds`, checklist parents).
 * Ids are globally unique in the schema and deletions are soft, so keeping
 * the ids from the file would collide on a second import of the same file;
 * regenerating is what makes import idempotent-safe for several users while
 * preserving all content (titles, order, wipLimit, cover, dueDate,
 * archivedAt, checklist state).
 *
 * Archived cards are absent from `column.cardIds` (they only live in the
 * `cards` map), but `Card.columnId` is mandatory — such cards are attached
 * to the first column so they survive; `archivedAt` keeps them out of every
 * column on the way back out. A board with archived cards and no columns at
 * all gets a single placeholder column so the rows can exist.
 */
export async function persistBoard(
  tx: Prisma.TransactionClient,
  board: Board,
  userId: string,
): Promise<string> {
  const created = await tx.board.create({
    data: {
      title: board.title,
      archivedAt: board.archivedAt ? new Date(board.archivedAt) : null,
      createdAt: new Date(board.createdAt),
      updatedAt: new Date(board.updatedAt),
    },
  });
  await tx.boardMember.create({
    data: {
      boardId: created.id,
      userId,
      role: "ADMIN",
      // Imported boards belong to the importer — accepted by definition.
      acceptedAt: new Date(),
    },
  });

  // Labels keep their order from the envelope (`Label.position`, TASK-27).
  const labelIdMap = new Map<string, string>();
  for (const [index, label] of board.labels.entries()) {
    const id = randomUUID();
    labelIdMap.set(label.id, id);
    await tx.label.create({
      data: {
        id,
        boardId: created.id,
        name: label.name,
        color: label.color,
        position: index,
      },
    });
  }

  const columnIdMap = new Map<string, string>();
  for (const [index, column] of board.columns.entries()) {
    const id = randomUUID();
    columnIdMap.set(column.id, id);
    const createdAt = new Date(column.createdAt);
    await tx.column.create({
      data: {
        id,
        boardId: created.id,
        title: column.title,
        wipLimit: column.wipLimit ?? null,
        position: index,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }

  // Active cards resolved from the ordered column arrays; archived cards fall
  // back to the first column (see the JSDoc above).
  const columnForCard = new Map<string, string>();
  const positionForCard = new Map<string, number>();
  for (const column of board.columns) {
    const columnId = columnIdMap.get(column.id);
    if (!columnId) continue;
    column.cardIds.forEach((cardId, index) => {
      if (!columnForCard.has(cardId)) {
        columnForCard.set(cardId, columnId);
        positionForCard.set(cardId, index);
      }
    });
  }
  let fallbackColumnId: string | null =
    board.columns.length > 0
      ? (columnIdMap.get(board.columns[0].id) ?? null)
      : null;

  // Fresh card ids — card links (TASK-46) are rewritten through this map
  // after every card exists (a link row needs both endpoints in the table).
  const cardIdMap = new Map<string, string>();
  // Batching (TASK-149, B16): rows are collected and inserted with
  // `createMany` instead of one round-trip per row — a 2400-card envelope
  // spent most of its 5 s budget on round-trips alone.
  const cardRows: Prisma.CardCreateManyInput[] = [];
  const labelRows: Prisma.CardLabelCreateManyInput[] = [];
  const checklistRows: Prisma.ChecklistCreateManyInput[] = [];
  const itemRows: Prisma.ChecklistItemCreateManyInput[] = [];

  for (const [oldId, card] of Object.entries(board.cards)) {
    let columnId = columnForCard.get(oldId);
    if (!columnId) {
      if (fallbackColumnId === null) {
        fallbackColumnId = await createPlaceholderColumn(tx, created.id);
      }
      columnId = fallbackColumnId;
    }

    const id = randomUUID();
    cardIdMap.set(oldId, id);
    const createdAt = new Date(card.createdAt);
    const updatedAt = new Date(card.updatedAt);
    // Assignee guard (TASK-49, tightened in TASK-147/B5): the only member of
    // a freshly imported board is the importer (created above), so an
    // assignment to anyone else would leak the card into a non-member's
    // e-mail/digests. A hand-edited file may also name a user that does not
    // exist here — in both cases the permissive import drops the assignment
    // instead of failing the whole board.
    const assigneeId = card.assigneeId ?? null;
    const keptAssigneeId = assigneeId === userId ? assigneeId : null;
    cardRows.push({
      id,
      columnId,
      title: card.title,
      description: card.description ?? null,
      coverType: card.cover?.type ?? null,
      coverValue: card.cover?.value ?? null,
      dueDate: card.dueDate ? new Date(card.dueDate) : null,
      priority: card.priority ?? null,
      assigneeId: keptAssigneeId,
      archivedAt: card.archivedAt ? new Date(card.archivedAt) : null,
      position: positionForCard.get(oldId) ?? 0,
      createdAt,
      updatedAt,
    });

    let labelPosition = 0;
    // A hand-edited envelope may repeat a label; the composite PK would abort
    // the whole import (TASK-156).
    for (const oldLabelId of new Set(card.labelIds)) {
      const labelId = labelIdMap.get(oldLabelId);
      if (!labelId) continue;
      labelRows.push({ cardId: id, labelId, position: labelPosition++ });
    }

    let checklistPosition = 0;
    for (const checklist of card.checklists ?? []) {
      const checklistId = randomUUID();
      checklistRows.push({
        id: checklistId,
        cardId: id,
        title: checklist.title,
        position: checklistPosition++,
      });
      let itemPosition = 0;
      for (const item of checklist.items) {
        itemRows.push({
          id: randomUUID(),
          checklistId,
          text: item.text,
          done: item.done,
          position: itemPosition++,
        });
      }
    }
  }

  // Bounded inserts (TASK-156): a single `createMany` for a 2400-card envelope
  // can exceed Postgres' 65 535 bind-parameter limit. `position` was computed
  // above, so chunking only changes the number of round-trips.
  await insertChunks((data) => tx.card.createMany({ data }), cardRows);
  await insertChunks((data) => tx.cardLabel.createMany({ data }), labelRows);
  await insertChunks(
    (data) => tx.checklist.createMany({ data }),
    checklistRows,
  );
  await insertChunks((data) => tx.checklistItem.createMany({ data }), itemRows);

  // Card links (TASK-46) in a second pass: both endpoints are rewritten to
  // the fresh ids. A row whose target is not in the envelope's cards map is
  // dangling (its target was deleted before the export) — the FK needs a
  // real card, so such rows are dropped instead of imported. `position` is
  // the index *within the source card*, matching what `writeLinkPositions`
  // maintains for live boards.
  const linkRows: Prisma.CardLinkCreateManyInput[] = [];
  for (const [oldFromId, card] of Object.entries(board.cards)) {
    const fromCardId = cardIdMap.get(oldFromId);
    if (fromCardId === undefined) continue;
    let position = 0;
    for (const link of card.links ?? []) {
      const toCardId = cardIdMap.get(link.targetCardId);
      if (toCardId === undefined || toCardId === fromCardId) continue;
      linkRows.push({
        id: randomUUID(),
        boardId: created.id,
        fromCardId,
        toCardId,
        type: link.type,
        position: position++,
      });
    }
  }
  await insertChunks((data) => tx.cardLink.createMany({ data }), linkRows);

  return created.id;
}

async function insertChunks<T>(
  insert: (rows: T[]) => Promise<unknown>,
  rows: T[],
): Promise<void> {
  for (let index = 0; index < rows.length; index += IMPORT_CHUNK) {
    await insert(rows.slice(index, index + IMPORT_CHUNK));
  }
}

async function createPlaceholderColumn(
  tx: Prisma.TransactionClient,
  boardId: string,
): Promise<string> {
  const id = randomUUID();
  await tx.column.create({
    data: { id, boardId, title: "Imported cards", position: 0 },
  });
  return id;
}
