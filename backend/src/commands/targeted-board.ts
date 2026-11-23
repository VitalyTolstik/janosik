import type { Board as BoardRow, Prisma } from "@prisma/client";
import type { BoardAggregate, EntityVersions } from "@janosik/shared";

import {
  type CardWithRelations,
  toBoardAggregate,
} from "@/boards/board-aggregate";

/** One card-targeted aggregate: the board shell, the touched card and columns. */
export interface TargetedBoard {
  board: BoardAggregate;
  /** The requested cards that exist on this board, with relations. */
  cards: CardWithRelations[];
  /** Active card ids per column, only when a positioning action needs them. */
  cardIdsByColumn: Map<string, string[]>;
  /** Versions of the board shell and every loaded card/column row. */
  versions: EntityVersions;
}

/**
 * TASK-200.7: load only what a card intent needs instead of the whole board.
 *
 * The board shell (columns, labels, workflow, policy) is small and is shared
 * by every command on the board. Cards are the expensive part — descriptions,
 * checklists, links — so only the card(s) named by the intent are loaded in
 * full. A positioning command (`MOVE_CARD`) additionally needs the active card
 * id order of the affected columns; that is one index query of `id + columnId`
 * rows, never the card payload. The resulting `Board` has the same column
 * card-id lists as `loadBoardAggregate`, so the reducer, WIP/workflow checks,
 * activity details and position writers see the state they expect.
 */
export async function loadTargetedBoardAggregate(
  db: Prisma.TransactionClient,
  boardId: string,
  options: {
    /** A board row already read in the same transaction. */
    board?: BoardRow;
    /** Cards whose full payload the intent needs. */
    cardIds: readonly string[];
    /** Load the active card-id order for every column (a move needs it). */
    includeCardIndex?: boolean;
  },
): Promise<TargetedBoard | null> {
  const board =
    options.board ??
    (await db.board.findFirst({
      where: { id: boardId, deletedAt: null },
    }));
  if (!board) return null;

  const cardIds = [...new Set(options.cardIds)];
  const [columns, labels, cards, links, indexRows] = await Promise.all([
    db.column.findMany({
      where: { boardId, deletedAt: null },
      orderBy: { position: "asc" },
    }),
    db.label.findMany({
      where: { boardId, deletedAt: null },
      orderBy: { position: "asc" },
    }),
    cardIds.length === 0
      ? Promise.resolve([] as CardWithRelations[])
      : db.card.findMany({
          where: {
            id: { in: cardIds },
            column: { boardId },
            deletedAt: null,
          },
          include: {
            labels: true,
            checklists: {
              where: { deletedAt: null },
              orderBy: { position: "asc" },
              include: {
                items: {
                  where: { deletedAt: null },
                  orderBy: { position: "asc" },
                },
              },
            },
          },
        }),
    cardIds.length === 0
      ? Promise.resolve([])
      : db.cardLink.findMany({
          where: {
            boardId,
            deletedAt: null,
            fromCardId: { in: cardIds },
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        }),
    options.includeCardIndex === true
      ? db.card.findMany({
          where: {
            column: { boardId },
            deletedAt: null,
            archivedAt: null,
          },
          orderBy: [{ columnId: "asc" }, { position: "asc" }],
          select: { id: true, columnId: true },
        })
      : Promise.resolve([] as Array<{ id: string; columnId: string }>),
  ]);

  const boardAggregate = toBoardAggregate(board, columns, cards, labels, links);

  const cardIdsByColumn = new Map<string, string[]>();
  if (options.includeCardIndex === true) {
    for (const column of boardAggregate.columns) {
      cardIdsByColumn.set(column.id, []);
    }
    for (const row of indexRows) {
      const list = cardIdsByColumn.get(row.columnId);
      if (list !== undefined) list.push(row.id);
    }
    boardAggregate.columns = boardAggregate.columns.map((column) => ({
      ...column,
      cardIds: cardIdsByColumn.get(column.id) ?? [],
    }));
  }

  const versions: EntityVersions = { [`board:${boardId}`]: board.version };
  for (const column of columns) {
    versions[`column:${column.id}`] = column.version;
  }
  for (const card of cards) {
    versions[`card:${card.id}`] = card.version;
  }

  return { board: boardAggregate, cards, cardIdsByColumn, versions };
}

/** Does any of these actions need the cross-column card order? */
export function needsCardIndex(
  actions: ReadonlyArray<{ type: string }>,
): boolean {
  return actions.some((action) => action.type === "MOVE_CARD");
}

/** Card ids an action needs the full payload for. */
export function targetedCardIds(actions: ReadonlyArray<object>): string[] {
  const ids = new Set<string>();
  for (const action of actions) {
    const record = action as Record<string, unknown>;
    for (const key of ["cardId", "newCardId"]) {
      const value = record[key];
      if (typeof value === "string" && value !== "") ids.add(value);
    }
  }
  return [...ids];
}
