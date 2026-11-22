import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import type { Attachment } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type {
  BoardAggregate,
  BoardEnvelope,
  BoardShareDto,
  BoardShareMode,
  CommentDto,
  CommentPage,
  PublicBoardDto,
  PublicBoardMemberDto,
  AttachmentDto,
} from "@janosik/shared";
import { SHARE_LIMITS, serializeExport } from "@janosik/shared";
import {
  type RequestAttribution,
  HUMAN_ATTRIBUTION,
} from "@/auth/request-attribution";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { pauseGateFor } from "@/auth/agent-pause";
import type { AgentPauseGate } from "@/auth/agent-pause";
import { BoardWriteService } from "@/common/board-write.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  beforeWrite,
  markGuaranteedRollback,
  rollbackOnThrow,
} from "@/common/rollback-certainty";
import { env } from "@/config/env";
import { BoardsService } from "@/boards/boards.service";
import {
  CommentsService,
  parseCommentPage,
  toCommentDto,
} from "@/comments/comments.service";
import {
  AttachmentsService,
  toAttachmentDto,
} from "@/attachments/attachments.service";
import { StorageService } from "@/attachments/storage.service";
import { FeatureFlagsService } from "@/ops/feature-flags.service";
import type { CreateShareDto, UpdateShareDto } from "./dto/share.dto";
import { renderBoardPng } from "./og-image";
import { ShareAggregateCache } from "./share-aggregate-cache";
import type { CachedBoardAggregate } from "./share-aggregate-cache";

interface SnapshotPayload {
  envelope: BoardEnvelope;
  members: PublicBoardMemberDto[];
  takenAt?: number;
}

// Keep large payloads out of list/authorization queries, including SSE polls.
export const SHARE_METADATA_SELECT = {
  id: true,
  token: true,
  boardId: true,
  board: { select: { deletedAt: true } },
  mode: true,
  snapshotVersion: true,
  snapshotTakenAt: true,
  snapshotHasComments: true,
  snapshotHasAttachments: true,
  title: true,
  includeComments: true,
  includeAttachments: true,
  expiresAt: true,
  revokedAt: true,
  createdBy: true,
  views: true,
  lastViewedAt: true,
  createdAt: true,
} satisfies Prisma.BoardShareSelect;

export type ShareRow = Prisma.BoardShareGetPayload<{
  select: typeof SHARE_METADATA_SELECT;
}>;

export function effectiveShareFlags(
  row: Pick<
    ShareRow,
    | "mode"
    | "board"
    | "includeComments"
    | "includeAttachments"
    | "snapshotHasComments"
    | "snapshotHasAttachments"
  >,
) {
  const legacySource = row.board?.deletedAt === null;
  return {
    effectiveIncludeComments:
      row.includeComments &&
      (row.mode === "live" || (row.snapshotHasComments ?? legacySource)),
    effectiveIncludeAttachments:
      row.includeAttachments &&
      (row.mode === "live" || (row.snapshotHasAttachments ?? legacySource)),
  };
}

/**
 * Public read-only board sharing (TASK-58, §7.9).
 *
 * Owns the whole lifecycle of a `BoardShare`: token minting, snapshot
 * capture, privacy filtering, TTL/revoke, view counting — and the read side
 * of the public `/share/:token` contour (aggregate, comments, attachments,
 * OG image). The public contour is deliberately write-free: nothing here ever
 * mutates board content.
 */
@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boards: BoardsService,
    private readonly comments: CommentsService,
    private readonly attachments: AttachmentsService,
    private readonly flags: FeatureFlagsService,
    private readonly boardWrite: BoardWriteService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Live-aggregate cache (TASK-141): a hot share link stops rebuilding the
   * whole board on every request. Invalidated the moment the board's command
   * `seq` moves; the window bounds how stale the roster may be.
   */
  private readonly aggregateCache = new ShareAggregateCache(
    env.SHARE_AGGREGATE_CACHE_MS,
  );

  // ------------------------------------------------------------ owner side

  /** Create a share for a board (owner runs this as the board ADMIN). */
  async create(
    boardId: string,
    createdBy: string,
    dto: CreateShareDto,
    actorType: "user" | "admin" = "user",
    attribution: RequestAttribution = HUMAN_ATTRIBUTION,
    principal?: AuthPrincipal,
    approvalApplied = false,
    internalId?: string,
  ): Promise<BoardShareDto> {
    // M4: `ALLOW_PUBLIC_SHARES=false` is the operator's "no public links"
    // promise. Minting a link that can never resolve was the gap: gate the
    // creation path too, not only token resolution.
    await this.assertPublicSharingEnabled();
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true },
    });
    if (!board) {
      throw beforeWrite(new NotFoundException("Board not found"));
    }
    const mode: BoardShareMode = dto.mode;
    const expiresAt =
      dto.expiresInHours === undefined
        ? this.parseExpiry(dto.expiresAt)
        : new Date(Date.now() + dto.expiresInHours * 3_600_000);
    const includeComments =
      dto.includeComments ??
      (mode === "live"
        ? SHARE_LIMITS.defaultIncludeCommentsLive
        : SHARE_LIMITS.defaultIncludeCommentsSnapshot);
    const includeAttachments =
      dto.includeAttachments ?? SHARE_LIMITS.defaultIncludeAttachments;

    const data: Prisma.BoardShareCreateInput = {
      id: internalId,
      token: this.mintToken(),
      board: { connect: { id: boardId } },
      mode,
      title: dto.title?.trim() || null,
      includeComments,
      includeAttachments,
      expiresAt,
      createdBy,
    };

    const row = await this.lifecycleTransaction(
      boardId,
      principal,
      attribution,
      async (tx) =>
        rollbackOnThrow(async () => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`board-shares:${boardId}`}, 0))`;
          await this.assertShareCapacity(tx, boardId, mode);
          const snapshot =
            mode === "snapshot"
              ? await this.captureSnapshot(tx, boardId, data)
              : undefined;
          const created = await tx.boardShare.create({
            data: { ...data, ...snapshot },
            select: SHARE_METADATA_SELECT,
          });
          await this.auditShare(
            tx,
            created,
            boardId,
            createdBy,
            actorType,
            "created",
            attribution,
          );
          return created;
        }),
      { action: "share.create", approvalApplied },
      mode === "snapshot",
    );
    return this.toDto(row);
  }

  private async auditShare(
    tx: Prisma.TransactionClient,
    share: ShareRow,
    boardId: string,
    actorId: string,
    actorType: "user" | "admin",
    action: "created" | "updated" | "refreshed" | "revoked" | "deleted",
    attribution: RequestAttribution,
  ): Promise<void> {
    await tx.boardShareAuditLog.create({
      data: {
        shareId: share.id,
        boardId,
        actorId,
        actorType,
        apiTokenId: attribution.apiTokenId,
        agentSessionId: attribution.agentSessionId,
        agentName: attribution.agentName,
        action,
        details: {
          mode: share.mode,
          title: share.title,
          includeComments: share.includeComments,
          includeAttachments: share.includeAttachments,
          expiresAt: share.expiresAt?.toISOString() ?? null,
          snapshotVersion: share.snapshotVersion,
          views: share.views,
        },
      },
    });
  }

  private async assertShareCapacity(
    tx: Prisma.TransactionClient,
    boardId: string,
    mode: BoardShareMode,
  ): Promise<void> {
    const count = await tx.boardShare.count({
      where: {
        boardId,
        mode,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (count >= SHARE_LIMITS.activePerBoard[mode]) {
      throw new ConflictException({
        message: "Active share limit reached",
        code: "limit_exceeded",
        limit: SHARE_LIMITS.activePerBoard[mode],
        current: count,
      });
    }
  }

  /** Every share of a board (owner's "Share" dialog). */
  async listByBoard(boardId: string): Promise<BoardShareDto[]> {
    const rows = await this.prisma.boardShare.findMany({
      where: { boardId },
      orderBy: { createdAt: "desc" },
      select: SHARE_METADATA_SELECT,
    });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Re-freeze a snapshot share with the board's current content.
   *
   * M9: replacing public content is a `share.update` action — it goes through
   * the same approval gate and the same audit trail as a PATCH, instead of
   * silently bypassing a board policy that requires approval.
   */
  async refreshSnapshot(
    shareId: string,
    actorId: string,
    principal?: AuthPrincipal,
    attribution: RequestAttribution = HUMAN_ATTRIBUTION,
    approvalApplied = false,
  ): Promise<BoardShareDto> {
    // These reads happen after the controller claimed the approval. Mark every
    // failure as pre-write so `performOperation` releases the claim instead of
    // leaving a failed refresh with a permanently consumed approval.
    await rollbackOnThrow(() => this.assertPublicSharingEnabled());
    const row = await this.requireShare(shareId);
    if (row.mode !== "snapshot") {
      throw beforeWrite(
        new BadRequestException("Only a snapshot share can be refreshed"),
      );
    }
    const boardId = this.boardIdOf(row);
    const updated = await this.lifecycleTransaction(
      boardId,
      principal,
      attribution,
      async (tx) =>
        rollbackOnThrow(async () => {
          const source = await tx.boardShare.findUniqueOrThrow({
            where: { id: shareId },
            select: { includeComments: true, includeAttachments: true },
          });
          const snapshot = await this.captureSnapshot(tx, boardId, source);
          // Remove the previous capture in the same transaction before inserting
          // rows whose source IDs can be present in both captures.
          await tx.boardShareSnapshotComment.deleteMany({ where: { shareId } });
          await tx.boardShareSnapshotBlob.deleteMany({ where: { shareId } });
          const current = await tx.boardShare.update({
            where: { id: shareId },
            data: snapshot,
            select: SHARE_METADATA_SELECT,
          });
          await this.auditShare(
            tx,
            current,
            boardId,
            actorId,
            "user",
            "refreshed",
            attribution,
          );
          return current;
        }),
      { action: "share.update", approvalApplied },
      true,
    );
    return this.toDto(updated);
  }

  /** Update flags/TTL/title (owner's dialog). */
  async update(
    shareId: string,
    actorId: string,
    dto: UpdateShareDto,
    principal?: AuthPrincipal,
    attribution: RequestAttribution = HUMAN_ATTRIBUTION,
    approvalApplied = false,
  ): Promise<BoardShareDto> {
    const row = await this.requireShare(shareId);
    const data: Prisma.BoardShareUpdateInput = {};
    if (dto.title !== undefined) {
      data.title = dto.title?.trim() || null;
    }
    if (dto.includeComments !== undefined) {
      data.includeComments = dto.includeComments;
    }
    if (dto.includeAttachments !== undefined) {
      data.includeAttachments = dto.includeAttachments;
    }
    if (dto.expiresAt !== undefined) {
      data.expiresAt = this.parseExpiry(dto.expiresAt);
    }
    const updated = await this.lifecycleTransaction(
      row.boardId,
      principal,
      attribution,
      async (tx) =>
        rollbackOnThrow(async () => {
          if (row.boardId) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`board-shares:${row.boardId}`}, 0))`;
            const current = await tx.boardShare.findUniqueOrThrow({
              where: { id: row.id },
              select: { mode: true, revokedAt: true, expiresAt: true },
            });
            if (
              dto.expiresAt !== undefined &&
              !current.revokedAt &&
              current.expiresAt &&
              current.expiresAt <= new Date()
            ) {
              await this.assertShareCapacity(
                tx,
                row.boardId,
                current.mode as BoardShareMode,
              );
            }
          }
          const current = await tx.boardShare.update({
            where: { id: row.id },
            data,
            select: SHARE_METADATA_SELECT,
          });
          if (row.boardId) {
            await this.auditShare(
              tx,
              current,
              row.boardId,
              actorId,
              "user",
              "updated",
              attribution,
            );
          }
          return current;
        }),
      { action: "share.update", approvalApplied },
      row.mode === "snapshot",
    );
    return this.toDto(updated);
  }

  /** Revoke a share: its token stops resolving at once. Idempotent. */
  async revoke(
    shareId: string,
    actorId: string,
    attribution: RequestAttribution = HUMAN_ATTRIBUTION,
    principal?: AuthPrincipal,
    approvalApplied = false,
  ): Promise<BoardShareDto> {
    const row = await this.requireShare(shareId);
    const updated = await this.lifecycleTransaction(
      row.boardId,
      principal,
      attribution,
      async (tx) =>
        rollbackOnThrow(async () => {
          const changed = await tx.boardShare.updateMany({
            where: { id: row.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          const current = await tx.boardShare.findUniqueOrThrow({
            where: { id: row.id },
            select: SHARE_METADATA_SELECT,
          });
          if (changed.count && row.boardId)
            await this.auditShare(
              tx,
              current,
              row.boardId,
              actorId,
              "user",
              "revoked",
              attribution,
            );
          return current;
        }),
      { action: "share.revoke", approvalApplied },
    );
    return this.toDto(updated);
  }

  async deleteRevoked(
    boardId: string,
    shareId: string,
    actorId: string,
    attribution: RequestAttribution = HUMAN_ATTRIBUTION,
    principal?: AuthPrincipal,
    approvalApplied = false,
  ): Promise<void> {
    const row = await this.requireShareOnBoard(shareId, boardId);
    if (!row.revokedAt) {
      const error = new BadRequestException(
        "Only revoked shares can be deleted",
      );
      markGuaranteedRollback(error);
      throw error;
    }
    await this.lifecycleTransaction(
      boardId,
      principal,
      attribution,
      async (tx) =>
        rollbackOnThrow(async () => {
          const deleted = await tx.boardShare.deleteMany({
            where: { id: shareId, boardId, revokedAt: { not: null } },
          });
          if (!deleted.count) throw new NotFoundException("Share not found");
          await this.auditShare(
            tx,
            row,
            boardId,
            actorId,
            "user",
            "deleted",
            attribution,
          );
        }),
      { action: "share.delete", approvalApplied },
    );
  }

  private lifecycleTransaction<T>(
    boardId: string | null,
    principal: AuthPrincipal | undefined,
    attribution: RequestAttribution,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    lifecycle?: AgentPauseGate["lifecycle"],
    lockBoard = false,
  ): Promise<T> {
    if (principal?.via === "pat") {
      if (!boardId)
        throw new Error(
          "Board write service is required for PAT lifecycle operations",
        );
      return this.boardWrite.run(
        boardId,
        work,
        pauseGateFor(principal, attribution.agentSessionId, lifecycle),
      );
    }
    if (lockBoard && boardId) {
      return this.boardWrite.run(boardId, work);
    }
    return this.prisma.$transaction(work);
  }

  /** The share row a board-owner operation targets, or 404. */
  async requireShare(shareId: string): Promise<ShareRow> {
    const row = await this.prisma.boardShare.findUnique({
      where: { id: shareId },
      select: SHARE_METADATA_SELECT,
    });
    if (!row) {
      throw beforeWrite(new NotFoundException("Share not found"));
    }
    return row;
  }

  /** Owner guard helper: the share must belong to `boardId`. */
  async requireShareOnBoard(
    shareId: string,
    boardId: string,
  ): Promise<ShareRow> {
    const row = await this.requireShare(shareId);
    if (row.boardId !== boardId) {
      throw beforeWrite(
        new ForbiddenException("Share does not belong to this board"),
      );
    }
    return row;
  }

  // ----------------------------------------------------------- public side

  /**
   * Resolve a token for the public contour: the `ALLOW_PUBLIC_SHARES` master
   * switch, then a live (non-revoked, non-expired) share. A missing, revoked
   * or expired token is the *same* 404 — a revoked link must not reveal that
   * it once existed.
   */
  async resolveToken(token: string): Promise<ShareRow> {
    if (!(await this.isPublicSharingEnabled())) {
      throw new NotFoundException("Not found");
    }
    const row = await this.prisma.boardShare.findUnique({
      where: { token },
      select: SHARE_METADATA_SELECT,
    });
    if (!row || row.revokedAt !== null) {
      throw new NotFoundException("Not found");
    }
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException("Not found");
    }
    return row;
  }

  /**
   * The whole public payload. A live share whose board is gone answers
   * `410 Gone` (it existed, the board does not); a snapshot never depends on
   * the board and keeps serving. Counts one view.
   */
  async publicBoard(share: ShareRow): Promise<PublicBoardDto> {
    const payload = await this.buildPublicBoard(share);
    // Count only a read that actually resolved (a gone/expired board below
    // throws before this line).
    await this.prisma.boardShare.update({
      where: { id: share.id },
      data: { views: { increment: 1 }, lastViewedAt: new Date() },
      select: { id: true },
    });
    return payload;
  }

  private async buildPublicBoard(share: ShareRow): Promise<PublicBoardDto> {
    if (share.mode === "snapshot") {
      const { payload, row } = await this.loadSnapshot(share.id);
      const flags = effectiveShareFlags(row);
      return {
        mode: "snapshot",
        title: row.title,
        takenAt:
          row.snapshotTakenAt?.getTime() ??
          payload.takenAt ??
          row.createdAt.getTime(),
        board: sanitizePublicBoard(payload.envelope.boards[0]),
        seq: row.snapshotVersion ?? null,
        members: payload.members,
        includeComments: flags.effectiveIncludeComments,
        includeAttachments: flags.effectiveIncludeAttachments,
      };
    }

    const boardId = this.boardIdOf(share);
    await this.assertBoardAlive(boardId);
    const { board, members, seq } = await this.liveAggregate(boardId);
    return {
      mode: "live",
      title: share.title,
      takenAt: null,
      board: sanitizePublicBoard(board),
      seq,
      members,
      includeComments: share.includeComments,
      includeAttachments: share.includeAttachments,
    };
  }

  /** The live board aggregate for the SSE bridge (live mode only). */
  async liveBoardId(share: ShareRow): Promise<string> {
    if (share.mode !== "live") {
      throw new NotFoundException("Not found");
    }
    const board = await this.prisma.board.findFirst({
      where: {
        id: this.boardIdOf(share),
        deletedAt: null,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!board) {
      throw new GoneException("The shared board no longer exists");
    }
    return board.id;
  }

  /** Comments of one card, when the share exposes them. */
  async publicComments(
    share: ShareRow,
    cardId: string,
    cursor?: string,
    limit?: string,
  ): Promise<CommentPage> {
    if (!effectiveShareFlags(share).effectiveIncludeComments) {
      throw new NotFoundException("Not found");
    }
    if (share.mode === "snapshot") {
      if (share.snapshotHasComments === true) {
        const { cursor: after, limit: size } = parseCommentPage(cursor, limit);
        const rows = await this.prisma.boardShareSnapshotComment.findMany({
          where: {
            shareId: share.id,
            cardId,
            ...(after
              ? {
                  OR: [
                    { createdAt: { lt: new Date(after.at) } },
                    { createdAt: new Date(after.at), id: { lt: after.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, createdAt: true, payload: true },
          take: size + 1,
        });
        if (!rows.length) await this.assertSnapshotCard(share.id, cardId);
        const last = rows.length > size ? rows[size - 1] : undefined;
        return {
          items: rows
            .slice(0, size)
            .map(({ payload }) =>
              toPublicComment(payload as unknown as CommentDto),
            ),
          nextCursor: last ? `${last.createdAt.getTime()}:${last.id}` : null,
        };
      }
      await this.assertSnapshotCard(share.id, cardId);
    } else {
      await this.assertBoardAlive(this.boardIdOf(share));
    }
    await this.assertCardOnBoard(share, cardId);
    const page = await this.comments.list(
      cardId,
      cursor,
      limit,
      undefined,
      this.legacyCutoff(share),
    );
    return { ...page, items: page.items.map(toPublicComment) };
  }

  /** Attachment metadata for a card on the shared board, when exposed. */
  async publicAttachments(
    share: ShareRow,
    cardId: string,
  ): Promise<AttachmentDto[]> {
    if (!effectiveShareFlags(share).effectiveIncludeAttachments) {
      throw new NotFoundException("Not found");
    }
    if (share.mode === "snapshot") {
      if (share.snapshotHasAttachments === true) {
        const rows = await this.prisma.boardShareSnapshotBlob.findMany({
          where: { shareId: share.id, cardId, isInline: false },
          orderBy: [{ createdAt: "desc" }, { attachmentId: "desc" }],
          select: { metadata: true },
        });
        if (!rows.length) await this.assertSnapshotCard(share.id, cardId);
        return rows.map(({ metadata }) => metadata as unknown as AttachmentDto);
      }
      await this.assertSnapshotCard(share.id, cardId);
    } else {
      await this.assertBoardAlive(this.boardIdOf(share));
    }
    await this.assertCardOnBoard(share, cardId);
    const rows = await this.attachments.list(
      cardId,
      false,
      this.legacyCutoff(share),
    );
    return rows.map(toPublicAttachment);
  }

  /** A blob for the public attachment route, when the share exposes blobs. */
  async publicAttachmentContent(
    share: ShareRow,
    attachmentId: string,
  ): Promise<{ meta: AttachmentDto; storedName: string }> {
    if (!effectiveShareFlags(share).effectiveIncludeAttachments) {
      throw new NotFoundException("Not found");
    }
    if (share.mode === "snapshot" && share.snapshotHasAttachments === true) {
      const item = await this.prisma.boardShareSnapshotBlob.findUnique({
        where: { shareId_attachmentId: { shareId: share.id, attachmentId } },
        select: { metadata: true, storedName: true },
      });
      if (!item?.metadata) throw new NotFoundException("Not found");
      return {
        meta: item.metadata as unknown as AttachmentDto,
        storedName: item.storedName,
      };
    }
    if (share.mode === "live") {
      await this.assertBoardAlive(this.boardIdOf(share));
    }
    const { meta, storedName } = await this.attachments.content(attachmentId);
    await this.assertCardOnBoard(share, meta.cardId);
    const cutoff = this.legacyCutoff(share);
    if (cutoff !== undefined) {
      await this.assertSnapshotCard(share.id, meta.cardId);
      if (meta.createdAt > cutoff.getTime())
        throw new NotFoundException("Not found");
    }
    return { meta: toPublicAttachment(meta), storedName };
  }

  private legacyCutoff(share: ShareRow): Date | undefined {
    return share.mode === "snapshot"
      ? (share.snapshotTakenAt ?? share.createdAt)
      : undefined;
  }

  /** The OG preview PNG for a share (snapshot or a live, existing board). */
  async ogImage(share: ShareRow): Promise<Buffer> {
    if (share.mode === "snapshot") {
      const { payload } = await this.loadSnapshot(share.id);
      return renderBoardPng(payload.envelope.boards[0]);
    }
    return renderBoardPng(await this.loadLiveBoard(this.boardIdOf(share)));
  }

  // ------------------------------------------------------------ internals

  /**
   * A live board aggregate, or `410 Gone` when the board is deleted/archived
   * away. `BoardsService` answers 404 for a gone board; a *shared* link must
   * say "it was here, it is gone", hence the explicit existence check first.
   */
  private async loadLiveBoard(boardId: string): Promise<BoardAggregate> {
    await this.assertBoardAlive(boardId);
    return (await this.liveAggregate(boardId)).board;
  }

  /**
   * The live board aggregate + roster, served from the short-TTL cache
   * (TASK-141) when the board's command `seq` is unchanged. A committed
   * command bumps the `seq` and forces a rebuild, so the served board is never
   * stale relative to the log; only the roster may lag, and only up to the
   * cache window. Concurrent misses share one rebuild.
   */
  private async liveAggregate(boardId: string): Promise<CachedBoardAggregate> {
    if (this.aggregateCache.enabled) {
      const cached = this.aggregateCache.get(
        boardId,
        await this.currentSeq(boardId),
      );
      if (cached !== undefined) return cached;
    }
    return this.aggregateCache.load(boardId, async () => {
      const { board, seq } = await this.boards.getAggregateWithSeq(boardId);
      return { board, seq, members: await this.publicMembers(boardId) };
    });
  }

  /**
   * The board's current command `seq` — one cheap indexed read on
   * `Command(boardId, seq)`, far lighter than rebuilding the aggregate.
   */
  private async currentSeq(boardId: string): Promise<number> {
    const max = await this.prisma.command.aggregate({
      where: { boardId },
      _max: { seq: true },
    });
    return max._max.seq === null ? 0 : Number(max._max.seq);
  }

  /** Throws `410 Gone` when the board is missing, deleted or archived. */
  private async assertBoardAlive(boardId: string): Promise<void> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null, archivedAt: null },
      select: { id: true },
    });
    if (!board) {
      throw new GoneException("The shared board no longer exists");
    }
  }

  private async captureSnapshot(
    tx: Prisma.TransactionClient,
    boardId: string,
    flags: {
      includeComments?: boolean;
      includeAttachments?: boolean;
    },
  ) {
    const { board, seq } = await this.boards.getAggregateWithSeq(boardId, tx);
    const envelope = JSON.parse(
      serializeExport([sanitizePublicBoard(board)]),
    ) as BoardEnvelope;
    const snapshotTakenAt = new Date();
    const payload: SnapshotPayload = {
      envelope,
      members: await this.publicMembers(boardId, tx),
    };
    const cardIds = Object.keys(envelope.boards[0].cards);
    const comments = flags.includeComments
      ? await this.captureComments(tx, cardIds)
      : [];
    const blobs = flags.includeAttachments
      ? await this.captureAttachments(tx, cardIds)
      : [];
    return {
      snapshot: payload as unknown as Prisma.InputJsonValue,
      snapshotVersion: seq,
      snapshotTakenAt,
      snapshotHasComments: Boolean(flags.includeComments),
      snapshotHasAttachments: Boolean(flags.includeAttachments),
      snapshotBlobs: blobs.length ? { createMany: { data: blobs } } : undefined,
      snapshotComments: comments.length
        ? { createMany: { data: comments } }
        : undefined,
    };
  }

  private async captureComments(
    tx: Prisma.TransactionClient,
    cardIds: string[],
  ): Promise<Prisma.BoardShareSnapshotCommentCreateManyShareInput[]> {
    if (cardIds.length === 0) return [];
    const rows = await tx.comment.findMany({
      where: { cardId: { in: cardIds }, deletedAt: null },
      take: SHARE_LIMITS.snapshotCommentCount + 1,
      include: { author: { select: { displayName: true, email: true } } },
    });
    const comments = rows.map((row) => {
      const payload = toPublicComment(toCommentDto(row));
      return {
        id: row.id,
        cardId: row.cardId,
        createdAt: row.createdAt,
        payload: payload as unknown as Prisma.InputJsonValue,
      };
    });
    const bytes = comments.reduce(
      (total, { payload }) =>
        total + Buffer.byteLength(JSON.stringify(payload)),
      0,
    );
    if (
      rows.length > SHARE_LIMITS.snapshotCommentCount ||
      bytes > SHARE_LIMITS.snapshotCommentBytes
    ) {
      throw new PayloadTooLargeException({
        code: "snapshot_comment_limit",
        message:
          "A snapshot can capture up to 1,000 comments and 10 MiB of comment data. Disable comments or reduce the board's comments.",
      });
    }
    return comments;
  }

  private async captureAttachments(
    tx: Prisma.TransactionClient,
    cardIds: string[],
  ): Promise<Prisma.BoardShareSnapshotBlobCreateManyShareInput[]> {
    if (cardIds.length === 0) return [];
    // Lock the source rows while copying so transcode cannot replace the selected
    // files. Check both limits before writing any bytes under the board lock.
    const rows = await tx.$queryRaw<Attachment[]>`
      SELECT * FROM "Attachment"
      WHERE "cardId" IN (${Prisma.join(cardIds)})
        AND "deletedAt" IS NULL AND NOT "descriptionDetached"
      LIMIT ${SHARE_LIMITS.snapshotAttachmentCount + 1}
      FOR SHARE
    `;
    const bytes = rows.reduce((total, row) => total + row.sizeBytes, 0);
    if (
      rows.length > SHARE_LIMITS.snapshotAttachmentCount ||
      bytes > SHARE_LIMITS.snapshotAttachmentBytes
    ) {
      throw new PayloadTooLargeException({
        code: "snapshot_attachment_limit",
        message:
          "A snapshot can capture up to 500 attachments and 100 MiB. Disable attachments or reduce the board's files.",
      });
    }
    const attachments: Prisma.BoardShareSnapshotBlobCreateManyShareInput[] = [];
    for (const row of rows) {
      attachments.push({
        attachmentId: row.id,
        cardId: row.cardId,
        createdAt: row.createdAt,
        metadata: toPublicAttachment(
          toAttachmentDto(row),
        ) as unknown as Prisma.InputJsonValue,
        storedName: await this.storage.copyForSnapshot(row.storedName),
        isInline: row.isInline,
      });
    }
    return attachments;
  }

  private async assertSnapshotCard(
    shareId: string,
    cardId: string,
  ): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "BoardShare"
      WHERE "id" = ${shareId} AND ("snapshot" #> '{envelope,boards,0,cards}') ? ${cardId}
    `;
    if (!rows.length) throw new NotFoundException("Not found");
  }

  private async loadSnapshot(shareId: string) {
    const row = await this.prisma.boardShare.findUnique({
      where: { id: shareId },
      select: { ...SHARE_METADATA_SELECT, snapshot: true },
    });
    const payload = row?.snapshot as unknown as
      SnapshotPayload | null | undefined;
    if (
      !row ||
      !Array.isArray(payload?.envelope?.boards) ||
      payload.envelope.boards.length === 0
    ) {
      throw new NotFoundException("Not found");
    }
    return { row, payload };
  }

  /** Sanitized roster: displayName/avatar only — never an email. */
  private async publicMembers(
    boardId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<PublicBoardMemberDto[]> {
    const members = await tx.boardMember.findMany({
      where: {
        boardId,
        acceptedAt: { not: null },
        // TASK-104: an expired VIEWER is no longer a member — never list
        // them on a public roster.
        NOT: { role: Role.VIEWER, expiresAt: { lt: new Date() } },
      },
      include: { user: true },
    });
    return members.map((member) => ({
      id: member.userId,
      displayName: member.user.displayName,
      avatarColor:
        (member.user.avatarColor as PublicBoardMemberDto["avatarColor"]) ??
        null,
      avatarPath: member.user.avatarPath,
    }));
  }

  private async assertCardOnBoard(
    share: ShareRow,
    cardId: string,
  ): Promise<void> {
    if (!(await this.cardOnBoard(share, cardId))) {
      throw new NotFoundException("Not found");
    }
  }

  /** A card belongs to the shared board only if its column's board matches. */
  private async cardOnBoard(share: ShareRow, cardId: string): Promise<boolean> {
    const card = await this.prisma.card.findFirst({
      where: {
        id: cardId,
        deletedAt: null,
        column: { boardId: share.boardId ?? "", board: { deletedAt: null } },
      },
      select: { id: true },
    });
    return card !== null;
  }

  private mintToken(): string {
    return randomBytes(SHARE_LIMITS.tokenBytes).toString("base64url");
  }

  /**
   * M4: the public-share master switch (TASK-58/61). The env value is the
   * fallback; an operator can override it from the panel via the
   * `public_shares` feature flag, and the check is awaited on every resolve.
   */
  private isPublicSharingEnabled(): Promise<boolean> {
    return this.flags.isEnabled("public_shares");
  }

  /**
   * Pre-write gate shared by controllers and the demo runner. Called before
   * approvals/idempotency so a disabled feature answers 404 instead of
   * creating an approval request or an in-progress idempotency record.
   */
  async assertPublicSharingEnabled(): Promise<void> {
    if (await this.isPublicSharingEnabled()) return;
    throw beforeWrite(new NotFoundException("Not found"));
  }

  private parseExpiry(raw: string | null | undefined): Date | null {
    if (raw === undefined || raw === null || raw === "") return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      const error = new BadRequestException(
        "expiresAt must be a valid ISO date",
      );
      markGuaranteedRollback(error);
      throw error;
    }
    if (parsed.getTime() <= Date.now()) {
      const error = new BadRequestException("expiresAt must be in the future");
      markGuaranteedRollback(error);
      throw error;
    }
    return parsed;
  }

  /** The source board, or 410 for a snapshot detached by a board purge. */
  private boardIdOf(row: ShareRow): string {
    if (row.boardId === null) {
      throw beforeWrite(new GoneException("The shared board no longer exists"));
    }
    return row.boardId;
  }

  private toDto(row: ShareRow, boardTitle?: string | null): BoardShareDto {
    return {
      id: row.id,
      token: row.token,
      boardId: row.boardId,
      boardTitle: boardTitle ?? null,
      mode: row.mode as BoardShareMode,
      title: row.title,
      includeComments: row.includeComments,
      includeAttachments: row.includeAttachments,
      ...effectiveShareFlags(row),
      expiresAt: row.expiresAt?.getTime() ?? null,
      revokedAt: row.revokedAt?.getTime() ?? null,
      views: row.views,
      lastViewedAt: row.lastViewedAt?.getTime() ?? null,
      createdAt: row.createdAt.getTime(),
      createdBy: row.createdBy,
    };
  }
}

/**
 * TASK-166: a public share is anonymous. Strip the token/session attribution
 * from cards before serving a live board or freezing a snapshot — the ADR
 * keeps that identity on member/audit surfaces only.
 */
export function sanitizePublicBoard(board: BoardAggregate): BoardAggregate {
  const cards = Object.fromEntries(
    Object.entries(board.cards ?? {}).map(([id, card]) => {
      const copy = { ...card };
      delete copy.claimedByTokenId;
      delete copy.claimedBySessionId;
      return [id, copy];
    }),
  );
  const copy = { ...board, cards };
  // Pause is operational and never leaves the member surface (ADR §6.3).
  delete copy.agentsPausedAt;
  delete copy.agentsPausedBy;
  delete copy.agentsPauseReason;
  // L26: the board's agent policy (destructive mode, approval list, run
  // limits, approval TTL) is internal control-plane data. A public reader
  // needs neither it nor a map of where the guards are.
  delete copy.agentPolicy;
  return copy;
}

/**
 * Comments on a public share keep their text/kind, not the agent identity.
 *
 * TASK-185.3: this is an explicit allowlist, not "the internal DTO minus
 * secrets". Revision ids, snapshots, counters, incompleteness flags, cutover
 * and verified fields must never ride along if the member projection grows.
 */
function toPublicComment(comment: CommentDto): CommentDto {
  return {
    id: comment.id,
    cardId: comment.cardId,
    authorId: comment.authorId,
    ...(comment.authorName !== undefined
      ? { authorName: comment.authorName }
      : {}),
    text: comment.text,
    kind: comment.kind,
    actorType: comment.actorType,
    createdAt: comment.createdAt,
    ...(comment.editedAt !== undefined ? { editedAt: comment.editedAt } : {}),
  };
}

/** Public attachment metadata never exposes the uploader's token/session. */
function toPublicAttachment(attachment: AttachmentDto): AttachmentDto {
  const copy = { ...attachment };
  delete copy.uploadedByTokenId;
  delete copy.uploadedBySessionId;
  return copy;
}
