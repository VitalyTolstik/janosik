import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { argon2id, hash as argonHash } from "argon2";
import { randomBytes } from "node:crypto";
import type {
  AdminAuditAction,
  AdminAuditRowDto,
  AdminBoardCommandRequest,
  AdminBoardRowDto,
  AdminCardRowDto,
  AdminCommandRowDto,
  AdminCommentRowDto,
  AdminRuntimeDto,
  AdminSessionRowDto,
  AdminTokenRowDto,
  AdminCreateBoardRequest,
  AdminCreateMasterRequest,
  AdminCreateMasterResponse,
  AdminCreateUserRequest,
  AdminCreateUserResponse,
  AdminDayPoint,
  AdminMasterRowDto,
  AdminMetricsDto,
  AdminPage,
  AdminUpdateMasterRequest,
  AdminUpdateUserRequest,
  AdminUserRowDto,
} from "@janosik/shared";
import { ADMIN_PAGE_LIMITS } from "@janosik/shared";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { env } from "@/config/env";
import type { CommandResponse } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardsService } from "@/boards/boards.service";
import { CommandsService } from "@/commands/commands.service";
import type { AdminPrincipal } from "./admin.types";
import type { AdminListQueryDto } from "./dto/admin-list-query.dto";

const DAY_MS = 24 * 60 * 60 * 1000;
const SPARKLINE_DAYS = 14;

/** Backend package version, read once for the infra card. */
const BACKEND_VERSION: string = (() => {
  try {
    const localRequire = createRequire(__filename);
    const pkg = localRequire("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/**
 * Master-account data plane (§7.4, TASK-36): cross-tenant reads, metrics and
 * moderation. Two rules hold everywhere in this service:
 *
 * - nothing sensitive is ever selected (`passwordHash`, `tokenHash` and raw
 *   refresh tokens never leave the database);
 * - every mutation appends an `AdminAuditLog` row with the acting master,
 *   so the trail is complete even when an action is undone later.
 *
 * Board content mutations continue to flow through the command log for
 * users; the master's board actions are moderation-level (archive/restore/
 * soft-delete) and are recorded in the audit log instead.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boards: BoardsService,
    private readonly commands: CommandsService,
  ) {}

  // ---------------------------------------------------------------- metrics

  async metrics(): Promise<AdminMetricsDto> {
    const now = Date.now();
    const since7d = new Date(now - 7 * DAY_MS);
    const since24h = new Date(now - DAY_MS);
    const todayUtc = new Date(now);
    const midnightUtc = Date.UTC(
      todayUtc.getUTCFullYear(),
      todayUtc.getUTCMonth(),
      todayUtc.getUTCDate(),
    );
    const sinceSpark = new Date(midnightUtc - (SPARKLINE_DAYS - 1) * DAY_MS);

    const dbStarted = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const databaseLatencyMs = Date.now() - dbStarted;

    const [
      usersTotal,
      usersLast7d,
      usersDisabled,
      boardsActive,
      boardsArchived,
      boardsDeleted,
      cardsActive,
      cardsArchived,
      commandsLast24h,
      commandsLast7d,
      commentsTotal,
      sessionsActive,
      adminsTotal,
      recentUsers,
      recentCommands,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      this.prisma.user.count({ where: { disabledAt: { not: null } } }),
      this.prisma.board.count({
        where: { deletedAt: null, archivedAt: null },
      }),
      this.prisma.board.count({
        where: { deletedAt: null, archivedAt: { not: null } },
      }),
      this.prisma.board.count({ where: { deletedAt: { not: null } } }),
      this.prisma.card.count({ where: { deletedAt: null, archivedAt: null } }),
      this.prisma.card.count({
        where: { deletedAt: null, archivedAt: { not: null } },
      }),
      this.prisma.command.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.command.count({ where: { createdAt: { gte: since7d } } }),
      this.prisma.comment.count({ where: { deletedAt: null } }),
      this.prisma.refreshToken.count({
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      this.prisma.adminUser.count(),
      this.prisma.user.findMany({
        where: { createdAt: { gte: sinceSpark } },
        select: { createdAt: true },
      }),
      this.prisma.command.findMany({
        where: { createdAt: { gte: sinceSpark } },
        select: { createdAt: true },
      }),
    ]);

    return {
      users: {
        total: usersTotal,
        last7d: usersLast7d,
        disabled: usersDisabled,
      },
      boards: {
        active: boardsActive,
        archived: boardsArchived,
        deleted: boardsDeleted,
      },
      cards: { active: cardsActive, archived: cardsArchived },
      commands: { last24h: commandsLast24h, last7d: commandsLast7d },
      comments: { total: commentsTotal },
      sessions: { active: sessionsActive },
      admins: { total: adminsTotal },
      runtime: this.runtime(databaseLatencyMs),
      registrationsByDay: this.toDaySeries(
        recentUsers.map((row) => row.createdAt),
        sinceSpark,
      ),
      commandsByDay: this.toDaySeries(
        recentCommands.map((row) => row.createdAt),
        sinceSpark,
      ),
    };
  }

  // ------------------------------------------------------------------ users

  async listUsers(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminUserRowDto>> {
    const where: Prisma.UserWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { email: { contains: query.search, mode: "insensitive" } },
        { displayName: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.status === "active") where.disabledAt = null;
    if (query.status === "disabled") where.disabledAt = { not: null };

    const { limit, offset } = this.window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          email: true,
          displayName: true,
          createdAt: true,
          disabledAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt.getTime(),
        disabledAt: user.disabledAt?.getTime() ?? null,
      })),
      total,
      limit,
      offset,
    };
  }

  async createUser(
    dto: AdminCreateUserRequest,
    admin: AdminPrincipal,
  ): Promise<AdminCreateUserResponse> {
    const generated = dto.password === undefined;
    const password = dto.password ?? randomBytes(12).toString("base64url");
    const passwordHash = await argonHash(password, { type: argon2id });

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          displayName: dto.displayName ?? null,
          passwordHash,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Email is already registered");
      }
      throw error;
    }

    await this.audit(admin, "user.create", "user", user.id, {
      email: user.email,
      generatedPassword: generated,
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt.getTime(),
        disabledAt: null,
      },
      temporaryPassword: generated ? password : null,
    };
  }

  /** One enriched row — the shape both `GET /admin/users` and mutations return. */
  private async userRow(userId: string): Promise<AdminUserRowDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
        disabledAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.getTime(),
      disabledAt: user.disabledAt?.getTime() ?? null,
    };
  }

  async updateUser(
    userId: string,
    dto: AdminUpdateUserRequest,
    admin: AdminPrincipal,
  ): Promise<AdminUserRowDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.disabled !== undefined) {
      data.disabledAt = dto.disabled ? new Date() : null;
    }
    const updated =
      Object.keys(data).length > 0
        ? await this.prisma.user.update({ where: { id: userId }, data })
        : user;

    // Blocking an account is a security action — it also kills its sessions
    // immediately, so the block cannot be outlived by a live refresh token.
    if (dto.disabled === true) {
      await this.revokeUserSessions(userId, admin, { silent: true });
      await this.audit(admin, "user.disable", "user", userId, {
        email: updated.email,
      });
    } else if (dto.disabled === false) {
      await this.audit(admin, "user.enable", "user", userId, {
        email: updated.email,
      });
    } else if (Object.keys(data).length > 0) {
      await this.audit(admin, "user.update", "user", userId, {
        displayName: updated.displayName,
      });
    }

    return this.userRow(userId);
  }

  async revokeUserSessions(
    userId: string,
    admin: AdminPrincipal,
    options: { silent?: boolean } = {},
  ): Promise<{ revoked: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (options.silent !== true) {
      await this.audit(admin, "user.sessions_revoked", "user", userId, {
        email: user.email,
        revoked: revoked.count,
      });
    }
    return { revoked: revoked.count };
  }

  async revokeUserTokens(
    userId: string,
    admin: AdminPrincipal,
  ): Promise<{ revoked: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    const revoked = await this.prisma.apiToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit(admin, "user.tokens_revoked", "user", userId, {
      email: user.email,
      revoked: revoked.count,
    });
    return { revoked: revoked.count };
  }

  // ---------------------------------------------------------------- masters

  /**
   * Master management (TASK-36) — owners only, all the way down. These are
   * the only endpoints that can mint another master account: the HTTP
   * surface stays closed for operators, so privilege escalation requires
   * either the CLI on the server or an owner session.
   */
  async listMasters(
    admin: AdminPrincipal,
  ): Promise<AdminPage<AdminMasterRowDto>> {
    this.assertOwner(admin);
    const admins = await this.prisma.adminUser.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        disabledAt: true,
        lockedUntil: true,
        lastLoginAt: true,
        createdAt: true,
        failedLogins: true,
      },
    });
    return {
      items: admins.map((entry) => this.toMasterRow(entry)),
      total: admins.length,
      limit: ADMIN_PAGE_LIMITS.max,
      offset: 0,
    };
  }

  async createMaster(
    dto: AdminCreateMasterRequest,
    admin: AdminPrincipal,
  ): Promise<AdminCreateMasterResponse> {
    this.assertOwner(admin);
    const password = randomBytes(12).toString("base64url");
    const passwordHash = await argonHash(password, { type: argon2id });

    let created;
    try {
      created = await this.prisma.adminUser.create({
        data: {
          email: dto.email,
          displayName: dto.displayName ?? null,
          role: dto.role ?? "OPERATOR",
          passwordHash,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Master account already exists");
      }
      throw error;
    }

    await this.audit(admin, "admin.create", "admin", created.id, {
      email: created.email,
      role: created.role,
      via: "panel",
    });
    return {
      admin: this.toMasterRow(created),
      temporaryPassword: password,
    };
  }

  async updateMaster(
    masterId: string,
    dto: AdminUpdateMasterRequest,
    admin: AdminPrincipal,
  ): Promise<AdminMasterRowDto> {
    this.assertOwner(admin);
    const target = await this.prisma.adminUser.findUnique({
      where: { id: masterId },
    });
    if (!target) {
      throw new NotFoundException("Master account not found");
    }

    if (dto.disabled === true && target.id === admin.id) {
      throw new ForbiddenException("You cannot disable your own account");
    }
    if (dto.disabled === true && target.role === "OWNER") {
      const activeOwners = await this.prisma.adminUser.count({
        where: { role: "OWNER", disabledAt: null, id: { not: target.id } },
      });
      if (activeOwners === 0) {
        throw new ForbiddenException("Cannot disable the last owner");
      }
    }

    if (dto.disabled === true) {
      // Blocking is immediate: no live refresh token outlives the block.
      await this.prisma.adminRefreshToken.updateMany({
        where: { adminId: masterId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const data: Prisma.AdminUserUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.disabled !== undefined) {
      data.disabledAt = dto.disabled ? new Date() : null;
      if (dto.disabled === false) {
        data.failedLogins = 0;
        data.lockedUntil = null;
      }
    }
    const updated =
      Object.keys(data).length > 0
        ? await this.prisma.adminUser.update({
            where: { id: masterId },
            data,
          })
        : target;

    if (dto.disabled === true) {
      await this.audit(admin, "admin.disable", "admin", masterId, {
        email: target.email,
      });
    } else if (dto.disabled === false) {
      await this.audit(admin, "admin.enable", "admin", masterId, {
        email: target.email,
      });
    } else if (dto.displayName !== undefined) {
      await this.audit(admin, "admin.update", "admin", masterId, {
        email: target.email,
      });
    }

    return this.toMasterRow(updated);
  }

  async resetMasterPassword(
    masterId: string,
    admin: AdminPrincipal,
  ): Promise<AdminCreateMasterResponse> {
    this.assertOwner(admin);
    const target = await this.prisma.adminUser.findUnique({
      where: { id: masterId },
    });
    if (!target) {
      throw new NotFoundException("Master account not found");
    }
    const password = randomBytes(12).toString("base64url");
    const passwordHash = await argonHash(password, { type: argon2id });
    const [updated] = await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: masterId },
        data: { passwordHash, failedLogins: 0, lockedUntil: null },
      }),
      // A re-keyed password invalidates every existing session.
      this.prisma.adminRefreshToken.updateMany({
        where: { adminId: masterId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit(admin, "admin.password_reset", "admin", masterId, {
      email: target.email,
    });
    return { admin: this.toMasterRow(updated), temporaryPassword: password };
  }

  async revokeMasterSessions(
    masterId: string,
    admin: AdminPrincipal,
  ): Promise<{ revoked: number }> {
    this.assertOwner(admin);
    const target = await this.prisma.adminUser.findUnique({
      where: { id: masterId },
    });
    if (!target) {
      throw new NotFoundException("Master account not found");
    }
    const revoked = await this.prisma.adminRefreshToken.updateMany({
      where: { adminId: masterId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit(admin, "admin.sessions_revoked", "admin", masterId, {
      email: target.email,
      revoked: revoked.count,
    });
    return { revoked: revoked.count };
  }

  private assertOwner(admin: AdminPrincipal): void {
    if (admin.role !== "OWNER") {
      throw new ForbiddenException("Owner rights are required");
    }
  }

  private toMasterRow(entry: {
    id: string;
    email: string;
    displayName: string | null;
    role: "OWNER" | "OPERATOR";
    disabledAt: Date | null;
    lockedUntil: Date | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    failedLogins: number;
  }): AdminMasterRowDto {
    return {
      id: entry.id,
      email: entry.email,
      displayName: entry.displayName,
      role: entry.role,
      disabledAt: entry.disabledAt?.getTime() ?? null,
      // An expired lockout reads as "not locked": the row keeps the
      // timestamp until the next successful login, but the panel must not
      // show a stale badge (and Date.now() stays out of the render path).
      lockedUntil:
        entry.lockedUntil !== null && entry.lockedUntil.getTime() > Date.now()
          ? entry.lockedUntil.getTime()
          : null,
      lastLoginAt: entry.lastLoginAt?.getTime() ?? null,
      createdAt: entry.createdAt.getTime(),
      failedLogins: entry.failedLogins,
    };
  }

  // ----------------------------------------------------------------- boards

  async listBoards(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminBoardRowDto>> {
    const where: Prisma.BoardWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { title: { contains: query.search, mode: "insensitive" } },
        // Join keys: a board is found by its owner/member id, not by a
        // title (titles are not unique).
        { members: { some: { userId: { contains: query.search } } } },
        {
          members: {
            some: {
              user: {
                email: { contains: query.search, mode: "insensitive" },
              },
            },
          },
        },
      ];
    }
    if (query.status === "active") {
      where.deletedAt = null;
      where.archivedAt = null;
    }
    if (query.status === "archived") {
      where.deletedAt = null;
      where.archivedAt = { not: null };
    }
    if (query.status === "deleted") where.deletedAt = { not: null };

    const { limit, offset } = this.window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.board.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          archivedAt: true,
          deletedAt: true,
          members: {
            where: { role: Role.ADMIN, acceptedAt: { not: null } },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { userId: true, user: { select: { email: true } } },
          },
        },
      }),
      this.prisma.board.count({ where }),
    ]);

    return {
      items: items.map((board) => ({
        id: board.id,
        title: board.title,
        userId: board.members[0]?.userId ?? null,
        ownerEmail: board.members[0]?.user.email ?? null,
        createdAt: board.createdAt.getTime(),
        updatedAt: board.updatedAt.getTime(),
        archivedAt: board.archivedAt?.getTime() ?? null,
        deletedAt: board.deletedAt?.getTime() ?? null,
      })),
      total,
      limit,
      offset,
    };
  }

  async createBoard(
    dto: AdminCreateBoardRequest,
    admin: AdminPrincipal,
  ): Promise<AdminBoardRowDto> {
    const owner = await this.prisma.user.findUnique({
      where: { email: dto.ownerEmail },
    });
    if (!owner) {
      throw new NotFoundException("Owner not found");
    }
    const board = await this.boards.createBoard(owner.id, { title: dto.title });
    await this.audit(admin, "board.create", "board", board.id, {
      title: board.title,
      ownerEmail: owner.email,
    });
    return this.boardRow(board.id);
  }

  async setBoardArchived(
    boardId: string,
    archived: boolean,
    admin: AdminPrincipal,
  ): Promise<AdminBoardRowDto> {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
    });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    await this.prisma.board.update({
      where: { id: boardId },
      data: { archivedAt: archived ? new Date() : null },
    });
    await this.audit(
      admin,
      archived ? "board.archive" : "board.unarchive",
      "board",
      boardId,
      { title: board.title },
    );
    return this.boardRow(boardId);
  }

  async deleteBoard(
    boardId: string,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
    });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    await this.boards.deleteBoard(boardId);
    await this.audit(admin, "board.delete", "board", boardId, {
      title: board.title,
    });
    return { status: "ok" };
  }

  /**
   * Read the whole board for the content editor. Same aggregate the board
   * UI gets — cards, columns, labels and checklists in one payload.
   */
  getBoardContent(
    boardId: string,
  ): Promise<import("@janosik/shared").BoardAggregate> {
    return this.boards.getAggregate(boardId);
  }

  /**
   * Apply a board content command on behalf of the board owner (TASK-43).
   *
   * Master moderation deliberately reuses the command log instead of
   * writing rows: the reducer stays the single source of truth, versions
   * stay coherent, and the command itself is the audit trail. The actor is
   * the board's first ADMIN (its creator), because `Command.actorId` must
   * be a real user — the master's own action is recorded in
   * `AdminAuditLog` right after.
   */
  async applyBoardCommand(
    boardId: string,
    dto: AdminBoardCommandRequest,
    admin: AdminPrincipal,
  ): Promise<CommandResponse> {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: { id: true, title: true, deletedAt: true },
    });
    if (!board || board.deletedAt !== null) {
      throw new NotFoundException("Board not found");
    }
    const owner = await this.prisma.boardMember.findFirst({
      where: { boardId, role: "ADMIN", acceptedAt: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { id: true, email: true } } },
    });
    if (!owner) {
      throw new BadRequestException("Board has no owner to act for");
    }

    const response = await this.commands.apply(boardId, owner.user.id, {
      commandId: dto.commandId ?? randomUUID(),
      // `CreateCommandDto.action` is deliberately loose (the strict shared
      // validator owns its shape); the wire type is already a BoardAction.
      action: dto.action as unknown as Record<string, unknown>,
    });
    await this.audit(admin, "board.command", "board", boardId, {
      title: board.title,
      type: dto.action.type,
      actorEmail: owner.user.email,
      seq: response.seq,
    });
    return response;
  }

  /** One enriched board row (counters + owner) for mutation responses. */
  private async boardRow(boardId: string): Promise<AdminBoardRowDto> {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        archivedAt: true,
        deletedAt: true,
        members: {
          where: { role: Role.ADMIN, acceptedAt: { not: null } },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { userId: true, user: { select: { email: true } } },
        },
      },
    });
    if (!board) {
      throw new NotFoundException("Board not found");
    }
    return {
      id: board.id,
      title: board.title,
      userId: board.members[0]?.userId ?? null,
      ownerEmail: board.members[0]?.user.email ?? null,
      createdAt: board.createdAt.getTime(),
      updatedAt: board.updatedAt.getTime(),
      archivedAt: board.archivedAt?.getTime() ?? null,
      deletedAt: board.deletedAt?.getTime() ?? null,
    };
  }

  // ----------------------------------------------------------------- cards

  /** Every card on the platform with its board/column context (TASK-43). */
  async listCards(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminCardRowDto>> {
    const where: Prisma.CardWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { title: { contains: query.search, mode: "insensitive" } },
        // Join keys: boardId / columnId locate a card when titles collide.
        { columnId: { contains: query.search } },
        { column: { boardId: { contains: query.search } } },
        {
          column: {
            board: { title: { contains: query.search, mode: "insensitive" } },
          },
        },
      ];
    }
    if (query.status === "active") {
      where.deletedAt = null;
      where.archivedAt = null;
    }
    if (query.status === "archived") {
      where.deletedAt = null;
      where.archivedAt = { not: null };
    }
    if (query.status === "deleted") where.deletedAt = { not: null };

    const { limit, offset } = this.window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.card.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          archivedAt: true,
          deletedAt: true,
          columnId: true,
          column: {
            select: {
              title: true,
              boardId: true,
              board: { select: { title: true } },
            },
          },
          comments: {
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          },
        },
      }),
      this.prisma.card.count({ where }),
    ]);

    return {
      items: items.map((card) => ({
        id: card.id,
        title: card.title,
        boardId: card.column.boardId,
        boardTitle: card.column.board.title,
        columnId: card.columnId,
        columnTitle: card.column.title,
        commentIds: card.comments.map((comment) => comment.id),
        createdAt: card.createdAt.getTime(),
        updatedAt: card.updatedAt.getTime(),
        archivedAt: card.archivedAt?.getTime() ?? null,
        deletedAt: card.deletedAt?.getTime() ?? null,
      })),
      total,
      limit,
      offset,
    };
  }

  /** Archive/restore a card — moderation, recorded in the audit log. */
  async setCardArchived(
    cardId: string,
    archived: boolean,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { id: true, title: true },
    });
    if (!card) {
      throw new NotFoundException("Card not found");
    }
    await this.prisma.card.update({
      where: { id: cardId },
      data: { archivedAt: archived ? new Date() : null },
    });
    await this.audit(
      admin,
      archived ? "card.archive" : "card.unarchive",
      "card",
      cardId,
      { title: card.title },
    );
    return { status: "ok" };
  }

  /** Soft-delete a card; its children keep their rows for the purge job. */
  async deleteCard(
    cardId: string,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { id: true, title: true },
    });
    if (!card) {
      throw new NotFoundException("Card not found");
    }
    await this.prisma.$transaction([
      this.prisma.checklistItem.updateMany({
        where: { checklist: { cardId } },
        data: { deletedAt: new Date() },
      }),
      this.prisma.checklist.updateMany({
        where: { cardId },
        data: { deletedAt: new Date() },
      }),
      this.prisma.card.update({
        where: { id: cardId },
        data: { deletedAt: new Date() },
      }),
    ]);
    await this.audit(admin, "card.delete", "card", cardId, {
      title: card.title,
    });
    return { status: "ok" };
  }

  // -------------------------------------------------------------- sessions

  /** Active refresh sessions across all users — security review page. */
  async listSessions(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminSessionRowDto>> {
    const where: Prisma.RefreshTokenWhereInput = {
      revokedAt: null,
      expiresAt: { gt: new Date() },
    };
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { userId: { contains: query.search } },
        { user: { email: { contains: query.search, mode: "insensitive" } } },
      ];
    }
    const { limit, offset } = this.window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.refreshToken.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          userId: true,
          createdAt: true,
          expiresAt: true,
          user: { select: { email: true } },
        },
      }),
      this.prisma.refreshToken.count({ where }),
    ]);

    return {
      items: items.map((session) => ({
        id: session.id,
        userId: session.userId,
        userEmail: session.user.email,
        createdAt: session.createdAt.getTime(),
        expiresAt: session.expiresAt.getTime(),
      })),
      total,
      limit,
      offset,
    };
  }

  /** Revoke one concrete session (the user keeps the others). */
  async revokeSession(
    sessionId: string,
    admin: AdminPrincipal,
  ): Promise<{ revoked: number }> {
    const session = await this.prisma.refreshToken.findUnique({
      where: { id: sessionId },
      select: { id: true, revokedAt: true, user: { select: { email: true } } },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count > 0) {
      await this.audit(admin, "session.revoke", "session", sessionId, {
        userEmail: session.user.email,
      });
    }
    return { revoked: revoked.count };
  }

  // ---------------------------------------------------------------- tokens

  /** Personal API tokens across all users (TASK-43, §7.6). */
  async listTokens(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminTokenRowDto>> {
    const where: Prisma.ApiTokenWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { userId: { contains: query.search } },
        { name: { contains: query.search, mode: "insensitive" } },
        {
          user: { email: { contains: query.search, mode: "insensitive" } },
        },
      ];
    }
    if (query.status === "active") where.revokedAt = null;
    if (query.status === "disabled") where.revokedAt = { not: null };

    const { limit, offset } = this.window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.apiToken.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          userId: true,
          name: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          user: { select: { email: true } },
        },
      }),
      this.prisma.apiToken.count({ where }),
    ]);

    return {
      items: items.map((token) => ({
        id: token.id,
        userId: token.userId,
        userEmail: token.user.email,
        name: token.name,
        createdAt: token.createdAt.getTime(),
        lastUsedAt: token.lastUsedAt?.getTime() ?? null,
        expiresAt: token.expiresAt?.getTime() ?? null,
        revokedAt: token.revokedAt?.getTime() ?? null,
      })),
      total,
      limit,
      offset,
    };
  }

  async revokeToken(
    tokenId: string,
    admin: AdminPrincipal,
  ): Promise<{ revoked: number }> {
    const token = await this.prisma.apiToken.findUnique({
      where: { id: tokenId },
      select: { id: true, name: true, user: { select: { email: true } } },
    });
    if (!token) {
      throw new NotFoundException("API token not found");
    }
    const revoked = await this.prisma.apiToken.updateMany({
      where: { id: tokenId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count > 0) {
      await this.audit(admin, "token.revoke", "token", tokenId, {
        userEmail: token.user.email,
        name: token.name,
      });
    }
    return { revoked: revoked.count };
  }

  // -------------------------------------------------------------- comments

  /** Cross-board comment moderation feed. */
  async listComments(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminCommentRowDto>> {
    const where: Prisma.CommentWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { cardId: { contains: query.search } },
        { authorId: { contains: query.search } },
        { text: { contains: query.search, mode: "insensitive" } },
        // Join keys: find a comment by its board/column too.
        { card: { columnId: { contains: query.search } } },
        { card: { column: { boardId: { contains: query.search } } } },
        {
          card: { title: { contains: query.search, mode: "insensitive" } },
        },
        {
          card: {
            column: {
              board: { title: { contains: query.search, mode: "insensitive" } },
            },
          },
        },
        {
          author: { email: { contains: query.search, mode: "insensitive" } },
        },
      ];
    }
    const { limit, offset } = this.window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          cardId: true,
          authorId: true,
          text: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          card: { select: { title: true } },
          author: { select: { email: true } },
        },
      }),
      this.prisma.comment.count({ where }),
    ]);

    return {
      items: items.map((comment) => ({
        id: comment.id,
        cardId: comment.cardId,
        cardTitle: comment.card.title,
        authorId: comment.authorId,
        authorEmail: comment.author.email,
        text: comment.text,
        createdAt: comment.createdAt.getTime(),
        updatedAt: comment.updatedAt.getTime(),
        deletedAt: comment.deletedAt?.getTime() ?? null,
      })),
      total,
      limit,
      offset,
    };
  }

  async deleteComment(
    commentId: string,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, author: { select: { email: true } } },
    });
    if (!comment) {
      throw new NotFoundException("Comment not found");
    }
    await this.prisma.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    await this.audit(admin, "comment.delete", "comment", commentId, {
      authorEmail: comment.author.email,
    });
    return { status: "ok" };
  }

  // ------------------------------------------------------- log and audit

  async listCommands(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminCommandRowDto>> {
    const where: Prisma.CommandWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { boardId: { contains: query.search } },
        { actorId: { contains: query.search } },
        { type: { contains: query.search, mode: "insensitive" } },
        {
          board: { title: { contains: query.search, mode: "insensitive" } },
        },
        {
          actor: { email: { contains: query.search, mode: "insensitive" } },
        },
      ];
    }
    const { limit, offset } = this.window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.command.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { seq: "desc" }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          boardId: true,
          type: true,
          seq: true,
          createdAt: true,
          actorId: true,
          board: { select: { title: true } },
          actor: { select: { email: true } },
        },
      }),
      this.prisma.command.count({ where }),
    ]);

    return {
      items: items.map((command) => ({
        id: command.id,
        boardId: command.boardId,
        boardTitle: command.board.title,
        actorId: command.actorId,
        actorEmail: command.actor.email,
        type: command.type,
        seq: Number(command.seq),
        createdAt: command.createdAt.getTime(),
      })),
      total,
      limit,
      offset,
    };
  }

  async listAudit(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminAuditRowDto>> {
    const where: Prisma.AdminAuditLogWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { adminId: { contains: query.search } },
        { action: { contains: query.search, mode: "insensitive" } },
        { adminEmail: { contains: query.search, mode: "insensitive" } },
        { targetId: { contains: query.search, mode: "insensitive" } },
      ];
    }
    const { limit, offset } = this.window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    return {
      items: items.map((entry) => ({
        id: entry.id,
        adminId: entry.adminId,
        adminEmail: entry.adminEmail,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        details: (entry.details as Record<string, unknown> | null) ?? null,
        createdAt: entry.createdAt.getTime(),
      })),
      total,
      limit,
      offset,
    };
  }

  /** Appends an audit row; the single write path for every mutation. */
  async audit(
    admin: AdminPrincipal,
    action: AdminAuditAction,
    targetType: string | null,
    targetId: string | null,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: admin.id,
        adminEmail: admin.email,
        action,
        targetType,
        targetId,
        details: details as Prisma.InputJsonValue,
      },
    });
  }

  // ----------------------------------------------------------------- utils

  private window(query: AdminListQueryDto): { limit: number; offset: number } {
    const limit = Math.min(
      Math.max(query.limit ?? ADMIN_PAGE_LIMITS.default, ADMIN_PAGE_LIMITS.min),
      ADMIN_PAGE_LIMITS.max,
    );
    return { limit, offset: Math.max(query.offset ?? 0, 0) };
  }

  /** Buckets timestamps into a dense per-day series (oldest first). */
  private toDaySeries(dates: Date[], since: Date): AdminDayPoint[] {
    const points: AdminDayPoint[] = [];
    const counts = new Map<string, number>();
    for (const date of dates) {
      const key = this.dayKey(date);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (let i = 0; i < SPARKLINE_DAYS; i += 1) {
      const day = new Date(since.getTime() + i * DAY_MS);
      const key = this.dayKey(day);
      points.push({ date: key, count: counts.get(key) ?? 0 });
    }
    return points;
  }

  private runtime(databaseLatencyMs: number): AdminRuntimeDto {
    return {
      version: BACKEND_VERSION,
      uptimeSec: Math.round(process.uptime()),
      nodeEnv: env.NODE_ENV,
      databaseLatencyMs,
    };
  }

  private dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
