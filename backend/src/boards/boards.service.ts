import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import type {
  BoardAggregate,
  BoardEnvelope,
  BoardMemberDto,
  BoardState,
  BoardSummary,
} from "@janosik/shared";
import { parseExport, serializeExport } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  loadBoardAggregate,
  toBoardSummary,
  toMemberDto,
} from "./board-aggregate";
import { persistBoard } from "./board-import";
import type { CreateBoardDto } from "./dto/create-board.dto";
import type { InviteMemberDto } from "./dto/invite-member.dto";
import type { UpdateMemberDto } from "./dto/update-member.dto";

/**
 * Boards aggregate + membership + import/export (§7.4, TASK-25).
 *
 * These are aggregate-level REST operations, not reducer commands: mutations
 * that are `BoardAction`s (columns/cards/labels/checklists) arrive through
 * the command log in TASK-26. Membership changes are the one board mutation
 * that is REST by design (they are not reducer actions).
 */
@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Boards where the caller is a member (§7.4). */
  async listBoards(userId: string): Promise<BoardSummary[]> {
    const memberships = await this.prisma.boardMember.findMany({
      where: { userId, board: { deletedAt: null } },
      include: {
        board: {
          include: {
            _count: { select: { columns: { where: { deletedAt: null } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const summaries: BoardSummary[] = [];
    for (const membership of memberships) {
      const cards = await this.prisma.card.count({
        where: { column: { boardId: membership.boardId }, deletedAt: null },
      });
      summaries.push(
        toBoardSummary(membership.board, {
          cards,
          columns: membership.board._count.columns,
        }),
      );
    }
    return summaries;
  }

  /** Create a board with the caller as its first ADMIN (§7.4). */
  async createBoard(
    userId: string,
    dto: CreateBoardDto,
  ): Promise<BoardAggregate> {
    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException("title must not be blank");
    }
    const board = await this.prisma.$transaction(async (tx) => {
      const created = await tx.board.create({ data: { title } });
      await tx.boardMember.create({
        data: { boardId: created.id, userId, role: Role.ADMIN },
      });
      return created;
    });
    return this.getAggregate(board.id);
  }

  /** The whole board aggregate in the frontend `Board` shape (§7.4). */
  async getAggregate(boardId: string): Promise<BoardAggregate> {
    const aggregate = await loadBoardAggregate(this.prisma, boardId);
    if (!aggregate) {
      throw new NotFoundException("Board not found");
    }
    return aggregate;
  }

  /**
   * Soft-delete a board and cascade the flag to its children (§7.0).
   *
   * Chosen semantics for members: memberships are hard-deleted (they carry
   * no `deletedAt` in §7.3 and mean nothing once the board is gone), while
   * columns/cards/labels/checklists/items keep their rows with `deletedAt`
   * set, so the 30-day purge job can reclaim them.
   */
  async deleteBoard(boardId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const cards = await tx.card.findMany({
        where: { column: { boardId } },
        select: { id: true },
      });
      const cardIds = cards.map((card) => card.id);
      const checklists = await tx.checklist.findMany({
        where: { cardId: { in: cardIds } },
        select: { id: true },
      });
      const checklistIds = checklists.map((checklist) => checklist.id);

      await tx.checklistItem.updateMany({
        where: { checklistId: { in: checklistIds } },
        data: { deletedAt: now },
      });
      await tx.checklist.updateMany({
        where: { id: { in: checklistIds } },
        data: { deletedAt: now },
      });
      await tx.card.updateMany({
        where: { id: { in: cardIds } },
        data: { deletedAt: now },
      });
      await tx.column.updateMany({
        where: { boardId },
        data: { deletedAt: now },
      });
      await tx.label.updateMany({
        where: { boardId },
        data: { deletedAt: now },
      });
      await tx.board.update({
        where: { id: boardId },
        data: { deletedAt: now },
      });
      await tx.boardMember.deleteMany({ where: { boardId } });
    });
  }

  /** Members of the board (§7.4) — readable by any role, VIEWER included. */
  async listMembers(boardId: string): Promise<BoardMemberDto[]> {
    const members = await this.prisma.boardMember.findMany({
      where: { boardId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });
    return members.map(toMemberDto);
  }

  /**
   * Invite a user by email (ADMIN only, enforced by the guard).
   *
   * `expiresAt` is meaningful for VIEWER only — a time-limited read-only
   * guest (§7.0). For ADMIN/MEMBER it is ignored and stored as null.
   * Membership is an `Activity` event (not a reducer command), so the feed
   * records who invited whom with an email/role snapshot.
   */
  async inviteMember(
    boardId: string,
    actorId: string,
    dto: InviteMemberDto,
  ): Promise<BoardMemberDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw new NotFoundException("No user with that email");
    }

    const existing = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: user.id } },
    });
    if (existing) {
      throw new ConflictException("User is already a board member");
    }

    const expiresAt = this.resolveExpiresAt(dto.role, dto.expiresAt, null);
    const member = await this.prisma.$transaction(async (tx) => {
      const created = await tx.boardMember.create({
        data: { boardId, userId: user.id, role: dto.role, expiresAt },
        include: { user: true },
      });
      await tx.activity.create({
        data: {
          boardId,
          type: "member_invited",
          actorId,
          details: {
            userId: user.id,
            email: user.email,
            role: dto.role,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
          },
        },
      });
      return created;
    });
    return toMemberDto(member);
  }

  /**
   * Change a member's role and/or VIEWER expiry (ADMIN only).
   *
   * The last ADMIN of a board can never be demoted — otherwise nobody could
   * manage the board anymore (§7.4). The change lands in the feed as
   * `member_role_changed` / `member_expiry_changed`; a patch that changes
   * nothing writes no event.
   */
  async updateMember(
    boardId: string,
    actorId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
  ): Promise<BoardMemberDto> {
    const member = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: targetUserId } },
      include: { user: true },
    });
    if (!member) {
      throw new NotFoundException("Board member not found");
    }

    const role = dto.role ?? member.role;
    if (member.role === Role.ADMIN && role !== Role.ADMIN) {
      await this.assertNotLastAdmin(boardId, targetUserId, "demote");
    }

    const expiresAt = this.resolveExpiresAt(
      role,
      dto.expiresAt,
      member.expiresAt,
    );
    const roleChanged = role !== member.role;
    const expiryChanged =
      (expiresAt?.getTime() ?? null) !== (member.expiresAt?.getTime() ?? null);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.boardMember.update({
        where: { id: member.id },
        data: { role, expiresAt },
        include: { user: true },
      });
      if (roleChanged || expiryChanged) {
        await tx.activity.create({
          data: {
            boardId,
            type: roleChanged ? "member_role_changed" : "member_expiry_changed",
            actorId,
            details: {
              userId: member.userId,
              email: member.user.email,
              ...(roleChanged ? { from: member.role, to: role } : {}),
              ...(expiryChanged
                ? {
                    from: member.expiresAt?.toISOString() ?? null,
                    to: expiresAt?.toISOString() ?? null,
                  }
                : {}),
            },
          },
        });
      }
      return row;
    });
    return toMemberDto(updated);
  }

  /** Remove a member (ADMIN only); the last ADMIN cannot be removed. */
  async removeMember(
    boardId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    const member = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: targetUserId } },
      include: { user: true },
    });
    if (!member) {
      throw new NotFoundException("Board member not found");
    }
    if (member.role === Role.ADMIN) {
      await this.assertNotLastAdmin(boardId, targetUserId, "remove");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.boardMember.delete({ where: { id: member.id } });
      await tx.activity.create({
        data: {
          boardId,
          type: "member_removed",
          actorId,
          details: {
            userId: member.userId,
            email: member.user.email,
            role: member.role,
          },
        },
      });
    });
  }

  /**
   * Export the board as the shared envelope (the UI file format), readable
   * by every member including VIEWER (§7.4).
   */
  async exportBoard(boardId: string): Promise<BoardEnvelope> {
    const board = await this.getAggregate(boardId);
    // serializeExport owns the envelope shape; round-trip it back to an
    // object so the endpoint answers JSON rather than a JSON string.
    return JSON.parse(serializeExport([board])) as BoardEnvelope;
  }

  /**
   * Import a board envelope: normalize leniently (clamp whatever came in
   * past the UI) and create the board(s) with the importer as ADMIN.
   */
  async importBoards(userId: string, body: unknown): Promise<BoardAggregate[]> {
    const boards = this.parseEnvelope(body);
    if (boards.length === 0) {
      throw new BadRequestException("The envelope contains no boards");
    }
    const createdIds: string[] = [];
    for (const board of boards) {
      const id = await this.prisma.$transaction((tx) =>
        persistBoard(tx, board, userId),
      );
      createdIds.push(id);
    }
    return Promise.all(createdIds.map((id) => this.getAggregate(id)));
  }

  /**
   * Import accepts the export envelope either as a parsed object (normal
   * HTTP JSON body) or as a raw JSON string, and reuses the shared
   * `parseExport` (which runs the lenient `normalizeBoards` clamp mode).
   */
  private parseEnvelope(body: unknown): BoardState {
    const raw = typeof body === "string" ? body : JSON.stringify(body ?? null);
    try {
      return parseExport(raw);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid export file",
      );
    }
  }

  /**
   * `expiresAt` applies to VIEWER only. For other roles it is dropped;
   * for VIEWER, `undefined` keeps the current value and `null` clears it.
   */
  private resolveExpiresAt(
    role: Role,
    requested: string | null | undefined,
    current: Date | null,
  ): Date | null {
    if (role !== Role.VIEWER) {
      return null;
    }
    if (requested === undefined) {
      return current;
    }
    if (requested === null) {
      return null;
    }
    const parsed = new Date(requested);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("expiresAt must be a valid ISO date");
    }
    return parsed;
  }

  private async assertNotLastAdmin(
    boardId: string,
    targetUserId: string,
    action: "demote" | "remove",
  ): Promise<void> {
    const otherAdmins = await this.prisma.boardMember.count({
      where: {
        boardId,
        role: Role.ADMIN,
        userId: { not: targetUserId },
      },
    });
    if (otherAdmins === 0) {
      throw new ConflictException(
        `Cannot ${action} the last ADMIN of the board`,
      );
    }
  }
}
