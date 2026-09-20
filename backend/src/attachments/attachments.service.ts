import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AttachmentDto } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";

import type { AuthUser } from "@/auth/auth.types";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { ATTACHMENT_MIME_ALLOWLIST, StorageService } from "./storage.service";

/** Express multer file shape used by the controller. */
export interface UploadedBlob {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Card file attachments (TASK-47) — comments-style REST outside the command
 * loop: no undo, no board JSON. Each write stamps the denormalized
 * `Card.attachmentCount` (the card-face badge) and publishes an `activity`
 * SSE frame so open dialogs refresh without polling.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(
    cardId: string,
    user: AuthUser,
    file: UploadedBlob,
    isInline = false,
  ): Promise<AttachmentDto> {
    if (!file || file.size <= 0) {
      throw new BadRequestException({
        message: "File is required",
        field: "file",
      });
    }
    if (file.size > LIMITS.attachmentSize) {
      throw new BadRequestException({
        message: `File must be at most ${LIMITS.attachmentSize} bytes`,
        field: "file",
      });
    }
    if (!ATTACHMENT_MIME_ALLOWLIST.test(file.mimetype)) {
      throw new BadRequestException({
        message: "File type is not allowed",
        field: "file",
      });
    }

    const card = await this.prisma.card.findFirst({
      where: { id: cardId, deletedAt: null },
      select: { id: true, column: { select: { boardId: true } } },
    });
    if (!card) throw new NotFoundException();

    const live = await this.prisma.attachment.count({
      where: { cardId, deletedAt: null },
    });
    if (live >= LIMITS.attachmentsPerCard) {
      throw new BadRequestException({
        message: `Card must hold at most ${LIMITS.attachmentsPerCard} attachments`,
        field: "file",
      });
    }

    const fileName = this.storage.sanitizeFileName(file.originalname);
    const storedName = this.storage.storedName(fileName);
    await this.storage.ensureDirs();
    await writeFile(this.storage.attachmentPath(storedName), file.buffer);

    const now = new Date();
    // Inline media (pasted into the description/comment body) skip the
    // card-face counter, the activity row and the SSE frame: nothing in
    // the attachment UI changes, only the body markdown references them.
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.attachment.create({
        data: {
          id: randomUUID(),
          cardId,
          boardId: card.column.boardId,
          fileName,
          storedName,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          uploadedById: user.id,
          isInline,
          createdAt: now,
        },
      });
      if (!isInline) {
        await tx.card.update({
          where: { id: cardId },
          data: { attachmentCount: { increment: 1 } },
        });
        const activity = await tx.activity.create({
          data: {
            boardId: card.column.boardId,
            cardId,
            type: "attachment_added",
            actorId: user.id,
            details: { attachmentId: row.id, fileName },
          },
        });
        return { row, activityId: activity.id };
      }
      return { row, activityId: null };
    });

    if (created.activityId === null) return toAttachmentDto(created.row);

    this.publish(
      card.column.boardId,
      cardId,
      created.activityId,
      user.id,
      "attachment_added",
      created.row.id,
    );
    return toAttachmentDto(created.row);
  }

  async list(cardId: string): Promise<AttachmentDto[]> {
    const rows = await this.prisma.attachment.findMany({
      where: { cardId, deletedAt: null, isInline: false },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toAttachmentDto);
  }

  /**
   * Resolve a live attachment for streaming — the guard has already proven
   * the caller is a member of the owning board.
   */
  async content(attachmentId: string): Promise<{
    meta: AttachmentDto;
    storedName: string;
  }> {
    const row = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, deletedAt: null },
    });
    if (!row) throw new NotFoundException();
    return { meta: toAttachmentDto(row), storedName: row.storedName };
  }

  async remove(attachmentId: string, user: AuthUser): Promise<void> {
    const row = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, deletedAt: null },
      select: {
        id: true,
        cardId: true,
        boardId: true,
        storedName: true,
        uploadedById: true,
        card: { select: { deletedAt: true } },
      },
    });
    if (!row || row.card.deletedAt !== null) throw new NotFoundException();

    // Uploader or board ADMIN — the comments rule (author-only) does not
    // fit files, where cleanup is a board-management concern.
    if (row.uploadedById !== user.id) {
      const membership = await this.prisma.boardMember.findFirst({
        where: {
          boardId: row.boardId,
          userId: user.id,
          acceptedAt: { not: null },
        },
        select: { role: true },
      });
      if (membership?.role !== "ADMIN") throw new ForbiddenException();
    }

    const removed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.attachment.updateMany({
        where: { id: attachmentId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (updated.count === 0) return null;
      await tx.card.update({
        where: { id: row.cardId },
        data: { attachmentCount: { decrement: 1 } },
      });
      const activity = await tx.activity.create({
        data: {
          boardId: row.boardId,
          cardId: row.cardId,
          type: "attachment_deleted",
          actorId: user.id,
          details: { attachmentId },
        },
      });
      return activity.id;
    });
    if (!removed) return;

    await this.storage.remove(this.storage.attachmentPath(row.storedName));
    this.publish(
      row.boardId,
      row.cardId,
      removed,
      user.id,
      "attachment_deleted",
      attachmentId,
    );
  }

  private publish(
    boardId: string,
    cardId: string,
    activityId: string,
    actorId: string,
    kind: "attachment_added" | "attachment_deleted",
    detail: string,
  ): void {
    this.realtime.publish(boardId, {
      type: "activity",
      id: activityId,
      boardId,
      cardId,
      actorId,
      at: Date.now(),
      kind,
      detail,
    });
  }
}

function toAttachmentDto(row: {
  id: string;
  cardId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  createdAt: Date;
}): AttachmentDto {
  return {
    id: row.id,
    cardId: row.cardId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt.getTime(),
  };
}
