import {
  Controller,
  Get,
  Header,
  HttpCode,
  MethodNotAllowedException,
  MessageEvent,
  Param,
  Post,
  Query,
  Res,
  Sse,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { interval, Observable } from "rxjs";
import type { BoardShare } from "@prisma/client";
import type {
  AttachmentDto,
  CommentPage,
  CommandSseEvent,
  PublicBoardDto,
} from "@janosik/shared";
import { CommandsService } from "@/commands/commands.service";
import { parseSince } from "@/commands/parse-since";
import { RealtimeService } from "@/realtime/realtime.service";
import { StorageService } from "@/attachments/storage.service";
import { CurrentShare } from "./current-share.decorator";
import { ShareAccessGuard } from "./share-access.guard";
import { ShareThrottlerGuard } from "./share-throttler.guard";
import { ShareService } from "./share.service";

/** Keep-alive comment cadence for proxies and idle connections. */
const KEEP_ALIVE_MS = 25_000;

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
   * The delta catch-up (`?since=`) mirrors the member stream, so a reconnect
   * never misses a move.
   */
  @UseGuards(ShareAccessGuard)
  @Sse(":token/events")
  @Header("X-Robots-Tag", "noindex, nofollow")
  events(
    @CurrentShare() share: BoardShare,
    @Query("since") since?: string,
  ): Observable<MessageEvent> {
    return this.stream(share, parseSince(since));
  }

  private stream(share: BoardShare, since: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let ready = false;
      let lastSeq = since;
      const buffered: CommandSseEvent[] = [];

      const push = (event: CommandSseEvent): void => {
        if (event.seq <= lastSeq) return;
        lastSeq = event.seq;
        subscriber.next({ data: event as unknown as object } as MessageEvent);
      };

      const live = this.realtime.watch(share.boardId).subscribe((event) => {
        // No identities on the public contour: presence and membership never
        // leave the building.
        if (event.type === "presence" || event.type === "membership") return;
        if (event.type === "activity") {
          if (share.includeComments) {
            subscriber.next({
              data: event as unknown as object,
            } as MessageEvent);
          }
          return;
        }
        if (event.type !== "command") return;
        if (ready) push(event);
        else buffered.push(event);
      });

      void this.commands
        .listSince(share.boardId, since)
        .then((delta) => {
          if (subscriber.closed) return;
          for (const entry of delta) {
            push({
              type: "command",
              seq: entry.seq,
              action: entry.action,
              actorId: entry.actorId,
              touches: entry.touches,
            });
          }
          ready = true;
          for (const event of buffered) push(event);
          buffered.length = 0;
        })
        .catch((error: unknown) => subscriber.error(error));

      const keepAlive = interval(KEEP_ALIVE_MS).subscribe(() => {
        subscriber.next({ data: "ping" } as MessageEvent);
      });

      return () => {
        live.unsubscribe();
        keepAlive.unsubscribe();
      };
    });
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
