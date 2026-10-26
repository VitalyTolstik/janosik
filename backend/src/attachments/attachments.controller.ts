import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import type { AttachmentDto } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";

import { BoardRoles } from "@/common/board-roles.decorator";
import { CardAccessGuard } from "@/common/card-access.guard";
import { CurrentUser } from "@/auth/current-user.decorator";
import type { AuthUser } from "@/auth/auth.types";
import { AttachmentsService } from "./attachments.service";
import type { UploadedBlob } from "./attachments.service";
import { MediaService } from "./media.service";
import { StorageService } from "./storage.service";

/**
 * Card file attachments (TASK-47). REST like the comments (§7.6.1) — the
 * command loop carries no binaries. `CardAccessGuard` resolves the owning
 * board from `cardId`/`attachmentId` and enforces membership + `@BoardRoles`.
 */
@Controller()
@UseGuards(CardAccessGuard)
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
  ) {}

  /** Upload one file (multipart field `file`); ≤ `LIMITS.attachmentSize`.
   *  `?inline=1` marks the blob as body-embedded media (pasted into the
   *  description/comment): hidden from the list, no counter/activity. */
  @Post("cards/:cardId/attachments")
  @BoardRoles("ADMIN", "MEMBER")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { files: 1, fileSize: LIMITS.attachmentSize },
    }),
  )
  create(
    @Param("cardId") cardId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBlob,
    @Query("inline") inline?: string,
  ): Promise<AttachmentDto> {
    return this.attachments.create(
      cardId,
      user,
      file,
      inline === "1" || inline === "true",
    );
  }

  /** Live attachments of one card, newest-first. */
  @Get("cards/:cardId/attachments")
  list(@Param("cardId") cardId: string): Promise<AttachmentDto[]> {
    return this.attachments.list(cardId);
  }

  /**
   * Stream the blob to board members. `storedName` is server-generated, so
   * the metadata join is trusted; `Content-Disposition: attachment` keeps
   * browsers from rendering scriptable payloads inline.
   */
  @Get("attachments/:attachmentId/content")
  async content(
    @Param("attachmentId") attachmentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { meta, storedName } = await this.attachments.content(attachmentId);
    res.setHeader("Content-Type", meta.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
    );
    // Range-aware (TASK-107): video/audio players can seek.
    await this.storage.send(this.storage.attachmentPath(storedName), res, req);
  }

  /**
   * TASK-70 thumbnail: the ffmpeg-made preview when ready, otherwise the
   * original blob for images (the UI always has *something* to show). Videos
   * have no thumbnail — the poster route covers them.
   */
  @Get("attachments/:attachmentId/thumbnail")
  async thumbnail(
    @Param("attachmentId") attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const derivative = await this.media.derivativePath(
      attachmentId,
      "thumbnail",
    );
    if (derivative !== null) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=86400");
      await this.storage.send(derivative, res);
      return;
    }
    const { meta, storedName } = await this.attachments.content(attachmentId);
    if (!meta.mimeType.startsWith("image/")) throw new NotFoundException();
    res.setHeader("Content-Type", meta.mimeType);
    // TASK-76: the fallback serves the raw original (server-sniffed type);
    // `attachment` + `nosniff` keeps a mislabeled blob from ever rendering.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
    );
    res.setHeader("Cache-Control", "private, max-age=3600");
    await this.storage.send(this.storage.attachmentPath(storedName), res);
  }

  /** TASK-70 poster: the first meaningful frame of a video, if generated. */
  @Get("attachments/:attachmentId/poster")
  async poster(
    @Param("attachmentId") attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const derivative = await this.media.derivativePath(attachmentId, "poster");
    if (derivative === null) throw new NotFoundException();
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    await this.storage.send(derivative, res);
  }

  @Delete("attachments/:attachmentId")
  @BoardRoles("ADMIN", "MEMBER")
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param("attachmentId") attachmentId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ status: "ok" }> {
    await this.attachments.remove(attachmentId, user);
    return { status: "ok" };
  }
}
