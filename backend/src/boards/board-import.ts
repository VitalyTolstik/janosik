import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Board } from "@janosik/shared";

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
    data: { boardId: created.id, userId, role: "ADMIN" },
  });

  // §7.3 has no order column on Label, so only the ids are remapped.
  const labelIdMap = new Map<string, string>();
  for (const label of board.labels) {
    const id = randomUUID();
    labelIdMap.set(label.id, id);
    await tx.label.create({
      data: { id, boardId: created.id, name: label.name, color: label.color },
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

  for (const [oldId, card] of Object.entries(board.cards)) {
    let columnId = columnForCard.get(oldId);
    if (!columnId) {
      if (fallbackColumnId === null) {
        fallbackColumnId = await createPlaceholderColumn(tx, created.id);
      }
      columnId = fallbackColumnId;
    }

    const id = randomUUID();
    const createdAt = new Date(card.createdAt);
    const updatedAt = new Date(card.updatedAt);
    await tx.card.create({
      data: {
        id,
        columnId,
        title: card.title,
        description: card.description ?? null,
        coverType: card.cover?.type ?? null,
        coverValue: card.cover?.value ?? null,
        dueDate: card.dueDate ? new Date(card.dueDate) : null,
        archivedAt: card.archivedAt ? new Date(card.archivedAt) : null,
        position: positionForCard.get(oldId) ?? 0,
        createdAt,
        updatedAt,
      },
    });

    let labelPosition = 0;
    for (const oldLabelId of card.labelIds) {
      const labelId = labelIdMap.get(oldLabelId);
      if (!labelId) continue;
      await tx.cardLabel.create({
        data: { cardId: id, labelId, position: labelPosition++ },
      });
    }

    let checklistPosition = 0;
    for (const checklist of card.checklists ?? []) {
      const checklistId = randomUUID();
      await tx.checklist.create({
        data: {
          id: checklistId,
          cardId: id,
          title: checklist.title,
          position: checklistPosition++,
        },
      });
      let itemPosition = 0;
      for (const item of checklist.items) {
        await tx.checklistItem.create({
          data: {
            id: randomUUID(),
            checklistId,
            text: item.text,
            done: item.done,
            position: itemPosition++,
          },
        });
      }
    }
  }

  return created.id;
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
