import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Logger,
  MethodNotAllowedException,
  NotFoundException,
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
import type { ShareRow } from "./share.service";
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
import { FeatureFlagsService } from "@/ops/feature-flags.service";
import { RealtimeFlagGuard } from "@/realtime/realtime-flag.guard";
import { CurrentShare } from "./current-share.decorator";
import { ShareAccessGuard } from "./share-access.guard";
import { ShareThrottlerGuard } from "./share-throttler.guard";
import { ShareService } from "./share.service";

/** Comment kinds the public contour may announce (still id-only). */
const PUBLIC_ACTIVITY_KINDS = new Set([
  "comment_added",
  "comment_updated",
  "comment_deleted",
]);

/** Touches safe to repeat on the public wire (`card:<id>`, …). */
const PUBLIC_TOUCH =
  /^(board|column|card|label|checklist|checklistItem):[\w-]{1,64}$/;

/**
 * Explicit public action projection (TASK-185.2). Only the fields the
 * anonymous board reducer reads are copied; token/session/run attribution,
 * command ids, inverse metadata and unknown action types never cross. An
 * action that cannot be reconstructed safely becomes a `resync`, so the
 * public page re-reads the authoritative snapshot instead of half-applying
 * it.
 */
const PUBLIC_ACTION_FIELDS: Record<string, readonly string[]> = {
  ADD_COLUMN: ["newColumnId", "title"],
  RENAME_COLUMN: ["columnId", "title"],
  DELETE_COLUMN: ["columnId"],
  RENAME_BOARD: ["title"],
  ADD_CARD: ["newCardId", "columnId", "title", "labelIds", "atIndex"],
  UPDATE_CARD: ["cardId", "title", "description", "quiet"],
  TOUCH_CARD: ["cardId"],
  DELETE_CARD: ["cardId"],
  ARCHIVE_CARD: ["cardId", "archivedAt"],
  UNARCHIVE_CARD: ["cardId", "columnId", "index"],
  ARCHIVE_COLUMN_CARDS: ["columnId"],
  SET_CARD_LABEL: ["cardId", "labelId", "on", "index"],
  ADD_LABEL: ["label"],
  RENAME_LABEL: ["labelId", "name"],
  SET_LABEL_COLOR: ["labelId", "color"],
  DELETE_LABEL: ["labelId"],
  ADD_CHECKLIST: ["cardId", "newChecklistId", "title"],
  RENAME_CHECKLIST: ["cardId", "checklistId", "title"],
  DELETE_CHECKLIST: ["cardId", "checklistId"],
  ADD_CHECKLIST_ITEM: ["cardId", "checklistId", "newItemId", "text"],
  SET_CHECKLIST_ITEM_DONE: ["cardId", "checklistId", "itemId", "done"],
  RENAME_CHECKLIST_ITEM: ["cardId", "checklistId", "itemId", "text"],
  DELETE_CHECKLIST_ITEM: ["cardId", "checklistId", "itemId"],
  SET_CARD_DUE_DATE: ["cardId", "dueDate"],
  SET_CARD_PRIORITY: ["cardId", "priority"],
  SET_CARD_ASSIGN: ["cardId", "assigneeId"],
  CLAIM_CARD: ["cardId", "claimedBy", "leaseUntil"],
  SET_CARD_TASK_SPEC: ["cardId", "acceptanceCriteria", "definitionOfDone"],
  ADD_CARD_LINK: ["cardId", "linkId", "targetCardId", "linkType"],
  REMOVE_CARD_LINK: ["cardId", "linkId", "targetCardId", "linkType"],
  SET_CARD_COVER: ["cardId", "cover"],
  DUPLICATE_CARD: ["cardId", "newCardId", "title"],
  DUPLICATE_COLUMN: ["columnId", "newColumnId", "newCardIds", "title"],
  MOVE_CARD: ["cardId", "fromColumnId", "fromIndex", "toColumnId", "toIndex"],
  MOVE_COLUMN: ["columnId", "fromIndex", "toIndex"],
  SORT_COLUMN: ["columnId", "sortBy"],
  SET_COLUMN_CARD_ORDER: ["columnId", "cardIds"],
  SET_COLUMN_WIP_LIMIT: ["columnId", "wipLimit"],
  SET_COLUMN_ACCENT: ["columnId", "accent"],
  SET_BOARD_COLUMN_STYLE: ["columnStyle"],
  SET_BOARD_WORKFLOW: ["workflow"],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function publicString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function publicNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Copy one projected action field, dropping free-form nested extras. */
function publicActionValue(field: string, value: unknown): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.filter(
      (item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    );
  }
  const record = asRecord(value);
  if (record === null) return undefined;
  if (field === "label") {
    return {
      ...(publicString(record.id) !== undefined
        ? { id: publicString(record.id) }
        : {}),
      ...(publicString(record.name) !== undefined
        ? { name: publicString(record.name) }
        : {}),
      ...(publicString(record.color) !== undefined
        ? { color: publicString(record.color) }
        : {}),
    };
  }
  if (field === "checklist") {
    const items = Array.isArray(record.items) ? record.items : [];
    return {
      ...(publicString(record.id) !== undefined
        ? { id: publicString(record.id) }
        : {}),
      ...(publicString(record.title) !== undefined
        ? { title: publicString(record.title) }
        : {}),
      items: items.flatMap((item) => {
        const row = asRecord(item);
        if (row === null) return [];
        return [
          {
            ...(publicString(row.id) !== undefined
              ? { id: publicString(row.id) }
              : {}),
            ...(publicString(row.text) !== undefined
              ? { text: publicString(row.text) }
              : {}),
            ...(typeof row.done === "boolean" ? { done: row.done } : {}),
          },
        ];
      }),
    };
  }
  if (field === "cover" || field === "accent") {
    return {
      ...(publicString(record.type) !== undefined
        ? { type: publicString(record.type) }
        : {}),
      ...(publicString(record.value) !== undefined
        ? { value: publicString(record.value) }
        : {}),
    };
  }
  if (field === "workflow") {
    // Board workflow is already part of the public aggregate; a plain JSON
    // clone keeps its nested transition/condition shape intact.
    return JSON.parse(JSON.stringify(record)) as unknown;
  }
  return undefined;
}

function projectPublicAction(value: unknown): Record<string, unknown> | null {
  const action = asRecord(value);
  if (action === null) return null;
  const type = publicString(action.type);
  if (type === undefined) return null;
  const fields = PUBLIC_ACTION_FIELDS[type];
  if (fields === undefined) return null;
  const projected: Record<string, unknown> = {
    type,
    at: publicNumber(action.at) ?? 0,
    ...(publicString(action.boardId) !== undefined
      ? { boardId: publicString(action.boardId) }
      : {}),
  };
  for (const field of fields) {
    const copy = publicActionValue(field, action[field]);
    if (copy !== undefined) projected[field] = copy;
  }
  return projected;
}

function publicTouches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (touch): touch is string =>
      typeof touch === "string" && PUBLIC_TOUCH.test(touch),
  );
}

/**
 * Anonymous share streams are a separate wire contract, not "the member
 * frame minus secrets". TASK-185.2 builds every activity and command frame
 * from an allowlist, drops the rest and degrades an unprojectable command to
 * `resync`. Service frames are only a literal `ping` and `{type:"resync"}`.
 */
export function sanitizePublicFrame(
  data: object | string,
): object | string | null {
  if (typeof data === "string") return data === "ping" ? data : null;
  const event = asRecord(data);
  if (event === null) return null;
  if (event.type === "resync") return { type: "resync" };

  if (event.type === "activity") {
    const kind = publicString(event.kind);
    if (kind === undefined || !PUBLIC_ACTIVITY_KINDS.has(kind)) return null;
    const id = publicString(event.id);
    const boardId = publicString(event.boardId);
    const at = publicNumber(event.at);
    // New frames use `commentId`; a legacy frame may still carry the id in
    // `detail` (the only transitional field accepted by this contract).
    const commentId =
      publicString(event.commentId) ?? publicString(event.detail);
    if (
      id === undefined ||
      boardId === undefined ||
      at === undefined ||
      commentId === undefined
    ) {
      return null;
    }
    const cardId = publicString(event.cardId);
    return {
      type: "activity",
      id,
      boardId,
      ...(cardId !== undefined ? { cardId } : {}),
      at,
      kind,
      commentId,
      detail: commentId,
    };
  }

  if (event.type === "command") {
    const seq = publicNumber(event.seq);
    const action = projectPublicAction(event.action);
    if (seq === undefined || action === null) return { type: "resync" };
    return {
      type: "command",
      seq,
      touches: publicTouches(event.touches),
      action,
    };
  }

  // Presence, membership, approval, agent, run, keepalive and any unknown
  // frame never cross the public boundary.
  return null;
}

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
    private readonly flags: FeatureFlagsService,
  ) {}

  /** The whole public payload: the board and its sanitized member roster. */
  @UseGuards(ShareAccessGuard)
  @Get(":token")
  @Header("X-Robots-Tag", "noindex, nofollow")
  board(@CurrentShare() share: ShareRow): Promise<PublicBoardDto> {
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
  @UseGuards(ShareAccessGuard, RealtimeFlagGuard)
  @Sse(":token/events")
  @Header("X-Robots-Tag", "noindex, nofollow")
  events(
    @CurrentShare() share: ShareRow,
    @Query("since") since?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Observable<MessageEvent> {
    // Parse before reserving: a bad `since` 400s without leaking the slot
    // (TASK-147 follow-up).
    const sinceSeq = parseSince(since);
    // A public link must not open unbounded long-lived streams either
    // (TASK-146 follow-up). Anonymous, so only the instance/per-board caps
    // apply — the per-user cap would throttle a popular share.
    const boardId = share.boardId;
    if (boardId === null) {
      throw new NotFoundException("Not found");
    }
    const admission = this.realtime.reserveSubscriber(boardId, null);
    if (!admission.ok) {
      res?.setHeader("Retry-After", "5");
      throw new ServiceUnavailableException({
        message: `Too many live streams (${admission.reason} limit ${admission.limit})`,
      });
    }
    return this.stream(share, boardId, sinceSeq, admission.release);
  }

  private stream(
    share: ShareRow,
    boardId: string,
    since: number,
    release: () => void,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      // M11: the owner can turn comments off while this stream is connected.
      // Re-read the flag on every keep-alive tick instead of freezing the
      // value captured at connect time.
      let includeComments = share.includeComments;
      const send = (data: object | string): void => {
        if (subscriber.closed) return;
        const frame = sanitizePublicFrame(data);
        if (frame === null) return;
        subscriber.next({ data: frame } as MessageEvent);
      };
      const sequencer = new CommandStreamSequencer(
        this.commands,
        boardId,
        since,
        (event) => send(event as unknown as object),
        (error) => subscriber.error(error),
      );

      const live = this.realtime.watch(boardId).subscribe((event) => {
        // No identities on the public contour: presence and membership never
        // leave the building.
        if (event.type === "presence" || event.type === "membership") return;
        if (event.type === "activity") {
          if (includeComments) send(event as unknown as object);
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
        void this.tick(share, sequencer, includeComments).then((current) => {
          if (subscriber.closed) return;
          if (!current.allowed) {
            subscriber.complete();
            return;
          }
          includeComments = current.includeComments;
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
    share: ShareRow,
    sequencer: CommandStreamSequencer,
    includeComments: boolean,
  ): Promise<{ allowed: boolean; includeComments: boolean }> {
    try {
      if (!(await this.flags.isEnabled("realtime_sse"))) {
        return { allowed: false, includeComments: false };
      }
      const current = await this.shares.resolveToken(share.token);
      const liveBoard = await this.shares.liveBoardId(current);
      await sequencer.verifyCaughtUp().catch(() => undefined);
      return {
        allowed: liveBoard.length > 0,
        includeComments: current.includeComments,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        return { allowed: false, includeComments: false };
      }
      this.logger.warn(
        `Share stream check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { allowed: true, includeComments };
    }
  }

  /** Deterministic board preview; cached briefly at the edge. */
  @UseGuards(ShareAccessGuard)
  @Get(":token/og.png")
  @Header("X-Robots-Tag", "noindex, nofollow")
  async og(
    @CurrentShare() share: ShareRow,
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
    @CurrentShare() share: ShareRow,
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
    @CurrentShare() share: ShareRow,
    @Param("cardId") cardId: string,
  ): Promise<AttachmentDto[]> {
    return this.shares.publicAttachments(share, cardId);
  }

  /** Stream one attachment blob, when the share exposes attachments. */
  @UseGuards(ShareAccessGuard)
  @Get(":token/attachments/:attachmentId/content")
  @Header("X-Robots-Tag", "noindex, nofollow")
  async attachment(
    @CurrentShare() share: ShareRow,
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
