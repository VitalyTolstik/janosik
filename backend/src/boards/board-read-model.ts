import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  type Board as BoardRow,
  type CardLink as CardLinkRow,
} from "@prisma/client";
import type {
  BoardCardDetailDto,
  BoardCardDetailsDto,
  BoardCardPageDto,
  BoardCardSummaryDto,
  BoardReadColumnDto,
  BoardReadMetaDto,
  BoardReadSummaryDto,
  BoardRole,
  CardCover,
  CardLink,
  CardPriority,
  CoverColor,
  IncomingCardLink,
  CoverGradient,
  LabelColor,
} from "@janosik/shared";
import {
  BOARD_CARD_DETAIL_BATCH_MAX,
  BOARD_CARD_PAGE_LIMIT_MAX,
  COVER_COLORS,
  COVER_GRADIENTS,
  isCardLinkType,
  LIMITS,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { toBoardAggregate, toCard } from "./board-aggregate";
import type { BoardReadBuildBudget } from "@/common/board-read.service";

/** ETag projections (part of the TASK-200.6 validator and single-flight key). */
export const BOARD_SUMMARY_ROUTE = "GET /boards/:id/summary";
export const BOARD_CARDS_ROUTE = "GET /boards/:id/cards";
export const BOARD_CARD_DETAIL_ROUTE = "GET /boards/:id/cards/:cardId";

export function boardSummaryProjection(limit: number): string {
  return `board-summary:v1:limit=${limit}`;
}

export function boardPageProjection(input: {
  columnId: string | null;
  archived: boolean;
  cursor: string | undefined;
  limit: number;
}): string {
  return [
    "board-page:v1",
    `column=${input.columnId ?? ""}`,
    `archived=${input.archived ? "1" : "0"}`,
    `cursor=${input.cursor ?? ""}`,
    `limit=${input.limit}`,
  ].join(":");
}

export function boardCardDetailProjection(cardId: string): string {
  return `board-card-detail:v1:card=${cardId}`;
}

export function boardCardDetailsProjection(ids: readonly string[]): string {
  return `board-card-details:v1:ids=${ids.join(",")}`;
}

/** Decoded, board-scoped keyset cursor. Not secret; tampering is validated. */
interface BoardPageCursor {
  v: 1;
  b: string;
  k: "column" | "archived";
  c?: string;
  /** Card position within the column (active pages only). */
  p?: number;
  /** `archivedAt` ms (archived pages only). */
  a?: number;
  id: string;
}

export function encodeBoardPageCursor(cursor: BoardPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeBoardPageCursor(
  raw: string,
  expected: { boardId: string; kind: "column" | "archived"; columnId?: string },
): BoardPageCursor {
  if (raw.length === 0 || raw.length > 512) {
    throw new BadRequestException("cursor is malformed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestException("cursor is malformed");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new BadRequestException("cursor is malformed");
  }
  const value = parsed as Record<string, unknown>;
  const valid =
    value.v === 1 &&
    value.b === expected.boardId &&
    value.k === expected.kind &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 200 &&
    (expected.kind === "column"
      ? value.c === expected.columnId &&
        typeof value.p === "number" &&
        Number.isSafeInteger(value.p)
      : typeof value.a === "number" &&
        Number.isSafeInteger(value.a) &&
        value.p === undefined);
  if (!valid) {
    throw new BadRequestException("cursor does not belong to this page");
  }
  return value as unknown as BoardPageCursor;
}

const CARD_SUMMARY_SELECT = {
  id: true,
  columnId: true,
  title: true,
  position: true,
  version: true,
  descriptionLength: true,
  coverType: true,
  coverValue: true,
  dueDate: true,
  priority: true,
  assigneeId: true,
  claimedBy: true,
  claimedByTokenId: true,
  claimedBySessionId: true,
  leaseUntil: true,
  archivedAt: true,
  archivedFromColumnId: true,
  createdAt: true,
  updatedAt: true,
  lastActorId: true,
  attachmentCount: true,
} satisfies Prisma.CardSelect;

type CardSummaryRow = Prisma.CardGetPayload<{
  select: typeof CARD_SUMMARY_SELECT;
}>;

const CARD_DETAIL_INCLUDE = {
  labels: true,
  checklists: {
    where: { deletedAt: null },
    orderBy: { position: "asc" as const },
    include: {
      items: {
        where: { deletedAt: null },
        orderBy: { position: "asc" as const },
      },
    },
  },
} satisfies Prisma.CardInclude;

type CardWithDetail = Prisma.CardGetPayload<{
  include: {
    labels: true;
    checklists: { include: { items: true } };
  };
}>;

interface LinkFacts {
  degree: number;
  blocked: boolean;
}

interface ChecklistCounts {
  total: number;
  done: number;
}

/**
 * TASK-200.9 read model v1: board summary, bounded card pages and card
 * detail. The projections deliberately select no description/checklist/link
 * bodies; only scalar counters stand in for them.
 */
@Injectable()
export class BoardReadModelService {
  constructor(private readonly prisma: PrismaService) {}

  private readTransaction<T>(
    budget: BoardReadBuildBudget,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(run, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      ...(budget.maxWaitMs === undefined ? {} : { maxWait: budget.maxWaitMs }),
      ...(budget.timeoutMs === undefined ? {} : { timeout: budget.timeoutMs }),
    });
  }

  private async stamp(
    tx: Prisma.TransactionClient,
    boardId: string,
  ): Promise<{ seq: number; revision: number }> {
    const max = await tx.command.aggregate({
      where: { boardId },
      _max: { seq: true },
    });
    const board = await tx.board.findUnique({
      where: { id: boardId },
      select: { aggregateRevision: true },
    });
    return {
      seq: max._max.seq === null ? 0 : Number(max._max.seq),
      revision: board === null ? 0 : Number(board.aggregateRevision),
    };
  }

  private async summaryRow(
    tx: Prisma.TransactionClient,
    boardId: string,
  ): Promise<BoardRow> {
    const board = await tx.board.findFirst({
      where: { id: boardId, deletedAt: null },
    });
    if (board === null) throw new NotFoundException("Board not found");
    return board;
  }

  async summary(
    boardId: string,
    role: BoardRole,
    limit: number,
    budget: BoardReadBuildBudget,
  ): Promise<BoardReadSummaryDto> {
    const pageLimit = Math.max(1, Math.min(limit, BOARD_CARD_PAGE_LIMIT_MAX));
    return this.readTransaction(budget, async (tx) => {
      const board = await this.summaryRow(tx, boardId);
      const [columns, labels, activeIds, archivedIds, stamp] =
        await Promise.all([
          tx.column.findMany({
            where: { boardId, deletedAt: null },
            orderBy: { position: "asc" },
          }),
          tx.label.findMany({
            where: { boardId, deletedAt: null },
            orderBy: { position: "asc" },
          }),
          tx.card.findMany({
            where: {
              column: { boardId },
              deletedAt: null,
              archivedAt: null,
            },
            orderBy: [{ columnId: "asc" }, { position: "asc" }, { id: "asc" }],
            select: { id: true, columnId: true, position: true },
          }),
          tx.card.findMany({
            where: {
              column: { boardId },
              deletedAt: null,
              archivedAt: { not: null },
            },
            orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
            select: { id: true, columnId: true, archivedAt: true },
          }),
          this.stamp(tx, boardId),
        ]);

      const idsByColumn = new Map<string, string[]>();
      for (const row of activeIds) {
        const list = idsByColumn.get(row.columnId) ?? [];
        list.push(row.id);
        idsByColumn.set(row.columnId, list);
      }
      const archivedByColumn = new Map<string, number>();
      for (const row of archivedIds) {
        archivedByColumn.set(
          row.columnId,
          (archivedByColumn.get(row.columnId) ?? 0) + 1,
        );
      }

      // First page of each column, plus the first archived page. These are
      // bounded indexed reads; the body never carries more than
      // columns × limit + limit summaries.
      const firstPages = await Promise.all(
        columns.map(async (column) => {
          const rows = await tx.card.findMany({
            where: {
              columnId: column.id,
              deletedAt: null,
              archivedAt: null,
            },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            take: pageLimit + 1,
            select: CARD_SUMMARY_SELECT,
          });
          return { columnId: column.id, rows };
        }),
      );
      const archivedPageRows = await tx.card.findMany({
        where: {
          column: { boardId },
          deletedAt: null,
          archivedAt: { not: null },
        },
        orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
        take: pageLimit + 1,
        select: CARD_SUMMARY_SELECT,
      });

      const decorated = await this.decorate(tx, boardId, [
        ...firstPages.flatMap((page) => page.rows),
        ...archivedPageRows,
      ]);

      const readColumns: BoardReadColumnDto[] = columns.map((column) => {
        const page = firstPages.find((entry) => entry.columnId === column.id);
        const rows = page?.rows ?? [];
        const hasMore = rows.length > pageLimit;
        const visible = hasMore ? rows.slice(0, pageLimit) : rows;
        const last = visible[visible.length - 1];
        const accent = columnAccent(column);
        return {
          id: column.id,
          title: column.title,
          count: idsByColumn.get(column.id)?.length ?? 0,
          archivedCount: archivedByColumn.get(column.id) ?? 0,
          wipLimit: column.wipLimit,
          ...(accent ? { accent } : {}),
          createdAt: column.createdAt.getTime(),
          cardIds: [...(idsByColumn.get(column.id) ?? [])],
          cards: visible.map((row) => decorated.get(row.id)!),
          nextCursor:
            hasMore && last !== undefined
              ? encodeBoardPageCursor({
                  v: 1,
                  b: boardId,
                  k: "column",
                  c: column.id,
                  p: last.position,
                  id: last.id,
                })
              : null,
          hasMore,
        };
      });

      const archivedHasMore = archivedPageRows.length > pageLimit;
      const archivedVisible = archivedHasMore
        ? archivedPageRows.slice(0, pageLimit)
        : archivedPageRows;
      const lastArchived = archivedVisible[archivedVisible.length - 1];
      const meta = toBoardAggregate(board, [], [], []);
      const readMeta: BoardReadMetaDto = {
        id: meta.id,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        ...(meta.archivedAt !== undefined
          ? { archivedAt: meta.archivedAt }
          : {}),
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
        role,
      };

      return {
        board: readMeta,
        columns: readColumns,
        labels: labels.map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color as LabelColor,
        })),
        limits: {
          cardsPerColumn: LIMITS.cardsPerColumn,
          columns: LIMITS.columnsPerBoard,
        },
        archivedCardIds: archivedIds.map((row) => row.id),
        archivedCards: archivedVisible.map((row) => decorated.get(row.id)!),
        archivedNextCursor:
          archivedHasMore && lastArchived?.archivedAt
            ? encodeBoardPageCursor({
                v: 1,
                b: boardId,
                k: "archived",
                a: lastArchived.archivedAt.getTime(),
                id: lastArchived.id,
              })
            : null,
        firstPageLimit: pageLimit,
        seq: stamp.seq,
        atSeq: stamp.seq,
        aggregateRevision: stamp.revision,
        readModel: "v1",
      };
    });
  }

  async page(
    boardId: string,
    query: {
      columnId: string | null;
      archived: boolean;
      cursor: string | undefined;
      limit: number;
    },
    budget: BoardReadBuildBudget,
  ): Promise<BoardCardPageDto> {
    if (query.archived && query.columnId !== null) {
      throw new BadRequestException(
        "columnId and archived are mutually exclusive",
      );
    }
    if (!query.archived && query.columnId === null) {
      throw new BadRequestException("columnId or archived=1 is required");
    }
    const limit = Math.max(1, Math.min(query.limit, BOARD_CARD_PAGE_LIMIT_MAX));
    return this.readTransaction(budget, async (tx) => {
      await this.summaryRow(tx, boardId);
      if (query.columnId !== null) {
        const column = await tx.column.findFirst({
          where: { id: query.columnId, boardId, deletedAt: null },
          select: { id: true },
        });
        if (column === null) throw new NotFoundException("Column not found");
      }
      const kind = query.archived ? "archived" : "column";
      const cursor =
        query.cursor === undefined
          ? null
          : decodeBoardPageCursor(query.cursor, {
              boardId,
              kind,
              ...(query.columnId !== null ? { columnId: query.columnId } : {}),
            });
      const where: Prisma.CardWhereInput = query.archived
        ? {
            column: { boardId },
            deletedAt: null,
            archivedAt: { not: null },
            ...(cursor
              ? {
                  OR: [
                    { archivedAt: { lt: new Date(cursor.a as number) } },
                    {
                      archivedAt: new Date(cursor.a as number),
                      id: { lt: cursor.id },
                    },
                  ],
                }
              : {}),
          }
        : {
            columnId: query.columnId as string,
            deletedAt: null,
            archivedAt: null,
            ...(cursor
              ? {
                  OR: [
                    { position: { gt: cursor.p as number } },
                    {
                      position: cursor.p as number,
                      id: { gt: cursor.id },
                    },
                  ],
                }
              : {}),
          };
      const [rows, total, stamp] = await Promise.all([
        tx.card.findMany({
          where,
          orderBy: query.archived
            ? [{ archivedAt: "desc" }, { id: "desc" }]
            : [{ position: "asc" }, { id: "asc" }],
          take: limit + 1,
          select: CARD_SUMMARY_SELECT,
        }),
        tx.card.count({
          where: query.archived
            ? {
                column: { boardId },
                deletedAt: null,
                archivedAt: { not: null },
              }
            : {
                columnId: query.columnId as string,
                deletedAt: null,
                archivedAt: null,
              },
        }),
        this.stamp(tx, boardId),
      ]);
      const hasMore = rows.length > limit;
      const visible = hasMore ? rows.slice(0, limit) : rows;
      const decorated = await this.decorate(tx, boardId, visible);
      const last = visible[visible.length - 1];
      return {
        boardId,
        columnId: query.columnId,
        archived: query.archived,
        cards: visible.map((row) => decorated.get(row.id)!),
        nextCursor:
          hasMore && last !== undefined
            ? query.archived
              ? encodeBoardPageCursor({
                  v: 1,
                  b: boardId,
                  k: "archived",
                  a: (last.archivedAt as Date).getTime(),
                  id: last.id,
                })
              : encodeBoardPageCursor({
                  v: 1,
                  b: boardId,
                  k: "column",
                  c: query.columnId as string,
                  p: last.position,
                  id: last.id,
                })
            : null,
        hasMore,
        total,
        seq: stamp.seq,
        atSeq: stamp.seq,
        aggregateRevision: stamp.revision,
      };
    });
  }

  /** Conditional-read precheck: a card must exist on this board. */
  async assertCardInBoard(boardId: string, cardId: string): Promise<void> {
    const card = await this.prisma.card.findFirst({
      where: { id: cardId, column: { boardId }, deletedAt: null },
      select: { id: true },
    });
    if (card === null) throw new NotFoundException("Card not found");
  }

  /** Conditional-read precheck: a column must exist on this board. */
  async assertColumnInBoard(boardId: string, columnId: string): Promise<void> {
    const column = await this.prisma.column.findFirst({
      where: { id: columnId, boardId, deletedAt: null },
      select: { id: true },
    });
    if (column === null) throw new NotFoundException("Column not found");
  }

  /** Conditional batch precheck: every requested card belongs to the board. */
  async assertCardsInBoard(boardId: string, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const rows = await this.prisma.card.findMany({
      where: { id: { in: unique }, column: { boardId }, deletedAt: null },
      select: { id: true },
    });
    if (rows.length !== unique.length) {
      throw new NotFoundException("Card not found");
    }
  }

  async detail(
    boardId: string,
    cardId: string,
    budget: BoardReadBuildBudget,
  ): Promise<BoardCardDetailDto> {
    return this.readTransaction(budget, async (tx) => {
      await this.summaryRow(tx, boardId);
      const card = await this.loadCard(tx, boardId, cardId);
      const [links, incoming, labels, facts, stamp] = await Promise.all([
        tx.cardLink.findMany({
          where: { fromCardId: cardId, boardId, deletedAt: null },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        }),
        tx.cardLink.findMany({
          where: {
            toCardId: cardId,
            boardId,
            deletedAt: null,
            fromCard: { deletedAt: null },
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: {
            id: true,
            type: true,
            fromCardId: true,
            fromCard: { select: { archivedAt: true } },
          },
        }),
        tx.label.findMany({
          where: { boardId, deletedAt: null },
          select: { id: true },
        }),
        this.linkFacts(tx, boardId, [cardId]),
        this.stamp(tx, boardId),
      ]);
      const labelIds = new Set(labels.map((label) => label.id));
      const factsForCard = facts.get(cardId) ?? { degree: 0, blocked: false };
      return this.detailDto(
        boardId,
        card,
        card.columnId,
        links,
        this.incomingDtos(incoming),
        labelIds,
        factsForCard,
        stamp,
      );
    });
  }

  async detailsByIds(
    boardId: string,
    ids: string[],
    budget: BoardReadBuildBudget,
  ): Promise<BoardCardDetailsDto> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      throw new BadRequestException("ids is required");
    }
    if (unique.length > BOARD_CARD_DETAIL_BATCH_MAX) {
      throw new BadRequestException(
        `ids accepts at most ${BOARD_CARD_DETAIL_BATCH_MAX} card ids`,
      );
    }
    return this.readTransaction(budget, async (tx) => {
      await this.summaryRow(tx, boardId);
      const rows = await this.loadCards(tx, boardId, unique);
      // All-or-nothing, like the per-id read: a partial batch would silently
      // hide a deleted/foreign card from a destructive preimage request.
      if (rows.length !== unique.length) {
        throw new NotFoundException("Card not found");
      }
      const [links, incoming, labels, facts, stamp] = await Promise.all([
        tx.cardLink.findMany({
          where: { fromCardId: { in: unique }, boardId, deletedAt: null },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        }),
        tx.cardLink.findMany({
          where: {
            toCardId: { in: unique },
            boardId,
            deletedAt: null,
            fromCard: { deletedAt: null },
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: {
            id: true,
            type: true,
            fromCardId: true,
            toCardId: true,
            fromCard: { select: { archivedAt: true } },
          },
        }),
        tx.label.findMany({
          where: { boardId, deletedAt: null },
          select: { id: true },
        }),
        this.linkFacts(tx, boardId, unique),
        this.stamp(tx, boardId),
      ]);
      const linksByCard = new Map<string, CardLinkRow[]>();
      for (const link of links) {
        const list = linksByCard.get(link.fromCardId) ?? [];
        list.push(link);
        linksByCard.set(link.fromCardId, list);
      }
      const incomingByCard = new Map<string, IncomingCardLink[]>();
      for (const link of incoming) {
        const list = incomingByCard.get(link.toCardId) ?? [];
        list.push(...this.incomingDtos([link]));
        incomingByCard.set(link.toCardId, list);
      }
      const labelIds = new Set(labels.map((label) => label.id));
      return {
        boardId,
        cards: rows.map((card) =>
          this.detailDto(
            boardId,
            card,
            card.columnId,
            linksByCard.get(card.id) ?? [],
            incomingByCard.get(card.id) ?? [],
            labelIds,
            facts.get(card.id) ?? { degree: 0, blocked: false },
            stamp,
          ),
        ),
        seq: stamp.seq,
        atSeq: stamp.seq,
        aggregateRevision: stamp.revision,
      };
    });
  }

  private async loadCard(
    tx: Prisma.TransactionClient,
    boardId: string,
    cardId: string,
  ): Promise<CardWithDetail> {
    const card = await tx.card.findFirst({
      where: { id: cardId, column: { boardId }, deletedAt: null },
      include: CARD_DETAIL_INCLUDE,
    });
    if (card === null) throw new NotFoundException("Card not found");
    return card;
  }

  /** One query for a bounded preimage batch, preserving the requested order. */
  private async loadCards(
    tx: Prisma.TransactionClient,
    boardId: string,
    ids: string[],
  ): Promise<CardWithDetail[]> {
    const cards = await tx.card.findMany({
      where: { id: { in: ids }, column: { boardId }, deletedAt: null },
      include: CARD_DETAIL_INCLUDE,
    });
    const byId = new Map(cards.map((card) => [card.id, card]));
    return ids.flatMap((id) => {
      const card = byId.get(id);
      return card === undefined ? [] : [card];
    });
  }

  private incomingDtos(
    links: Array<{
      id: string;
      type: string;
      fromCardId: string;
      fromCard: { archivedAt: Date | null };
    }>,
  ): IncomingCardLink[] {
    return links
      .filter((link) => isCardLinkType(link.type))
      .map((link) => ({
        id: link.id,
        type: link.type as CardLink["type"],
        fromCardId: link.fromCardId,
        fromArchived: link.fromCard.archivedAt !== null,
      }));
  }

  private detailDto(
    boardId: string,
    card: CardWithDetail,
    columnId: string,
    links: CardLinkRow[],
    incomingLinks: IncomingCardLink[],
    labelIds: Set<string>,
    facts: LinkFacts,
    stamp: { seq: number; revision: number },
  ): BoardCardDetailDto {
    const mapped: CardLink[] = links
      .filter((link) => isCardLinkType(link.type))
      .map((link) => ({
        id: link.id,
        type: link.type as CardLink["type"],
        targetCardId: link.toCardId,
      }));
    return {
      boardId,
      columnId,
      card: toCard(card, labelIds, mapped),
      version: card.version,
      linkCount: facts.degree,
      blocked: facts.blocked,
      incomingLinks,
      seq: stamp.seq,
      atSeq: stamp.seq,
      aggregateRevision: stamp.revision,
    };
  }

  /** Attach label ids and the summary counters to a bounded card page. */
  private async decorate(
    tx: Prisma.TransactionClient,
    boardId: string,
    rows: CardSummaryRow[],
  ): Promise<Map<string, BoardCardSummaryDto>> {
    const result = new Map<string, BoardCardSummaryDto>();
    if (rows.length === 0) return result;
    const ids = rows.map((row) => row.id);
    const [labels, checklist, links] = await Promise.all([
      tx.cardLabel.findMany({
        where: { cardId: { in: ids } },
        orderBy: { position: "asc" },
        select: { cardId: true, labelId: true },
      }),
      this.checklistCounts(tx, ids),
      this.linkFacts(tx, boardId, ids),
    ]);
    const labelsByCard = new Map<string, string[]>();
    for (const link of labels) {
      const list = labelsByCard.get(link.cardId) ?? [];
      list.push(link.labelId);
      labelsByCard.set(link.cardId, list);
    }
    for (const row of rows) {
      const counts = checklist.get(row.id) ?? { total: 0, done: 0 };
      const facts = links.get(row.id) ?? { degree: 0, blocked: false };
      result.set(row.id, {
        id: row.id,
        title: row.title,
        columnId: row.columnId,
        position: row.position,
        version: row.version,
        descriptionChars: row.descriptionLength,
        checklistItemCount: counts.total,
        checklistDoneCount: counts.done,
        linkCount: facts.degree,
        blocked: facts.blocked,
        labelIds: labelsByCard.get(row.id) ?? [],
        ...(row.dueDate ? { dueDate: row.dueDate.getTime() } : {}),
        ...(row.priority ? { priority: row.priority as CardPriority } : {}),
        ...(row.assigneeId ? { assigneeId: row.assigneeId } : {}),
        ...(row.claimedBy ? { claimedBy: row.claimedBy } : {}),
        ...(row.claimedByTokenId
          ? { claimedByTokenId: row.claimedByTokenId }
          : {}),
        ...(row.claimedBySessionId
          ? { claimedBySessionId: row.claimedBySessionId }
          : {}),
        ...(row.leaseUntil ? { leaseUntil: row.leaseUntil.getTime() } : {}),
        ...(coverOf(row) ? { cover: coverOf(row) } : {}),
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
        ...(row.lastActorId ? { lastActorId: row.lastActorId } : {}),
        ...(row.attachmentCount > 0
          ? { attachmentCount: row.attachmentCount }
          : {}),
        ...(row.archivedAt
          ? {
              archivedAt: row.archivedAt.getTime(),
              ...(row.archivedFromColumnId
                ? { archivedFromColumnId: row.archivedFromColumnId }
                : {}),
            }
          : {}),
      });
    }
    return result;
  }

  /** Live checklist totals per card, without selecting item text. */
  private async checklistCounts(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<Map<string, ChecklistCounts>> {
    const result = new Map<string, ChecklistCounts>();
    if (ids.length === 0) return result;
    const rows = await tx.$queryRaw<
      Array<{ cardId: string; total: number; done: number }>
    >(Prisma.sql`
      SELECT c."cardId" AS "cardId",
             COUNT(i."id")::int AS "total",
             (COUNT(i."id") FILTER (WHERE i."done" = true))::int AS "done"
      FROM "ChecklistItem" i
      JOIN "Checklist" c ON c."id" = i."checklistId"
      WHERE c."deletedAt" IS NULL
        AND i."deletedAt" IS NULL
        AND c."cardId" IN (${Prisma.join(ids)})
      GROUP BY c."cardId"
    `);
    for (const row of rows) {
      result.set(row.cardId, { total: row.total, done: row.done });
    }
    return result;
  }

  /**
   * Degree (live relations in both directions) and the blocked flag for a
   * bounded id set. Mirrors the client's `cardLinkIndex`: dangling rows do
   * not count, archived blockers do not block.
   */
  private async linkFacts(
    tx: Prisma.TransactionClient,
    boardId: string,
    ids: string[],
  ): Promise<Map<string, LinkFacts>> {
    const result = new Map<string, LinkFacts>();
    if (ids.length === 0) return result;
    const links = await tx.cardLink.findMany({
      where: {
        boardId,
        deletedAt: null,
        OR: [{ fromCardId: { in: ids } }, { toCardId: { in: ids } }],
      },
      select: {
        fromCardId: true,
        toCardId: true,
        type: true,
        fromCard: { select: { deletedAt: true, archivedAt: true } },
        toCard: { select: { deletedAt: true } },
      },
    });
    const wanted = new Set(ids);
    const facts = (id: string): LinkFacts => {
      const current = result.get(id) ?? { degree: 0, blocked: false };
      result.set(id, current);
      return current;
    };
    for (const link of links) {
      if (wanted.has(link.fromCardId) && link.toCard.deletedAt === null) {
        facts(link.fromCardId).degree += 1;
      }
      if (wanted.has(link.toCardId) && link.fromCard.deletedAt === null) {
        facts(link.toCardId).degree += 1;
        if (link.type === "blocks" && link.fromCard.archivedAt === null) {
          facts(link.toCardId).blocked = true;
        }
      }
    }
    return result;
  }
}

function coverOf(row: {
  coverType: string | null;
  coverValue: string | null;
}): CardCover | undefined {
  if (row.coverType === "color") {
    return (COVER_COLORS as readonly string[]).includes(
      row.coverValue as string,
    )
      ? { type: "color", value: row.coverValue as CoverColor }
      : undefined;
  }
  if (row.coverType === "gradient") {
    return (COVER_GRADIENTS as readonly string[]).includes(
      row.coverValue as string,
    )
      ? { type: "gradient", value: row.coverValue as CoverGradient }
      : undefined;
  }
  return undefined;
}

/** Column accent as the shared renderable shape. */
function columnAccent(column: {
  accentType: string | null;
  accentValue: string | null;
}): CardCover | undefined {
  return coverOf({
    coverType: column.accentType,
    coverValue: column.accentValue,
  });
}
