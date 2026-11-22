import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  DELETED_ITEM_TYPES,
  type DeletedBoardItemDto,
  type DeletedBoardItemsDto,
  type DeletedItemType,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";
import { CommandsService } from "@/commands/commands.service";
import { loadCardRestore, loadColumnRestore } from "@/admin/admin-snapshots";
import type { AuthPrincipal } from "@/auth/auth-principal";
import type { RequestAttribution } from "@/auth/request-attribution";
import { OpsSettingsService } from "@/ops/ops-settings.service";
import { CommentsService } from "@/comments/comments.service";
import { AttachmentsService } from "@/attachments/attachments.service";

const DAY_MS = 86_400_000;
/** One page is enough for the dialog; older rows are announced, not hidden. */
const DELETED_PAGE_SIZE = 200;

function isDeletedItemType(value: string): value is DeletedItemType {
  return (DELETED_ITEM_TYPES as readonly string[]).includes(value);
}

/**
 * TASK-177.7 — user-facing "Recently deleted" (G-15).
 *
 * Deletion is soft: cards, columns, comments and attachments keep their row
 * until the maintenance sweep reaches the retention cutoff. Board
 * ADMIN/MEMBER can see that window and undo a mistake without waking a
 * platform administrator. Cards and columns are restored through the same
 * command log the admin panel uses, so version/SSE/history stay consistent;
 * comments and attachments are restored by their own services because they
 * live outside the command log.
 */
@Injectable()
export class DeletedItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ops: OpsSettingsService,
    private readonly commands: CommandsService,
    private readonly comments: CommentsService,
    private readonly attachments: AttachmentsService,
  ) {}

  private async retentionDays(): Promise<number> {
    return (await this.ops.retentionDays()) ?? env.PURGE_AFTER_DAYS;
  }

  async list(boardId: string): Promise<DeletedBoardItemsDto> {
    const retentionDays = await this.retentionDays();
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
    const take = DELETED_PAGE_SIZE + 1;

    const [cards, columns, comments, attachments] = await Promise.all([
      // Cards whose column is still live can be restored one by one. A card
      // taken down with its column comes back with that column's restore.
      this.prisma.card.findMany({
        where: {
          deletedAt: { gte: cutoff },
          column: { boardId, deletedAt: null },
        },
        select: {
          id: true,
          title: true,
          deletedAt: true,
          column: { select: { id: true, title: true } },
        },
        orderBy: { deletedAt: "desc" },
        take,
      }),
      this.prisma.column.findMany({
        where: { boardId, deletedAt: { gte: cutoff } },
        select: { id: true, title: true, deletedAt: true },
        orderBy: { deletedAt: "desc" },
        take,
      }),
      this.prisma.comment.findMany({
        where: {
          deletedAt: { gte: cutoff },
          card: { deletedAt: null, column: { boardId, deletedAt: null } },
        },
        select: {
          id: true,
          text: true,
          deletedAt: true,
          author: { select: { displayName: true, email: true } },
          card: { select: { id: true, title: true } },
        },
        orderBy: { deletedAt: "desc" },
        take,
      }),
      // Normal card-face files only: inline media and description uploads
      // were never in the file list, so restoring them here would be a
      // surprise rather than a recovery.
      this.prisma.attachment.findMany({
        where: {
          boardId,
          deletedAt: { gte: cutoff },
          isInline: false,
          descriptionEmbed: false,
          descriptionDetached: false,
          card: { deletedAt: null, column: { deletedAt: null } },
        },
        select: {
          id: true,
          fileName: true,
          sizeBytes: true,
          deletedAt: true,
          card: { select: { id: true, title: true } },
        },
        orderBy: { deletedAt: "desc" },
        take,
      }),
    ]);

    const items: DeletedBoardItemDto[] = [
      ...cards.map((row) => ({
        type: "cards" as const,
        id: row.id,
        title: row.title,
        deletedAt: row.deletedAt!.getTime(),
        purgeAt: row.deletedAt!.getTime() + retentionDays * DAY_MS,
        cardId: row.id,
        cardTitle: row.title,
      })),
      ...columns.map((row) => ({
        type: "columns" as const,
        id: row.id,
        title: row.title,
        deletedAt: row.deletedAt!.getTime(),
        purgeAt: row.deletedAt!.getTime() + retentionDays * DAY_MS,
      })),
      ...comments.map((row) => ({
        type: "comments" as const,
        id: row.id,
        // The dialog only needs a recognizable excerpt. The full body stays
        // behind the normal comment read once it is restored.
        title: excerpt(row.text),
        deletedAt: row.deletedAt!.getTime(),
        purgeAt: row.deletedAt!.getTime() + retentionDays * DAY_MS,
        cardId: row.card.id,
        cardTitle: row.card.title,
        authorName: row.author.displayName ?? row.author.email,
      })),
      ...attachments.map((row) => ({
        type: "attachments" as const,
        id: row.id,
        title: row.fileName,
        deletedAt: row.deletedAt!.getTime(),
        purgeAt: row.deletedAt!.getTime() + retentionDays * DAY_MS,
        cardId: row.card.id,
        cardTitle: row.card.title,
        sizeBytes: row.sizeBytes,
      })),
    ].sort((a, b) => b.deletedAt - a.deletedAt);

    return {
      retentionDays,
      items: items.slice(0, DELETED_PAGE_SIZE),
      truncated: items.length > DELETED_PAGE_SIZE,
    };
  }

  async restore(
    boardId: string,
    type: string,
    itemId: string,
    user: { id: string },
    role: Role,
    attribution: RequestAttribution,
    principal?: AuthPrincipal,
  ): Promise<{ status: "ok" }> {
    if (!isDeletedItemType(type)) {
      throw new BadRequestException(
        `type must be one of: ${DELETED_ITEM_TYPES.join(", ")}`,
      );
    }
    const retentionDays = await this.retentionDays();
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

    if (type === "comments") {
      await this.comments.restoreItem(
        boardId,
        itemId,
        user.id,
        cutoff,
        attribution,
      );
      return { status: "ok" };
    }
    if (type === "attachments") {
      await this.attachments.restoreItem(
        boardId,
        itemId,
        user.id,
        cutoff,
        attribution,
      );
      return { status: "ok" };
    }

    if (type === "cards") {
      const card = await this.prisma.card.findFirst({
        where: { id: itemId, column: { boardId } },
        select: { deletedAt: true, column: { select: { deletedAt: true } } },
      });
      if (!card || card.deletedAt === null) {
        throw new NotFoundException("Card not found in Recently deleted");
      }
      if (card.deletedAt < cutoff) throw retentionExpired("card");
      if (card.column.deletedAt !== null) {
        throw new ConflictException({
          message: "Restore the card's column before restoring the card",
          code: "column_deleted",
        });
      }
      const snapshot = await loadCardRestore(this.prisma, itemId);
      if (!snapshot) throw new NotFoundException("Card not found");
      await this.commands.apply(
        boardId,
        user.id,
        {
          commandId: randomUUID(),
          action: {
            type: "RESTORE_CARD",
            boardId,
            at: Date.now(),
            card: snapshot.card,
            ...(snapshot.columnId !== null
              ? { columnId: snapshot.columnId, index: snapshot.index }
              : {}),
          },
        },
        { actorRole: role, attribution, principal },
      );
      return { status: "ok" };
    }

    const column = await this.prisma.column.findFirst({
      where: { id: itemId, boardId },
      select: { deletedAt: true },
    });
    if (!column || column.deletedAt === null) {
      throw new NotFoundException("Column not found in Recently deleted");
    }
    if (column.deletedAt < cutoff) throw retentionExpired("column");
    const snapshot = await loadColumnRestore(this.prisma, itemId);
    if (!snapshot) throw new NotFoundException("Column not found");
    await this.commands.apply(
      boardId,
      user.id,
      {
        commandId: randomUUID(),
        action: {
          type: "RESTORE_COLUMN",
          boardId,
          at: Date.now(),
          column: snapshot.column,
          index: snapshot.index,
          cards: snapshot.cards,
        },
      },
      { actorRole: role, attribution, principal },
    );
    return { status: "ok" };
  }
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}

function retentionExpired(what: string): GoneException {
  return new GoneException({
    message: `This ${what} is past the retention period and can no longer be restored`,
    code: "retention_expired",
  });
}
