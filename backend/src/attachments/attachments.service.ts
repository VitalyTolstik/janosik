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
import { BoardWriteService } from "@/common/board-write.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { FeatureFlagsService } from "@/ops/feature-flags.service";
import {
  ATTACHMENT_MIME_ALLOWLIST,
  SIGNATURE_REQUIRED_MIME,
  sniffMime,
  StorageService,
} from "./storage.service";
import { MediaService } from "./media.service";
import { TranscodeService } from "./transcode.service";

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
    private readonly boardWrite: BoardWriteService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly transcode: TranscodeService,
    private readonly media: MediaService,
    private readonly flags: FeatureFlagsService,
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
    // The declared multipart type is a hint, never the truth (TASK-76):
    // detect the real family from the bytes and store *that*. A client that
    // declares an image/video/archive but uploads unrecognizable bytes (HTML
    // dressed as a PNG) is refused.
    const sniffed = sniffMime(file.buffer);
    let mimeType: string;
    if (sniffed !== null) {
      if (!ATTACHMENT_MIME_ALLOWLIST.test(sniffed)) {
        throw new BadRequestException({
          message: "File type is not allowed",
          field: "file",
        });
      }
      mimeType = sniffed;
    } else if (SIGNATURE_REQUIRED_MIME.test(file.mimetype)) {
      throw new BadRequestException({
        message: "File contents do not match the declared type",
        field: "file",
      });
    } else {
      mimeType = file.mimetype;
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

    // TASK-50: videos take the "ужиматор" route — the upload is playable
    // immediately; the background job swaps the blob for a compact MP4.
    // The `video_transcode` flag (TASK-61) can switch it off per-user/globally.
    const transcodeStatus =
      mimeType.startsWith("video/") &&
      (await this.flags.isEnabled("video_transcode", user.id))
        ? "pending"
        : "none";

    // TASK-70: images get a thumbnail, videos a poster — generated in the
    // background (queue `media`), never blocking the upload.
    const derivativeStatus =
      mimeType.startsWith("image/") || mimeType.startsWith("video/")
        ? "pending"
        : "none";

    const now = new Date();
    // Inline media (pasted into the description/comment body) skip the
    // card-face counter, the activity row and the SSE frame: nothing in
    // the attachment UI changes, only the body markdown references them.
    const created = await this.boardWrite.run(
      card.column.boardId,
      async (tx) => {
        const row = await tx.attachment.create({
          data: {
            id: randomUUID(),
            cardId,
            boardId: card.column.boardId,
            fileName,
            storedName,
            mimeType,
            sizeBytes: file.size,
            uploadedById: user.id,
            isInline,
            transcodeStatus,
            derivativeStatus,
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
      },
    );

    if (created.activityId === null) {
      if (transcodeStatus === "pending") this.transcode.enqueue(created.row.id);
      if (derivativeStatus === "pending") this.media.enqueue(created.row.id);
      return toAttachmentDto(created.row);
    }

    if (transcodeStatus === "pending") this.transcode.enqueue(created.row.id);
    if (derivativeStatus === "pending") this.media.enqueue(created.row.id);
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

    const removed = await this.boardWrite.run(row.boardId, async (tx) => {
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

    // TASK-88: the blob and its derivatives stay on disk — soft-delete is
    // reversible (`POST /admin/entities/attachments/:id/restore`), so a
    // restored attachment must still stream. The purge sweep reclaims the
    // files once the retention window passes.
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
  transcodeStatus: string;
  thumbnailName?: string | null;
  posterName?: string | null;
  createdAt: Date;
}): AttachmentDto {
  return {
    id: row.id,
    cardId: row.cardId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedById: row.uploadedById,
    transcodeStatus: row.transcodeStatus as AttachmentDto["transcodeStatus"],
    hasThumbnail: Boolean(row.thumbnailName),
    hasPoster: Boolean(row.posterName),
    createdAt: row.createdAt.getTime(),
  };
}
