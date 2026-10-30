import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Role, Prisma } from "@prisma/client";
import type {
  ActorType,
  BoardAggregate,
  BoardCardSearchResult,
  BoardEnvelope,
  BoardMemberDto,
  BoardState,
  BoardSummary,
} from "@janosik/shared";
import { LIMITS, parseExport, serializeExport } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  BoardWriteService,
  isTransactionTimeout,
} from "@/common/board-write.service";
import { activeMembershipWhere } from "@/common/membership";
import { RealtimeService } from "@/realtime/realtime.service";
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
 * Import timeout (TASK-149, B16). An interactive Prisma transaction defaults to
 * 5 s; a large envelope (several boards × 2400 cards) hits that and rolls back
 * halfway. Give it a real budget — the whole import is one transaction now, so
 * a failure leaves *no* boards behind instead of the first N-1.
 */
const IMPORT_TIMEOUT_MS = 120_000;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly boardWrite: BoardWriteService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Boards where the caller is a member (§7.4). Pending invitations don't
   * count, and neither does an expired VIEWER (TASK-147, B4): the row still
   * exists until a request lazily cleans it, so the expiry must be in the
   * query or a lapsed guest keeps the board in their listing.
   */
  async listBoards(userId: string): Promise<BoardSummary[]> {
    const memberships = await this.prisma.boardMember.findMany({
      where: {
        userId,
        board: { deletedAt: null },
        ...activeMembershipWhere(),
      },
      include: {
        board: {
          include: {
            _count: { select: { columns: { where: { deletedAt: null } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Card counts for every board in two constant-size queries (TASK-101):
    // a per-board `count()` was N+1. `Card` has no `boardId`, so group the
    // cards by column and fold each column into its board.
    const boardIds = memberships.map((membership) => membership.boardId);
    const cardCounts = new Map<string, number>();
    if (boardIds.length > 0) {
      const [groups, columns] = await Promise.all([
        this.prisma.card.groupBy({
          by: ["columnId"],
          where: {
            // TASK-153: the counter is the number of cards a view can show —
            // archived cards and cards of a soft-deleted column are not it.
            column: { boardId: { in: boardIds }, deletedAt: null },
            deletedAt: null,
            archivedAt: null,
          },
          _count: { _all: true },
        }),
        this.prisma.column.findMany({
          where: { boardId: { in: boardIds }, deletedAt: null },
          select: { id: true, boardId: true },
        }),
      ]);
      const columnToBoard = new Map(
        columns.map((column) => [column.id, column.boardId]),
      );
      for (const group of groups) {
        const boardId = columnToBoard.get(group.columnId);
        if (boardId === undefined) continue;
        cardCounts.set(
          boardId,
          (cardCounts.get(boardId) ?? 0) + group._count._all,
        );
      }
    }

    const summaries: BoardSummary[] = [];
    for (const membership of memberships) {
      summaries.push(
        toBoardSummary(
          membership.board,
          {
            cards: cardCounts.get(membership.boardId) ?? 0,
            columns: membership.board._count.columns,
          },
          membership.role,
        ),
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
        data: {
          boardId: created.id,
          userId,
          role: Role.ADMIN,
          acceptedAt: new Date(),
        },
      });
      return created;
    });
    return this.getAggregate(board.id);
  }

  /** The whole board aggregate in the frontend `Board` shape (§7.4). */
  async getAggregate(boardId: string): Promise<BoardAggregate> {
    const snapshot = await this.getAggregateWithSeq(boardId);
    return snapshot.board;
  }

  /**
   * Cards on a board whose title, description, a checklist item or a comment
   * matches `q` (case-insensitive substring). Comments live outside the board
   * aggregate, so this is the only way the MCP search can span the whole card
   * (TASK-157, D11). Scoped to the board the guard already resolved.
   */
  async searchCards(
    boardId: string,
    q: string,
  ): Promise<BoardCardSearchResult> {
    const query = q.trim();
    if (query.length === 0) return { cardIds: [] };
    if (query.length > LIMITS.query) {
      throw new BadRequestException(
        `q is too long (max ${LIMITS.query} characters)`,
      );
    }
    const contains = { contains: query, mode: "insensitive" as const };
    const [cards, checklistItems, comments] = await Promise.all([
      this.prisma.card.findMany({
        where: {
          column: { boardId },
          deletedAt: null,
          OR: [{ title: contains }, { description: contains }],
        },
        select: { id: true },
      }),
      this.prisma.checklistItem.findMany({
        where: {
          text: contains,
          deletedAt: null,
          checklist: { card: { column: { boardId }, deletedAt: null } },
        },
        select: { checklist: { select: { cardId: true } } },
      }),
      this.prisma.comment.findMany({
        where: {
          text: contains,
          deletedAt: null,
          card: { column: { boardId }, deletedAt: null },
        },
        select: { cardId: true },
      }),
    ]);
    const ids = new Set<string>();
    for (const card of cards) ids.add(card.id);
    for (const item of checklistItems) ids.add(item.checklist.cardId);
    for (const comment of comments) ids.add(comment.cardId);
    return { cardIds: [...ids] };
  }

  /**
   * The aggregate together with the command `seq` it reflects (TASK-30) —
   * the baseline the SSE client resumes from (`?since=`), served as the
   * `X-Board-Seq` header of `GET /boards/:id`.
   *
   * Both reads share one REPEATABLE READ snapshot, so a command committing
   * while the aggregate loads is never half-in half-out: the snapshot's seq
   * either predates the command (it arrives as a delta) or includes it (the
   * aggregate already has it). Under READ COMMITTED the aggregate could be
   * newer than the reported seq and the delta would replay committed
   * commands on top of their own effects.
   */
  async getAggregateWithSeq(
    boardId: string,
  ): Promise<{ board: BoardAggregate; seq: number }> {
    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        const board = await loadBoardAggregate(tx, boardId);
        if (!board) return null;
        const max = await tx.command.aggregate({
          where: { boardId },
          _max: { seq: true },
        });
        return {
          board,
          seq: max._max.seq === null ? 0 : Number(max._max.seq),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (!snapshot) {
      throw new NotFoundException("Board not found");
    }
    return snapshot;
  }

  /**
   * Soft-delete a board and cascade the flag to its children (§7.0).
   *
   * Only **live** children are stamped (TASK-156): a checklist the user
   * removed before the board went down must stay deleted for the 30-day
   * window, otherwise an admin restore would resurrect it. Memberships are
   * deliberately kept (they are inert while `Board.deletedAt` is set and are
   * the only record of who may see a restored board); the purge job reclaims
   * them with the rest of the subtree.
   */
  async deleteBoard(boardId: string): Promise<void> {
    await this.boardWrite.run(boardId, async (tx) => {
      const now = new Date();

      const cards = await tx.card.findMany({
        where: { column: { boardId }, deletedAt: null },
        select: { id: true },
      });
      const cardIds = cards.map((card) => card.id);
      const checklists =
        cardIds.length === 0
          ? []
          : await tx.checklist.findMany({
              where: { cardId: { in: cardIds }, deletedAt: null },
              select: { id: true },
            });
      const checklistIds = checklists.map((checklist) => checklist.id);

      if (checklistIds.length > 0) {
        await tx.checklistItem.updateMany({
          where: { checklistId: { in: checklistIds }, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.checklist.updateMany({
          where: { id: { in: checklistIds } },
          data: { deletedAt: now },
        });
      }
      // Card links (TASK-46) carry `deletedAt` like every other child and
      // must be flagged with them, or the purge job would leave the rows
      // behind after the board itself is gone.
      await tx.cardLink.updateMany({
        where: { boardId, deletedAt: null },
        data: { deletedAt: now },
      });
      if (cardIds.length > 0) {
        await tx.card.updateMany({
          where: { id: { in: cardIds } },
          data: { deletedAt: now },
        });
      }
      await tx.column.updateMany({
        where: { boardId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.label.updateMany({
        where: { boardId, deletedAt: null },
        data: { deletedAt: now },
      });
      // A live share of a deleted board is dead by definition — revoke it so
      // the master panel shows an explicit "revoked" instead of a link that
      // silently answers 410. Snapshot shares deliberately survive the board
      // (a frozen copy), so they are left untouched.
      await tx.boardShare.updateMany({
        where: { boardId, mode: "live", revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.board.update({
        where: { id: boardId },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Accepted members of the board (§7.4) — readable by any role, VIEWER
   * included. An expired VIEWER is left out even before a request lazily
   * deletes the row (TASK-147, B4).
   */
  async listMembers(boardId: string): Promise<BoardMemberDto[]> {
    const members = await this.prisma.boardMember.findMany({
      where: { boardId, ...activeMembershipWhere() },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });
    return members.map(toMemberDto);
  }

  /**
   * Invite a user by email (ADMIN only, enforced by the guard).
   *
   * Opt-in since the TASK-35 addendum: the row is created as a **pending
   * invitation** (`acceptedAt: null`) and confers no access — the invitee
   * accepts or declines it from the notifications bell. `expiresAt` is
   * meaningful for VIEWER only — a time-limited read-only guest (§7.0). For
   * ADMIN/MEMBER it is ignored and stored as null. The invite is an
   * `Activity` event (not a reducer command) recording who invited whom.
   *
   * Non-enumerating (review "minor" items): the answer never reveals whether
   * an account exists for the address. An unknown address, a known one and a
   * repeat invite of a still-pending invitee all answer the same `201` with
   * the same masked projection (`userId: ""`, no profile fields) — only an
   * already-*accepted* member is a `409`, and those are on the board's own
   * member list anyway. An unverified account (B-1) gets the pending row,
   * but `InvitationsService` hides it until the address is confirmed.
   */
  async inviteMember(
    boardId: string,
    actorId: string,
    dto: InviteMemberDto,
    actorType: ActorType = "human",
  ): Promise<BoardMemberDto> {
    const email = dto.email.trim().toLowerCase();
    const expiresAt = this.resolveExpiresAt(dto.role, dto.expiresAt, null);
    const masked: BoardMemberDto = {
      userId: "",
      displayName: null,
      email,
      role: dto.role,
      expiresAt: expiresAt?.getTime() ?? null,
      avatarColor: null,
      avatarPath: null,
    };
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (!user) {
      return masked;
    }

    // The duplicate check lives inside the board lock (TASK-100): two
    // concurrent invites would otherwise both pass the read and one `create`
    // would surface a raw P2002 as a 500. The lock serializes them, and the
    // unique constraint is the final backstop.
    await this.boardWrite
      .run(boardId, async (tx) => {
        const existing = await tx.boardMember.findUnique({
          where: { boardId_userId: { boardId, userId: user.id } },
        });
        if (existing) {
          if (existing.acceptedAt === null) {
            // A pending invite must not swallow a material change
            // (TASK-156, item 37): an expired one is invisible in the feed
            // but still blocks a fresh row until the sweep, and a repeat
            // invite with a different role/TTL used to be a silent no-op —
            // the invitee never saw the new role. Revive the row with the
            // new role/TTL/inviter instead. Only a truly identical pending
            // invite stays an idempotent no-op — a 409 here would tell the
            // inviter the account exists.
            const expired =
              existing.expiresAt !== null &&
              existing.expiresAt.getTime() <= Date.now();
            const roleChanged = existing.role !== dto.role;
            const ttlChanged =
              (expiresAt?.getTime() ?? null) !==
              (existing.expiresAt?.getTime() ?? null);
            if (expired || roleChanged || ttlChanged) {
              await tx.boardMember.update({
                where: { id: existing.id },
                data: { role: dto.role, expiresAt, invitedById: actorId },
              });
            }
            return null;
          }
          throw new ConflictException("User is already a board member");
        }
        const created = await tx.boardMember.create({
          data: {
            boardId,
            userId: user.id,
            role: dto.role,
            expiresAt,
            acceptedAt: null,
            invitedById: actorId,
          },
          include: { user: true },
        });
        await tx.activity.create({
          data: {
            boardId,
            type: "member_invited",
            actorId,
            actorType,
            details: {
              userId: user.id,
              email: user.email,
              role: dto.role,
              expiresAt: expiresAt ? expiresAt.toISOString() : null,
            },
          },
        });
        return created;
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new ConflictException("User is already a board member");
        }
        throw error;
      });
    return masked;
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
    actorType: ActorType = "human",
  ): Promise<BoardMemberDto> {
    const member = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: targetUserId } },
      include: { user: true },
    });
    if (!member) {
      throw new NotFoundException("Board member not found");
    }

    const role = dto.role ?? member.role;
    const demoting =
      member.acceptedAt !== null &&
      member.role === Role.ADMIN &&
      role !== Role.ADMIN;

    const expiresAt = this.resolveExpiresAt(
      role,
      dto.expiresAt,
      member.expiresAt,
    );
    const roleChanged = role !== member.role;
    const expiryChanged =
      (expiresAt?.getTime() ?? null) !== (member.expiresAt?.getTime() ?? null);

    const updated = await this.boardWrite.run(boardId, async (tx) => {
      // Last-ADMIN guard runs inside the board lock (TASK-100): two
      // concurrent demotes would otherwise both pass and leave the board
      // adminless. A pending invitation is not a member yet.
      if (demoting) {
        await this.assertNotLastAdmin(tx, boardId, targetUserId, "demote");
      }
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
            actorType,
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
    // A real role/expiry change rewrites the directory every open member
    // list shows; a no-op PATCH stays silent (mirrors the activity write).
    if ((roleChanged || expiryChanged) && member.acceptedAt !== null) {
      this.realtime.publish(boardId, {
        type: "membership",
        boardId,
        userId: member.userId,
        change: "updated",
      });
    }
    return toMemberDto(updated);
  }

  /** Remove a member (ADMIN only); the last ADMIN cannot be removed. */
  async removeMember(
    boardId: string,
    actorId: string,
    targetUserId: string,
    actorType: ActorType = "human",
  ): Promise<void> {
    const member = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: targetUserId } },
      include: { user: true },
    });
    if (!member) {
      throw new NotFoundException("Board member not found");
    }
    // Pending invitations are not members — deleting the row cancels the
    // invitation and never trips the last-ADMIN guard. The guard runs inside
    // the board lock (TASK-100) so a concurrent demote+remove cannot leave
    // the board adminless.
    const removingAdmin =
      member.acceptedAt !== null && member.role === Role.ADMIN;
    await this.boardWrite.run(boardId, async (tx) => {
      if (removingAdmin) {
        await this.assertNotLastAdmin(tx, boardId, targetUserId, "remove");
      }
      await tx.boardMember.delete({ where: { id: member.id } });
      await tx.activity.create({
        data: {
          boardId,
          type: "member_removed",
          actorId,
          actorType,
          details: {
            userId: member.userId,
            email: member.user.email,
            role: member.role,
          },
        },
      });
    });
    // An accepted member has an open SSE stream: tell it the membership is
    // gone so it stops following the board (the endpoint closes that
    // stream), instead of leaving a ghost that only notices on reconnect.
    // Pending invitations never had a stream — deleting the row is enough.
    if (member.acceptedAt !== null) {
      this.realtime.publish(boardId, {
        type: "membership",
        boardId,
        userId: member.userId,
        change: "removed",
      });
    }
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

  /** Import a board envelope, atomically (TASK-149, B16). */
  async importBoards(userId: string, body: unknown): Promise<BoardAggregate[]> {
    const boards = this.parseEnvelope(body);
    if (boards.length === 0) {
      throw new BadRequestException("The envelope contains no boards");
    }
    let createdIds: string[];
    try {
      createdIds = await this.prisma.$transaction(
        async (tx) => {
          const ids: string[] = [];
          for (const board of boards) {
            ids.push(await persistBoard(tx, board, userId));
          }
          return ids;
        },
        { timeout: IMPORT_TIMEOUT_MS, maxWait: 10_000 },
      );
    } catch (error) {
      // A large envelope can outlive the budget; that is a retryable overload,
      // not a 500 (TASK-156).
      if (isTransactionTimeout(error)) {
        throw new ServiceUnavailableException("Import timed out; please retry");
      }
      throw error;
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
    tx: Prisma.TransactionClient,
    boardId: string,
    targetUserId: string,
    action: "demote" | "remove",
  ): Promise<void> {
    const otherAdmins = await tx.boardMember.count({
      where: {
        boardId,
        role: Role.ADMIN,
        acceptedAt: { not: null },
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
