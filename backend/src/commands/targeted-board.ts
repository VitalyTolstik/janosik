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
  /** Active card ids per column that the caller asked to index. */
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
 * full. A positioning command additionally needs the active card-id order of
 * the source/destination columns only; that is one index query of
 * `id + columnId` rows for those columns, never a board-wide scan and never
 * the card payload. The resulting `Board` has the same card-id lists for the
 * affected columns as `loadBoardAggregate`, so the reducer, WIP/workflow
 * checks, activity details and position writers see the state they expect.
 */
export async function loadTargetedBoardAggregate(
  db: Prisma.TransactionClient,
  boardId: string,
  options: {
    /** A board row already read in the same transaction. */
    board?: BoardRow;
    /** Cards whose full payload the intent needs. */
    cardIds: readonly string[];
    /** Load the active card-id order for these columns only. */
    indexColumnIds?: readonly string[];
    /**
     * Add the target card's current column to the index set (context/move
     * preflight: the source column is only known from the card row).
     */
    includeTargetColumn?: boolean;
  },
): Promise<TargetedBoard | null> {
  const board =
    options.board ??
    (await db.board.findFirst({
      where: { id: boardId, deletedAt: null },
    }));
  if (!board) return null;

  const cardIds = [...new Set(options.cardIds)];
  const [columns, labels, cards, links] = await Promise.all([
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
  ]);

  // Validate before indexing: a caller-supplied destination id from another
  // board must never become an index query even though it could not leak a
  // row. Only columns loaded for this board are eligible, and the query is
  // scoped by `column.boardId` as defence in depth.
  const boardColumnIds = new Set(columns.map((column) => column.id));
  const indexColumns = new Set(
    [...(options.indexColumnIds ?? [])].filter((id) => boardColumnIds.has(id)),
  );
  if (
    options.includeTargetColumn === true &&
    cards[0]?.columnId &&
    boardColumnIds.has(cards[0].columnId)
  ) {
    indexColumns.add(cards[0].columnId);
  }
  const indexRows =
    indexColumns.size === 0
      ? []
      : await db.card.findMany({
          where: {
            columnId: { in: [...indexColumns] },
            column: { boardId },
            deletedAt: null,
            archivedAt: null,
          },
          orderBy: [{ columnId: "asc" }, { position: "asc" }],
          select: { id: true, columnId: true },
        });

  const boardAggregate = toBoardAggregate(board, columns, cards, labels, links);

  const cardIdsByColumn = new Map<string, string[]>();
  for (const column of boardAggregate.columns) {
    cardIdsByColumn.set(column.id, [...column.cardIds]);
  }
  for (const columnId of indexColumns) {
    cardIdsByColumn.set(columnId, []);
  }
  for (const row of indexRows) {
    if (!indexColumns.has(row.columnId)) continue;
    const list = cardIdsByColumn.get(row.columnId);
    if (list !== undefined) list.push(row.id);
  }
  boardAggregate.columns = boardAggregate.columns.map((column) => ({
    ...column,
    cardIds: cardIdsByColumn.get(column.id) ?? [],
  }));

  const versions: EntityVersions = { [`board:${boardId}`]: board.version };
  for (const column of columns) {
    versions[`column:${column.id}`] = column.version;
  }
  for (const card of cards) {
    versions[`card:${card.id}`] = card.version;
  }

  return { board: boardAggregate, cards, cardIdsByColumn, versions };
}

/** Columns whose active card order a command action needs. */
export function targetedIndexColumnIds(
  actions: ReadonlyArray<object>,
): string[] {
  const ids = new Set<string>();
  for (const action of actions) {
    const record = action as Record<string, unknown>;
    if (record.type !== "MOVE_CARD") continue;
    for (const key of ["fromColumnId", "toColumnId"]) {
      const value = record[key];
      if (typeof value === "string" && value !== "") ids.add(value);
    }
  }
  return [...ids];
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
