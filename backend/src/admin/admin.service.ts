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
  AdminEmailSettingsDto,
  AdminEmailTestResponse,
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
  AdminShareRowDto,
} from "@janosik/shared";
import { ADMIN_PAGE_LIMITS } from "@janosik/shared";
import type {
  AdminAddBoardMemberRequest,
  AdminBulkResultDto,
  AdminImpersonationDto,
  AdminPromoteUserResponse,
  AdminResendVerificationResponse,
  AdminResetUserPasswordResponse,
  AdminRetentionDto,
  AdminUpdateBoardMemberRequest,
  AdminUserExportDto,
} from "@janosik/shared";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { env } from "@/config/env";
import {
  OAUTH_PROVIDER_IDS,
  type AdminDemoStatusDto,
  type AdminOAuthProviderDto,
  type AdminThrottleSettingsDto,
  type AdminTrafficDto,
  type CommandResponse,
  type OAuthProviderId,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardWriteService } from "@/common/board-write.service";
import { TrafficService } from "@/common/traffic.service";
import { BoardsService } from "@/boards/boards.service";
import { CommandsService } from "@/commands/commands.service";
import { MailerService } from "@/mailer/mailer.service";
import { EmailSettingsService } from "@/mailer/email-settings.service";
import { pickLocale } from "@/mailer/mail.types";
import { emailChangedNoticeEmail } from "@/mailer/templates";
import { OAuthSettingsService } from "@/oauth/oauth-settings.service";
import { ShareService } from "@/share/share.service";
import { AuthService } from "@/auth/auth.service";
import { USER_JWT_AUDIENCE } from "@/auth/auth.types";
import { JwtService } from "@nestjs/jwt";
import { StorageService } from "@/attachments/storage.service";
import { OpsSettingsService } from "@/ops/ops-settings.service";
import type { AdminPrincipal } from "./admin.types";
import type { AdminListQueryDto } from "./dto/admin-list-query.dto";
import type { AdminUpdateEmailSettingsDto } from "./dto/admin-update-email-settings.dto";
import type { AdminEmailTestDto } from "./dto/admin-email-test.dto";
import type { AdminUpdateOAuthProviderDto } from "./dto/admin-update-oauth-provider.dto";
import type { AdminUpdateThrottleSettingsDto } from "./dto/admin-update-throttle-settings.dto";
import type { AdminDemoStartDto } from "./dto/admin-demo-start.dto";
import { DemoService } from "./demo.service";
import { ThrottleSettingsService } from "./throttle-settings.service";

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
    private readonly boardWrite: BoardWriteService,
    private readonly boards: BoardsService,
    private readonly commands: CommandsService,
    private readonly mailer: MailerService,
    private readonly emailSettings: EmailSettingsService,
    private readonly oauthSettings: OAuthSettingsService,
    private readonly throttleSettings: ThrottleSettingsService,
    private readonly traffic: TrafficService,
    private readonly demo: DemoService,
    private readonly shares: ShareService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly storage: StorageService,
    private readonly ops: OpsSettingsService,
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
          emailVerifiedAt: true,
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
        emailVerifiedAt: user.emailVerifiedAt?.getTime() ?? null,
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
        emailVerifiedAt: null,
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
        emailVerifiedAt: true,
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
      emailVerifiedAt: user.emailVerifiedAt?.getTime() ?? null,
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
    // TASK-59: master override of the registration gate. Setting it verified
    // also consumes any outstanding code so a stale letter cannot un-verify.
    let verifyFlag: boolean | null = null;
    if (dto.emailVerified !== undefined) {
      data.emailVerifiedAt = dto.emailVerified ? new Date() : null;
      verifyFlag = dto.emailVerified;
    }
    const emailChanged =
      dto.email !== undefined && dto.email !== user.email ? dto.email : null;
    if (emailChanged !== null) {
      const taken = await this.prisma.user.findUnique({
        where: { email: emailChanged },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException("Email is already registered");
      }
      data.email = emailChanged;
    }
    const updated =
      Object.keys(data).length > 0
        ? await this.prisma.user.update({ where: { id: userId }, data })
        : user;

    // Moving the sign-in address is a security action of its own (TASK-51):
    // the old address must stop working everywhere immediately, so every
    // session is revoked and both the audit log and the old inbox hear
    // about it.
    if (emailChanged !== null) {
      await this.revokeUserSessions(userId, admin, { silent: true });
      await this.audit(admin, "user.email_changed", "user", userId, {
        from: user.email,
        to: emailChanged,
      });
      const notice = emailChangedNoticeEmail(emailChanged, "en");
      await this.mailer
        .send({ to: user.email, ...notice })
        .catch(() => undefined);
    }

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
    } else if (verifyFlag === null && Object.keys(data).length > 0) {
      await this.audit(admin, "user.update", "user", userId, {
        displayName: updated.displayName,
      });
    }

    if (verifyFlag !== null) {
      await this.prisma.emailVerificationCode.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await this.audit(
        admin,
        verifyFlag ? "user.verified" : "user.unverified",
        "user",
        userId,
        { email: updated.email },
      );
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
    await this.boardWrite.run(boardId, (tx) =>
      tx.board.update({
        where: { id: boardId },
        data: { archivedAt: archived ? new Date() : null },
      }),
    );
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
          priority: true,
          dueDate: true,
          assignee: { select: { id: true, email: true } },
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
        priority: card.priority,
        dueDate: card.dueDate?.getTime() ?? null,
        assigneeId: card.assignee?.id ?? null,
        assigneeEmail: card.assignee?.email ?? null,
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
      select: {
        id: true,
        title: true,
        column: { select: { boardId: true } },
      },
    });
    if (!card) {
      throw new NotFoundException("Card not found");
    }
    await this.boardWrite.run(card.column.boardId, (tx) =>
      tx.card.update({
        where: { id: cardId },
        data: { archivedAt: archived ? new Date() : null },
      }),
    );
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
      select: {
        id: true,
        title: true,
        column: { select: { boardId: true } },
      },
    });
    if (!card) {
      throw new NotFoundException("Card not found");
    }
    await this.boardWrite.run(card.column.boardId, async (tx) => {
      await tx.checklistItem.updateMany({
        where: { checklist: { cardId } },
        data: { deletedAt: new Date() },
      });
      await tx.checklist.updateMany({
        where: { cardId },
        data: { deletedAt: new Date() },
      });
      await tx.card.update({
        where: { id: cardId },
        data: { deletedAt: new Date() },
      });
    });
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
      createdAt: this.dateRange(query),
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
          ip: true,
          userAgent: true,
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
        ip: session.ip,
        userAgent: session.userAgent,
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
    where.createdAt = this.dateRange(query);

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
    where.createdAt = this.dateRange(query);
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
    where.createdAt = this.dateRange(query);
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
          payload: true,
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
        payload: (command.payload as Record<string, unknown> | null) ?? null,
      })),
      total,
      limit,
      offset,
    };
  }

  // --------------------------------------------------- email settings (52)

  /** The saved mail transport settings; operators may view, only owners edit. */
  async getEmailSettings(): Promise<AdminEmailSettingsDto> {
    return this.emailSettings.getPublic();
  }

  async updateEmailSettings(
    dto: AdminUpdateEmailSettingsDto,
    admin: AdminPrincipal,
  ): Promise<AdminEmailSettingsDto> {
    this.assertOwner(admin);
    const saved = await this.emailSettings.update(dto, admin.email);
    await this.audit(
      admin,
      "email.settings_changed",
      "email_settings",
      "singleton",
      {
        provider: saved.provider,
        host: saved.host,
        port: saved.port,
        enabled: saved.enabled,
        passwordChanged: dto.password !== undefined,
      },
    );
    return saved;
  }

  async testEmailSettings(
    dto: AdminEmailTestDto,
    admin: AdminPrincipal,
    acceptLanguage?: string,
  ): Promise<AdminEmailTestResponse> {
    this.assertOwner(admin);
    const result = await this.emailSettings.test(
      dto.to,
      pickLocale(acceptLanguage),
    );
    await this.audit(admin, "email.test_sent", "email_settings", "singleton", {
      to: dto.to,
      ok: result.ok,
    });
    return result;
  }

  // --------------------------------------------- oauth providers (TASK-54)

  /** Saved OAuth login settings; operators may view, only owners edit. */
  async getOAuthProviders(): Promise<AdminOAuthProviderDto[]> {
    return this.oauthSettings.listAdmin();
  }

  async updateOAuthProvider(
    provider: string,
    dto: AdminUpdateOAuthProviderDto,
    admin: AdminPrincipal,
  ): Promise<AdminOAuthProviderDto> {
    this.assertOwner(admin);
    if (!OAUTH_PROVIDER_IDS.includes(provider as OAuthProviderId)) {
      throw new BadRequestException("Unknown OAuth provider");
    }
    const saved = await this.oauthSettings.update(
      provider as OAuthProviderId,
      dto,
      admin.email,
    );
    await this.audit(
      admin,
      "oauth.settings_changed",
      "oauth_provider",
      provider,
      {
        clientId: saved.clientId,
        enabled: saved.enabled,
        secretChanged: dto.clientSecret !== undefined,
      },
    );
    return saved;
  }

  // ------------------------------------- rate limit & traffic (TASK-57)

  /** The active global rate limit; operators may view, only owners edit. */
  async getThrottleSettings(): Promise<AdminThrottleSettingsDto> {
    return this.throttleSettings.getPublic();
  }

  async updateThrottleSettings(
    dto: AdminUpdateThrottleSettingsDto,
    admin: AdminPrincipal,
  ): Promise<AdminThrottleSettingsDto> {
    this.assertOwner(admin);
    const saved = await this.throttleSettings.update(dto.limit, admin.email);
    await this.audit(
      admin,
      "throttle.settings_changed",
      "throttle_settings",
      "singleton",
      { limit: saved.limit },
    );
    return saved;
  }

  /** Live request-rate snapshot — polled by the panel's traffic gauge. */
  getTraffic(): AdminTrafficDto {
    return this.traffic.snapshot();
  }

  // ------------------------------------------------------- demo runner (57)

  async getDemo(): Promise<AdminDemoStatusDto> {
    return this.demo.status();
  }

  async startDemo(
    dto: AdminDemoStartDto,
    admin: AdminPrincipal,
  ): Promise<AdminDemoStatusDto> {
    this.assertOwner(admin);
    const status = await this.demo.start(dto, admin.email);
    await this.audit(admin, "demo.started", "demo", status.boardId ?? "demo", {
      users: status.users,
      cards: status.cards,
    });
    return status;
  }

  async stopDemo(admin: AdminPrincipal): Promise<AdminDemoStatusDto> {
    this.assertOwner(admin);
    const status = await this.demo.stop(admin.email);
    await this.audit(admin, "demo.stopped", "demo", status.boardId ?? "demo", {
      users: status.users,
      cards: status.cards,
    });
    return status;
  }

  // ------------------------------------------- public shares (TASK-58)

  /** Every public share link, newest first — with its board's title/state. */
  async listShares(
    query: AdminListQueryDto,
  ): Promise<AdminPage<AdminShareRowDto>> {
    const where: Prisma.BoardShareWhereInput = {};
    if (query.search) {
      where.OR = [
        { id: { contains: query.search } },
        { token: { contains: query.search } },
        { title: { contains: query.search, mode: "insensitive" } },
        { createdBy: { contains: query.search, mode: "insensitive" } },
        { board: { title: { contains: query.search, mode: "insensitive" } } },
      ];
    }
    where.createdAt = this.dateRange(query);
    const { limit, offset } = this.window(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.boardShare.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        include: {
          board: { select: { title: true, deletedAt: true, archivedAt: true } },
        },
      }),
      this.prisma.boardShare.count({ where }),
    ]);

    return {
      items: items.map((row) => ({
        id: row.id,
        token: row.token,
        boardId: row.boardId,
        boardTitle: row.board?.title ?? null,
        boardDeleted:
          row.board === null ||
          row.board.deletedAt !== null ||
          row.board.archivedAt !== null,
        mode: row.mode as AdminShareRowDto["mode"],
        title: row.title,
        includeComments: row.includeComments,
        includeAttachments: row.includeAttachments,
        expiresAt: row.expiresAt?.getTime() ?? null,
        revokedAt: row.revokedAt?.getTime() ?? null,
        views: row.views,
        lastViewedAt: row.lastViewedAt?.getTime() ?? null,
        createdAt: row.createdAt.getTime(),
        createdBy: row.createdBy,
      })),
      total,
      limit,
      offset,
    };
  }

  /** Revoke any share from the panel (support/inspection). Idempotent. */
  async revokeShare(
    id: string,
    admin: AdminPrincipal,
  ): Promise<AdminShareRowDto> {
    const existing = await this.prisma.boardShare.findUnique({
      where: { id },
      include: {
        board: { select: { title: true, deletedAt: true, archivedAt: true } },
      },
    });
    if (!existing) {
      throw new NotFoundException("Share not found");
    }
    const updated = await this.prisma.boardShare.update({
      where: { id },
      data: { revokedAt: existing.revokedAt ?? new Date() },
    });
    await this.audit(admin, "share.revoked", "share", id, {
      boardId: existing.boardId,
      mode: existing.mode,
    });
    return {
      id: updated.id,
      token: updated.token,
      boardId: updated.boardId,
      boardTitle: existing.board?.title ?? null,
      boardDeleted:
        existing.board === null ||
        existing.board.deletedAt !== null ||
        existing.board.archivedAt !== null,
      mode: updated.mode as AdminShareRowDto["mode"],
      title: updated.title,
      includeComments: updated.includeComments,
      includeAttachments: updated.includeAttachments,
      expiresAt: updated.expiresAt?.getTime() ?? null,
      revokedAt: updated.revokedAt?.getTime() ?? null,
      views: updated.views,
      lastViewedAt: updated.lastViewedAt?.getTime() ?? null,
      createdAt: updated.createdAt.getTime(),
      createdBy: updated.createdBy,
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
    where.createdAt = this.dateRange(query);
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

  /** `createdAt` range for the log-like listings (period tabs in the UI). */
  private dateRange(query: AdminListQueryDto): Prisma.DateTimeFilter {
    const range: Prisma.DateTimeFilter = {};
    if (query.from !== undefined) range.gte = new Date(query.from);
    if (query.to !== undefined) range.lte = new Date(query.to);
    return range;
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

  // ------------------------------------------------- user support (TASK-59)

  /**
   * Resends the registration confirmation code (TASK-53 machinery). Only for
   * an unverified account — a verified one answers 409, so a support request
   * cannot silently re-open the gate.
   */
  async resendUserVerification(
    userId: string,
    admin: AdminPrincipal,
  ): Promise<AdminResendVerificationResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    if (user.emailVerifiedAt !== null) {
      throw new ConflictException("Email is already verified");
    }
    const { expiresAt } = await this.auth.resendEmailVerification(userId, "en");
    await this.audit(admin, "user.verification_resent", "user", userId, {
      email: user.email,
    });
    return { ok: true, expiresAt, delivered: this.mailer.enabled };
  }

  /** Issues a fresh temporary password, revealed once, and kills sessions. */
  async resetUserPassword(
    userId: string,
    admin: AdminPrincipal,
  ): Promise<AdminResetUserPasswordResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    const password = randomBytes(12).toString("base64url");
    const passwordHash = await argonHash(password, { type: argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit(admin, "user.password_reset", "user", userId, {
      email: user.email,
    });
    return { user: await this.userRow(userId), temporaryPassword: password };
  }

  /**
   * Erase (GDPR, TASK-59/63): hard-deletes the user and the rows that make
   * them the actor/author, in one transaction, then the residue blobs. The
   * destructive twin of `disable` — the panel requires typing the email.
   */
  async deleteUser(
    userId: string,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    const blobs = await this.prisma.attachment.findMany({
      where: { uploadedById: userId },
      select: { storedName: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationCode.deleteMany({ where: { userId } });
      await tx.emailChangeCode.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.apiToken.deleteMany({ where: { userId } });
      await tx.attachment.deleteMany({ where: { uploadedById: userId } });
      await tx.comment.deleteMany({ where: { authorId: userId } });
      await tx.activity.deleteMany({ where: { actorId: userId } });
      await tx.command.deleteMany({ where: { actorId: userId } });
      await tx.boardMember.deleteMany({ where: { userId } });
      await tx.boardMember.updateMany({
        where: { invitedById: userId },
        data: { invitedById: null },
      });
      await tx.card.updateMany({
        where: { assigneeId: userId },
        data: { assigneeId: null },
      });
      await tx.user.delete({ where: { id: userId } });
    });
    for (const blob of blobs) {
      await this.storage
        .remove(this.storage.attachmentPath(blob.storedName))
        .catch(() => undefined);
    }
    await this.audit(admin, "user.delete", "user", userId, {
      email: user.email,
    });
    return { status: "ok" };
  }

  /** Creates an OPERATOR master from an existing user (TASK-59). */
  async promoteUser(
    userId: string,
    admin: AdminPrincipal,
  ): Promise<AdminPromoteUserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    const clash = await this.prisma.adminUser.findUnique({
      where: { email: user.email },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException("A master with this email already exists");
    }
    const password = randomBytes(12).toString("base64url");
    const passwordHash = await argonHash(password, { type: argon2id });
    const master = await this.prisma.adminUser.create({
      data: {
        email: user.email,
        displayName: user.displayName,
        passwordHash,
        role: "OPERATOR",
      },
    });
    await this.audit(admin, "user.promoted", "user", userId, {
      email: user.email,
      masterId: master.id,
    });
    return { admin: this.toMasterRow(master), temporaryPassword: password };
  }

  /** Removes a master account (TASK-59 demote), owner-guarded. */
  async demoteMaster(
    masterId: string,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    this.assertOwner(admin);
    const master = await this.prisma.adminUser.findUnique({
      where: { id: masterId },
    });
    if (!master) throw new NotFoundException("Master not found");
    if (master.id === admin.id) {
      throw new BadRequestException("You cannot demote your own account");
    }
    if (master.role === "OWNER") {
      const owners = await this.prisma.adminUser.count({
        where: { role: "OWNER" },
      });
      if (owners <= 1) {
        throw new ConflictException("The last owner cannot be demoted");
      }
    }
    await this.prisma.$transaction([
      this.prisma.adminRefreshToken.updateMany({
        where: { adminId: masterId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.adminUser.delete({ where: { id: masterId } }),
    ]);
    await this.audit(admin, "user.demoted", "admin", masterId, {
      email: master.email,
    });
    return { status: "ok" };
  }

  /**
   * "View as" support session (TASK-59): mints a short user token scoped to
   * one account. The panel opens the app with it and shows an irremovable
   * banner; the mint is audited. Reads stay scoped to what the user sees.
   */
  async impersonateUser(
    userId: string,
    admin: AdminPrincipal,
  ): Promise<AdminImpersonationDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    if (user.disabledAt !== null) {
      throw new ConflictException("Cannot impersonate a disabled account");
    }
    const ttlSec = 15 * 60;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, imp: admin.id },
      { audience: USER_JWT_AUDIENCE, expiresIn: `${ttlSec}s` },
    );
    await this.audit(admin, "user.impersonated", "user", userId, {
      email: user.email,
    });
    return {
      accessToken,
      expiresAt: Date.now() + ttlSec * 1000,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    };
  }

  // --------------------------------------------- membership (TASK-60)

  async addBoardMember(
    boardId: string,
    dto: AdminAddBoardMemberRequest,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true },
    });
    if (!board) throw new NotFoundException("Board not found");
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new NotFoundException("User not found");
    const existing = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId: user.id } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException("User is already a member of this board");
    }
    const role = normalizeRole(dto.role);
    await this.prisma.boardMember.create({
      data: {
        boardId,
        userId: user.id,
        role,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        // A master-added membership is effective immediately — no invitation
        // round-trip the user could miss.
        acceptedAt: new Date(),
        invitedById: null,
      },
    });
    await this.audit(admin, "board.member_added", "board", boardId, {
      userId: user.id,
      email: user.email,
      role,
    });
    return { status: "ok" };
  }

  async updateBoardMember(
    boardId: string,
    memberId: string,
    dto: AdminUpdateBoardMemberRequest,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    const member = await this.prisma.boardMember.findFirst({
      where: { id: memberId, boardId },
    });
    if (!member) throw new NotFoundException("Membership not found");
    const data: Prisma.BoardMemberUpdateInput = {};
    if (dto.role !== undefined) data.role = normalizeRole(dto.role);
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    if (dto.accepted !== undefined) {
      data.acceptedAt = dto.accepted ? new Date() : null;
    }
    await this.prisma.boardMember.update({ where: { id: memberId }, data });
    await this.audit(admin, "board.member_role_changed", "board", boardId, {
      memberId,
      userId: member.userId,
      ...dto,
    });
    return { status: "ok" };
  }

  async removeBoardMember(
    boardId: string,
    memberId: string,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    const member = await this.prisma.boardMember.findFirst({
      where: { id: memberId, boardId },
    });
    if (!member) throw new NotFoundException("Membership not found");
    await this.prisma.boardMember.delete({ where: { id: memberId } });
    await this.audit(admin, "board.member_removed", "board", boardId, {
      memberId,
      userId: member.userId,
    });
    return { status: "ok" };
  }

  async transferOwner(
    boardId: string,
    userId: string,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true },
    });
    if (!board) throw new NotFoundException("Board not found");
    const target = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId } },
    });
    if (!target || target.acceptedAt === null) {
      throw new BadRequestException(
        "The new owner must be an accepted member of the board",
      );
    }
    await this.prisma.$transaction([
      this.prisma.boardMember.updateMany({
        where: { boardId, role: "ADMIN", NOT: { id: target.id } },
        data: { role: "MEMBER" },
      }),
      this.prisma.boardMember.update({
        where: { id: target.id },
        data: { role: "ADMIN" },
      }),
    ]);
    await this.audit(admin, "board.owner_transferred", "board", boardId, {
      userId,
    });
    return { status: "ok" };
  }

  /** Master deletes an attachment and its blob (TASK-60). */
  async deleteAttachment(
    attachmentId: string,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    const row = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!row) throw new NotFoundException("Attachment not found");
    await this.prisma.$transaction(async (tx) => {
      await tx.attachment.update({
        where: { id: attachmentId },
        data: { deletedAt: new Date() },
      });
      if (!row.isInline) {
        await tx.card.update({
          where: { id: row.cardId },
          data: { attachmentCount: { decrement: 1 } },
        });
      }
    });
    await this.storage
      .remove(this.storage.attachmentPath(row.storedName))
      .catch(() => undefined);
    await this.audit(admin, "attachment.delete", "attachment", attachmentId, {
      fileName: row.fileName,
      boardId: row.boardId,
    });
    return { status: "ok" };
  }

  // ------------------------------------------- restore + bulk (TASK-60)

  /** Restores one soft-deleted row (`deletedAt` → null) for a master. */
  async restoreEntity(
    entity: string,
    id: string,
    admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    await this.setDeletedAt(entity, id, null);
    await this.audit(admin, "entity.restored", entity, id, {});
    return { status: "ok" };
  }

  async bulkEntity(
    entity: string,
    ids: string[],
    action: "delete" | "restore" | "archive" | "unarchive",
    admin: AdminPrincipal,
  ): Promise<AdminBulkResultDto> {
    let affected = 0;
    for (const id of ids) {
      if (action === "delete") await this.setDeletedAt(entity, id, new Date());
      else if (action === "restore") await this.setDeletedAt(entity, id, null);
      else if (action === "archive") await this.setArchived(entity, id, true);
      else await this.setArchived(entity, id, false);
      affected += 1;
    }
    await this.audit(admin, "entity.bulk_deleted", entity, null, {
      action,
      count: affected,
    });
    return { affected };
  }

  /** Maps an entity name to its table update for `deletedAt`-style columns. */
  private async setDeletedAt(
    entity: string,
    id: string,
    when: Date | null,
  ): Promise<void> {
    switch (entity) {
      case "boards":
        await this.prisma.board.update({
          where: { id },
          data: { deletedAt: when },
        });
        return;
      case "cards":
        await this.prisma.card.update({
          where: { id },
          data: { deletedAt: when },
        });
        return;
      case "columns":
        await this.prisma.column.update({
          where: { id },
          data: { deletedAt: when },
        });
        return;
      case "labels":
        await this.prisma.label.update({
          where: { id },
          data: { deletedAt: when },
        });
        return;
      case "checklists":
        await this.prisma.checklist.update({
          where: { id },
          data: { deletedAt: when },
        });
        return;
      case "checklistItems":
        await this.prisma.checklistItem.update({
          where: { id },
          data: { deletedAt: when },
        });
        return;
      case "cardLinks":
        await this.prisma.cardLink.update({
          where: { id },
          data: { deletedAt: when },
        });
        return;
      case "comments":
        await this.prisma.comment.update({
          where: { id },
          data: { deletedAt: when },
        });
        return;
      case "attachments":
        await this.prisma.attachment.update({
          where: { id },
          data: { deletedAt: when },
        });
        return;
      default:
        throw new NotFoundException(
          `Entity ${entity} does not support restore`,
        );
    }
  }

  private async setArchived(
    entity: string,
    id: string,
    archived: boolean,
  ): Promise<void> {
    const when = archived ? new Date() : null;
    if (entity === "boards") {
      await this.prisma.board.update({
        where: { id },
        data: { archivedAt: when },
      });
    } else if (entity === "cards") {
      await this.prisma.card.update({
        where: { id },
        data: { archivedAt: when },
      });
    } else {
      throw new NotFoundException(`Entity ${entity} does not support archive`);
    }
  }

  // --------------------------------------------- data/compliance (TASK-63)

  /** Builds a JSON export of everything tied to one user (GDPR access). */
  async exportUser(
    userId: string,
    admin: AdminPrincipal,
  ): Promise<AdminUserExportDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
        disabledAt: true,
        emailVerifiedAt: true,
      },
    });
    if (!user) throw new NotFoundException("User not found");

    const [
      memberships,
      comments,
      attachments,
      sessions,
      tokens,
      commands,
      activity,
    ] = await this.prisma.$transaction([
      this.prisma.boardMember.findMany({
        where: { userId },
        include: { board: { select: { id: true, title: true } } },
      }),
      this.prisma.comment.findMany({
        where: { authorId: userId },
        select: { id: true, cardId: true, text: true, createdAt: true },
      }),
      this.prisma.attachment.findMany({
        where: { uploadedById: userId },
        select: {
          id: true,
          cardId: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      }),
      this.prisma.refreshToken.findMany({
        where: { userId },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          revokedAt: true,
          ip: true,
        },
      }),
      this.prisma.apiToken.findMany({
        where: { userId },
        select: { id: true, name: true, createdAt: true, revokedAt: true },
      }),
      this.prisma.command.findMany({
        where: { actorId: userId },
        select: { id: true, boardId: true, type: true, createdAt: true },
      }),
      this.prisma.activity.findMany({
        where: { actorId: userId },
        select: { id: true, boardId: true, type: true, createdAt: true },
      }),
    ]);

    const generatedAt = Date.now();
    await this.audit(admin, "data.exported", "user", userId, {
      email: user.email,
    });
    return {
      generatedAt,
      filename: `janosik-user-${user.id}-${generatedAt}.json`,
      data: {
        user: {
          ...user,
          createdAt: user.createdAt.getTime(),
          disabledAt: user.disabledAt?.getTime() ?? null,
          emailVerifiedAt: user.emailVerifiedAt?.getTime() ?? null,
        },
        memberships: memberships.map((m) => ({
          boardId: m.boardId,
          boardTitle: m.board.title,
          role: m.role,
          acceptedAt: m.acceptedAt?.getTime() ?? null,
          createdAt: m.createdAt.getTime(),
        })),
        comments: comments.map((c) => ({
          ...c,
          createdAt: c.createdAt.getTime(),
        })),
        attachments,
        sessions: sessions.map((s) => ({
          ...s,
          createdAt: s.createdAt.getTime(),
          expiresAt: s.expiresAt.getTime(),
          revokedAt: s.revokedAt?.getTime() ?? null,
        })),
        tokens: tokens.map((t) => ({
          ...t,
          createdAt: t.createdAt.getTime(),
          revokedAt: t.revokedAt?.getTime() ?? null,
        })),
        commands: commands.map((c) => ({
          ...c,
          createdAt: c.createdAt.getTime(),
        })),
        activity: activity.map((a) => ({
          ...a,
          createdAt: a.createdAt.getTime(),
        })),
      },
    };
  }

  /** Retention policy + how much a purge would remove right now. */
  async getRetention(): Promise<AdminRetentionDto> {
    const cutoff = await this.retentionCutoff();
    const where = { deletedAt: { not: null, lte: cutoff } } as const;
    const [cards, comments, attachments, columns] =
      await this.prisma.$transaction([
        this.prisma.card.count({ where }),
        this.prisma.comment.count({ where }),
        this.prisma.attachment.count({ where }),
        this.prisma.column.count({ where }),
      ]);
    const backupDir = process.env.BACKUP_DIR ?? null;
    return {
      retentionDays: await this.ops.retentionDays(),
      purgeable: { cards, comments, attachments, columns },
      backups: { configured: backupDir !== null, location: backupDir },
    };
  }

  private async retentionCutoff(): Promise<Date> {
    const days = (await this.ops.retentionDays()) ?? 30;
    return new Date(Date.now() - days * DAY_MS);
  }

  /** Hard-deletes soft-deleted rows past the retention window (TASK-38a/63). */
  async purgeSoftDeleted(admin: AdminPrincipal): Promise<AdminBulkResultDto> {
    const cutoff = await this.retentionCutoff();
    const stale = { deletedAt: { not: null, lte: cutoff } } as const;
    const blobs = await this.prisma.attachment.findMany({
      where: stale,
      select: { storedName: true },
    });
    const affected = await this.prisma.$transaction(async (tx) => {
      let count = 0;
      count += (await tx.attachment.deleteMany({ where: stale })).count;
      count += (await tx.comment.deleteMany({ where: stale })).count;
      count += (await tx.checklistItem.deleteMany({ where: stale })).count;
      count += (await tx.checklist.deleteMany({ where: stale })).count;
      count += (await tx.cardLink.deleteMany({ where: stale })).count;
      count += (
        await tx.column.deleteMany({
          where: { ...stale, cards: { none: {} } },
        })
      ).count;
      count += (
        await tx.label.deleteMany({
          where: { ...stale, cards: { none: {} } },
        })
      ).count;
      const cards = await tx.card.findMany({
        where: stale,
        select: { id: true },
      });
      for (const card of cards) {
        await tx.checklistItem.deleteMany({
          where: { checklist: { cardId: card.id } },
        });
        await tx.checklist.deleteMany({ where: { cardId: card.id } });
        await tx.cardLabel.deleteMany({ where: { cardId: card.id } });
        await tx.cardLink.deleteMany({
          where: { OR: [{ fromCardId: card.id }, { toCardId: card.id }] },
        });
        await tx.comment.deleteMany({ where: { cardId: card.id } });
        await tx.attachment.deleteMany({ where: { cardId: card.id } });
        await tx.card.delete({ where: { id: card.id } });
        count += 1;
      }
      return count;
    });
    for (const blob of blobs) {
      await this.storage
        .remove(this.storage.attachmentPath(blob.storedName))
        .catch(() => undefined);
    }
    await this.audit(admin, "retention.changed", "retention", null, {
      purged: affected,
      cutoff: cutoff.toISOString(),
    });
    return { affected };
  }
}

const VALID_ROLES = new Set<Role>(["ADMIN", "MEMBER", "VIEWER" as Role]);

function normalizeRole(raw: string | undefined): Role {
  const value = (raw ?? "MEMBER").toUpperCase() as Role;
  return VALID_ROLES.has(value) ? value : "MEMBER";
}
