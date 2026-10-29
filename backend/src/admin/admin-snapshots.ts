import {
  CARD_PRIORITIES,
  COVER_COLORS,
  COVER_GRADIENTS,
  isCardLinkType,
  type Card,
  type CardCover,
  type CardLink,
  type CardPriority,
  type Checklist,
  type Column,
  type CoverColor,
  type CoverGradient,
} from "@janosik/shared";
import type { PrismaService } from "@/common/prisma/prisma.service";
import { activeMembershipWhere } from "@/common/membership";

const CARD_INCLUDE = {
  labels: {
    where: { label: { deletedAt: null } },
    orderBy: { position: "asc" as const },
    select: { labelId: true },
  },
  linksFrom: {
    where: { deletedAt: null },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
    select: { id: true, type: true, toCardId: true },
  },
  checklists: {
    orderBy: { position: "asc" as const },
    include: {
      items: { orderBy: { position: "asc" as const } },
    },
  },
};

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
  lastActorId: string | null;
  attachmentCount: number;
  labels: Array<{ labelId: string }>;
  linksFrom: Array<{ id: string; type: string; toCardId: string }>;
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
 *
 * `RESTORE_COLUMN*` does not pass through the command-side assignee check
 * (`assertAssigneeIsBoardMember` covers `RESTORE_CARD` only), so the snapshot
 * itself must be clean: `liveAssignees` is the board's active member set, and
 * an `assigneeId` outside it is dropped (TASK-147/B5) instead of resurrecting
 * a removed member with the board's content.
 */
function toCardSnapshot(
  row: CardRow,
  liveAssignees: ReadonlySet<string>,
): Card {
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

  const links: CardLink[] = row.linksFrom
    .filter((link) => isCardLinkType(link.type))
    .map((link) => ({
      id: link.id,
      type: link.type as CardLink["type"],
      targetCardId: link.toCardId,
    }));

  const cover: CardCover | undefined = (() => {
    if (
      row.coverType === "color" &&
      row.coverValue !== null &&
      (COVER_COLORS as readonly string[]).includes(row.coverValue)
    ) {
      return { type: "color", value: row.coverValue as CoverColor };
    }
    if (
      row.coverType === "gradient" &&
      row.coverValue !== null &&
      (COVER_GRADIENTS as readonly string[]).includes(row.coverValue)
    ) {
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
    // A hand-edited `priority` must not make the restore command invalid
    // (400 before any write): unknown values are omitted, like an unknown
    // cover (TASK-156).
    ...(row.priority !== null && isKnownPriority(row.priority)
      ? { priority: row.priority }
      : {}),
    ...(row.assigneeId !== null && liveAssignees.has(row.assigneeId)
      ? { assigneeId: row.assigneeId }
      : {}),
    ...(cover !== undefined ? { cover } : {}),
    labelIds: row.labels.map((label) => label.labelId),
    ...(links.length > 0 ? { links } : {}),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    ...(row.lastActorId !== null ? { lastActorId: row.lastActorId } : {}),
    ...(row.attachmentCount > 0
      ? { attachmentCount: row.attachmentCount }
      : {}),
    ...(row.archivedAt !== null
      ? { archivedAt: row.archivedAt.getTime() }
      : {}),
  };
}

/** The `priority` ladder the command contract knows (TASK-156). */
function isKnownPriority(value: string): value is CardPriority {
  return (CARD_PRIORITIES as readonly string[]).includes(value);
}

/**
 * Active member user ids of one board — the same predicate the command-side
 * assignee check uses. One set query per snapshot load, never one per card
 * (TASK-147/B5).
 */
async function liveAssignees(
  db: PrismaService,
  boardId: string,
): Promise<Set<string>> {
  const members = await db.boardMember.findMany({
    where: { boardId, ...activeMembershipWhere() },
    select: { userId: true },
  });
  return new Set(members.map((member) => member.userId));
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
  const assignees = await liveAssignees(db, row.column.boardId);
  return {
    boardId: row.column.boardId,
    columnId: row.archivedAt !== null ? null : row.columnId,
    columnDeleted: row.column.deletedAt !== null,
    index: row.position,
    card: toCardSnapshot(row as CardRow, assignees),
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
  const assignees = await liveAssignees(db, column.boardId);
  const cards = rows.map((row) => toCardSnapshot(row as CardRow, assignees));

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
