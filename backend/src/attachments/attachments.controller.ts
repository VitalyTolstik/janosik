import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { AttachmentDto } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";

import { BoardRoles } from "@/common/board-roles.decorator";
import { CardAccessGuard } from "@/common/card-access.guard";
import { CurrentUser } from "@/auth/current-user.decorator";
import type { AuthUser } from "@/auth/auth.types";
import { AttachmentsService } from "./attachments.service";
import type { UploadedBlob } from "./attachments.service";
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
  ) {}

  /** Upload one file (multipart field `file`); ≤ `LIMITS.attachmentSize`. */
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
  ): Promise<AttachmentDto> {
    return this.attachments.create(cardId, user, file);
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
    @Res() res: Response,
  ): Promise<void> {
    const { meta, storedName } = await this.attachments.content(attachmentId);
    res.setHeader("Content-Type", meta.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
    );
    this.storage.open(this.storage.attachmentPath(storedName)).pipe(res);
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
