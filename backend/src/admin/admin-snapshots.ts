import type {
  Card,
  CardCover,
  CardPriority,
  Checklist,
  Column,
  CoverColor,
  CoverGradient,
} from "@janosik/shared";
import type { PrismaService } from "@/common/prisma/prisma.service";

const CARD_INCLUDE = {
  labels: { orderBy: { position: "asc" as const }, select: { labelId: true } },
  checklists: {
    orderBy: { position: "asc" as const },
    include: {
      items: { orderBy: { position: "asc" as const } },
    },
  },
} as const;

type CardRow = {
  id: string;
  title: string;
  description: string | null;
  coverType: string | null;
  coverValue: string | null;
  dueDate: Date | null;
  priority: string | null;
  assigneeId: string | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  position: number;
  columnId: string;
  createdAt: Date;
  updatedAt: Date;
  labels: Array<{ labelId: string }>;
  checklists: Array<{
    id: string;
    title: string;
    deletedAt: Date | null;
    items: Array<{
      id: string;
      text: string;
      done: boolean;
      deletedAt: Date | null;
    }>;
  }>;
};

/**
 * Rebuild the frontend `Card` snapshot the restore commands expect (TASK-149).
 *
 * A delete stamps the card *and* its checklists/items with the same clock, so
 * "deleted in the same operation" is the filter: a checklist the user removed
 * on its own before deleting the card must stay deleted. Label links survive a
 * card delete now (the writer no longer drops them), which is what lets this
 * rebuild `labelIds` — the rows are the only record of them.
 */
function toCardSnapshot(row: CardRow): Card {
  const stamp = row.deletedAt?.getTime();
  const sameOp = (value: Date | null): boolean =>
    value === null || (stamp !== undefined && value.getTime() === stamp);

  const checklists: Checklist[] = row.checklists
    .filter((checklist) => sameOp(checklist.deletedAt))
    .map((checklist) => ({
      id: checklist.id,
      title: checklist.title,
      items: checklist.items
        .filter((item) => sameOp(item.deletedAt))
        .map((item) => ({
          id: item.id,
          text: item.text,
          done: item.done,
        })),
    }));

  const cover: CardCover | undefined = (() => {
    if (row.coverType === "color" && row.coverValue !== null) {
      return { type: "color", value: row.coverValue as CoverColor };
    }
    if (row.coverType === "gradient" && row.coverValue !== null) {
      return { type: "gradient", value: row.coverValue as CoverGradient };
    }
    return undefined;
  })();

  return {
    id: row.id,
    title: row.title,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(checklists.length > 0 ? { checklists } : {}),
    ...(row.dueDate !== null ? { dueDate: row.dueDate.getTime() } : {}),
    ...(row.priority !== null
      ? { priority: row.priority as CardPriority }
      : {}),
    ...(row.assigneeId !== null ? { assigneeId: row.assigneeId } : {}),
    ...(cover !== undefined ? { cover } : {}),
    labelIds: row.labels.map((label) => label.labelId),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    ...(row.archivedAt !== null
      ? { archivedAt: row.archivedAt.getTime() }
      : {}),
  };
}

export interface CardRestore {
  boardId: string;
  /** Null for an archived card: the reducer refuses a column-less live card. */
  columnId: string | null;
  columnDeleted: boolean;
  index: number;
  card: Card;
}

export async function loadCardRestore(
  db: PrismaService,
  cardId: string,
): Promise<CardRestore | null> {
  const row = await db.card.findUnique({
    where: { id: cardId },
    include: {
      ...CARD_INCLUDE,
      column: { select: { boardId: true, deletedAt: true } },
    },
  });
  if (!row) return null;
  return {
    boardId: row.column.boardId,
    columnId: row.archivedAt !== null ? null : row.columnId,
    columnDeleted: row.column.deletedAt !== null,
    index: row.position,
    card: toCardSnapshot(row as CardRow),
  };
}

export interface ColumnRestore {
  boardId: string;
  index: number;
  column: Column;
  cards: Card[];
}

/**
 * Snapshot of a soft-deleted column and the cards it took down with it.
 * Archived cards were never deleted by the command (they already sat outside
 * every column), so they are not part of the restore payload.
 */
export async function loadColumnRestore(
  db: PrismaService,
  columnId: string,
): Promise<ColumnRestore | null> {
  const column = await db.column.findUnique({
    where: { id: columnId },
  });
  if (!column) return null;

  const rows = await db.card.findMany({
    where: {
      columnId,
      deletedAt: column.deletedAt,
      archivedAt: null,
    },
    orderBy: { position: "asc" },
    include: CARD_INCLUDE,
  });
  const cards = rows.map((row) => toCardSnapshot(row as CardRow));

  return {
    boardId: column.boardId,
    index: column.position,
    column: {
      id: column.id,
      title: column.title,
      cardIds: cards.map((card) => card.id),
      ...(column.wipLimit !== null ? { wipLimit: column.wipLimit } : {}),
      createdAt: column.createdAt.getTime(),
    },
    cards,
  };
}
