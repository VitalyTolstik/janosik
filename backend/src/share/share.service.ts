import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { BoardShare } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type {
  BoardAggregate,
  BoardEnvelope,
  BoardShareDto,
  BoardShareMode,
  CommentPage,
  PublicBoardDto,
  PublicBoardMemberDto,
  AttachmentDto,
} from "@janosik/shared";
import { SHARE_LIMITS, serializeExport } from "@janosik/shared";
import { env } from "@/config/env";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardsService } from "@/boards/boards.service";
import { CommentsService } from "@/comments/comments.service";
import { AttachmentsService } from "@/attachments/attachments.service";
import type { CreateShareDto, UpdateShareDto } from "./dto/share.dto";
import { renderBoardPng } from "./og-image";

/** What a snapshot share freezes: the envelope plus its (sanitized) roster. */
interface SnapshotPayload {
  envelope: BoardEnvelope;
  members: PublicBoardMemberDto[];
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
  ) {}

  // ------------------------------------------------------------ owner side

  /** Create a share for a board (owner runs this as the board ADMIN). */
  async create(
    boardId: string,
    createdBy: string,
    dto: CreateShareDto,
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

    const row = await this.prisma.boardShare.create({ data });
    return this.toDto(row);
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
    const { payload, version } = await this.captureSnapshot(row.boardId);
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
    const updated = await this.prisma.boardShare.update({
      where: { id: row.id },
      data,
    });
    return this.toDto(updated);
  }

  /** Revoke a share: its token stops resolving at once. Idempotent. */
  async revoke(shareId: string): Promise<BoardShareDto> {
    const row = await this.requireShare(shareId);
    const updated = await this.prisma.boardShare.update({
      where: { id: row.id },
      data: { revokedAt: row.revokedAt ?? new Date() },
    });
    return this.toDto(updated);
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
    if (!this.isPublicSharingEnabled()) {
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
        takenAt: share.createdAt.getTime(),
        board: payload.envelope.boards[0],
        seq: share.snapshotVersion ?? null,
        members: payload.members,
        includeComments: share.includeComments,
        includeAttachments: share.includeAttachments,
      };
    }

    await this.assertBoardAlive(share.boardId);
    const { board, seq } = await this.boards.getAggregateWithSeq(share.boardId);
    return {
      mode: "live",
      title: share.title,
      takenAt: null,
      board,
      seq,
      members: await this.publicMembers(share.boardId),
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
      where: { id: share.boardId, deletedAt: null, archivedAt: null },
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
    return this.comments.list(cardId, cursor, limit);
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
    return this.attachments.list(cardId);
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
    return { meta, storedName };
  }

  /** The OG preview PNG for a share (snapshot or a live, existing board). */
  async ogImage(share: ShareRow): Promise<Buffer> {
    if (share.mode === "snapshot") {
      const payload = this.parseSnapshot(share);
      return renderBoardPng(payload.envelope.boards[0]);
    }
    return renderBoardPng(await this.loadLiveBoard(share.boardId));
  }

  // ------------------------------------------------------------ internals

  /**
   * A live board aggregate, or `410 Gone` when the board is deleted/archived
   * away. `BoardsService` answers 404 for a gone board; a *shared* link must
   * say "it was here, it is gone", hence the explicit existence check first.
   */
  private async loadLiveBoard(boardId: string): Promise<BoardAggregate> {
    await this.assertBoardAlive(boardId);
    return this.boards.getAggregate(boardId);
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
    const envelope = JSON.parse(serializeExport([board])) as BoardEnvelope;
    return {
      payload: { envelope, members: await this.publicMembers(boardId) },
      version: seq,
    };
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
      where: { boardId, acceptedAt: { not: null } },
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
      where: { id: cardId, column: { boardId: share.boardId } },
      select: { id: true },
    });
    return card !== null;
  }

  private mintToken(): string {
    return randomBytes(SHARE_LIMITS.tokenBytes).toString("base64url");
  }

  /**
   * The `ALLOW_PUBLIC_SHARES` master switch. Isolated in one method so a test
   * (and only a test) can flip it — the env object itself is frozen by
   * envalid, and a whole disabled-instance boot is disproportionate.
   */
  private isPublicSharingEnabled(): boolean {
    return env.ALLOW_PUBLIC_SHARES;
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

/** The Prisma row shape the service works with (local alias, not exported). */
type ShareRow = BoardShare;
