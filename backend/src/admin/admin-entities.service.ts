import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AdminActivityRowDto,
  AdminAnnouncementDto,
  AdminAttachmentRowDto,
  AdminBoardDetailDto,
  AdminBoardMemberRowDto,
  AdminCardDetailDto,
  AdminCardLabelRowDto,
  AdminCardLinkRowDto,
  AdminCardRowDto,
  AdminChecklistItemRowDto,
  AdminChecklistRowDto,
  AdminColumnRowDto,
  AdminCommandRowDto,
  AdminCommentRowDto,
  AdminEntity,
  AdminEntityRowMap,
  AdminGlobalSearchDto,
  AdminLabelRowDto,
  AdminPage,
  AdminSessionRowDto,
  AdminTokenRowDto,
  AdminUserDetailDto,
  AdminUserRowDto,
} from "@janosik/shared";
import { ADMIN_PAGE_LIMITS } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { AdminListQueryDto } from "./dto/admin-list-query.dto";
import { AdminService } from "./admin.service";

/**
 * Admin v2 (TASK-48): full Prisma coverage for the support panel.
 *
 * `AdminService` keeps the ten original typed listings and every mutation;
 * this service adds the missing entity listings (columns, labels, checklists,
 * links, members, attachments, activity), the entity detail graphs and the
 * cross-entity search behind the omnibox. The generic `listEntity` switch is
 * the only place that maps an `AdminEntity` name to a query — the wire shape
 * per entity stays a typed DTO from `@janosik/shared`.
 */

/** Page window shared by every listing (clamped, never dumps whole tables). */
function window(query: AdminListQueryDto): { limit: number; offset: number } {
  const limit = Math.min(
    Math.max(query.limit ?? ADMIN_PAGE_LIMITS.default, ADMIN_PAGE_LIMITS.min),
    ADMIN_PAGE_LIMITS.max,
  );
  return { limit, offset: Math.max(query.offset ?? 0, 0) };
}

const MS = (value: Date | null): number | null =>
  value ? value.getTime() : null;

/** Search helper: insensitive `contains` for every OR branch. */
function like(value: string): Prisma.StringFilter {
  return { contains: value, mode: "insensitive" };
}

interface CardRowJoin {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
  columnId: string;
  priority: string | null;
  dueDate: Date | null;
  assignee: { id: string; email: string; displayName: string | null } | null;
  column: { title: string; boardId: string; board: { title: string } };
  comments: Array<{ id: string }>;
}

function toCardRow(card: CardRowJoin): AdminCardRowDto {
  return {
    id: card.id,
    title: card.title,
    boardId: card.column.boardId,
    boardTitle: card.column.board.title,
    columnId: card.columnId,
    columnTitle: card.column.title,
    commentIds: card.comments.map((comment) => comment.id),
    createdAt: card.createdAt.getTime(),
    updatedAt: card.updatedAt.getTime(),
    priority: card.priority,
    dueDate: MS(card.dueDate),
    assigneeId: card.assignee?.id ?? null,
    assigneeEmail: card.assignee?.email ?? null,
    archivedAt: MS(card.archivedAt),
    deletedAt: MS(card.deletedAt),
  };
}

const CARD_ROW_SELECT = {
  id: true,
  title: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  deletedAt: true,
  columnId: true,
  priority: true,
  dueDate: true,
  assignee: {
    select: { id: true, email: true, displayName: true },
  },
  column: {
    select: { title: true, boardId: true, board: { select: { title: true } } },
  },
  comments: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" as const },
    select: { id: true },
  },
} satisfies Prisma.CardSelect;

@Injectable()
export class AdminEntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  async listEntity<E extends AdminEntity>(
    entity: E,
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminEntityRowMap[E]>> {
    switch (entity) {
      case "users":
        return (await this.admin.listUsers(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "boards":
        return (await this.admin.listBoards(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "cards":
        return (await this.admin.listCards(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "comments":
        return (await this.admin.listComments(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "sessions":
        return (await this.admin.listSessions(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "tokens":
        return (await this.admin.listTokens(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "commands":
        return (await this.admin.listCommands(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "audit":
        return (await this.admin.listAudit(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "admins":
        throw new NotFoundException(
          "Masters keep their owner-only endpoint: GET /admin/admins",
        );
      case "boardMembers":
        return (await this.listBoardMembers(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "columns":
        return (await this.listColumns(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "cardLinks":
        return (await this.listCardLinks(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "labels":
        return (await this.listLabels(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "cardLabels":
        return (await this.listCardLabels(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "checklists":
        return (await this.listChecklists(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "checklistItems":
        return (await this.listChecklistItems(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "attachments":
        return (await this.listAttachments(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "activity":
        return (await this.listActivity(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      case "announcements":
        return (await this.listAnnouncements(query)) as AdminPage<
          AdminEntityRowMap[E]
        >;
      default:
        throw new NotFoundException(`Unknown entity: ${String(entity)}`);
    }
  }

  // ------------------------------------------------------------- new lists

  async listBoardMembers(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminBoardMemberRowDto>> {
    const where: Prisma.BoardMemberWhereInput = {};
    if (query.search) {
      const roleHit = (["ADMIN", "MEMBER", "VIEWER"] as const).find(
        (role) => role.toLowerCase() === query.search?.toLowerCase(),
      );
      where.OR = [
        { id: { contains: query.search } },
        { boardId: { contains: query.search } },
        { userId: { contains: query.search } },
        { board: { title: like(query.search) } },
        { user: { email: like(query.search) } },
        { user: { displayName: like(query.search) } },
        { invitedBy: { email: like(query.search) } },
      ];
      if (roleHit) where.OR.push({ role: roleHit });
    }
    if (query.status === "active") {
      where.acceptedAt = { not: null };
    }
    if (query.status === "disabled") {
      // Pending invitations.
      where.acceptedAt = null;
    }

    const { limit, offset } = window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.boardMember.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          userId: true,
          role: true,
          expiresAt: true,
          acceptedAt: true,
          createdAt: true,
          boardId: true,
          invitedById: true,
          board: { select: { title: true, deletedAt: true } },
          user: {
            select: { email: true, displayName: true, disabledAt: true },
          },
          invitedBy: { select: { email: true } },
        },
      }),
      this.prisma.boardMember.count({ where }),
    ]);

    return {
      items: items.map((member) => ({
        id: member.id,
        boardId: member.boardId,
        boardTitle: member.board.title,
        boardDeletedAt: MS(member.board.deletedAt),
        userId: member.userId,
        userEmail: member.user.email,
        userDisplayName: member.user.displayName,
        userDisabledAt: MS(member.user.disabledAt),
        role: member.role,
        expiresAt: MS(member.expiresAt),
        acceptedAt: MS(member.acceptedAt),
        invitedById: member.invitedById,
        invitedByEmail: member.invitedBy?.email ?? null,
        createdAt: member.createdAt.getTime(),
      })),
      total,
      limit,
      offset,
    };
  }

  async listColumns(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminColumnRowDto>> {
    const where: Prisma.ColumnWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { title: like(query.search) },
        { boardId: { contains: query.search } },
        { board: { title: like(query.search) } },
      ];
    }
    if (query.status === "active") where.deletedAt = null;
    if (query.status === "deleted") where.deletedAt = { not: null };

    const { limit, offset } = window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.column.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          title: true,
          wipLimit: true,
          position: true,
          deletedAt: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          boardId: true,
          board: { select: { title: true } },
          _count: {
            select: { cards: { where: { deletedAt: null } } },
          },
        },
      }),
      this.prisma.column.count({ where }),
    ]);

    return {
      items: items.map((column) => ({
        id: column.id,
        boardId: column.boardId,
        boardTitle: column.board.title,
        title: column.title,
        wipLimit: column.wipLimit,
        position: column.position,
        cardCount: column._count.cards,
        deletedAt: MS(column.deletedAt),
        version: column.version,
        createdAt: column.createdAt.getTime(),
        updatedAt: column.updatedAt.getTime(),
      })),
      total,
      limit,
      offset,
    };
  }

  async listCardLinks(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminCardLinkRowDto>> {
    const where: Prisma.CardLinkWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { type: like(query.search) },
        { boardId: { contains: query.search } },
        { fromCardId: { contains: query.search } },
        { toCardId: { contains: query.search } },
        { board: { title: like(query.search) } },
        { fromCard: { title: like(query.search) } },
        { toCard: { title: like(query.search) } },
      ];
    }
    if (query.status === "active") where.deletedAt = null;
    if (query.status === "deleted") where.deletedAt = { not: null };

    const { limit, offset } = window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.cardLink.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          type: true,
          position: true,
          deletedAt: true,
          createdAt: true,
          boardId: true,
          fromCardId: true,
          toCardId: true,
          board: { select: { title: true } },
          fromCard: { select: { title: true } },
          toCard: { select: { title: true } },
        },
      }),
      this.prisma.cardLink.count({ where }),
    ]);

    return {
      items: items.map((link) => ({
        id: link.id,
        boardId: link.boardId,
        boardTitle: link.board.title,
        fromCardId: link.fromCardId,
        fromCardTitle: link.fromCard.title,
        toCardId: link.toCardId,
        toCardTitle: link.toCard.title,
        type: link.type,
        position: link.position,
        deletedAt: MS(link.deletedAt),
        createdAt: link.createdAt.getTime(),
      })),
      total,
      limit,
      offset,
    };
  }

  async listLabels(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminLabelRowDto>> {
    const where: Prisma.LabelWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { name: like(query.search) },
        { color: like(query.search) },
        { boardId: { contains: query.search } },
        { board: { title: like(query.search) } },
      ];
    }
    if (query.status === "active") where.deletedAt = null;
    if (query.status === "deleted") where.deletedAt = { not: null };

    const { limit, offset } = window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.label.findMany({
        where,
        orderBy: [{ boardId: "asc" }, { position: "asc" }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          name: true,
          color: true,
          position: true,
          deletedAt: true,
          version: true,
          boardId: true,
          board: { select: { title: true } },
          _count: {
            select: { cards: { where: { card: { deletedAt: null } } } },
          },
        },
      }),
      this.prisma.label.count({ where }),
    ]);

    return {
      items: items.map((label) => ({
        id: label.id,
        boardId: label.boardId,
        boardTitle: label.board.title,
        name: label.name,
        color: label.color,
        position: label.position,
        cardCount: label._count.cards,
        deletedAt: MS(label.deletedAt),
        version: label.version,
      })),
      total,
      limit,
      offset,
    };
  }

  async listCardLabels(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminCardLabelRowDto>> {
    const where: Prisma.CardLabelWhereInput = {};
    if (query.search) {
      where.OR = [
        { cardId: { contains: query.search } },
        { labelId: { contains: query.search } },
        { card: { title: like(query.search) } },
        { label: { name: like(query.search) } },
        { card: { column: { board: { title: like(query.search) } } } },
      ];
    }

    const { limit, offset } = window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.cardLabel.findMany({
        where,
        orderBy: [{ cardId: "asc" }, { position: "asc" }],
        skip: offset,
        take: limit,
        select: {
          cardId: true,
          labelId: true,
          position: true,
          card: {
            select: {
              title: true,
              column: {
                select: { boardId: true, board: { select: { title: true } } },
              },
            },
          },
          label: { select: { name: true, color: true } },
        },
      }),
      this.prisma.cardLabel.count({ where }),
    ]);

    return {
      items: items.map((row) => ({
        cardId: row.cardId,
        cardTitle: row.card.title,
        labelId: row.labelId,
        labelName: row.label.name,
        labelColor: row.label.color,
        boardId: row.card.column.boardId,
        boardTitle: row.card.column.board.title,
        position: row.position,
      })),
      total,
      limit,
      offset,
    };
  }

  async listChecklists(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminChecklistRowDto>> {
    const where: Prisma.ChecklistWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { title: like(query.search) },
        { cardId: { contains: query.search } },
        { card: { title: like(query.search) } },
        { card: { column: { board: { title: like(query.search) } } } },
      ];
    }
    if (query.status === "active") where.deletedAt = null;
    if (query.status === "deleted") where.deletedAt = { not: null };

    const { limit, offset } = window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.checklist.findMany({
        where,
        orderBy: [{ cardId: "asc" }, { position: "asc" }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          title: true,
          position: true,
          deletedAt: true,
          version: true,
          cardId: true,
          card: {
            select: {
              title: true,
              column: {
                select: { boardId: true, board: { select: { title: true } } },
              },
            },
          },
          items: {
            where: { deletedAt: null },
            select: { done: true },
          },
        },
      }),
      this.prisma.checklist.count({ where }),
    ]);

    return {
      items: items.map((checklist) => ({
        id: checklist.id,
        cardId: checklist.cardId,
        cardTitle: checklist.card.title,
        boardId: checklist.card.column.boardId,
        boardTitle: checklist.card.column.board.title,
        title: checklist.title,
        position: checklist.position,
        itemCount: checklist.items.length,
        doneCount: checklist.items.filter((item) => item.done).length,
        deletedAt: MS(checklist.deletedAt),
        version: checklist.version,
      })),
      total,
      limit,
      offset,
    };
  }

  async listChecklistItems(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminChecklistItemRowDto>> {
    const where: Prisma.ChecklistItemWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { text: like(query.search) },
        { checklistId: { contains: query.search } },
        { checklist: { title: like(query.search) } },
        { checklist: { card: { title: like(query.search) } } },
        {
          checklist: {
            card: { column: { board: { title: like(query.search) } } },
          },
        },
      ];
    }
    if (query.status === "active") where.deletedAt = null;
    if (query.status === "deleted") where.deletedAt = { not: null };

    const { limit, offset } = window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.checklistItem.findMany({
        where,
        orderBy: [{ checklistId: "asc" }, { position: "asc" }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          text: true,
          done: true,
          position: true,
          deletedAt: true,
          version: true,
          checklistId: true,
          checklist: {
            select: {
              title: true,
              cardId: true,
              card: {
                select: {
                  title: true,
                  column: {
                    select: {
                      boardId: true,
                      board: { select: { title: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.checklistItem.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        checklistId: item.checklistId,
        checklistTitle: item.checklist.title,
        cardId: item.checklist.cardId,
        cardTitle: item.checklist.card.title,
        boardId: item.checklist.card.column.boardId,
        boardTitle: item.checklist.card.column.board.title,
        text: item.text,
        done: item.done,
        position: item.position,
        deletedAt: MS(item.deletedAt),
        version: item.version,
      })),
      total,
      limit,
      offset,
    };
  }

  async listAttachments(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminAttachmentRowDto>> {
    const where: Prisma.AttachmentWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { fileName: like(query.search) },
        { storedName: like(query.search) },
        { mimeType: like(query.search) },
        { cardId: { contains: query.search } },
        { boardId: { contains: query.search } },
        { card: { title: like(query.search) } },
        { uploadedBy: { email: like(query.search) } },
      ];
    }
    if (query.status === "active") where.deletedAt = null;
    if (query.status === "deleted") where.deletedAt = { not: null };

    const { limit, offset } = window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attachment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          fileName: true,
          storedName: true,
          mimeType: true,
          sizeBytes: true,
          transcodeStatus: true,
          deletedAt: true,
          createdAt: true,
          cardId: true,
          boardId: true,
          uploadedById: true,
          card: { select: { title: true } },
          uploadedBy: { select: { email: true } },
        },
      }),
      this.prisma.attachment.count({ where }),
    ]);

    return {
      items: items.map((file) => ({
        id: file.id,
        cardId: file.cardId,
        cardTitle: file.card.title,
        boardId: file.boardId,
        boardTitle: "—",
        fileName: file.fileName,
        storedName: file.storedName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        uploadedById: file.uploadedById,
        uploadedByEmail: file.uploadedBy.email,
        transcodeStatus: file.transcodeStatus,
        deletedAt: MS(file.deletedAt),
        createdAt: file.createdAt.getTime(),
      })),
      total,
      limit,
      offset,
    };
  }

  async listActivity(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminActivityRowDto>> {
    const where: Prisma.ActivityWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { type: like(query.search) },
        { boardId: { contains: query.search } },
        { cardId: { contains: query.search } },
        { actorId: { contains: query.search } },
        { actor: { email: like(query.search) } },
        { board: { title: like(query.search) } },
        { card: { title: like(query.search) } },
      ];
    }
    where.createdAt = {};
    if (query.from !== undefined) where.createdAt.gte = new Date(query.from);
    if (query.to !== undefined) where.createdAt.lte = new Date(query.to);

    const { limit, offset } = window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.activity.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          type: true,
          details: true,
          createdAt: true,
          boardId: true,
          cardId: true,
          actorId: true,
          board: { select: { title: true } },
          card: { select: { title: true } },
          actor: { select: { email: true } },
        },
      }),
      this.prisma.activity.count({ where }),
    ]);

    return {
      items: items.map((entry) => ({
        id: entry.id,
        boardId: entry.boardId,
        boardTitle: entry.board.title,
        cardId: entry.cardId,
        cardTitle: entry.card?.title ?? null,
        type: entry.type,
        actorId: entry.actorId,
        actorEmail: entry.actor.email,
        details: (entry.details as Record<string, unknown> | null) ?? null,
        createdAt: entry.createdAt.getTime(),
      })),
      total,
      limit,
      offset,
    };
  }

  // ------------------------------------------------------- announcements

  /** `GET /admin/entities/announcements` — the announcement/news history. */
  async listAnnouncements(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminAnnouncementDto>> {
    const where: Prisma.AnnouncementWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { title: like(query.search) },
        { body: like(query.search) },
        { createdBy: like(query.search) },
      ];
    }
    if (query.status === "active") where.active = true;
    if (query.status === "disabled" || query.status === "deleted") {
      where.active = false;
    }

    const { limit, offset } = window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      this.prisma.announcement.count({ where }),
    ]);

    return {
      items: items.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        level: row.level as AdminAnnouncementDto["level"],
        audience: row.audience as AdminAnnouncementDto["audience"],
        segment: row.segment,
        active: row.active,
        sendEmail: row.sendEmail,
        startsAt: row.startsAt?.getTime() ?? null,
        endsAt: row.endsAt?.getTime() ?? null,
        createdBy: row.createdBy,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      })),
      total,
      limit,
      offset,
    };
  }

  // ---------------------------------------------------------------- search

  /** Cross-entity top matches for the omnibox (`GET /admin/search`). */
  async globalSearch(rawQuery: string): Promise<AdminGlobalSearchDto> {
    const q = rawQuery.trim();
    if (!q) {
      return {
        users: [],
        boards: [],
        cards: [],
        comments: [],
        attachments: [],
        labels: [],
      };
    }
    const idMatch = { contains: q };
    const [users, boards, cards, comments, attachments, labels] =
      await this.prisma.$transaction([
        this.prisma.user.findMany({
          where: {
            OR: [{ id: idMatch }, { email: like(q) }, { displayName: like(q) }],
          },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            email: true,
            displayName: true,
            createdAt: true,
            disabledAt: true,
            emailVerifiedAt: true,
          },
        }),
        this.prisma.board.findMany({
          where: {
            OR: [
              { id: idMatch },
              { title: like(q) },
              { members: { some: { user: { email: like(q) } } } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: {
            id: true,
            title: true,
            createdAt: true,
            updatedAt: true,
            archivedAt: true,
            deletedAt: true,
            members: {
              where: { role: "ADMIN", acceptedAt: { not: null } },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { userId: true, user: { select: { email: true } } },
            },
          },
        }),
        this.prisma.card.findMany({
          where: {
            OR: [
              { id: idMatch },
              { title: like(q) },
              { description: like(q) },
              { comments: { some: { text: like(q) } } },
              { labels: { some: { label: { name: like(q) } } } },
              {
                assignee: {
                  OR: [{ email: like(q) }, { displayName: like(q) }],
                },
              },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: 8,
          select: CARD_ROW_SELECT,
        }),
        this.prisma.comment.findMany({
          where: {
            OR: [
              { id: idMatch },
              { text: like(q) },
              { author: { email: like(q) } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            text: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            cardId: true,
            authorId: true,
            card: { select: { title: true } },
            author: { select: { email: true } },
          },
        }),
        this.prisma.attachment.findMany({
          where: {
            OR: [
              { id: idMatch },
              { fileName: like(q) },
              { storedName: like(q) },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 4,
          select: {
            id: true,
            fileName: true,
            storedName: true,
            mimeType: true,
            sizeBytes: true,
            transcodeStatus: true,
            deletedAt: true,
            createdAt: true,
            cardId: true,
            boardId: true,
            uploadedById: true,
            card: { select: { title: true } },
            uploadedBy: { select: { email: true } },
          },
        }),
        this.prisma.label.findMany({
          where: {
            OR: [
              { id: idMatch },
              { name: like(q) },
              { board: { title: like(q) } },
            ],
          },
          orderBy: [{ boardId: "asc" as const }, { position: "asc" as const }],
          take: 4,
          select: {
            id: true,
            name: true,
            color: true,
            position: true,
            deletedAt: true,
            version: true,
            boardId: true,
            board: { select: { title: true } },
            _count: {
              select: { cards: { where: { card: { deletedAt: null } } } },
            },
          },
        }),
      ]);

    return {
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt.getTime(),
        disabledAt: MS(user.disabledAt),
        emailVerifiedAt: MS(user.emailVerifiedAt),
      })),
      boards: boards.map((board) => ({
        id: board.id,
        title: board.title,
        userId: board.members[0]?.userId ?? null,
        ownerEmail: board.members[0]?.user.email ?? null,
        createdAt: board.createdAt.getTime(),
        updatedAt: board.updatedAt.getTime(),
        archivedAt: MS(board.archivedAt),
        deletedAt: MS(board.deletedAt),
      })),
      cards: cards.map(toCardRow),
      comments: comments.map((comment) => ({
        id: comment.id,
        cardId: comment.cardId,
        cardTitle: comment.card.title,
        authorId: comment.authorId,
        authorEmail: comment.author.email,
        text: comment.text,
        createdAt: comment.createdAt.getTime(),
        updatedAt: comment.updatedAt.getTime(),
        deletedAt: MS(comment.deletedAt),
      })),
      attachments: attachments.map((file) => ({
        id: file.id,
        cardId: file.cardId,
        cardTitle: file.card.title,
        boardId: file.boardId,
        boardTitle: "—",
        fileName: file.fileName,
        storedName: file.storedName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        uploadedById: file.uploadedById,
        uploadedByEmail: file.uploadedBy.email,
        transcodeStatus: file.transcodeStatus,
        deletedAt: MS(file.deletedAt),
        createdAt: file.createdAt.getTime(),
      })),
      labels: labels.map((label) => ({
        id: label.id,
        boardId: label.boardId,
        boardTitle: label.board.title,
        name: label.name,
        color: label.color,
        position: label.position,
        cardCount: label._count.cards,
        deletedAt: MS(label.deletedAt),
        version: label.version,
      })),
    };
  }

  // --------------------------------------------------------------- details

  /** `GET /admin/users/:id` — the full user graph. */
  async userDetail(userId: string): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
        disabledAt: true,
        emailVerifiedAt: true,
      },
    });
    if (!user) throw new NotFoundException("User not found");

    const createdIds = await this.prisma.command.findMany({
      where: { actorId: userId, type: { in: ["ADD_CARD", "DUPLICATE_CARD"] } },
      select: { payload: true },
      orderBy: { seq: "desc" },
      take: 500,
    });
    const cardIds = [
      ...new Set(
        createdIds
          .map((row) => (row.payload as Record<string, unknown>).newCardId)
          .filter((value): value is string => typeof value === "string"),
      ),
    ];

    const [
      memberships,
      createdCards,
      assignedCards,
      comments,
      attachments,
      sessions,
      tokens,
      recentCommands,
      recentActivity,
      boardCount,
      cardsAssigned,
      commentCount,
      attachmentCount,
      sessionCount,
      tokenCount,
      commandCount,
    ] = await this.prisma.$transaction([
      this.prisma.boardMember.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          role: true,
          acceptedAt: true,
          expiresAt: true,
          createdAt: true,
          boardId: true,
          invitedById: true,
          board: { select: { title: true, deletedAt: true } },
          invitedBy: { select: { email: true } },
        },
      }),
      this.prisma.card.findMany({
        where: { id: { in: cardIds } },
        select: CARD_ROW_SELECT,
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      this.prisma.card.findMany({
        where: { assigneeId: userId, deletedAt: null },
        select: CARD_ROW_SELECT,
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      this.prisma.comment.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: COMMENT_SELECT,
      }),
      this.prisma.attachment.findMany({
        where: { uploadedById: userId },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: ATTACHMENT_SELECT,
      }),
      this.prisma.refreshToken.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: SESSION_SELECT,
      }),
      this.prisma.apiToken.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: TOKEN_SELECT,
      }),
      this.prisma.command.findMany({
        where: { actorId: userId },
        orderBy: { seq: "desc" },
        take: 25,
        select: COMMAND_SELECT,
      }),
      this.prisma.activity.findMany({
        where: { actorId: userId },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: ACTIVITY_SELECT,
      }),
      this.prisma.boardMember.count({
        where: { userId, acceptedAt: { not: null } },
      }),
      this.prisma.card.count({
        where: { assigneeId: userId, deletedAt: null },
      }),
      this.prisma.comment.count({
        where: { authorId: userId, deletedAt: null },
      }),
      this.prisma.attachment.count({
        where: { uploadedById: userId, deletedAt: null },
      }),
      this.prisma.refreshToken.count({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      this.prisma.apiToken.count({
        where: { userId, revokedAt: null },
      }),
      this.prisma.command.count({ where: { actorId: userId } }),
    ]);

    const userRow: AdminUserRowDto = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.getTime(),
      disabledAt: MS(user.disabledAt),
      emailVerifiedAt: MS(user.emailVerifiedAt),
    };

    return {
      user: userRow,
      counters: {
        boards: boardCount,
        cardsCreated: createdCards.length,
        cardsAssigned,
        comments: commentCount,
        attachments: attachmentCount,
        sessions: sessionCount,
        tokens: tokenCount,
        commands: commandCount,
      },
      memberships: memberships.map((membership) => ({
        id: membership.id,
        boardId: membership.boardId,
        boardTitle: membership.board.title,
        boardDeletedAt: MS(membership.board.deletedAt),
        role: membership.role,
        acceptedAt: MS(membership.acceptedAt),
        expiresAt: MS(membership.expiresAt),
        invitedByEmail: membership.invitedBy?.email ?? null,
        createdAt: membership.createdAt.getTime(),
      })),
      createdCards: createdCards.map(toCardRow),
      assignedCards: assignedCards.map(toCardRow),
      comments: comments.map(toCommentRow),
      attachments: attachments.map(toAttachmentRow),
      sessions: sessions.map(toSessionRow),
      tokens: tokens.map(toTokenRow),
      recentCommands: recentCommands.map(toCommandRow),
      recentActivity: recentActivity.map(toActivityRow),
    };
  }

  /** `GET /admin/cards/:id` — the full card graph. */
  async cardDetail(cardId: string): Promise<AdminCardDetailDto> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        title: true,
        description: true,
        coverType: true,
        coverValue: true,
        dueDate: true,
        priority: true,
        assignee: { select: { id: true, email: true, displayName: true } },
        archivedAt: true,
        deletedAt: true,
        version: true,
        position: true,
        attachmentCount: true,
        createdAt: true,
        updatedAt: true,
        lastActorId: true,
        columnId: true,
        column: {
          select: {
            title: true,
            boardId: true,
            board: { select: { title: true } },
          },
        },
        labels: {
          orderBy: { position: "asc" },
          select: {
            position: true,
            label: { select: { id: true, name: true, color: true } },
          },
        },
        checklists: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            position: true,
            deletedAt: true,
            items: {
              orderBy: { position: "asc" },
              select: {
                id: true,
                text: true,
                done: true,
                position: true,
                deletedAt: true,
              },
            },
          },
        },
        linksFrom: {
          select: {
            id: true,
            type: true,
            deletedAt: true,
            createdAt: true,
            toCardId: true,
            toCard: { select: { title: true } },
          },
        },
        linksTo: {
          select: {
            id: true,
            type: true,
            deletedAt: true,
            createdAt: true,
            fromCardId: true,
            fromCard: { select: { title: true } },
          },
        },
        comments: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            text: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            cardId: true,
            authorId: true,
            card: { select: { title: true } },
            author: { select: { email: true } },
          },
        },
        attachments: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: ATTACHMENT_SELECT,
        },
      },
    });
    if (!card) throw new NotFoundException("Card not found");

    // `Card` carries no creator column — derive it from the command log:
    // the oldest ADD_CARD / DUPLICATE_CARD command whose payload names this
    // card. Rows predating the log (or IMPORT_BOARDS) stay null.
    const creationCommands = await this.prisma.command.findMany({
      where: {
        type: { in: ["ADD_CARD", "DUPLICATE_CARD"] },
        OR: [
          { touches: { has: `card:${cardId}` } },
          { payload: { string_contains: cardId } },
        ],
      },
      orderBy: { seq: "asc" },
      take: 20,
      select: {
        actorId: true,
        payload: true,
        createdAt: true,
        actor: { select: { email: true } },
      },
    });
    const creation = creationCommands.find(
      (row) => (row.payload as Record<string, unknown>).newCardId === cardId,
    );
    const createdBy = creation
      ? {
          actorId: creation.actorId,
          actorEmail: creation.actor.email,
          at: creation.createdAt.getTime(),
        }
      : null;

    const lastActorEmail = card.lastActorId
      ? ((
          await this.prisma.user.findUnique({
            where: { id: card.lastActorId },
            select: { email: true },
          })
        )?.email ?? null)
      : null;

    const [activity, commands] = await this.prisma.$transaction([
      this.prisma.activity.findMany({
        where: { cardId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: ACTIVITY_SELECT,
      }),
      this.prisma.command.findMany({
        where: { touches: { has: `card:${cardId}` } },
        orderBy: { seq: "desc" },
        take: 30,
        select: COMMAND_SELECT,
      }),
    ]);

    const timeline = [
      ...activity.map((entry) => ({
        id: entry.id,
        kind: "activity" as const,
        type: entry.type,
        actorId: entry.actorId,
        actorEmail: entry.actor.email,
        details: (entry.details as Record<string, unknown> | null) ?? null,
        createdAt: entry.createdAt.getTime(),
      })),
      ...commands.map((entry) => ({
        id: entry.id,
        kind: "command" as const,
        type: entry.type,
        actorId: entry.actorId,
        actorEmail: entry.actor.email,
        details: (entry.details as Record<string, unknown> | null) ?? null,
        createdAt: entry.createdAt.getTime(),
      })),
    ]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);

    return {
      card: {
        id: card.id,
        title: card.title,
        boardId: card.column.boardId,
        boardTitle: card.column.board.title,
        columnId: card.columnId,
        columnTitle: card.column.title,
        commentIds: card.comments
          .filter((comment) => !comment.deletedAt)
          .map((comment) => comment.id),
        createdAt: card.createdAt.getTime(),
        updatedAt: card.updatedAt.getTime(),
        archivedAt: MS(card.archivedAt),
        deletedAt: MS(card.deletedAt),
        description: card.description,
        dueDate: MS(card.dueDate),
        priority: card.priority,
        assigneeId: card.assignee?.id ?? null,
        assigneeEmail: card.assignee?.email ?? null,
        assigneeDisplayName: card.assignee?.displayName ?? null,
        coverType: card.coverType,
        coverValue: card.coverValue,
        version: card.version,
        attachmentCount: card.attachmentCount,
        lastActorEmail,
      },
      labels: card.labels.map((row) => ({
        id: row.label.id,
        name: row.label.name,
        color: row.label.color,
        position: row.position,
      })),
      checklists: card.checklists.map((checklist) => ({
        id: checklist.id,
        title: checklist.title,
        position: checklist.position,
        deletedAt: MS(checklist.deletedAt),
        items: checklist.items.map((item) => ({
          id: item.id,
          text: item.text,
          done: item.done,
          position: item.position,
          deletedAt: MS(item.deletedAt),
        })),
      })),
      linksOut: card.linksFrom.map((link) => ({
        id: link.id,
        otherCardId: link.toCardId,
        otherCardTitle: link.toCard.title,
        type: link.type,
        deletedAt: MS(link.deletedAt),
        createdAt: link.createdAt.getTime(),
      })),
      linksIn: card.linksTo.map((link) => ({
        id: link.id,
        otherCardId: link.fromCardId,
        otherCardTitle: link.fromCard.title,
        type: link.type,
        deletedAt: MS(link.deletedAt),
        createdAt: link.createdAt.getTime(),
      })),
      comments: card.comments.map(toCommentRow),
      attachments: card.attachments.map(toAttachmentRow),
      timeline,
      createdBy,
    };
  }

  /** `GET /admin/boards/:id/meta` — counts, members, columns, labels. */
  async boardDetail(boardId: string): Promise<AdminBoardDetailDto> {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: {
        id: true,
        title: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        archivedAt: true,
        deletedAt: true,
        members: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            expiresAt: true,
            acceptedAt: true,
            createdAt: true,
            boardId: true,
            invitedById: true,
            board: { select: { title: true, deletedAt: true } },
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
                disabledAt: true,
              },
            },
            invitedBy: { select: { email: true } },
          },
        },
        columns: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            wipLimit: true,
            position: true,
            deletedAt: true,
            version: true,
            createdAt: true,
            updatedAt: true,
            boardId: true,
            board: { select: { title: true } },
            _count: { select: { cards: { where: { deletedAt: null } } } },
          },
        },
        labels: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            color: true,
            position: true,
            deletedAt: true,
            version: true,
            boardId: true,
            board: { select: { title: true } },
            _count: {
              select: { cards: { where: { card: { deletedAt: null } } } },
            },
          },
        },
        _count: {
          select: {
            members: true,
            columns: true,
            labels: true,
            cardLinks: true,
            activity: true,
            commands: true,
          },
        },
      },
    });
    if (!board) throw new NotFoundException("Board not found");

    const boardRow = {
      id: board.id,
      title: board.title,
      version: board.version,
      createdAt: board.createdAt.getTime(),
      updatedAt: board.updatedAt.getTime(),
      archivedAt: MS(board.archivedAt),
      deletedAt: MS(board.deletedAt),
    };
    const owner = board.members.find(
      (member) => member.role === "ADMIN" && member.acceptedAt !== null,
    );
    const [cardCount, commentCount, attachmentCount] =
      await this.prisma.$transaction([
        this.prisma.card.count({
          where: { column: { boardId }, deletedAt: null },
        }),
        this.prisma.comment.count({
          where: { card: { column: { boardId } }, deletedAt: null },
        }),
        this.prisma.attachment.count({
          where: { boardId, deletedAt: null },
        }),
      ]);

    return {
      board: {
        ...boardRow,
        userId: owner?.user.id ?? null,
        ownerEmail: owner?.user.email ?? null,
        counts: {
          members: board._count.members,
          columns: board._count.columns,
          cards: cardCount,
          labels: board._count.labels,
          links: board._count.cardLinks,
          comments: commentCount,
          attachments: attachmentCount,
          commands: board._count.commands,
          activity: board._count.activity,
        },
      },
      members: board.members.map((member) => ({
        id: member.id,
        boardId: member.boardId,
        boardTitle: member.board.title,
        boardDeletedAt: MS(member.board.deletedAt),
        userId: member.user.id,
        userEmail: member.user.email,
        userDisplayName: member.user.displayName,
        userDisabledAt: MS(member.user.disabledAt),
        role: member.role,
        expiresAt: MS(member.expiresAt),
        acceptedAt: MS(member.acceptedAt),
        invitedById: member.invitedById,
        invitedByEmail: member.invitedBy?.email ?? null,
        createdAt: member.createdAt.getTime(),
      })),
      columns: board.columns.map((column) => ({
        id: column.id,
        boardId: column.boardId,
        boardTitle: column.board.title,
        title: column.title,
        wipLimit: column.wipLimit,
        position: column.position,
        cardCount: column._count.cards,
        deletedAt: MS(column.deletedAt),
        version: column.version,
        createdAt: column.createdAt.getTime(),
        updatedAt: column.updatedAt.getTime(),
      })),
      labels: board.labels.map((label) => ({
        id: label.id,
        boardId: label.boardId,
        boardTitle: label.board.title,
        name: label.name,
        color: label.color,
        position: label.position,
        cardCount: label._count.cards,
        deletedAt: MS(label.deletedAt),
        version: label.version,
      })),
    };
  }

  // -------------------------------------------------------------- mappings
}

type CommentJoin = {
  id: string;
  text: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  cardId: string;
  authorId: string;
  card: { title: string };
  author: { email: string };
};

function toCommentRow(comment: CommentJoin): AdminCommentRowDto {
  return {
    id: comment.id,
    cardId: comment.cardId,
    cardTitle: comment.card.title,
    authorId: comment.authorId,
    authorEmail: comment.author.email,
    text: comment.text,
    createdAt: comment.createdAt.getTime(),
    updatedAt: comment.updatedAt.getTime(),
    deletedAt: MS(comment.deletedAt),
  };
}

const COMMENT_SELECT = {
  id: true,
  text: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  cardId: true,
  authorId: true,
  card: { select: { title: true } },
  author: { select: { email: true } },
} satisfies Prisma.CommentSelect;

type AttachmentJoin = {
  id: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  transcodeStatus: string;
  deletedAt: Date | null;
  createdAt: Date;
  cardId: string;
  boardId: string;
  uploadedById: string;
  card: { title: string };
  uploadedBy: { email: string };
};

function toAttachmentRow(file: AttachmentJoin): AdminAttachmentRowDto {
  return {
    id: file.id,
    cardId: file.cardId,
    cardTitle: file.card.title,
    boardId: file.boardId,
    boardTitle: "—",
    fileName: file.fileName,
    storedName: file.storedName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    uploadedById: file.uploadedById,
    uploadedByEmail: file.uploadedBy.email,
    transcodeStatus: file.transcodeStatus,
    deletedAt: MS(file.deletedAt),
    createdAt: file.createdAt.getTime(),
  };
}

const ATTACHMENT_SELECT = {
  id: true,
  fileName: true,
  storedName: true,
  mimeType: true,
  sizeBytes: true,
  transcodeStatus: true,
  deletedAt: true,
  createdAt: true,
  cardId: true,
  boardId: true,
  uploadedById: true,
  card: { select: { title: true } },
  uploadedBy: { select: { email: true } },
} satisfies Prisma.AttachmentSelect;

type SessionJoin = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  userId: string;
  ip: string | null;
  userAgent: string | null;
  user: { email: string };
};

function toSessionRow(session: SessionJoin): AdminSessionRowDto {
  return {
    id: session.id,
    userId: session.userId,
    userEmail: session.user.email,
    createdAt: session.createdAt.getTime(),
    expiresAt: session.expiresAt.getTime(),
    ip: session.ip,
    userAgent: session.userAgent,
  };
}

const SESSION_SELECT = {
  id: true,
  createdAt: true,
  expiresAt: true,
  userId: true,
  ip: true,
  userAgent: true,
  user: { select: { email: true } },
} satisfies Prisma.RefreshTokenSelect;

type TokenJoin = {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  userId: string;
  user: { email: string };
};

function toTokenRow(token: TokenJoin): AdminTokenRowDto {
  return {
    id: token.id,
    userId: token.userId,
    userEmail: token.user.email,
    name: token.name,
    createdAt: token.createdAt.getTime(),
    lastUsedAt: MS(token.lastUsedAt),
    expiresAt: MS(token.expiresAt),
    revokedAt: MS(token.revokedAt),
  };
}

const TOKEN_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  userId: true,
  user: { select: { email: true } },
} satisfies Prisma.ApiTokenSelect;

type CommandJoin = {
  id: string;
  type: string;
  seq: bigint;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  boardId: string;
  actorId: string;
  board: { title: string };
  actor: { email: string };
};

function toCommandRow(command: CommandJoin): AdminCommandRowDto {
  return {
    id: command.id,
    boardId: command.boardId,
    boardTitle: command.board.title,
    actorId: command.actorId,
    actorEmail: command.actor.email,
    type: command.type,
    seq: Number(command.seq),
    createdAt: command.createdAt.getTime(),
    payload: (command.payload as Record<string, unknown> | null) ?? null,
  };
}

const COMMAND_SELECT = {
  id: true,
  type: true,
  seq: true,
  details: true,
  payload: true,
  createdAt: true,
  boardId: true,
  actorId: true,
  board: { select: { title: true } },
  actor: { select: { email: true } },
} satisfies Prisma.CommandSelect;

type ActivityJoin = {
  id: string;
  type: string;
  details: Prisma.JsonValue | null;
  createdAt: Date;
  boardId: string;
  cardId: string | null;
  actorId: string;
  board: { title: string };
  card: { title: string } | null;
  actor: { email: string };
};

function toActivityRow(entry: ActivityJoin): AdminActivityRowDto {
  return {
    id: entry.id,
    boardId: entry.boardId,
    boardTitle: entry.board.title,
    cardId: entry.cardId,
    cardTitle: entry.card?.title ?? null,
    type: entry.type,
    actorId: entry.actorId,
    actorEmail: entry.actor.email,
    details: (entry.details as Record<string, unknown> | null) ?? null,
    createdAt: entry.createdAt.getTime(),
  };
}

const ACTIVITY_SELECT = {
  id: true,
  type: true,
  details: true,
  createdAt: true,
  boardId: true,
  cardId: true,
  actorId: true,
  board: { select: { title: true } },
  card: { select: { title: true } },
  actor: { select: { email: true } },
} satisfies Prisma.ActivitySelect;
