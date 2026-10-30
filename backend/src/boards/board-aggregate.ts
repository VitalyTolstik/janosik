import type {
  Board as BoardRow,
  BoardMember as BoardMemberRow,
  CardLink as CardLinkRow,
  Column as ColumnRow,
  Label as LabelRow,
  Prisma,
  User as UserRow,
} from "@prisma/client";
import type {
  BoardAggregate,
  BoardCounters,
  BoardMemberDto,
  BoardRole,
  BoardSummary,
  Card,
  CardCover,
  CardLink,
  Checklist,
  LabelColor,
  UserAvatarColor,
} from "@janosik/shared";
import { isCardLinkType } from "@janosik/shared";

/** A card row with the relations the aggregate needs (labels + checklists). */
export type CardWithRelations = Prisma.CardGetPayload<{
  include: {
    labels: true;
    checklists: { include: { items: true } };
  };
}>;

/** A membership row with its user, as loaded for `GET /boards/:id/members`. */
export type MemberWithUser = BoardMemberRow & { user: UserRow };

/**
 * Load a board's aggregate with one query set, from either the pooled
 * `PrismaService` or an active transaction.
 *
 * Archived cards of a soft-deleted column stay visible: `DELETE_COLUMN`
 * keeps them in the reducer's `cards` map (only `column.cardIds` is
 * emptied), so the card filter walks live cards by `boardId` rather than
 * through `column.deletedAt`. Cards of a deleted board are filtered by the
 * board lookup itself and by their own `deletedAt` cascade.
 */
export async function loadBoardAggregate(
  db: Prisma.TransactionClient,
  boardId: string,
): Promise<BoardAggregate | null> {
  const board = await db.board.findFirst({
    where: { id: boardId, deletedAt: null },
  });
  if (!board) return null;

  const [columns, labels, cards, links] = await Promise.all([
    db.column.findMany({
      where: { boardId, deletedAt: null },
      orderBy: { position: "asc" },
    }),
    db.label.findMany({
      where: { boardId, deletedAt: null },
      orderBy: { position: "asc" },
    }),
    db.card.findMany({
      where: { column: { boardId }, deletedAt: null },
      orderBy: { position: "asc" },
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
    // The rows a card holds towards other cards (TASK-46). A link whose
    // target card is soft-deleted stays: the reducer never scrubs a
    // dangling row either, and restoring the target revives the link.
    // `id` breaks a `position` tie so the order is reproducible even if
    // two rows ever share one (they should not — `writeLinkPositions`
    // renumbers the card's whole list on every write).
    db.cardLink.findMany({
      where: { boardId, deletedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    }),
  ]);

  return toBoardAggregate(board, columns, cards, labels, links);
}

/**
 * Map normalized Prisma rows onto the frontend `Board` model (§7.4).
 *
 * Contract (ROADMAP §7.0 / TASK-25):
 * - `column.cardIds` holds **only active** cards, in `position` order;
 * - archived cards stay in the `cards` map and carry `archivedAt`;
 * - soft-deleted rows never reach here (callers filter `deletedAt: null`);
 * - timestamps are Unix ms, matching the UI model.
 */
export function toBoardAggregate(
  board: BoardRow,
  columns: ColumnRow[],
  cards: CardWithRelations[],
  labels: LabelRow[],
  links: CardLinkRow[] = [],
): BoardAggregate {
  const boardLabelIds = new Set(labels.map((label) => label.id));

  // Group the board's link rows by their source card (TASK-46); a row whose
  // type the app no longer knows (a hand-edited DB) is skipped rather than
  // poisoning the render.
  const linksBySource = new Map<string, CardLink[]>();
  for (const link of links) {
    if (!isCardLinkType(link.type)) continue;
    const rows = linksBySource.get(link.fromCardId) ?? [];
    rows.push({
      id: link.id,
      type: link.type,
      targetCardId: link.toCardId,
    });
    linksBySource.set(link.fromCardId, rows);
  }

  const cardsMap: Record<string, Card> = {};
  for (const card of cards) {
    cardsMap[card.id] = toCard(card, boardLabelIds, linksBySource.get(card.id));
  }

  return {
    id: board.id,
    title: board.title,
    columns: columns.map((column) => {
      const cardIds = cards
        .filter(
          (card) =>
            card.columnId === column.id &&
            card.archivedAt === null &&
            card.deletedAt === null,
        )
        .map((card) => card.id);
      return {
        id: column.id,
        title: column.title,
        cardIds,
        // Keep the "omit when unset" invariant of the UI model.
        ...(column.wipLimit !== null ? { wipLimit: column.wipLimit } : {}),
        createdAt: column.createdAt.getTime(),
      };
    }),
    cards: cardsMap,
    labels: labels.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color as LabelColor,
    })),
    createdAt: board.createdAt.getTime(),
    updatedAt: board.updatedAt.getTime(),
    ...(board.archivedAt ? { archivedAt: board.archivedAt.getTime() } : {}),
  };
}

function toCard(
  card: CardWithRelations,
  boardLabelIds: Set<string>,
  links?: CardLink[],
): Card {
  const labelIds = [...card.labels]
    .filter((link) => boardLabelIds.has(link.labelId))
    .sort((a, b) => a.position - b.position)
    .map((link) => link.labelId);

  const checklists = toChecklists(card.checklists);

  return {
    id: card.id,
    title: card.title,
    ...(card.description !== null ? { description: card.description } : {}),
    ...(checklists ? { checklists } : {}),
    ...(card.dueDate ? { dueDate: card.dueDate.getTime() } : {}),
    ...(card.priority ? { priority: card.priority as Card["priority"] } : {}),
    // Assignee (TASK-49): raw user id; display data resolves client-side
    // from the member directory.
    ...(card.assigneeId ? { assigneeId: card.assigneeId } : {}),
    // Claim (TASK-157): raw claimant id + lease expiry, both omitted when
    // unclaimed. Display data resolves client-side like the assignee.
    ...(card.claimedBy ? { claimedBy: card.claimedBy } : {}),
    ...(card.leaseUntil ? { leaseUntil: card.leaseUntil.getTime() } : {}),
    ...(links && links.length > 0 ? { links } : {}),
    ...(card.coverType && card.coverValue
      ? {
          cover: {
            type: card.coverType as CardCover["type"],
            value: card.coverValue as CardCover["value"],
          } as CardCover,
        }
      : {}),
    labelIds,
    createdAt: card.createdAt.getTime(),
    updatedAt: card.updatedAt.getTime(),
    // Attribution (TASK-36): omitted when unset, like every optional field.
    ...(card.lastActorId ? { lastActorId: card.lastActorId } : {}),
    // Attachments badge (TASK-47): server-side denormalized counter.
    ...(card.attachmentCount > 0
      ? { attachmentCount: card.attachmentCount }
      : {}),
    ...(card.archivedAt ? { archivedAt: card.archivedAt.getTime() } : {}),
  };
}

function toChecklists(
  rows: CardWithRelations["checklists"],
): Checklist[] | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((checklist) => ({
      id: checklist.id,
      title: checklist.title,
      items: [...checklist.items]
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          id: item.id,
          text: item.text,
          done: item.done,
        })),
    }));
}

/** `GET /boards` entry: identity + counters + the caller's role. */
export function toBoardSummary(
  board: BoardRow,
  counters: BoardCounters,
  role: BoardRole,
): BoardSummary {
  return {
    id: board.id,
    title: board.title,
    ...(board.archivedAt ? { archivedAt: board.archivedAt.getTime() } : {}),
    counters,
    role,
  };
}

/** `GET /boards/:id/members` row (§7.4). */
export function toMemberDto(member: MemberWithUser): BoardMemberDto {
  return {
    userId: member.userId,
    displayName: member.user.displayName,
    email: member.user.email,
    role: member.role,
    expiresAt: member.expiresAt ? member.expiresAt.getTime() : null,
    avatarColor: (member.user.avatarColor as UserAvatarColor | null) ?? null,
    avatarPath: member.user.avatarPath,
  };
}
