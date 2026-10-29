import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AttachmentDto } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";

import type { AuthUser } from "@/auth/auth.types";
import { env } from "@/config/env";
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
import { UploadLimiter } from "./upload-limiter";
import { readFilePrefix } from "./upload-storage";

/** Express multer file shape used by the controller (disk storage). */
export interface UploadedBlob {
  originalname: string;
  mimetype: string;
  size: number;
  /** Path of the `.tmp-*` scratch file multer streamed the body into. */
  path: string;
}

/**
 * Card file attachments (TASK-47) — comments-style REST outside the command
 * loop: no undo, no board JSON. Each write stamps the denormalized
 * `Card.attachmentCount` (the card-face badge) and publishes an `activity`
 * SSE frame so open dialogs refresh without polling.
 */
@Injectable()
export class AttachmentsService {
  /** Per-user upload budget (TASK-146): a bounded, fixed 60 s window. */
  private readonly uploads = new UploadLimiter(() => env.UPLOAD_RATE_LIMIT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly boardWrite: BoardWriteService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly transcode: TranscodeService,
    private readonly media: MediaService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /**
   * Bounded per-user upload budget (TASK-146). Refuses the Nth+1 upload in a
   * 60 s window with `429`; the table is capped so a user-id flood cannot
   * grow it without bound. Called from `UploadRateGuard`, i.e. *before*
   * multer buffers the body (TASK-147 follow-up) — the budget then bounds
   * peak memory, not just the attempt rate. Per-process, so a multi-node
   * deployment allows the budget per node.
   */
  assertUploadRate(userId: string): void {
    this.uploads.consume(userId);
  }

  async create(
    cardId: string,
    user: AuthUser,
    file: UploadedBlob,
    isInline = false,
  ): Promise<AttachmentDto> {
    // multer streamed the body to a `.tmp-*` file (TASK-155). Every exit path
    // removes it; a successful upload renamed it into the blob tree already.
    if (!file || typeof file.path !== "string" || file.path.length === 0) {
      throw new BadRequestException({
        message: "File is required",
        field: "file",
      });
    }
    try {
      return await this.persist(cardId, user, file, isInline);
    } finally {
      await rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  private async persist(
    cardId: string,
    user: AuthUser,
    file: UploadedBlob,
    isInline = false,
  ): Promise<AttachmentDto> {
    if (file.size <= 0) {
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
    // detect the real family from the first bytes and store *that* — a
    // limited prefix, never the whole file (TASK-155). A client that
    // declares an image/video/archive but uploads unrecognizable bytes (HTML
    // dressed as a PNG) is refused.
    const sniffed = sniffMime(await readFilePrefix(file.path));
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

    // Fast-fail before writing the blob; the authoritative check runs inside
    // the board lock below (TASK-100/108).
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
    // Move the already-validated temp file into the blob tree (same
    // filesystem, atomic) instead of copying a 25 MB buffer from RAM.
    await rename(file.path, this.storage.attachmentPath(storedName));

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
        // Authoritative cap under the board lock (TASK-100): two concurrent
        // uploads would otherwise both pass the pre-check. Counts inline too,
        // so pasted media cannot bypass the per-card budget (TASK-108).
        const concurrent = await tx.attachment.count({
          where: { cardId, deletedAt: null },
        });
        if (concurrent >= LIMITS.attachmentsPerCard) {
          throw new BadRequestException({
            message: `Card must hold at most ${LIMITS.attachmentsPerCard} attachments`,
            field: "file",
          });
        }
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

  async list(cardId: string, createdUpTo?: Date): Promise<AttachmentDto[]> {
    const rows = await this.prisma.attachment.findMany({
      where: {
        cardId,
        deletedAt: null,
        isInline: false,
        // Snapshot shares only show what existed at capture time.
        ...(createdUpTo ? { createdAt: { lte: createdUpTo } } : {}),
      },
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
        isInline: true,
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
      // TASK-108: inline media never incremented the counter, so they must
      // not decrement it either — that drift went negative over time.
      if (!row.isInline) {
        await tx.card.update({
          where: { id: row.cardId },
          data: { attachmentCount: { decrement: 1 } },
        });
      }
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
