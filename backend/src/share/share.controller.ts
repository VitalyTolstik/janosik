import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Logger,
  MethodNotAllowedException,
  MessageEvent,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  Sse,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { Observable } from "rxjs";
import type { BoardShare } from "@prisma/client";
import type {
  AttachmentDto,
  CommentPage,
  PublicBoardDto,
} from "@janosik/shared";
import { CommandStreamSequencer } from "@/commands/command-stream";
import { CommandsService } from "@/commands/commands.service";
import { parseSince } from "@/commands/parse-since";
import {
  type InternalCommandEvent,
  RealtimeService,
} from "@/realtime/realtime.service";
import { sseTiming } from "@/realtime/sse-timing";
import { StorageService } from "@/attachments/storage.service";
import { CurrentShare } from "./current-share.decorator";
import { ShareAccessGuard } from "./share-access.guard";
import { ShareThrottlerGuard } from "./share-throttler.guard";
import { ShareService } from "./share.service";

/**
 * The public read-only contour `/api/v1/share/:token` (TASK-58, §7.9.4).
 *
 * Every route is GET (plus the explicit 405 write guards below) and behind
 * `ShareAccessGuard` — a token resolves to a live share or 404. There is no
 * user/admin JWT here and no way to write board content through a token: the
 * member/command path (auth'd) and this one never touch. Responses carry
 * `X-Robots-Tag: noindex` — a share is "only by link".
 */
@Controller("share")
@UseGuards(ShareThrottlerGuard)
export class ShareController {
  private readonly logger = new Logger(ShareController.name);

  constructor(
    private readonly shares: ShareService,
    private readonly commands: CommandsService,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
  ) {}

  /** The whole public payload: the board and its sanitized member roster. */
  @UseGuards(ShareAccessGuard)
  @Get(":token")
  @Header("X-Robots-Tag", "noindex, nofollow")
  board(@CurrentShare() share: BoardShare): Promise<PublicBoardDto> {
    return this.shares.publicBoard(share);
  }

  /**
   * Live mode only: the board's command/activity stream, read-only. Presence
   * and membership frames are dropped entirely (a public viewer sees no
   * identities); activity frames (comments) only when the share exposes them.
   * The delta catch-up (`?since=`) mirrors the member stream (same sequencer:
   * `resync` on truncation, log re-read on a gap), so a reconnect never
   * misses a move.
   */
  @UseGuards(ShareAccessGuard)
  @Sse(":token/events")
  @Header("X-Robots-Tag", "noindex, nofollow")
  events(
    @CurrentShare() share: BoardShare,
    @Query("since") since?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Observable<MessageEvent> {
    // Parse before reserving: a bad `since` 400s without leaking the slot
    // (TASK-147 follow-up).
    const sinceSeq = parseSince(since);
    // A public link must not open unbounded long-lived streams either
    // (TASK-146 follow-up). Anonymous, so only the instance/per-board caps
    // apply — the per-user cap would throttle a popular share.
    const admission = this.realtime.reserveSubscriber(share.boardId, null);
    if (!admission.ok) {
      res?.setHeader("Retry-After", "5");
      throw new ServiceUnavailableException({
        message: `Too many live streams (${admission.reason} limit ${admission.limit})`,
      });
    }
    return this.stream(share, sinceSeq, admission.release);
  }

  private stream(
    share: BoardShare,
    since: number,
    release: () => void,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const send = (data: object | string): void => {
        if (!subscriber.closed) {
          subscriber.next({ data } as MessageEvent);
        }
      };
      const sequencer = new CommandStreamSequencer(
        this.commands,
        share.boardId,
        since,
        (event) => send(event as unknown as object),
        (error) => subscriber.error(error),
      );

      const live = this.realtime.watch(share.boardId).subscribe((event) => {
        // No identities on the public contour: presence and membership never
        // leave the building.
        if (event.type === "presence" || event.type === "membership") return;
        if (event.type === "activity") {
          if (share.includeComments) send(event as unknown as object);
          return;
        }
        if (event.type !== "command") return;
        sequencer.offer(event as InternalCommandEvent);
      });

      sequencer.start();

      // B-6: a revoked/expired share, a disabled public-sharing switch or a
      // board that went away ends the open stream on the next tick — not
      // only new connections.
      const keepAlive = setInterval(() => {
        send("ping");
        void this.tick(share, sequencer).then((allowed) => {
          if (!allowed && !subscriber.closed) subscriber.complete();
        });
      }, sseTiming.keepAliveMs);

      return () => {
        sequencer.close();
        live.unsubscribe();
        clearInterval(keepAlive);
        release();
      };
    });
  }

  private async tick(
    share: BoardShare,
    sequencer: CommandStreamSequencer,
  ): Promise<boolean> {
    try {
      const current = await this.shares.resolveToken(share.token);
      await this.shares.liveBoardId(current);
    } catch (error) {
      if (error instanceof HttpException) return false;
      this.logger.warn(
        `Share stream check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
    await sequencer.verifyCaughtUp().catch(() => undefined);
    return true;
  }

  /** Deterministic board preview; cached briefly at the edge. */
  @UseGuards(ShareAccessGuard)
  @Get(":token/og.png")
  @Header("X-Robots-Tag", "noindex, nofollow")
  async og(
    @CurrentShare() share: BoardShare,
    @Res() res: Response,
  ): Promise<void> {
    const png = await this.shares.ogImage(share);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(png);
  }

  /** Card comments, when the share exposes them. */
  @UseGuards(ShareAccessGuard)
  @Get(":token/cards/:cardId/comments")
  @Header("X-Robots-Tag", "noindex, nofollow")
  comments(
    @CurrentShare() share: BoardShare,
    @Param("cardId") cardId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<CommentPage> {
    return this.shares.publicComments(share, cardId, cursor, limit);
  }

  /** Attachment metadata, when the share exposes attachments. */
  @UseGuards(ShareAccessGuard)
  @Get(":token/cards/:cardId/attachments")
  @Header("X-Robots-Tag", "noindex, nofollow")
  attachments(
    @CurrentShare() share: BoardShare,
    @Param("cardId") cardId: string,
  ): Promise<AttachmentDto[]> {
    return this.shares.publicAttachments(share, cardId);
  }

  /** Stream one attachment blob, when the share exposes attachments. */
  @UseGuards(ShareAccessGuard)
  @Get(":token/attachments/:attachmentId/content")
  @Header("X-Robots-Tag", "noindex, nofollow")
  async attachment(
    @CurrentShare() share: BoardShare,
    @Param("attachmentId") attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { meta, storedName } = await this.shares.publicAttachmentContent(
      share,
      attachmentId,
    );
    res.setHeader("Content-Type", meta.mimeType);
    // TASK-76: never render a shared blob inline on the public contour — the
    // server type is sniffed, but `attachment` + `nosniff` is the belt to
    // that suspender (helmet already sets nosniff globally).
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
    );
    await this.storage.send(this.storage.attachmentPath(storedName), res);
  }

  // ------------------------------------------------------- structural 405

  /**
   * The public contour is read-only *by construction*: the only write-ish
   * verbs a client might try are answered with an explicit 405, so the
   * "no writes through a token" rule is stated, not merely implied by the
   * absence of a route. A wildcard covers every nested write path
   * (`/commands`, `/cards/:id/comments`, …) in one place.
   */
  @Post(":token")
  @HttpCode(405)
  writeToken(): never {
    throw new MethodNotAllowedException("Shared boards are read-only");
  }

  @Post(":token/{*rest}")
  @HttpCode(405)
  writeRest(): never {
    throw new MethodNotAllowedException("Shared boards are read-only");
  }
}
