import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import type { BoardShare } from "@prisma/client";
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
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";
import { BoardsService } from "@/boards/boards.service";
import { CommentsService } from "@/comments/comments.service";
import { AttachmentsService } from "@/attachments/attachments.service";
import { FeatureFlagsService } from "@/ops/feature-flags.service";
import type { CreateShareDto, UpdateShareDto } from "./dto/share.dto";
import { renderBoardPng } from "./og-image";
import { ShareAggregateCache } from "./share-aggregate-cache";
import type { CachedBoardAggregate } from "./share-aggregate-cache";

/** What a snapshot share freezes: the envelope plus its (sanitized) roster. */
interface SnapshotPayload {
  envelope: BoardEnvelope;
  members: PublicBoardMemberDto[];
  /**
   * Capture time (Unix ms). Comments and attachments are served live from
   * their tables, so a snapshot filters them to `createdAt <= takenAt` —
   * otherwise a "frozen" link would keep leaking every later discussion.
   * Absent on snapshots captured before this field: `share.createdAt`.
   */
  takenAt?: number;
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
  ): Promise<BoardShareDto> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true },
    });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    const mode: BoardShareMode = dto.mode;
    const expiresAt = this.parseExpiry(dto.expiresAt);
    const includeComments =
      dto.includeComments ??
      (mode === "live"
        ? SHARE_LIMITS.defaultIncludeCommentsLive
        : SHARE_LIMITS.defaultIncludeCommentsSnapshot);
    const includeAttachments =
      dto.includeAttachments ?? SHARE_LIMITS.defaultIncludeAttachments;

    const data: Prisma.BoardShareCreateInput = {
      token: this.mintToken(),
      board: { connect: { id: boardId } },
      mode,
      title: dto.title?.trim() || null,
      includeComments,
      includeAttachments,
      expiresAt,
      createdBy,
    };

    if (mode === "snapshot") {
      const { payload, version } = await this.captureSnapshot(boardId);
      data.snapshot = payload as unknown as Prisma.InputJsonValue;
      data.snapshotVersion = version;
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`board-shares:${boardId}`}, 0))`;
      await this.assertShareCapacity(tx, boardId, mode);
      const created = await tx.boardShare.create({ data });
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
    });
    return this.toDto(row);
  }

  private async auditShare(
    tx: Prisma.TransactionClient,
    share: BoardShare,
    boardId: string,
    actorId: string,
    actorType: "user" | "admin",
    action: "created" | "revoked" | "deleted",
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
      throw new ConflictException("Active share limit reached");
    }
  }

  /** Every share of a board (owner's "Share" dialog). */
  async listByBoard(boardId: string): Promise<BoardShareDto[]> {
    const rows = await this.prisma.boardShare.findMany({
      where: { boardId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toDto(row));
  }

  /** Re-freeze a snapshot share with the board's current content. */
  async refreshSnapshot(shareId: string): Promise<BoardShareDto> {
    const row = await this.requireShare(shareId);
    if (row.mode !== "snapshot") {
      throw new BadRequestException("Only a snapshot share can be refreshed");
    }
    const { payload, version } = await this.captureSnapshot(
      this.boardIdOf(row),
    );
    const updated = await this.prisma.boardShare.update({
      where: { id: shareId },
      data: {
        snapshot: payload as unknown as Prisma.InputJsonValue,
        snapshotVersion: version,
      },
    });
    return this.toDto(updated);
  }

  /** Update flags/TTL/title (owner's dialog). */
  async update(shareId: string, dto: UpdateShareDto): Promise<BoardShareDto> {
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
    const updated = await this.prisma.$transaction(async (tx) => {
      if (row.boardId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`board-shares:${row.boardId}`}, 0))`;
        const current = await tx.boardShare.findUniqueOrThrow({
          where: { id: row.id },
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
      return tx.boardShare.update({ where: { id: row.id }, data });
    });
    return this.toDto(updated);
  }

  /** Revoke a share: its token stops resolving at once. Idempotent. */
  async revoke(
    shareId: string,
    actorId: string,
    attribution: RequestAttribution = HUMAN_ATTRIBUTION,
  ): Promise<BoardShareDto> {
    const row = await this.requireShare(shareId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.boardShare.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const current = await tx.boardShare.findUniqueOrThrow({
        where: { id: row.id },
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
    });
    return this.toDto(updated);
  }

  async deleteRevoked(
    boardId: string,
    shareId: string,
    actorId: string,
    attribution: RequestAttribution = HUMAN_ATTRIBUTION,
  ): Promise<void> {
    const row = await this.requireShareOnBoard(shareId, boardId);
    if (!row.revokedAt)
      throw new BadRequestException("Only revoked shares can be deleted");
    await this.prisma.$transaction(async (tx) => {
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
    });
  }

  /** The share row a board-owner operation targets, or 404. */
  async requireShare(shareId: string): Promise<ShareRow> {
    const row = await this.prisma.boardShare.findUnique({
      where: { id: shareId },
    });
    if (!row) {
      throw new NotFoundException("Share not found");
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
      throw new ForbiddenException("Share does not belong to this board");
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
    const row = await this.prisma.boardShare.findUnique({ where: { token } });
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
    });
    return payload;
  }

  private async buildPublicBoard(share: ShareRow): Promise<PublicBoardDto> {
    if (share.mode === "snapshot") {
      const payload = this.parseSnapshot(share);
      return {
        mode: "snapshot",
        title: share.title,
        takenAt: payload.takenAt ?? share.createdAt.getTime(),
        board: sanitizePublicBoard(payload.envelope.boards[0]),
        seq: share.snapshotVersion ?? null,
        members: payload.members,
        includeComments: share.includeComments,
        includeAttachments: share.includeAttachments,
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
    if (!share.includeComments) {
      throw new NotFoundException("Not found");
    }
    await this.assertCardOnBoard(share, cardId);
    const page = await this.comments.list(
      cardId,
      cursor,
      limit,
      undefined,
      this.snapshotCutoff(share),
    );
    return {
      ...page,
      items: page.items.map(toPublicComment),
    };
  }

  /** Attachment metadata for a card on the shared board, when exposed. */
  async publicAttachments(
    share: ShareRow,
    cardId: string,
  ): Promise<AttachmentDto[]> {
    if (!share.includeAttachments) {
      throw new NotFoundException("Not found");
    }
    await this.assertCardOnBoard(share, cardId);
    const rows = await this.attachments.list(
      cardId,
      this.snapshotCutoff(share),
    );
    return rows.map(toPublicAttachment);
  }

  /** A blob for the public attachment route, when the share exposes blobs. */
  async publicAttachmentContent(
    share: ShareRow,
    attachmentId: string,
  ): Promise<{ meta: AttachmentDto; storedName: string }> {
    if (!share.includeAttachments) {
      throw new NotFoundException("Not found");
    }
    const { meta, storedName } = await this.attachments.content(attachmentId);
    if (!(await this.cardOnBoard(share, meta.cardId))) {
      throw new NotFoundException("Not found");
    }
    const cutoff = this.snapshotCutoff(share);
    if (cutoff !== undefined && meta.createdAt > cutoff.getTime()) {
      throw new NotFoundException("Not found");
    }
    return { meta: toPublicAttachment(meta), storedName };
  }

  /** The OG preview PNG for a share (snapshot or a live, existing board). */
  async ogImage(share: ShareRow): Promise<Buffer> {
    if (share.mode === "snapshot") {
      const payload = this.parseSnapshot(share);
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
    boardId: string,
  ): Promise<{ payload: SnapshotPayload; version: number }> {
    const { board, seq } = await this.boards.getAggregateWithSeq(boardId);
    if (board === undefined) {
      throw new NotFoundException("Board not found");
    }
    const envelope = JSON.parse(
      serializeExport([sanitizePublicBoard(board)]),
    ) as BoardEnvelope;
    return {
      payload: {
        envelope,
        members: await this.publicMembers(boardId),
        takenAt: Date.now(),
      },
      version: seq,
    };
  }

  /** For a snapshot share: newest `createdAt` a comment/attachment may have. */
  private snapshotCutoff(share: ShareRow): Date | undefined {
    if (share.mode !== "snapshot") return undefined;
    const raw = share.snapshot as unknown as SnapshotPayload | null;
    const takenAt =
      raw !== null && typeof raw === "object" && typeof raw.takenAt === "number"
        ? raw.takenAt
        : share.createdAt.getTime();
    return new Date(takenAt);
  }

  private parseSnapshot(share: ShareRow): SnapshotPayload {
    const raw = share.snapshot as unknown as SnapshotPayload | null;
    if (
      raw === null ||
      typeof raw !== "object" ||
      !Array.isArray(raw.envelope?.boards) ||
      raw.envelope.boards.length === 0
    ) {
      throw new NotFoundException("Not found");
    }
    return raw;
  }

  /** Sanitized roster: displayName/avatar only — never an email. */
  private async publicMembers(
    boardId: string,
  ): Promise<PublicBoardMemberDto[]> {
    const members = await this.prisma.boardMember.findMany({
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
      // TASK-104: a soft-deleted card's comments/attachments must not leak
      // through a share (snapshot or live).
      where: {
        id: cardId,
        deletedAt: null,
        column: { boardId: share.boardId ?? "" },
      },
      select: { id: true },
    });
    return card !== null;
  }

  private mintToken(): string {
    return randomBytes(SHARE_LIMITS.tokenBytes).toString("base64url");
  }

  /**
   * The public-share master switch (TASK-58/61). The env value is the
   * fallback; an operator can override it from the panel via the
   * `public_shares` feature flag, and the check is awaited on every resolve.
   */
  private isPublicSharingEnabled(): Promise<boolean> {
    return this.flags.isEnabled("public_shares");
  }

  private parseExpiry(raw: string | null | undefined): Date | null {
    if (raw === undefined || raw === null || raw === "") return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("expiresAt must be a valid ISO date");
    }
    if (parsed.getTime() <= Date.now()) {
      throw new BadRequestException("expiresAt must be in the future");
    }
    return parsed;
  }

  /** The source board, or 410 for a snapshot detached by a board purge. */
  private boardIdOf(row: ShareRow): string {
    if (row.boardId === null) {
      throw new GoneException("The shared board no longer exists");
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
  return copy;
}

/** Comments on a public share keep their text/kind, not the agent identity. */
function toPublicComment(comment: CommentDto): CommentDto {
  const copy = { ...comment };
  delete copy.apiTokenId;
  delete copy.agentSessionId;
  delete copy.agentName;
  return copy;
}

/** Public attachment metadata never exposes the uploader's token/session. */
function toPublicAttachment(attachment: AttachmentDto): AttachmentDto {
  const copy = { ...attachment };
  delete copy.uploadedByTokenId;
  delete copy.uploadedBySessionId;
  return copy;
}

/** The Prisma row shape the service works with (local alias, not exported). */
type ShareRow = BoardShare;
