import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { argon2id, hash as argonHash } from "argon2";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { boardReducer } from "@janosik/shared";
import type { BoardAction } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import { env } from "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { StorageService } from "@/attachments/storage.service";
import { USER_JWT_AUDIENCE } from "@/auth/auth.types";
import { securityStamp } from "@/auth/security-stamp";
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_QUEUES_JWT_AUDIENCE,
  ADMIN_QUEUES_TOKEN_TYPE,
  ADMIN_TOKEN_TYPE,
} from "@/admin/admin.types";
import {
  ADMIN_REFRESH_COOKIE,
  cookieValue,
  findCookie,
} from "./support/cookies";
import { wipeAll } from "./support/wipe";

const ADMIN_EMAIL = "master@example.com";
const ADMIN_PASSWORD = "master correct horse battery";
const USER_EMAIL = "member@example.com";
const USER_PASSWORD = "member correct horse battery";

/**
 * Master account + admin API (TASK-36). The guarantees under test are the
 * security ones: contour isolation (user tokens cannot reach `/admin` and
 * admin tokens cannot reach user routes), cookie scoping, lockout, audit
 * trail, password hash never serialized and moderation actions that
 * actually take effect.
 */
describe("Admin API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminId: string;
  let adminToken: string;
  let adminEmail: string;
  let userToken: string;
  let userId: string;

  const server = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // FK-safe cleanup of every table (TASK-156).
    await wipeAll(prisma);

    const admin = await prisma.adminUser.create({
      data: {
        email: ADMIN_EMAIL,
        displayName: "Master",
        role: "OWNER",
        passwordHash: await argonHash(ADMIN_PASSWORD, { type: argon2id }),
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs the master in with a path-scoped httpOnly cookie", async () => {
    const res = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    expect(res.body.admin).toEqual({
      id: adminId,
      email: ADMIN_EMAIL,
      displayName: "Master",
      role: "OWNER",
      createdAt: expect.any(Number),
      lastLoginAt: expect.any(Number),
    });
    expect(res.body.admin.passwordHash).toBeUndefined();
    expect(typeof res.body.accessToken).toBe("string");
    adminToken = res.body.accessToken;
    adminEmail = res.body.admin.email;

    const cookie = findCookie(res, ADMIN_REFRESH_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/v1/admin/auth");
    expect(cookie).not.toContain("Secure");

    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: "admin.login", adminId },
    });
    expect(audit).not.toBeNull();
  });

  it("returns the principal on /admin/auth/me", async () => {
    const res = await server()
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.email).toBe(ADMIN_EMAIL);
    expect(res.body.passwordHash).toBeUndefined();
  });

  it("isolates the contours: user token → 401 here, admin token → 401 there", async () => {
    await server().get("/api/v1/admin/metrics").expect(401);
    await server()
      .get("/api/v1/admin/metrics")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const registration = await server()
      .post("/api/v1/auth/register")
      .send({ email: USER_EMAIL, password: USER_PASSWORD })
      .expect(201);
    userToken = registration.body.accessToken;
    userId = registration.body.user.id;

    await server()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(401);
    await server()
      .get("/api/v1/boards")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(401);
    await server()
      .get("/api/v1/admin/metrics")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(401);
  });

  it("rejects a queue-dashboard ticket on normal admin routes (TASK-90)", async () => {
    // The ticket the dashboard reads is signed with its own audience/typ, so
    // it is not a general admin access token.
    const jwt = app.get(JwtService);
    const ticket = await jwt.signAsync(
      { sub: adminId, typ: ADMIN_QUEUES_TOKEN_TYPE },
      {
        secret: env.JWT_SECRET,
        audience: ADMIN_QUEUES_JWT_AUDIENCE,
        expiresIn: "5m",
      },
    );

    await server()
      .get("/api/v1/admin/metrics")
      .set("Authorization", `Bearer ${ticket}`)
      .expect(401);
    await server()
      .get("/api/v1/admin/metrics")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
  });

  it("answers the same generic 401 for an unknown email and logs the attempt", async () => {
    const res = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: "ghost@example.com", password: "whatever password" })
      .expect(401);
    expect(res.body.message).toBe("Invalid credentials");

    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: "admin.login_failed", adminEmail: "ghost@example.com" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.adminId).toBeNull();
    expect(audit?.details).toMatchObject({
      reason: "unknown_email",
      stage: "login",
      ip: expect.any(String),
    });
  });

  it("locks the account after too many failed logins", async () => {
    await prisma.adminUser.update({
      where: { id: adminId },
      data: { failedLogins: 4, lockedUntil: null },
    });

    await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: "wrong password!" })
      .expect(401);

    const locked = await prisma.adminUser.findUnique({
      where: { id: adminId },
    });
    expect(locked?.failedLogins).toBe(5);
    expect(locked?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    const failed = await prisma.adminAuditLog.findFirst({
      where: { adminId, action: "admin.login_failed" },
      orderBy: { createdAt: "desc" },
    });
    expect(failed?.details).toMatchObject({
      reason: "wrong_password",
      stage: "login",
      ip: expect.any(String),
    });

    const res = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(429);
    expect(res.body.message).toBe("Account is temporarily locked");

    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: "admin.login_locked", adminId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.details).toMatchObject({
      reason: "locked",
      stage: "login",
      ip: expect.any(String),
    });

    await prisma.adminUser.update({
      where: { id: adminId },
      data: { failedLogins: 0, lockedUntil: null },
    });
  });

  it("reports metrics over the whole platform", async () => {
    const res = await server()
      .get("/api/v1/admin/metrics")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.users.total).toBe(1);
    expect(res.body.admins.total).toBe(1);
    expect(res.body.boards.active).toBe(0);
    expect(res.body.registrationsByDay).toHaveLength(14);
    expect(res.body.commandsByDay).toHaveLength(14);
  });

  it("lists, searches and paginates users", async () => {
    const all = await server()
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(all.body.total).toBe(1);
    expect(all.body.items[0]).toMatchObject({
      id: userId,
      email: USER_EMAIL,
      disabledAt: null,
    });
    // Schema-first rows carry no aggregate counters.
    expect(all.body.items[0].boards).toBeUndefined();
    expect(all.body.items[0].sessions).toBeUndefined();
    expect(all.body.items[0].passwordHash).toBeUndefined();
    expect(JSON.stringify(all.body)).not.toContain("$argon2");

    const found = await server()
      .get("/api/v1/admin/users?search=member")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(found.body.total).toBe(1);

    const missing = await server()
      .get("/api/v1/admin/users?search=nobody")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(missing.body.total).toBe(0);
  });

  it("marks an impersonation session on GET /auth/me (U-8)", async () => {
    const master = await server()
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const imp = await server()
      .post(`/api/v1/admin/users/${userId}/impersonate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    const me = await server()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${imp.body.accessToken as string}`)
      .expect(200);
    expect(me.body.id).toBe(userId);
    expect(me.body.impersonatedBy).toBe(master.body.id);

    // TASK-147 (B3): the "view as" token is read-only — it must not be a full
    // account takeover (create boards, rotate credentials, mint keys).
    const impToken = imp.body.accessToken as string;
    const created = await server()
      .post("/api/v1/boards")
      .set("Authorization", `Bearer ${impToken}`)
      .send({ title: "Should not exist" })
      .expect(403);
    expect(created.body.code).toBe("impersonation_read_only");

    await server()
      .post("/api/v1/auth/password")
      .set("Authorization", `Bearer ${impToken}`)
      .send({ currentPassword: USER_PASSWORD, newPassword: "new password 123" })
      .expect(403);

    await server()
      .get("/api/v1/users/me/tokens")
      .set("Authorization", `Bearer ${impToken}`)
      .expect(403);
  });

  it("creates a user and returns the generated password exactly once", async () => {
    const res = await server()
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "created@example.com", displayName: "Created" })
      .expect(201);

    expect(res.body.user.email).toBe("created@example.com");
    expect(typeof res.body.temporaryPassword).toBe("string");
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(res.body.user.passwordHash).toBeUndefined();

    const login = await server()
      .post("/api/v1/auth/login")
      .send({
        email: "created@example.com",
        password: res.body.temporaryPassword,
      })
      .expect(200);
    expect(login.body.user.email).toBe("created@example.com");

    await server()
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "created@example.com" })
      .expect(409);
  });

  it("rejects a weak supplied password (validation + whitelist)", async () => {
    await server()
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "weak@example.com", password: "short" })
      .expect(400);
    await server()
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "not-an-email" })
      .expect(400);
  });

  it("disables a user, kills the sessions and refuses the login", async () => {
    const disabled = await server()
      .patch(`/api/v1/admin/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ disabled: true })
      .expect(200);
    expect(disabled.body.disabledAt).toBeGreaterThan(0);
    // Blocking kills the live sessions: the security page shows none left.
    const live = await server()
      .get(`/api/v1/admin/sessions?search=${userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(live.body.total).toBe(0);

    await server()
      .post("/api/v1/auth/login")
      .send({ email: USER_EMAIL, password: USER_PASSWORD })
      .expect(403);

    const enabled = await server()
      .patch(`/api/v1/admin/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ disabled: false })
      .expect(200);
    expect(enabled.body.disabledAt).toBeNull();

    await server()
      .post("/api/v1/auth/login")
      .send({ email: USER_EMAIL, password: USER_PASSWORD })
      .expect(200);
  });

  it("revokes sessions and API tokens on demand", async () => {
    await prisma.refreshToken.create({
      data: {
        tokenHash: "manual-hash",
        userId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const sessions = await server()
      .post(`/api/v1/admin/users/${userId}/sessions/revoke`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(sessions.body.revoked).toBeGreaterThanOrEqual(1);

    await prisma.apiToken.create({
      data: { userId, name: "CI", tokenHash: "api-hash" },
    });
    const tokens = await server()
      .post(`/api/v1/admin/users/${userId}/tokens/revoke`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(tokens.body.revoked).toBe(1);
  });

  it("creates, archives, restores and soft-deletes boards", async () => {
    const created = await server()
      .post("/api/v1/admin/boards")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Master board", ownerEmail: USER_EMAIL })
      .expect(201);
    expect(created.body).toMatchObject({
      title: "Master board",
      userId,
      ownerEmail: USER_EMAIL,
      archivedAt: null,
    });
    const boardId = created.body.id;

    const archived = await server()
      .post(`/api/v1/admin/boards/${boardId}/archive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(archived.body.archivedAt).toBeGreaterThan(0);

    const restored = await server()
      .post(`/api/v1/admin/boards/${boardId}/unarchive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(restored.body.archivedAt).toBeNull();

    const listed = await server()
      .get("/api/v1/admin/boards?search=Master")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(listed.body.total).toBe(1);

    await server()
      .delete(`/api/v1/admin/boards/${boardId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const gone = await server()
      .get("/api/v1/admin/boards?status=deleted")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(gone.body.total).toBe(1);
  });

  it("rejects creating a board for an unknown owner", async () => {
    await server()
      .post("/api/v1/admin/boards")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Orphan", ownerEmail: "nobody@example.com" })
      .expect(404);
  });

  it("exposes the command log and the audit trail with search", async () => {
    const commands = await server()
      .get("/api/v1/admin/commands")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(commands.body.items)).toBe(true);

    const audit = await server()
      .get("/api/v1/admin/audit")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(audit.body.total).toBeGreaterThan(0);

    const created = await server()
      .get("/api/v1/admin/audit?search=user.create")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(created.body.total).toBe(1);
    expect(created.body.items[0]).toMatchObject({
      adminEmail: adminEmail,
      targetType: "user",
      targetExists: true,
    });
  });

  it("filters the log pages by a createdAt window (from/to)", async () => {
    // A window entirely in the future matches nothing; the one spanning
    // "now" matches at least the rows this suite just produced.
    const future = Date.now() + 3_600_000;
    for (const url of [
      "/api/v1/admin/commands",
      "/api/v1/admin/audit",
      "/api/v1/admin/sessions",
      "/api/v1/admin/tokens",
      "/api/v1/admin/entities/activity",
      "/api/v1/admin/comments",
    ]) {
      const empty = await server()
        .get(`${url}?from=${future}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(empty.body.total).toBe(0);
    }

    const yearAgo = Date.now() - 365 * 24 * 3_600_000;
    const audit = await server()
      .get(`/api/v1/admin/audit?from=${yearAgo}&to=${Date.now() + 1000}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(audit.body.total).toBeGreaterThan(0);

    // Out-of-range or non-numeric windows are rejected by the DTO.
    await server()
      .get("/api/v1/admin/audit?from=-5")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
  });

  it("rotates the admin refresh cookie and detects reuse", async () => {
    const login = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    const stolenCookie = cookieValue(login, ADMIN_REFRESH_COOKIE);

    const rotated = await server()
      .post("/api/v1/admin/auth/refresh")
      .set("Cookie", `${ADMIN_REFRESH_COOKIE}=${stolenCookie}`)
      .expect(200);
    const freshCookie = cookieValue(rotated, ADMIN_REFRESH_COOKIE);
    expect(freshCookie).not.toBe(stolenCookie);

    // Reuse moments after the rotation is a lost race, not theft (TASK-153):
    // the old cookie is refused but the fresh session survives.
    await server()
      .post("/api/v1/admin/auth/refresh")
      .set("Cookie", `${ADMIN_REFRESH_COOKIE}=${stolenCookie}`)
      .expect(401);
    const withinGrace = await server()
      .post("/api/v1/admin/auth/refresh")
      .set("Cookie", `${ADMIN_REFRESH_COOKIE}=${freshCookie}`)
      .expect(200);
    const newerCookie = cookieValue(withinGrace, ADMIN_REFRESH_COOKIE);

    // Beyond the grace window the same reuse kills every session.
    await prisma.adminRefreshToken.updateMany({
      where: { adminId, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 2 * 60_000) },
    });
    await server()
      .post("/api/v1/admin/auth/refresh")
      .set("Cookie", `${ADMIN_REFRESH_COOKIE}=${stolenCookie}`)
      .expect(401);
    await server()
      .post("/api/v1/admin/auth/refresh")
      .set("Cookie", `${ADMIN_REFRESH_COOKIE}=${newerCookie}`)
      .expect(401);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: "admin.sessions_revoked", adminId },
    });
    expect(audit).not.toBeNull();
  });

  describe("content and security pages", () => {
    let boardId: string;
    let cardId: string;
    let sessionId: string;
    let tokenId: string;
    let commentId: string;

    beforeAll(async () => {
      const board = await prisma.board.create({
        data: { title: "Moderation board" },
      });
      boardId = board.id;
      await prisma.boardMember.create({
        data: {
          boardId: board.id,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      const column = await prisma.column.create({
        data: {
          id: "mod-column",
          boardId: board.id,
          title: "Backlog",
          position: 0,
        },
      });
      const card = await prisma.card.create({
        data: {
          id: "mod-card",
          columnId: column.id,
          title: "Moderate me",
          position: 0,
        },
      });
      cardId = card.id;
      const comment = await prisma.comment.create({
        data: { cardId: card.id, authorId: userId, text: "spam-ish" },
      });
      commentId = comment.id;
      const session = await prisma.refreshToken.create({
        data: {
          tokenHash: "mod-session-hash",
          userId,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      sessionId = session.id;
      const token = await prisma.apiToken.create({
        data: { userId, name: "moderation", tokenHash: "mod-token-hash" },
      });
      tokenId = token.id;
    });

    /** A two-column board with its own owner user for correlation tests. */
    const commandFixture = async (label: string) => {
      const ownerEmail = `command-owner-${randomUUID()}@example.com`;
      const owner = await prisma.user.create({
        data: {
          email: ownerEmail,
          displayName: `Command owner ${label}`,
          emailVerifiedAt: new Date(),
        },
      });
      const jwt = app.get(JwtService);
      const ownerToken = await jwt.signAsync(
        { sub: owner.id, authMethod: "password", stamp: securityStamp(owner) },
        { audience: USER_JWT_AUDIENCE },
      );

      const board = await prisma.board.create({
        data: { title: `Command board ${label}` },
      });
      await prisma.boardMember.create({
        data: {
          boardId: board.id,
          userId: owner.id,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      const source = await prisma.column.create({
        data: {
          id: `src-${randomUUID()}`,
          boardId: board.id,
          title: "Source",
          position: 0,
        },
      });
      const target = await prisma.column.create({
        data: {
          id: `dst-${randomUUID()}`,
          boardId: board.id,
          title: "Target",
          position: 1,
        },
      });
      const card = await prisma.card.create({
        data: {
          id: `card-${randomUUID()}`,
          columnId: source.id,
          title: `Card ${label}`,
          position: 0,
        },
      });
      return {
        boardId: board.id,
        sourceId: source.id,
        targetId: target.id,
        cardId: card.id,
        ownerId: owner.id,
        ownerToken,
        ownerEmail,
      };
    };

    /**
     * Remove a command fixture without leaving rows other list tests count:
     * command/audit rows, the board subtree and the local owner user.
     */
    const cleanupCommandFixture = async (fixture: {
      boardId: string;
      cardId: string;
      ownerId: string;
    }) => {
      await prisma.command.deleteMany({ where: { boardId: fixture.boardId } });
      const labelIds = (
        await prisma.label.findMany({
          where: { boardId: fixture.boardId },
          select: { id: true },
        })
      ).map((label) => label.id);
      if (labelIds.length > 0) {
        await prisma.cardLabel.deleteMany({
          where: { labelId: { in: labelIds } },
        });
      }
      await prisma.label.deleteMany({ where: { boardId: fixture.boardId } });
      await prisma.cardLink.deleteMany({ where: { boardId: fixture.boardId } });
      await prisma.checklistItem.deleteMany({
        where: {
          checklist: { card: { column: { boardId: fixture.boardId } } },
        },
      });
      await prisma.checklist.deleteMany({
        where: { card: { column: { boardId: fixture.boardId } } },
      });
      await prisma.card.deleteMany({
        where: { column: { boardId: fixture.boardId } },
      });
      await prisma.column.deleteMany({ where: { boardId: fixture.boardId } });
      await prisma.boardMember.deleteMany({
        where: { boardId: fixture.boardId },
      });
      await prisma.board.deleteMany({ where: { id: fixture.boardId } });
      await prisma.adminAuditLog.deleteMany({
        where: {
          OR: [
            { targetType: "board", targetId: fixture.boardId },
            { targetType: "card", targetId: fixture.cardId },
          ],
        },
      });
      await prisma.refreshToken.deleteMany({
        where: { userId: fixture.ownerId },
      });
      await prisma.user.deleteMany({ where: { id: fixture.ownerId } });
    };

    it("correlates a master's description edit and move with the audit row (TASK-176.8/176.10)", async () => {
      const fixture = await commandFixture("edit");
      const commandId = randomUUID();
      const update = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          commandId,
          action: {
            type: "UPDATE_CARD",
            cardId: fixture.cardId,
            description: "Master note",
            at: Date.now(),
          },
        })
        .expect(201);
      expect(typeof update.body.seq).toBe("number");

      // Board-facing attribution is still the owner; the master is in audit.
      const stored = await prisma.command.findUniqueOrThrow({
        where: { id: commandId },
      });
      expect(stored.actorId).toBe(fixture.ownerId);
      expect(stored.actorType).toBe("admin");

      const moveId = randomUUID();
      await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          commandId: moveId,
          action: {
            type: "MOVE_CARD",
            cardId: fixture.cardId,
            fromColumnId: fixture.sourceId,
            fromIndex: 0,
            toColumnId: fixture.targetId,
            toIndex: 0,
            at: Date.now(),
          },
        })
        .expect(201);

      const content = await server()
        .get(`/api/v1/admin/boards/${fixture.boardId}/content`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(content.body.columns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: fixture.sourceId,
            cardIds: [],
          }),
          expect.objectContaining({
            id: fixture.targetId,
            cardIds: [fixture.cardId],
          }),
        ]),
      );

      const detail = await server()
        .get(`/api/v1/admin/cards/${fixture.cardId}/detail`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(detail.body.card.description).toBe("Master note");
      const updateEvent = detail.body.timeline.find(
        (event: { id: string }) => event.id === commandId,
      );
      expect(updateEvent).toMatchObject({
        kind: "command",
        type: "UPDATE_CARD",
        auditId: expect.any(String),
      });

      const commands = await server()
        .get(`/api/v1/admin/commands?commandId=${commandId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(commands.body.total).toBe(1);
      expect(commands.body.items[0]).toMatchObject({
        id: commandId,
        type: "UPDATE_CARD",
        auditId: updateEvent.auditId,
      });

      const moveCommands = await server()
        .get(`/api/v1/admin/commands?commandId=${moveId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(moveCommands.body.total).toBe(1);
      expect(moveCommands.body.items[0].auditId).toEqual(expect.any(String));

      const audit = await server()
        .get(`/api/v1/admin/audit?commandId=${commandId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(audit.body.total).toBe(1);
      expect(audit.body.items[0]).toMatchObject({
        id: updateEvent.auditId,
        action: "board.command",
        targetType: "board",
        targetId: fixture.boardId,
        details: {
          commandId,
          masterId: adminId,
          masterEmail: ADMIN_EMAIL,
          actorEmail: fixture.ownerEmail,
          type: "UPDATE_CARD",
          seq: update.body.seq,
        },
      });

      const moveAudit = await server()
        .get(`/api/v1/admin/audit?commandId=${moveId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(moveAudit.body.total).toBe(1);
      expect(moveAudit.body.items[0].details).toMatchObject({
        commandId: moveId,
        masterId: adminId,
        masterEmail: ADMIN_EMAIL,
        type: "MOVE_CARD",
      });

      // Exact filters: an unknown id matches neither list, a malformed one
      // is rejected by the shared DTO instead of reaching Prisma.
      for (const path of ["commands", "audit"]) {
        const empty = await server()
          .get(`/api/v1/admin/${path}?commandId=${randomUUID()}`)
          .set("Authorization", `Bearer ${adminToken}`)
          .expect(200);
        expect(empty.body.total).toBe(0);

        await server()
          .get(`/api/v1/admin/${path}?commandId=bad%24id`)
          .set("Authorization", `Bearer ${adminToken}`)
          .expect(400);
      }

      // An OPERATOR may execute and read the same correlation.
      const operatorEmail = `operator-176-${randomUUID()}@example.com`;
      const operator = await server()
        .post("/api/v1/admin/admins")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: operatorEmail, displayName: "Operator 176" })
        .expect(201);
      const operatorId = operator.body.admin.id as string;
      const login = await server()
        .post("/api/v1/admin/auth/login")
        .send({
          email: operatorEmail,
          password: operator.body.temporaryPassword,
        })
        .expect(200);
      const operatorToken = login.body.accessToken as string;
      const operatorCommandId = randomUUID();
      await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({
          commandId: operatorCommandId,
          action: {
            type: "UPDATE_CARD",
            cardId: fixture.cardId,
            description: "Operator note",
            at: Date.now(),
          },
        })
        .expect(201);

      const operatorAudit = await server()
        .get(`/api/v1/admin/audit?commandId=${operatorCommandId}`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .expect(200);
      expect(operatorAudit.body.total).toBe(1);
      expect(operatorAudit.body.items[0].details).toMatchObject({
        commandId: operatorCommandId,
        masterId: operatorId,
        masterEmail: operatorEmail,
      });
      const operatorCommands = await server()
        .get(`/api/v1/admin/commands?commandId=${operatorCommandId}`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .expect(200);
      expect(operatorCommands.body.total).toBe(1);

      await server()
        .delete(`/api/v1/admin/admins/${operatorId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      await prisma.adminAuditLog.deleteMany({
        where: {
          OR: [
            { targetId: operatorId },
            { adminId: operatorId },
            { adminEmail: operatorEmail },
          ],
        },
      });

      await cleanupCommandFixture(fixture);
    });

    it("answers null for historical commands and survives a deleted target (TASK-176.10)", async () => {
      const fixture = await commandFixture("history");
      const historyId = `history-${randomUUID()}`;
      await prisma.command.create({
        data: {
          id: historyId,
          boardId: fixture.boardId,
          actorId: fixture.ownerId,
          type: "UPDATE_CARD",
          payload: {
            type: "UPDATE_CARD",
            cardId: fixture.cardId,
            description: "User edit",
            at: Date.now(),
          },
          result: { seq: 0, versions: {} },
          touches: [`card:${fixture.cardId}`],
        },
      });

      const historical = await server()
        .get(`/api/v1/admin/commands?commandId=${historyId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(historical.body.total).toBe(1);
      expect(historical.body.items[0]).toMatchObject({
        id: historyId,
        auditId: null,
      });

      const detail = await server()
        .get(`/api/v1/admin/cards/${fixture.cardId}/detail`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(
        detail.body.timeline.find(
          (event: { id: string }) => event.id === historyId,
        ),
      ).toMatchObject({ kind: "command", auditId: null });

      // No audit row exists for a normal user command: the exact filter is
      // simply empty, and the historical command still renders.
      const emptyAudit = await server()
        .get(`/api/v1/admin/audit?commandId=${historyId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(emptyAudit.body.total).toBe(0);

      // A soft-deleted card/board must not break correlation reads.
      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { deletedAt: new Date() },
      });
      await server()
        .get(`/api/v1/admin/commands?commandId=${historyId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      // A purged card is gone, but the command/audit correlation is not part
      // of the card row: the historical command still answers `auditId: null`.
      await prisma.card.delete({ where: { id: fixture.cardId } });
      const afterCardPurge = await server()
        .get(`/api/v1/admin/commands?commandId=${historyId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(afterCardPurge.body.total).toBe(1);
      expect(afterCardPurge.body.items[0].auditId).toBeNull();

      await prisma.board.update({
        where: { id: fixture.boardId },
        data: { deletedAt: new Date() },
      });
      const afterDelete = await server()
        .get(`/api/v1/admin/commands?commandId=${historyId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(afterDelete.body.total).toBe(1);
      expect(afterDelete.body.items[0].auditId).toBeNull();

      await cleanupCommandFixture(fixture);
    });

    it("does not fabricate a master audit row when replaying a normal user command (TASK-176.10)", async () => {
      const fixture = await commandFixture("replay");
      const commandId = randomUUID();
      const action = {
        type: "UPDATE_CARD",
        cardId: fixture.cardId,
        description: "User edit",
        at: Date.now(),
      };
      const user = await server()
        .post(`/api/v1/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${fixture.ownerToken}`)
        .send({ commandId, action })
        .expect(200);
      const before = await prisma.command.findUniqueOrThrow({
        where: { id: commandId },
      });
      expect(before.actorId).toBe(fixture.ownerId);
      expect(before.actorType).toBe("human");
      expect(before.seq).toBe(BigInt(user.body.seq));

      const replay = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId, action })
        .expect(201);
      expect(replay.body.seq).toBe(user.body.seq);
      const after = await prisma.command.findUniqueOrThrow({
        where: { id: commandId },
      });
      expect(after.seq).toBe(before.seq);
      expect(after.actorId).toBe(fixture.ownerId);
      expect(after.actorType).toBe("human");
      expect(
        await prisma.adminAuditLog.count({
          where: {
            action: "board.command",
            targetId: fixture.boardId,
            details: { path: ["commandId"], equals: commandId },
          },
        }),
      ).toBe(0);

      const listed = await server()
        .get(`/api/v1/admin/commands?commandId=${commandId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(listed.body.total).toBe(1);
      expect(listed.body.items[0].auditId).toBeNull();

      // A second master retry of its own fresh command is also a replay: the
      // command and its one audit row stay exactly one row each.
      const adminCommandId = randomUUID();
      const adminAction = {
        type: "UPDATE_CARD",
        cardId: fixture.cardId,
        description: "Master edit",
        at: Date.now(),
      };
      const first = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: adminCommandId, action: adminAction })
        .expect(201);
      const second = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: adminCommandId, action: adminAction })
        .expect(201);
      expect(second.body.seq).toBe(first.body.seq);
      expect(
        await prisma.adminAuditLog.count({
          where: {
            action: "board.command",
            targetId: fixture.boardId,
            details: { path: ["commandId"], equals: adminCommandId },
          },
        }),
      ).toBe(1);

      await cleanupCommandFixture(fixture);
    });

    it("rejects deleted/missing card edits and archived-card moves before the command log (TASK-176.8)", async () => {
      const fixture = await commandFixture("guards");
      const deletedUpdateId = randomUUID();
      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { deletedAt: new Date() },
      });
      await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          commandId: deletedUpdateId,
          action: {
            type: "UPDATE_CARD",
            cardId: fixture.cardId,
            description: "Should not land",
            at: Date.now(),
          },
        })
        .expect(404);
      expect(
        await prisma.command.count({ where: { id: deletedUpdateId } }),
      ).toBe(0);

      const missingId = randomUUID();
      await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          commandId: missingId,
          action: {
            type: "MOVE_CARD",
            cardId: `missing-${randomUUID()}`,
            fromColumnId: fixture.sourceId,
            fromIndex: 0,
            toColumnId: fixture.targetId,
            toIndex: 0,
            at: Date.now(),
          },
        })
        .expect(404);
      expect(await prisma.command.count({ where: { id: missingId } })).toBe(0);

      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { deletedAt: null, archivedAt: new Date() },
      });
      const archivedMoveId = randomUUID();
      await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          commandId: archivedMoveId,
          action: {
            type: "MOVE_CARD",
            cardId: fixture.cardId,
            fromColumnId: fixture.sourceId,
            fromIndex: 0,
            toColumnId: fixture.targetId,
            toIndex: 0,
            at: Date.now(),
          },
        })
        .expect(409);
      expect(
        await prisma.command.count({ where: { id: archivedMoveId } }),
      ).toBe(0);
      expect(
        await prisma.adminAuditLog.count({
          where: {
            action: "board.command",
            targetId: fixture.boardId,
          },
        }),
      ).toBe(0);

      await cleanupCommandFixture(fixture);
    });

    it("rejects malformed cardId in admin edit/move actions with 400", async () => {
      const fixture = await commandFixture("malformed");
      const malformed: unknown[] = [undefined, {}, null, "", "   "];
      for (const type of ["UPDATE_CARD", "MOVE_CARD"] as const) {
        for (const cardId of malformed) {
          const action: Record<string, unknown> = {
            type,
            cardId,
            at: Date.now(),
          };
          if (type === "UPDATE_CARD") {
            action.description = "Never applied";
          } else {
            action.fromColumnId = fixture.sourceId;
            action.fromIndex = 0;
            action.toColumnId = fixture.targetId;
            action.toIndex = 0;
          }
          await server()
            .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ action })
            .expect(400);
        }
      }
      expect(
        await prisma.command.count({ where: { boardId: fixture.boardId } }),
      ).toBe(0);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "board.command", targetId: fixture.boardId },
        }),
      ).toBe(0);

      await cleanupCommandFixture(fixture);
    });

    it("replays stored results after the card is archived or deleted (TASK-176.8/176.10)", async () => {
      const fixture = await commandFixture("replay-state");
      const moveId = randomUUID();
      const moveAction = {
        type: "MOVE_CARD",
        cardId: fixture.cardId,
        fromColumnId: fixture.sourceId,
        fromIndex: 0,
        toColumnId: fixture.targetId,
        toIndex: 0,
        at: Date.now(),
      };
      const moved = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: moveId, action: moveAction })
        .expect(201);
      await server()
        .post(`/api/v1/admin/cards/${fixture.cardId}/archive`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      const moveRetry = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: moveId, action: moveAction })
        .expect(201);
      expect(moveRetry.body.seq).toBe(moved.body.seq);
      expect(await prisma.command.count({ where: { id: moveId } })).toBe(1);
      expect(
        await prisma.adminAuditLog.count({
          where: {
            action: "board.command",
            targetId: fixture.boardId,
            details: { path: ["commandId"], equals: moveId },
          },
        }),
      ).toBe(1);

      await server()
        .post(`/api/v1/admin/cards/${fixture.cardId}/unarchive`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      const updateId = randomUUID();
      const updateAction = {
        type: "UPDATE_CARD",
        cardId: fixture.cardId,
        description: "Stored before delete",
        at: Date.now(),
      };
      const updated = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: updateId, action: updateAction })
        .expect(201);
      await server()
        .delete(`/api/v1/admin/cards/${fixture.cardId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const updateRetry = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: updateId, action: updateAction })
        .expect(201);
      expect(updateRetry.body.seq).toBe(updated.body.seq);
      expect(await prisma.command.count({ where: { id: updateId } })).toBe(1);
      expect(
        await prisma.adminAuditLog.count({
          where: {
            action: "board.command",
            targetId: fixture.boardId,
            details: { path: ["commandId"], equals: updateId },
          },
        }),
      ).toBe(1);

      await cleanupCommandFixture(fixture);
    });

    it("applies admin card field commands with owner attribution (TASK-176.9)", async () => {
      const fixture = await commandFixture("fields");
      const label = await prisma.label.create({
        data: {
          id: `label-${randomUUID()}`,
          boardId: fixture.boardId,
          name: "Field label",
          color: "red",
          position: 0,
        },
      });
      const due = Date.now() + 86_400_000;
      const sent: Array<{ id: string; type: string }> = [];
      const post = async (
        type: string,
        action: Record<string, unknown>,
      ): Promise<string> => {
        const id = randomUUID();
        sent.push({ id, type });
        await server()
          .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            commandId: id,
            action: { type, ...action, at: Date.now() },
          })
          .expect(201);
        return id;
      };

      await post("SET_CARD_ASSIGN", {
        cardId: fixture.cardId,
        assigneeId: fixture.ownerId,
      });
      await post("SET_CARD_DUE_DATE", {
        cardId: fixture.cardId,
        dueDate: due,
      });
      await post("SET_CARD_PRIORITY", {
        cardId: fixture.cardId,
        priority: "high",
      });
      await post("SET_CARD_COVER", {
        cardId: fixture.cardId,
        cover: { type: "color", value: "red" },
      });
      await post("SET_CARD_LABEL", {
        cardId: fixture.cardId,
        labelId: label.id,
        on: true,
      });

      const updated = await prisma.card.findUniqueOrThrow({
        where: { id: fixture.cardId },
        include: { labels: { select: { labelId: true } } },
      });
      expect(updated.assigneeId).toBe(fixture.ownerId);
      expect(updated.dueDate?.getTime()).toBe(due);
      expect(updated.priority).toBe("high");
      expect(updated.coverType).toBe("color");
      expect(updated.coverValue).toBe("red");
      expect(updated.labels.map((row) => row.labelId)).toContain(label.id);

      await post("SET_CARD_ASSIGN", {
        cardId: fixture.cardId,
        assigneeId: null,
      });
      await post("SET_CARD_DUE_DATE", { cardId: fixture.cardId });
      await post("SET_CARD_PRIORITY", {
        cardId: fixture.cardId,
        priority: "medium",
      });
      await post("SET_CARD_COVER", { cardId: fixture.cardId });
      await post("SET_CARD_LABEL", {
        cardId: fixture.cardId,
        labelId: label.id,
        on: false,
      });

      const cleared = await prisma.card.findUniqueOrThrow({
        where: { id: fixture.cardId },
        include: { labels: { select: { labelId: true } } },
      });
      expect(cleared.assigneeId).toBeNull();
      expect(cleared.dueDate).toBeNull();
      expect(cleared.priority).toBeNull();
      expect(cleared.coverType).toBeNull();
      expect(cleared.coverValue).toBeNull();
      expect(cleared.labels).toHaveLength(0);

      expect(
        await prisma.adminAuditLog.count({
          where: { action: "board.command", targetId: fixture.boardId },
        }),
      ).toBe(sent.length);
      for (const item of sent) {
        const audit = await prisma.adminAuditLog.findFirstOrThrow({
          where: {
            action: "board.command",
            targetId: fixture.boardId,
            details: { path: ["commandId"], equals: item.id },
          },
        });
        expect(audit.details).toMatchObject({
          commandId: item.id,
          masterId: adminId,
          masterEmail: ADMIN_EMAIL,
          actorEmail: fixture.ownerEmail,
          type: item.type,
        });
        const command = await prisma.command.findUniqueOrThrow({
          where: { id: item.id },
        });
        // Board-facing attribution stays the owner; the master is in audit.
        expect(command.actorId).toBe(fixture.ownerId);
        expect(command.actorType).toBe("admin");
      }

      await cleanupCommandFixture(fixture);
    });

    it("guards admin card field commands — deleted/missing/wrong-board cards, bad assignee/label, label cap (TASK-176.9)", async () => {
      const fixture = await commandFixture("field-guards");
      const label = await prisma.label.create({
        data: {
          id: `label-${randomUUID()}`,
          boardId: fixture.boardId,
          name: "Guard label",
          color: "green",
        },
      });
      const reject = async (
        status: number,
        action: Record<string, unknown>,
      ): Promise<string> => {
        const id = randomUUID();
        await server()
          .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ commandId: id, action: { ...action, at: Date.now() } })
          .expect(status);
        expect(await prisma.command.count({ where: { id } })).toBe(0);
        return id;
      };

      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { deletedAt: new Date() },
      });
      for (const action of [
        {
          type: "SET_CARD_ASSIGN",
          cardId: fixture.cardId,
          assigneeId: fixture.ownerId,
        },
        {
          type: "SET_CARD_DUE_DATE",
          cardId: fixture.cardId,
          dueDate: Date.now() + 60_000,
        },
        {
          type: "SET_CARD_PRIORITY",
          cardId: fixture.cardId,
          priority: "high",
        },
        {
          type: "SET_CARD_COVER",
          cardId: fixture.cardId,
          cover: { type: "color", value: "blue" },
        },
        {
          type: "SET_CARD_LABEL",
          cardId: fixture.cardId,
          labelId: label.id,
          on: true,
        },
      ]) {
        await reject(404, action);
      }
      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { deletedAt: null },
      });

      await reject(404, {
        type: "SET_CARD_PRIORITY",
        cardId: `missing-${randomUUID()}`,
        priority: "low",
      });

      // A card from another board is indistinguishable from a missing one.
      const otherBoard = await prisma.board.create({
        data: { title: `Other field board ${randomUUID()}` },
      });
      await prisma.boardMember.create({
        data: {
          boardId: otherBoard.id,
          userId: fixture.ownerId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      const wrongBoardId = randomUUID();
      await server()
        .post(`/api/v1/admin/boards/${otherBoard.id}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          commandId: wrongBoardId,
          action: {
            type: "SET_CARD_PRIORITY",
            cardId: fixture.cardId,
            priority: "low",
            at: Date.now(),
          },
        })
        .expect(404);
      expect(await prisma.command.count({ where: { id: wrongBoardId } })).toBe(
        0,
      );
      const foreignLabel = await prisma.label.create({
        data: {
          id: `foreign-label-${randomUUID()}`,
          boardId: otherBoard.id,
          name: "Foreign label",
          color: "red",
        },
      });
      await reject(404, {
        type: "SET_CARD_LABEL",
        cardId: fixture.cardId,
        labelId: foreignLabel.id,
        on: true,
      });
      await prisma.label.delete({ where: { id: foreignLabel.id } });
      await prisma.boardMember.deleteMany({
        where: { boardId: otherBoard.id },
      });
      await prisma.board.delete({ where: { id: otherBoard.id } });

      await reject(400, {
        type: "SET_CARD_ASSIGN",
        cardId: fixture.cardId,
        assigneeId: `ghost-${randomUUID()}`,
      });

      await prisma.label.update({
        where: { id: label.id },
        data: { deletedAt: new Date() },
      });
      await reject(404, {
        type: "SET_CARD_LABEL",
        cardId: fixture.cardId,
        labelId: label.id,
        on: true,
      });
      await reject(404, {
        type: "SET_CARD_LABEL",
        cardId: fixture.cardId,
        labelId: label.id,
        on: false,
      });

      const capLabels = Array.from({ length: 20 }, (_, index) => ({
        id: `cap-${randomUUID()}-${index}`,
        boardId: fixture.boardId,
        name: `Cap ${index + 1}`,
        color: "slate",
        position: index,
      }));
      await prisma.label.createMany({ data: capLabels });
      await prisma.cardLabel.createMany({
        data: capLabels.map((entry) => ({
          cardId: fixture.cardId,
          labelId: entry.id,
          position: 0,
        })),
      });
      const overflowLabel = await prisma.label.create({
        data: {
          id: `overflow-${randomUUID()}`,
          boardId: fixture.boardId,
          name: "Overflow",
          color: "red",
          position: 20,
        },
      });
      await reject(409, {
        type: "SET_CARD_LABEL",
        cardId: fixture.cardId,
        labelId: overflowLabel.id,
        on: true,
      });

      expect(
        await prisma.command.count({ where: { boardId: fixture.boardId } }),
      ).toBe(0);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "board.command", targetId: fixture.boardId },
        }),
      ).toBe(0);

      await cleanupCommandFixture(fixture);
    });

    it("allows archived field edits, replays field commands idempotently and supports OPERATOR (TASK-176.9)", async () => {
      const fixture = await commandFixture("field-state");
      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { archivedAt: new Date() },
      });
      const due = Date.now() + 86_400_000;
      const dueId = randomUUID();
      const dueAction = {
        type: "SET_CARD_DUE_DATE",
        cardId: fixture.cardId,
        dueDate: due,
        at: Date.now(),
      };
      const first = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: dueId, action: dueAction })
        .expect(201);
      const archivedCard = await prisma.card.findUniqueOrThrow({
        where: { id: fixture.cardId },
      });
      expect(archivedCard.dueDate?.getTime()).toBe(due);

      // A replay skips the fresh-command card guard, so it still returns the
      // stored result after the card is deleted.
      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { deletedAt: new Date() },
      });
      const retry = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: dueId, action: dueAction })
        .expect(201);
      expect(retry.body.seq).toBe(first.body.seq);
      expect(await prisma.command.count({ where: { id: dueId } })).toBe(1);
      expect(
        await prisma.adminAuditLog.count({
          where: {
            action: "board.command",
            targetId: fixture.boardId,
            details: { path: ["commandId"], equals: dueId },
          },
        }),
      ).toBe(1);

      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { deletedAt: null },
      });
      // Mint the OPERATOR token directly instead of another password login:
      // the admin auth throttle is intentionally tight and this test is about
      // the field-command path, not the login flow (covered elsewhere).
      const operatorEmail = `operator-1769-${randomUUID()}@example.com`;
      const operator = await prisma.adminUser.create({
        data: {
          email: operatorEmail,
          displayName: "Operator 176.9",
          role: "OPERATOR",
          passwordHash: await argonHash("operator correct horse", {
            type: argon2id,
          }),
        },
      });
      const operatorId = operator.id;
      const operatorToken = await app
        .get(JwtService)
        .signAsync(
          { sub: operatorId, typ: ADMIN_TOKEN_TYPE },
          { audience: ADMIN_JWT_AUDIENCE },
        );
      const operatorCommandId = randomUUID();
      await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({
          commandId: operatorCommandId,
          action: {
            type: "SET_CARD_PRIORITY",
            cardId: fixture.cardId,
            priority: "lowest",
            at: Date.now(),
          },
        })
        .expect(201);
      const operatorAudit = await prisma.adminAuditLog.findFirstOrThrow({
        where: {
          action: "board.command",
          targetId: fixture.boardId,
          details: { path: ["commandId"], equals: operatorCommandId },
        },
      });
      expect(operatorAudit.details).toMatchObject({
        commandId: operatorCommandId,
        masterId: operatorId,
        masterEmail: operatorEmail,
        type: "SET_CARD_PRIORITY",
      });
      expect(
        await prisma.command.count({ where: { id: operatorCommandId } }),
      ).toBe(1);

      await server()
        .delete(`/api/v1/admin/admins/${operatorId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      await prisma.adminAuditLog.deleteMany({
        where: {
          OR: [
            { targetId: operatorId },
            { adminId: operatorId },
            { adminEmail: operatorEmail },
          ],
        },
      });
      await cleanupCommandFixture(fixture);
    });

    it("applies admin checklist and link commands with owner attribution (TASK-176.9 B2)", async () => {
      const fixture = await commandFixture("relations");
      const targetCard = await prisma.card.create({
        data: {
          id: `card-${randomUUID()}`,
          columnId: fixture.targetId,
          title: "Link target",
          position: 0,
        },
      });
      const secondTarget = await prisma.card.create({
        data: {
          id: `card-${randomUUID()}`,
          columnId: fixture.targetId,
          title: "Second link target",
          position: 1,
        },
      });
      const checklistId = randomUUID();
      const itemId = randomUUID();
      const linkId = randomUUID();
      const secondLinkId = randomUUID();
      const sent: Array<{
        id: string;
        type: string;
        action: Record<string, unknown>;
      }> = [];
      const post = async (
        type: string,
        action: Record<string, unknown>,
      ): Promise<string> => {
        const id = randomUUID();
        const payload = { type, ...action, at: Date.now() };
        sent.push({ id, type, action: payload });
        await server()
          .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ commandId: id, action: payload })
          .expect(201);
        return id;
      };

      await post("ADD_CHECKLIST", {
        cardId: fixture.cardId,
        newChecklistId: checklistId,
        title: "Steps",
      });
      await post("RENAME_CHECKLIST", {
        cardId: fixture.cardId,
        checklistId,
        title: "Steps renamed",
      });
      await post("ADD_CHECKLIST_ITEM", {
        cardId: fixture.cardId,
        checklistId,
        newItemId: itemId,
        text: "First step",
      });
      await post("SET_CHECKLIST_ITEM_DONE", {
        cardId: fixture.cardId,
        checklistId,
        itemId,
        done: true,
      });
      await post("RENAME_CHECKLIST_ITEM", {
        cardId: fixture.cardId,
        checklistId,
        itemId,
        text: "First step renamed",
      });
      await post("ADD_CARD_LINK", {
        cardId: fixture.cardId,
        linkId,
        targetCardId: targetCard.id,
        linkType: "blocks",
      });

      const checklist = await prisma.checklist.findUniqueOrThrow({
        where: { id: checklistId },
        include: { items: true },
      });
      expect(checklist.title).toBe("Steps renamed");
      expect(checklist.items).toHaveLength(1);
      expect(checklist.items[0]).toMatchObject({
        id: itemId,
        text: "First step renamed",
        done: true,
      });
      const link = await prisma.cardLink.findUniqueOrThrow({
        where: { id: linkId },
      });
      expect(link).toMatchObject({
        boardId: fixture.boardId,
        fromCardId: fixture.cardId,
        toCardId: targetCard.id,
        type: "blocks",
        deletedAt: null,
      });

      const detail = await server()
        .get(`/api/v1/admin/cards/${fixture.cardId}/detail`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(detail.body.checklists).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: checklistId,
            title: "Steps renamed",
            items: [
              expect.objectContaining({
                id: itemId,
                text: "First step renamed",
                done: true,
              }),
            ],
          }),
        ]),
      );
      expect(detail.body.linksOut).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: linkId,
            otherCardId: targetCard.id,
            otherCardTitle: "Link target",
            otherCardDeleted: false,
            type: "blocks",
          }),
        ]),
      );

      // The DTO flags a soft-deleted other end independently of the board
      // aggregate, so the admin UI can show its dangling badge immediately.
      await prisma.card.update({
        where: { id: targetCard.id },
        data: { deletedAt: new Date() },
      });
      const danglingDetail = await server()
        .get(`/api/v1/admin/cards/${fixture.cardId}/detail`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(danglingDetail.body.linksOut).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: linkId, otherCardDeleted: true }),
        ]),
      );
      const targetDetail = await server()
        .get(`/api/v1/admin/cards/${targetCard.id}/detail`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(targetDetail.body.linksIn).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: linkId,
            otherCardDeleted: false,
          }),
        ]),
      );
      await prisma.card.update({
        where: { id: targetCard.id },
        data: { deletedAt: null },
      });

      // Archived cards keep checklist and link editing; only moves stay
      // blocked (covered by the field test above).
      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { archivedAt: new Date() },
      });
      await post("RENAME_CHECKLIST", {
        cardId: fixture.cardId,
        checklistId,
        title: "Archived checklist",
      });
      await post("ADD_CARD_LINK", {
        cardId: fixture.cardId,
        linkId: secondLinkId,
        targetCardId: secondTarget.id,
        linkType: "relates_to",
      });
      await post("REMOVE_CARD_LINK", {
        cardId: fixture.cardId,
        linkId: secondLinkId,
        targetCardId: secondTarget.id,
        linkType: "relates_to",
      });
      await post("DELETE_CHECKLIST_ITEM", {
        cardId: fixture.cardId,
        checklistId,
        itemId,
      });
      await post("DELETE_CHECKLIST", { cardId: fixture.cardId, checklistId });

      const removedLink = await prisma.cardLink.findUniqueOrThrow({
        where: { id: secondLinkId },
      });
      expect(removedLink.deletedAt).not.toBeNull();
      const deletedChecklist = await prisma.checklist.findUniqueOrThrow({
        where: { id: checklistId },
      });
      expect(deletedChecklist.deletedAt).not.toBeNull();
      const deletedItem = await prisma.checklistItem.findUniqueOrThrow({
        where: { id: itemId },
      });
      expect(deletedItem.deletedAt).not.toBeNull();

      expect(
        await prisma.command.count({
          where: { id: { in: sent.map((entry) => entry.id) } },
        }),
      ).toBe(sent.length);
      for (const entry of sent) {
        const audit = await prisma.adminAuditLog.findFirstOrThrow({
          where: {
            action: "board.command",
            targetId: fixture.boardId,
            details: { path: ["commandId"], equals: entry.id },
          },
        });
        expect(audit.details).toMatchObject({
          commandId: entry.id,
          masterId: adminId,
          masterEmail: ADMIN_EMAIL,
          actorEmail: fixture.ownerEmail,
          type: entry.type,
        });
        const command = await prisma.command.findUniqueOrThrow({
          where: { id: entry.id },
        });
        expect(command.actorId).toBe(fixture.ownerId);
        expect(command.actorType).toBe("admin");
      }

      // An exact replay after the card is deleted returns the stored result
      // and never creates a second command or audit row.
      const replay = sent[1]!;
      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { deletedAt: new Date() },
      });
      const replayResult = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: replay.id, action: replay.action })
        .expect(201);
      const storedReplay = await prisma.command.findUniqueOrThrow({
        where: { id: replay.id },
      });
      expect(replayResult.body.seq).toBe(Number(storedReplay.seq));
      expect(
        await prisma.command.count({
          where: { id: replay.id },
        }),
      ).toBe(1);
      expect(
        await prisma.adminAuditLog.count({
          where: {
            action: "board.command",
            targetId: fixture.boardId,
            details: { path: ["commandId"], equals: replay.id },
          },
        }),
      ).toBe(1);
      const deletedSourceTargetDetail = await server()
        .get(`/api/v1/admin/cards/${targetCard.id}/detail`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(deletedSourceTargetDetail.body.linksIn).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: linkId, otherCardDeleted: true }),
        ]),
      );

      await cleanupCommandFixture(fixture);
    });

    it("guards admin checklist and link commands without writes or audit rows (TASK-176.9 B2)", async () => {
      const fixture = await commandFixture("relation-guards");
      const targetCard = await prisma.card.create({
        data: {
          id: `card-${randomUUID()}`,
          columnId: fixture.targetId,
          title: "Guard target",
          position: 0,
        },
      });
      const checklistId = randomUUID();
      const itemId = randomUUID();
      await prisma.checklist.create({
        data: {
          id: checklistId,
          cardId: fixture.cardId,
          title: "Guard checklist",
          position: 0,
          items: {
            create: {
              id: itemId,
              text: "Guard item",
              position: 0,
            },
          },
        },
      });
      const foreignChecklist = await prisma.checklist.create({
        data: {
          id: randomUUID(),
          cardId: targetCard.id,
          title: "Foreign checklist",
          position: 0,
        },
      });
      const foreignChecklistId = foreignChecklist.id;
      const deletedChecklist = await prisma.checklist.create({
        data: {
          id: randomUUID(),
          cardId: fixture.cardId,
          title: "Deleted checklist",
          position: 1,
          deletedAt: new Date(),
        },
      });
      const deletedItem = await prisma.checklistItem.create({
        data: {
          id: randomUUID(),
          checklistId,
          text: "Deleted item",
          position: 1,
          deletedAt: new Date(),
        },
      });
      const otherChecklist = await prisma.checklist.create({
        data: {
          id: randomUUID(),
          cardId: fixture.cardId,
          title: "Other checklist",
          position: 2,
          items: {
            create: {
              id: randomUUID(),
              text: "Other item",
              position: 0,
            },
          },
        },
        include: { items: true },
      });
      const otherItemId = otherChecklist.items[0]!.id;

      const otherBoard = await prisma.board.create({
        data: { title: `Other relation board ${randomUUID()}` },
      });
      await prisma.boardMember.create({
        data: {
          boardId: otherBoard.id,
          userId: fixture.ownerId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      const otherColumn = await prisma.column.create({
        data: {
          id: `col-${randomUUID()}`,
          boardId: otherBoard.id,
          title: "Other column",
          position: 0,
        },
      });
      const foreignCard = await prisma.card.create({
        data: {
          id: `card-${randomUUID()}`,
          columnId: otherColumn.id,
          title: "Foreign card",
          position: 0,
        },
      });

      const reject = async (
        status: number,
        action: Record<string, unknown>,
      ): Promise<string> => {
        const id = randomUUID();
        await server()
          .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ commandId: id, action: { ...action, at: Date.now() } })
          .expect(status);
        expect(await prisma.command.count({ where: { id } })).toBe(0);
        expect(
          await prisma.adminAuditLog.count({
            where: {
              action: "board.command",
              targetId: fixture.boardId,
              details: { path: ["commandId"], equals: id },
            },
          }),
        ).toBe(0);
        return id;
      };

      await reject(404, {
        type: "ADD_CHECKLIST",
        cardId: `missing-${randomUUID()}`,
        newChecklistId: randomUUID(),
        title: "Missing card",
      });
      await reject(404, {
        type: "ADD_CHECKLIST",
        cardId: foreignCard.id,
        newChecklistId: randomUUID(),
        title: "Wrong board",
      });
      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { deletedAt: new Date() },
      });
      await reject(404, {
        type: "RENAME_CHECKLIST",
        cardId: fixture.cardId,
        checklistId,
        title: "Deleted card",
      });
      await prisma.card.update({
        where: { id: fixture.cardId },
        data: { deletedAt: null },
      });

      await reject(404, {
        type: "RENAME_CHECKLIST",
        cardId: fixture.cardId,
        checklistId: `missing-${randomUUID()}`,
        title: "Missing checklist",
      });
      await reject(404, {
        type: "RENAME_CHECKLIST",
        cardId: fixture.cardId,
        checklistId: deletedChecklist.id,
        title: "Deleted checklist",
      });
      await reject(404, {
        type: "RENAME_CHECKLIST",
        cardId: fixture.cardId,
        checklistId: foreignChecklistId,
        title: "Wrong card",
      });
      await reject(404, {
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId: fixture.cardId,
        checklistId,
        itemId: `missing-${randomUUID()}`,
        done: true,
      });
      await reject(404, {
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId: fixture.cardId,
        checklistId,
        itemId: deletedItem.id,
        done: true,
      });
      await reject(404, {
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId: fixture.cardId,
        checklistId,
        itemId: otherItemId,
        done: true,
      });

      // New ids: free or a soft-deleted row owned by this card/checklist;
      // live and foreign rows are refused.
      await reject(409, {
        type: "ADD_CHECKLIST",
        cardId: fixture.cardId,
        newChecklistId: checklistId,
        title: "Live id",
      });
      await reject(409, {
        type: "ADD_CHECKLIST",
        cardId: fixture.cardId,
        newChecklistId: foreignChecklistId,
        title: "Foreign id",
      });
      await reject(409, {
        type: "ADD_CHECKLIST_ITEM",
        cardId: fixture.cardId,
        checklistId,
        newItemId: itemId,
        text: "Live item id",
      });
      await reject(409, {
        type: "ADD_CHECKLIST_ITEM",
        cardId: fixture.cardId,
        checklistId,
        newItemId: otherItemId,
        text: "Foreign item id",
      });

      const existingLink = await prisma.cardLink.create({
        data: {
          id: randomUUID(),
          boardId: fixture.boardId,
          fromCardId: fixture.cardId,
          toCardId: targetCard.id,
          type: "relates_to",
        },
      });
      await reject(409, {
        type: "ADD_CARD_LINK",
        cardId: fixture.cardId,
        linkId: existingLink.id,
        targetCardId: targetCard.id,
        linkType: "relates_to",
      });
      const foreignLink = await prisma.cardLink.create({
        data: {
          id: randomUUID(),
          boardId: fixture.boardId,
          fromCardId: targetCard.id,
          toCardId: fixture.cardId,
          type: "relates_to",
        },
      });
      await reject(409, {
        type: "ADD_CARD_LINK",
        cardId: fixture.cardId,
        linkId: foreignLink.id,
        targetCardId: targetCard.id,
        linkType: "relates_to",
      });
      await reject(404, {
        type: "ADD_CARD_LINK",
        cardId: fixture.cardId,
        linkId: randomUUID(),
        targetCardId: `missing-${randomUUID()}`,
        linkType: "relates_to",
      });
      await reject(404, {
        type: "ADD_CARD_LINK",
        cardId: fixture.cardId,
        linkId: randomUUID(),
        targetCardId: foreignCard.id,
        linkType: "relates_to",
      });
      await reject(400, {
        type: "ADD_CARD_LINK",
        cardId: fixture.cardId,
        linkId: randomUUID(),
        targetCardId: fixture.cardId,
        linkType: "relates_to",
      });
      await reject(409, {
        type: "ADD_CARD_LINK",
        cardId: fixture.cardId,
        linkId: randomUUID(),
        targetCardId: targetCard.id,
        linkType: "blocks",
      });

      const cycleA = await prisma.card.create({
        data: {
          id: `card-${randomUUID()}`,
          columnId: fixture.sourceId,
          title: "Cycle A",
          position: 1,
        },
      });
      const cycleB = await prisma.card.create({
        data: {
          id: `card-${randomUUID()}`,
          columnId: fixture.sourceId,
          title: "Cycle B",
          position: 2,
        },
      });
      const cycleC = await prisma.card.create({
        data: {
          id: `card-${randomUUID()}`,
          columnId: fixture.sourceId,
          title: "Cycle C",
          position: 3,
        },
      });
      await prisma.cardLink.createMany({
        data: [
          {
            id: randomUUID(),
            boardId: fixture.boardId,
            fromCardId: cycleB.id,
            toCardId: cycleC.id,
            type: "blocks",
          },
          {
            id: randomUUID(),
            boardId: fixture.boardId,
            fromCardId: cycleC.id,
            toCardId: cycleA.id,
            type: "blocks",
          },
        ],
      });
      await reject(409, {
        type: "ADD_CARD_LINK",
        cardId: cycleA.id,
        linkId: randomUUID(),
        targetCardId: cycleB.id,
        linkType: "blocks",
      });

      const capTargets = Array.from({ length: 50 }, (_, index) => ({
        id: `card-${randomUUID()}`,
        columnId: fixture.targetId,
        title: `Cap target ${index}`,
        position: index + 1,
      }));
      await prisma.card.createMany({ data: capTargets });
      await prisma.cardLink.createMany({
        data: capTargets.map((entry) => ({
          id: randomUUID(),
          boardId: fixture.boardId,
          fromCardId: cycleA.id,
          toCardId: entry.id,
          type: "relates_to" as const,
        })),
      });
      await reject(409, {
        type: "ADD_CARD_LINK",
        cardId: cycleA.id,
        linkId: randomUUID(),
        targetCardId: targetCard.id,
        linkType: "relates_to",
      });

      await reject(404, {
        type: "REMOVE_CARD_LINK",
        cardId: fixture.cardId,
        linkId: `missing-${randomUUID()}`,
        targetCardId: targetCard.id,
        linkType: "relates_to",
      });
      await prisma.cardLink.update({
        where: { id: existingLink.id },
        data: { deletedAt: new Date() },
      });
      await reject(404, {
        type: "REMOVE_CARD_LINK",
        cardId: fixture.cardId,
        linkId: existingLink.id,
        targetCardId: targetCard.id,
        linkType: "relates_to",
      });
      const liveLink = await prisma.cardLink.create({
        data: {
          id: randomUUID(),
          boardId: fixture.boardId,
          fromCardId: targetCard.id,
          toCardId: fixture.cardId,
          type: "relates_to",
        },
      });
      await reject(404, {
        type: "REMOVE_CARD_LINK",
        cardId: fixture.cardId,
        linkId: liveLink.id,
        targetCardId: fixture.cardId,
        linkType: "relates_to",
      });
      await reject(409, {
        type: "REMOVE_CARD_LINK",
        cardId: targetCard.id,
        linkId: liveLink.id,
        targetCardId: fixture.cardId,
        linkType: "blocks",
      });

      expect(
        await prisma.command.count({ where: { boardId: fixture.boardId } }),
      ).toBe(0);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "board.command", targetId: fixture.boardId },
        }),
      ).toBe(0);

      await prisma.cardLink.deleteMany({ where: { boardId: otherBoard.id } });
      await prisma.checklistItem.deleteMany({
        where: { checklist: { cardId: foreignCard.id } },
      });
      await prisma.checklist.deleteMany({ where: { cardId: foreignCard.id } });
      await prisma.card.deleteMany({
        where: { column: { boardId: otherBoard.id } },
      });
      await prisma.column.deleteMany({ where: { boardId: otherBoard.id } });
      await prisma.boardMember.deleteMany({
        where: { boardId: otherBoard.id },
      });
      await prisma.board.delete({ where: { id: otherBoard.id } });
      await cleanupCommandFixture(fixture);
    });

    it("rejects fresh checklist/item adds at the collection caps (TASK-176.9 B2)", async () => {
      const fixture = await commandFixture("relation-caps");
      const checklistIds = Array.from(
        { length: 20 },
        () => `checklist-${randomUUID()}`,
      );
      await prisma.checklist.createMany({
        data: checklistIds.map((id, index) => ({
          id,
          cardId: fixture.cardId,
          title: `Cap checklist ${index}`,
          position: index,
        })),
      });
      await prisma.checklistItem.createMany({
        data: Array.from({ length: 100 }, (_, index) => ({
          id: `item-${randomUUID()}`,
          checklistId: checklistIds[0]!,
          text: `Cap item ${index}`,
          position: index,
        })),
      });

      const checklistsBefore = await prisma.checklist.count({
        where: { cardId: fixture.cardId },
      });
      const itemsBefore = await prisma.checklistItem.count({
        where: { checklistId: checklistIds[0]! },
      });
      const reject = async (action: Record<string, unknown>): Promise<void> => {
        const id = randomUUID();
        const response = await server()
          .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ commandId: id, action: { ...action, at: Date.now() } })
          .expect(409);
        expect(response.body).toMatchObject({ conflict: "wip" });
        expect(await prisma.command.count({ where: { id } })).toBe(0);
        expect(
          await prisma.adminAuditLog.count({
            where: {
              action: "board.command",
              targetId: fixture.boardId,
              details: { path: ["commandId"], equals: id },
            },
          }),
        ).toBe(0);
      };

      await reject({
        type: "ADD_CHECKLIST",
        cardId: fixture.cardId,
        newChecklistId: randomUUID(),
        title: "Over the checklist cap",
      });
      await reject({
        type: "ADD_CHECKLIST_ITEM",
        cardId: fixture.cardId,
        checklistId: checklistIds[0],
        newItemId: randomUUID(),
        text: "Over the item cap",
      });

      expect(
        await prisma.command.count({ where: { boardId: fixture.boardId } }),
      ).toBe(0);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "board.command", targetId: fixture.boardId },
        }),
      ).toBe(0);
      expect(
        await prisma.checklist.count({
          where: { cardId: fixture.cardId },
        }),
      ).toBe(checklistsBefore);
      expect(
        await prisma.checklistItem.count({
          where: { checklistId: checklistIds[0]! },
        }),
      ).toBe(itemsBefore);

      await cleanupCommandFixture(fixture);
    });

    it("rejects a stale admin move and invalid target columns before the command log (TASK-176.8)", async () => {
      const fixture = await commandFixture("move-stale");
      const moveId = randomUUID();
      const moveAction = {
        type: "MOVE_CARD",
        cardId: fixture.cardId,
        fromColumnId: fixture.sourceId,
        fromIndex: 0,
        toColumnId: fixture.targetId,
        toIndex: 0,
        at: Date.now(),
      };
      const moved = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: moveId, action: moveAction })
        .expect(201);
      expect(
        await prisma.card.findUniqueOrThrow({
          where: { id: fixture.cardId },
          select: { columnId: true },
        }),
      ).toMatchObject({ columnId: fixture.targetId });

      // The exact replay returns the stored result after the move; the fresh
      // guard must not turn a retry into an error.
      const replay = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: moveId, action: moveAction })
        .expect(201);
      expect(replay.body.seq).toBe(moved.body.seq);
      expect(
        await prisma.command.count({ where: { boardId: fixture.boardId } }),
      ).toBe(1);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "board.command", targetId: fixture.boardId },
        }),
      ).toBe(1);

      const reject = async (
        status: number,
        action: Record<string, unknown>,
      ): Promise<string> => {
        const id = randomUUID();
        const response = await server()
          .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ commandId: id, action: { ...action, at: Date.now() } })
          .expect(status);
        if (status === 409) {
          expect(response.body).toMatchObject({ conflict: "version" });
        }
        expect(await prisma.command.count({ where: { id } })).toBe(0);
        expect(
          await prisma.adminAuditLog.count({
            where: {
              action: "board.command",
              targetId: fixture.boardId,
              details: { path: ["commandId"], equals: id },
            },
          }),
        ).toBe(0);
        return id;
      };

      // Stale from-column: the dialog was opened before someone moved the card.
      await reject(409, {
        type: "MOVE_CARD",
        cardId: fixture.cardId,
        fromColumnId: fixture.sourceId,
        fromIndex: 0,
        toColumnId: fixture.targetId,
        toIndex: 0,
      });
      // Missing target column.
      await reject(404, {
        type: "MOVE_CARD",
        cardId: fixture.cardId,
        fromColumnId: fixture.targetId,
        fromIndex: 0,
        toColumnId: `missing-${randomUUID()}`,
        toIndex: 0,
      });
      // Soft-deleted target column.
      const deletedColumn = await prisma.column.create({
        data: {
          id: `col-${randomUUID()}`,
          boardId: fixture.boardId,
          title: "Deleted target",
          position: 2,
          deletedAt: new Date(),
        },
      });
      await reject(404, {
        type: "MOVE_CARD",
        cardId: fixture.cardId,
        fromColumnId: fixture.targetId,
        fromIndex: 0,
        toColumnId: deletedColumn.id,
        toIndex: 0,
      });
      // Target column from another board.
      const otherBoard = await prisma.board.create({
        data: { title: `Other move board ${randomUUID()}` },
      });
      const foreignColumn = await prisma.column.create({
        data: {
          id: `col-${randomUUID()}`,
          boardId: otherBoard.id,
          title: "Foreign target",
          position: 0,
        },
      });
      await reject(404, {
        type: "MOVE_CARD",
        cardId: fixture.cardId,
        fromColumnId: fixture.targetId,
        fromIndex: 0,
        toColumnId: foreignColumn.id,
        toIndex: 0,
      });
      await prisma.column.deleteMany({ where: { boardId: otherBoard.id } });
      await prisma.board.delete({ where: { id: otherBoard.id } });

      // The successful move is the only command/audit row.
      expect(
        await prisma.command.count({ where: { boardId: fixture.boardId } }),
      ).toBe(1);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "board.command", targetId: fixture.boardId },
        }),
      ).toBe(1);

      await cleanupCommandFixture(fixture);
    });

    it("keeps archived orphan-column cards editable (TASK-176.9)", async () => {
      const fixture = await commandFixture("orphan-fields");
      const send = async (type: string, action: Record<string, unknown>) => {
        const id = randomUUID();
        const response = await server()
          .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            commandId: id,
            action: { type, ...action, at: Date.now() },
          });
        return { id, response };
      };

      const archived = await send("ARCHIVE_CARD", {
        cardId: fixture.cardId,
      });
      expect(archived.response.status).toBe(201);
      const deletedColumn = await send("DELETE_COLUMN", {
        columnId: fixture.sourceId,
      });
      expect(deletedColumn.response.status).toBe(201);

      const orphaned = await prisma.card.findUniqueOrThrow({
        where: { id: fixture.cardId },
        select: { columnId: true, archivedAt: true },
      });
      expect(orphaned.columnId).toBe(`orphan:${fixture.boardId}`);
      expect(orphaned.archivedAt).not.toBeNull();

      const updateId = randomUUID();
      const updateAction = {
        type: "UPDATE_CARD",
        cardId: fixture.cardId,
        title: "Orphan still editable",
        at: Date.now(),
      };
      const updated = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: updateId, action: updateAction })
        .expect(201);
      expect(
        await prisma.card.findUniqueOrThrow({
          where: { id: fixture.cardId },
          select: { title: true },
        }),
      ).toMatchObject({ title: "Orphan still editable" });

      const priority = await send("SET_CARD_PRIORITY", {
        cardId: fixture.cardId,
        priority: "high",
      });
      expect(priority.response.status).toBe(201);
      expect(
        await prisma.card.findUniqueOrThrow({
          where: { id: fixture.cardId },
          select: { priority: true },
        }),
      ).toMatchObject({ priority: "high" });

      // The exact replay still returns the stored result after the orphan
      // repoint; the fresh guard is skipped.
      const replay = await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ commandId: updateId, action: updateAction })
        .expect(201);
      expect(replay.body.seq).toBe(updated.body.seq);

      // A move is still an archived-card conflict, not a missing-card 404.
      const moveId = randomUUID();
      await server()
        .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          commandId: moveId,
          action: {
            type: "MOVE_CARD",
            cardId: fixture.cardId,
            fromColumnId: `orphan:${fixture.boardId}`,
            fromIndex: 0,
            toColumnId: fixture.targetId,
            toIndex: 0,
            at: Date.now(),
          },
        })
        .expect(409);
      expect(await prisma.command.count({ where: { id: moveId } })).toBe(0);
      expect(
        await prisma.adminAuditLog.count({
          where: {
            action: "board.command",
            targetId: fixture.boardId,
            details: { path: ["commandId"], equals: moveId },
          },
        }),
      ).toBe(0);

      // archive + delete-column + update + priority; the replay and the
      // rejected move add nothing.
      expect(
        await prisma.command.count({ where: { boardId: fixture.boardId } }),
      ).toBe(4);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "board.command", targetId: fixture.boardId },
        }),
      ).toBe(4);

      await cleanupCommandFixture(fixture);
    });

    it("validates the admin commandId on writes and reads", async () => {
      const fixture = await commandFixture("validation");
      for (const commandId of ["", "   ", "bad id", "a".repeat(65)]) {
        await server()
          .post(`/api/v1/admin/boards/${fixture.boardId}/commands`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            commandId,
            action: {
              type: "UPDATE_CARD",
              cardId: fixture.cardId,
              description: "Invalid id",
              at: Date.now(),
            },
          })
          .expect(400);
      }

      // The read filter must reject empty/whitespace/malformed ids instead of
      // silently dropping the predicate and returning the whole log.
      for (const commandId of ["", "   ", "bad%24id", "a".repeat(65)]) {
        await server()
          .get(`/api/v1/admin/commands?commandId=${commandId}`)
          .set("Authorization", `Bearer ${adminToken}`)
          .expect(400);
        await server()
          .get(`/api/v1/admin/audit?commandId=${commandId}`)
          .set("Authorization", `Bearer ${adminToken}`)
          .expect(400);
      }

      // Defensive pin: a `commandId` on a non-board.command row is not a link.
      await prisma.adminAuditLog.create({
        data: {
          adminId,
          adminEmail: ADMIN_EMAIL,
          action: "user.update",
          targetType: "board",
          targetId: fixture.boardId,
          details: { commandId: "decoy-command", seq: 1 },
        },
      });
      const decoy = await server()
        .get("/api/v1/admin/audit?commandId=decoy-command")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(decoy.body.total).toBe(0);

      await cleanupCommandFixture(fixture);
    });

    it("streams an attachment to a master for analysis", async () => {
      const storage = app.get(StorageService);
      await storage.ensureDirs();
      const storedName = "admin-download-probe.bin";
      await writeFile(storage.attachmentPath(storedName), "attachment-bytes");
      const attachment = await prisma.attachment.create({
        data: {
          cardId,
          boardId,
          uploadedById: userId,
          fileName: "proof.txt",
          mimeType: "text/plain",
          sizeBytes: 16,
          storedName,
        },
      });

      const res = await server()
        .get(`/api/v1/admin/attachments/${attachment.id}/download`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.headers["content-disposition"]).toContain("proof.txt");
      expect(res.text).toBe("attachment-bytes");

      // A regular user token has no business on the admin download route.
      await server()
        .get(`/api/v1/admin/attachments/${attachment.id}/download`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(401);
    });

    it("restores a soft-deleted attachment and keeps its blob (TASK-88)", async () => {
      const storage = app.get(StorageService);
      await storage.ensureDirs();
      const storedName = "admin-restore-probe.bin";
      await writeFile(storage.attachmentPath(storedName), "restore-bytes");
      const attachment = await prisma.attachment.create({
        data: {
          cardId,
          boardId,
          uploadedById: userId,
          fileName: "restore.txt",
          mimeType: "text/plain",
          sizeBytes: 13,
          storedName,
        },
      });

      await server()
        .delete(`/api/v1/admin/attachments/${attachment.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      // Soft-deleted: the download route 404s on the missing row…
      await server()
        .get(`/api/v1/admin/attachments/${attachment.id}/download`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);

      await server()
        .post(`/api/v1/admin/entities/attachments/${attachment.id}/restore`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      // …and the blob is still there, so restore brings it back.
      const res = await server()
        .get(`/api/v1/admin/attachments/${attachment.id}/download`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.text).toBe("restore-bytes");
    });

    it("finds rows by their foreign keys, not by titles", async () => {
      // Board titles are not unique; every listing must be reachable by
      // the ids that actually link the rows.
      const boards = await server()
        .get(`/api/v1/admin/boards?search=${userId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const board = boards.body.items.find(
        (item: { id: string }) => item.id === boardId,
      );
      expect(board).toBeDefined();
      expect(board.userId).toBe(userId);

      for (const key of [boardId, "mod-column"]) {
        const cards = await server()
          .get(`/api/v1/admin/cards?search=${key}`)
          .set("Authorization", `Bearer ${adminToken}`)
          .expect(200);
        const card = cards.body.items.find(
          (item: { id: string }) => item.id === cardId,
        );
        expect(card).toBeDefined();
        expect(card.boardId).toBe(boardId);
        expect(card.columnId).toBe("mod-column");
      }

      const comments = await server()
        .get(`/api/v1/admin/comments?search=${userId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(
        comments.body.items.some(
          (item: { id: string }) => item.id === commentId,
        ),
      ).toBe(true);

      const sessions = await server()
        .get(`/api/v1/admin/sessions?search=${userId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(
        sessions.body.items.some(
          (item: { id: string; userId: string }) =>
            item.id === sessionId && item.userId === userId,
        ),
      ).toBe(true);

      const tokens = await server()
        .get(`/api/v1/admin/tokens?search=${userId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(
        tokens.body.items.some(
          (item: { id: string; userId: string }) =>
            item.id === tokenId && item.userId === userId,
        ),
      ).toBe(true);

      const audit = await server()
        .get(`/api/v1/admin/audit?search=${adminId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(audit.body.total).toBeGreaterThan(0);
      expect(audit.body.items[0].adminId).toBe(adminId);
    });

    it("lists cards with board context and moderates them", async () => {
      const found = await server()
        .get("/api/v1/admin/cards?search=Moderate")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(found.body.total).toBe(1);
      expect(found.body.items[0]).toMatchObject({
        title: "Moderate me",
        boardId,
        boardTitle: "Moderation board",
        columnId: "mod-column",
        columnTitle: "Backlog",
        commentIds: [commentId],
        archivedAt: null,
        deletedAt: null,
      });

      await server()
        .post(`/api/v1/admin/cards/${cardId}/archive`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      const archived = await server()
        .get("/api/v1/admin/cards?status=archived")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(archived.body.total).toBe(1);

      await server()
        .post(`/api/v1/admin/cards/${cardId}/unarchive`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      await server()
        .delete(`/api/v1/admin/cards/${cardId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const deleted = await server()
        .get("/api/v1/admin/cards?status=deleted")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(deleted.body.total).toBe(1);

      const audit = await server()
        .get("/api/v1/admin/audit?search=card.delete")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(audit.body.total).toBe(1);
      expect(audit.body.items[0]).toMatchObject({
        targetType: "card",
        targetExists: true,
      });
    });

    it("lists and revokes individual sessions", async () => {
      const found = await server()
        .get(`/api/v1/admin/sessions?search=${USER_EMAIL}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const row = found.body.items.find(
        (item: { id: string }) => item.id === sessionId,
      );
      expect(row).toBeDefined();
      expect(row.userId).toBe(userId);
      expect(row.userEmail).toBe(USER_EMAIL);

      const revoked = await server()
        .post(`/api/v1/admin/sessions/${sessionId}/revoke`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      expect(revoked.body.revoked).toBe(1);

      const again = await server()
        .post(`/api/v1/admin/sessions/${sessionId}/revoke`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      expect(again.body.revoked).toBe(0);
    });

    it("lists and revokes API tokens", async () => {
      const found = await server()
        .get(`/api/v1/admin/tokens?search=moderation`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(found.body.total).toBe(1);
      expect(found.body.items[0].userId).toBe(userId);
      expect(found.body.items[0].userEmail).toBe(USER_EMAIL);
      expect(JSON.stringify(found.body)).not.toContain("mod-token-hash");

      const revoked = await server()
        .post(`/api/v1/admin/tokens/${tokenId}/revoke`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      expect(revoked.body.revoked).toBe(1);
    });

    it("moderates comments across boards", async () => {
      const found = await server()
        .get("/api/v1/admin/comments?search=spam")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(found.body.total).toBe(1);
      expect(found.body.items[0]).toMatchObject({
        cardId,
        cardTitle: "Moderate me",
        authorId: userId,
        authorEmail: USER_EMAIL,
        deletedAt: null,
      });

      await server()
        .delete(`/api/v1/admin/comments/${commentId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const after = await server()
        .get("/api/v1/admin/comments?search=spam")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(after.body.items[0].deletedAt).toBeGreaterThan(0);
    });

    it("deletes a column's cards with it and restores the subtree (TASK-149)", async () => {
      const board = await prisma.board.create({
        data: { title: "Cascade board" },
      });
      await prisma.boardMember.create({
        data: {
          boardId: board.id,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      await prisma.column.create({
        data: {
          id: "cascade-column",
          boardId: board.id,
          title: "Cascade",
          position: 0,
        },
      });
      await prisma.card.create({
        data: {
          id: "cascade-card",
          columnId: "cascade-column",
          title: "Carried down",
          position: 0,
        },
      });

      await server()
        .post("/api/v1/admin/entities/columns/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: ["cascade-column"], action: "delete" })
        .expect(201);

      // B10: the old direct write left the card alive pointing at a deleted
      // column — in `cards` but in no column. The command cascades.
      const column = await prisma.column.findUniqueOrThrow({
        where: { id: "cascade-column" },
      });
      expect(column.deletedAt).not.toBeNull();
      const card = await prisma.card.findUniqueOrThrow({
        where: { id: "cascade-card" },
      });
      expect(card.deletedAt).not.toBeNull();
      expect(
        await prisma.card.count({
          where: { column: { boardId: board.id }, deletedAt: null },
        }),
      ).toBe(0);

      await server()
        .post("/api/v1/admin/entities/columns/cascade-column/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      const restored = await prisma.card.findUniqueOrThrow({
        where: { id: "cascade-card" },
      });
      expect(restored.deletedAt).toBeNull();
      expect(restored.columnId).toBe("cascade-column");
      expect(
        (
          await prisma.column.findUniqueOrThrow({
            where: { id: "cascade-column" },
          })
        ).deletedAt,
      ).toBeNull();

      // And the live aggregate lists the card in that column again.
      const content = await server()
        .get(`/api/v1/admin/boards/${board.id}/content`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(
        content.body.columns.find(
          (entry: { id: string }) => entry.id === "cascade-column",
        ).cardIds,
      ).toEqual(["cascade-card"]);
    });

    it("replays bulk restores in position order (TASK-156)", async () => {
      const board = await prisma.board.create({
        data: { title: "Bulk order board" },
      });
      await prisma.boardMember.create({
        data: {
          boardId: board.id,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      await prisma.column.create({
        data: {
          id: "bulk-column",
          boardId: board.id,
          title: "Ordered",
          position: 0,
        },
      });
      for (const [position, id] of ["bulk-a", "bulk-b", "bulk-c"].entries()) {
        await prisma.card.create({
          data: { id, columnId: "bulk-column", title: id, position },
        });
      }

      await server()
        .post("/api/v1/admin/entities/cards/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ids: ["bulk-c", "bulk-b", "bulk-a"],
          action: "delete",
        })
        .expect(201);

      await server()
        .post("/api/v1/admin/entities/cards/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ids: ["bulk-c", "bulk-b", "bulk-a"],
          action: "restore",
        })
        .expect(201);

      const content = await server()
        .get(`/api/v1/admin/boards/${board.id}/content`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(
        content.body.columns.find(
          (entry: { id: string }) => entry.id === "bulk-column",
        ).cardIds,
      ).toEqual(["bulk-a", "bulk-b", "bulk-c"]);
    });

    it("restores a whole board subtree and its members (TASK-156)", async () => {
      const board = await prisma.board.create({
        data: { title: "Full restore board" },
      });
      await prisma.boardMember.create({
        data: {
          boardId: board.id,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      await prisma.label.create({
        data: {
          id: "full-label",
          boardId: board.id,
          name: "Priority",
          color: "red",
        },
      });
      await prisma.column.create({
        data: {
          id: "full-column",
          boardId: board.id,
          title: "Column",
          position: 0,
        },
      });
      await prisma.card.create({
        data: {
          id: "full-card",
          columnId: "full-column",
          title: "Card",
          position: 0,
        },
      });
      await prisma.card.create({
        data: {
          id: "full-target",
          columnId: "full-column",
          title: "Target",
          position: 1,
        },
      });
      await prisma.checklist.create({
        data: {
          id: "full-checklist",
          cardId: "full-card",
          title: "List",
          position: 0,
        },
      });
      await prisma.checklistItem.create({
        data: {
          id: "full-kept",
          checklistId: "full-checklist",
          text: "kept",
          position: 0,
        },
      });
      // Deleted by the user before the board delete: the board restore must
      // not resurrect it (TASK-156).
      await prisma.checklistItem.create({
        data: {
          id: "full-gone",
          checklistId: "full-checklist",
          text: "gone",
          position: 1,
          deletedAt: new Date(1),
        },
      });
      await prisma.cardLink.create({
        data: {
          id: "full-link",
          boardId: board.id,
          fromCardId: "full-card",
          toCardId: "full-target",
          type: "blocks",
          position: 0,
        },
      });
      const live = await prisma.boardShare.create({
        data: {
          token: "full-live",
          boardId: board.id,
          mode: "live",
          createdBy: userId,
        },
      });
      const snapshot = await prisma.boardShare.create({
        data: {
          token: "full-snapshot",
          boardId: board.id,
          mode: "snapshot",
          createdBy: userId,
          snapshot: { envelope: { boards: [] }, members: [] },
        },
      });

      await server()
        .post("/api/v1/admin/entities/boards/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: [board.id], action: "delete" })
        .expect(201);

      expect(
        await prisma.boardMember.count({ where: { boardId: board.id } }),
      ).toBe(1);
      expect(
        (await prisma.board.findUniqueOrThrow({ where: { id: board.id } }))
          .deletedAt,
      ).not.toBeNull();

      await server()
        .post(`/api/v1/admin/entities/boards/${board.id}/restore`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      const restoredBoard = await prisma.board.findUniqueOrThrow({
        where: { id: board.id },
      });
      expect(restoredBoard.deletedAt).toBeNull();
      const restoredCard = await prisma.card.findUniqueOrThrow({
        where: { id: "full-card" },
      });
      expect(restoredCard.deletedAt).toBeNull();
      expect(
        await prisma.checklistItem.findUniqueOrThrow({
          where: { id: "full-kept" },
        }),
      ).toMatchObject({ deletedAt: null });
      expect(
        (
          await prisma.checklistItem.findUniqueOrThrow({
            where: { id: "full-gone" },
          })
        ).deletedAt,
      ).not.toBeNull();
      expect(
        (await prisma.label.findUniqueOrThrow({ where: { id: "full-label" } }))
          .deletedAt,
      ).toBeNull();
      expect(
        (
          await prisma.boardShare.findUniqueOrThrow({
            where: { id: live.id },
          })
        ).revokedAt,
      ).toBeNull();
      expect(
        (
          await prisma.boardShare.findUniqueOrThrow({
            where: { id: snapshot.id },
          })
        ).revokedAt,
      ).toBeNull();

      const content = await server()
        .get(`/api/v1/admin/boards/${board.id}/content`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const card = content.body.cards["full-card"];
      expect(card).toBeDefined();
      expect(card.links).toEqual([
        { id: "full-link", type: "blocks", targetCardId: "full-target" },
      ]);
      expect(
        content.body.columns.find(
          (entry: { id: string }) => entry.id === "full-column",
        ).cardIds,
      ).toEqual(["full-card", "full-target"]);
    });

    it("refuses to restore a live board instead of no-op bumping it (TASK-156)", async () => {
      const board = await prisma.board.create({
        data: { title: "Still live board" },
      });
      await prisma.boardMember.create({
        data: {
          boardId: board.id,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      const before = await prisma.board.findUniqueOrThrow({
        where: { id: board.id },
      });

      const refusal = await server()
        .post(`/api/v1/admin/entities/boards/${board.id}/restore`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(409);
      expect(refusal.body.message).toMatch(/not deleted/i);

      // No version bump, no success audit — nothing was restored.
      const after = await prisma.board.findUniqueOrThrow({
        where: { id: board.id },
      });
      expect(after.version).toBe(before.version);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "entity.restored", targetId: board.id },
        }),
      ).toBe(0);

      // Inside a bulk the refusal is a `failed` entry, not a thrown error,
      // and a genuinely deleted sibling still restores.
      const doomed = await prisma.board.create({
        data: { title: "Doomed board" },
      });
      await prisma.boardMember.create({
        data: {
          boardId: doomed.id,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      await server()
        .post("/api/v1/admin/entities/boards/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: [doomed.id], action: "delete" })
        .expect(201);

      const bulk = await server()
        .post("/api/v1/admin/entities/boards/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: [board.id, doomed.id], action: "restore" })
        .expect(201);
      expect(bulk.body).toEqual({ affected: 1, failed: [board.id] });
      expect(
        (await prisma.board.findUniqueOrThrow({ where: { id: doomed.id } }))
          .deletedAt,
      ).toBeNull();
      expect(
        (await prisma.board.findUniqueOrThrow({ where: { id: board.id } }))
          .version,
      ).toBe(before.version);

      // The refusal is audited per item, not only as a count in the summary.
      const perItem = await prisma.adminAuditLog.findFirst({
        where: { action: "entity.bulk_restored", targetId: board.id },
      });
      expect(perItem).not.toBeNull();
      expect(perItem?.details).toMatchObject({
        action: "restore",
        failed: true,
      });
      const summary = await prisma.adminAuditLog.findFirst({
        where: {
          action: "entity.bulk_restored",
          targetId: null,
          details: { path: ["failed"], array_contains: board.id },
        },
      });
      expect(summary).not.toBeNull();
      expect(summary?.details).toMatchObject({ action: "restore", count: 1 });
    });

    it("drops assignees who lost membership while their card was deleted (TASK-156)", async () => {
      const stranger = await prisma.user.create({
        data: { email: "removed-assignee@example.com" },
      });
      const subtree = await prisma.board.create({
        data: { title: "Assignee subtree board" },
      });
      const columnar = await prisma.board.create({
        data: { title: "Assignee column board" },
      });
      for (const boardId of [subtree.id, columnar.id]) {
        await prisma.boardMember.create({
          data: { boardId, userId, role: "ADMIN", acceptedAt: new Date() },
        });
        await prisma.boardMember.create({
          data: {
            boardId,
            userId: stranger.id,
            role: "MEMBER",
            acceptedAt: new Date(),
          },
        });
      }
      await prisma.column.create({
        data: {
          id: "assign-sub-column",
          boardId: subtree.id,
          title: "Sub",
          position: 0,
        },
      });
      await prisma.card.create({
        data: {
          id: "assign-sub-card",
          columnId: "assign-sub-column",
          title: "Gone member",
          position: 0,
          assigneeId: stranger.id,
        },
      });
      await prisma.card.create({
        data: {
          id: "assign-sub-keep",
          columnId: "assign-sub-column",
          title: "Kept member",
          position: 1,
          assigneeId: userId,
        },
      });
      await prisma.column.create({
        data: {
          id: "assign-col-column",
          boardId: columnar.id,
          title: "Col",
          position: 0,
        },
      });
      await prisma.card.create({
        data: {
          id: "assign-col-card",
          columnId: "assign-col-column",
          title: "Column restore",
          position: 0,
          assigneeId: stranger.id,
        },
      });
      await prisma.card.create({
        data: {
          id: "assign-card",
          columnId: "assign-col-column",
          title: "Card restore",
          position: 1,
          assigneeId: stranger.id,
        },
      });

      // Take everything down: one card on its own, one column with its
      // card, and the first board as a whole subtree.
      await server()
        .post("/api/v1/admin/entities/cards/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: ["assign-card"], action: "delete" })
        .expect(201);
      await server()
        .post("/api/v1/admin/entities/columns/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: ["assign-col-column"], action: "delete" })
        .expect(201);
      await server()
        .post("/api/v1/admin/entities/boards/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: [subtree.id], action: "delete" })
        .expect(201);

      // The stranger leaves both boards while everything is down.
      await prisma.boardMember.delete({
        where: {
          boardId_userId: { boardId: subtree.id, userId: stranger.id },
        },
      });
      await prisma.boardMember.delete({
        where: {
          boardId_userId: { boardId: columnar.id, userId: stranger.id },
        },
      });

      // Subtree restore (TASK-147/B5): the removed member is not
      // resurrected; the member who stayed keeps the assignment.
      await server()
        .post(`/api/v1/admin/entities/boards/${subtree.id}/restore`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      expect(
        (
          await prisma.card.findUniqueOrThrow({
            where: { id: "assign-sub-card" },
          })
        ).assigneeId,
      ).toBeNull();
      expect(
        (
          await prisma.card.findUniqueOrThrow({
            where: { id: "assign-sub-keep" },
          })
        ).assigneeId,
      ).toBe(userId);

      // Column and card restores: the snapshot drops the stale assignee.
      await server()
        .post("/api/v1/admin/entities/columns/assign-col-column/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      const columnCard = await prisma.card.findUniqueOrThrow({
        where: { id: "assign-col-card" },
      });
      expect(columnCard.deletedAt).toBeNull();
      expect(columnCard.assigneeId).toBeNull();

      await server()
        .post("/api/v1/admin/entities/cards/assign-card/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      const restored = await prisma.card.findUniqueOrThrow({
        where: { id: "assign-card" },
      });
      expect(restored.deletedAt).toBeNull();
      expect(restored.assigneeId).toBeNull();
    });

    it("replays an admin snapshot restore through the reducer byte-for-byte (TASK-156)", async () => {
      const board = await prisma.board.create({
        data: { title: "Snapshot contract board" },
      });
      await prisma.boardMember.create({
        data: {
          boardId: board.id,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      await prisma.label.create({
        data: {
          id: "snap-label",
          boardId: board.id,
          name: "Ready",
          color: "green",
          position: 0,
        },
      });
      await prisma.column.create({
        data: {
          id: "snap-column",
          boardId: board.id,
          title: "Snap",
          position: 0,
        },
      });
      // One card carrying every badge the snapshot must preserve. The
      // delete/restore actor is the board's only admin (`userId`), so the
      // reducer's payload card and the written `lastActorId` agree.
      await prisma.card.create({
        data: {
          id: "snap-card",
          columnId: "snap-column",
          title: "Snapshot card",
          position: 0,
          description: "with everything on it",
          priority: "high",
          dueDate: new Date("2026-11-01T09:00:00Z"),
          lastActorId: userId,
          attachmentCount: 2,
        },
      });
      await prisma.card.create({
        data: {
          id: "snap-target",
          columnId: "snap-column",
          title: "Target",
          position: 1,
        },
      });
      await prisma.cardLabel.create({
        data: { cardId: "snap-card", labelId: "snap-label", position: 0 },
      });
      await prisma.checklist.create({
        data: {
          id: "snap-checklist",
          cardId: "snap-card",
          title: "Steps",
          position: 0,
        },
      });
      await prisma.checklistItem.create({
        data: {
          id: "snap-item",
          checklistId: "snap-checklist",
          text: "first",
          position: 0,
          done: true,
        },
      });
      await prisma.cardLink.create({
        data: {
          id: "snap-link",
          boardId: board.id,
          fromCardId: "snap-card",
          toCardId: "snap-target",
          type: "blocks",
          position: 0,
        },
      });
      for (const storedName of ["snap-a.bin", "snap-b.bin"]) {
        await prisma.attachment.create({
          data: {
            cardId: "snap-card",
            boardId: board.id,
            fileName: storedName,
            storedName,
            mimeType: "application/octet-stream",
            sizeBytes: 8,
            uploadedById: userId,
          },
        });
      }

      const content = async () =>
        (
          await server()
            .get(`/api/v1/admin/boards/${board.id}/content`)
            .set("Authorization", `Bearer ${adminToken}`)
            .expect(200)
        ).body;

      const before = await content();
      expect(before.cards["snap-card"]).toMatchObject({
        priority: "high",
        labelIds: ["snap-label"],
        links: [
          { id: "snap-link", type: "blocks", targetCardId: "snap-target" },
        ],
        lastActorId: userId,
        attachmentCount: 2,
        checklists: [
          { id: "snap-checklist", items: [{ id: "snap-item", done: true }] },
        ],
      });

      // Admin delete → real command; admin restore → snapshot replay.
      await server()
        .post("/api/v1/admin/entities/cards/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: ["snap-card"], action: "delete" })
        .expect(201);
      const deleted = await content();
      expect(deleted.cards["snap-card"]).toBeUndefined();

      await server()
        .post("/api/v1/admin/entities/cards/snap-card/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      // The stored RESTORE_CARD action — the snapshot this admin path
      // rebuilt — must reproduce the live aggregate through the pure
      // reducer, exactly like a user-issued command does.
      const command = await prisma.command.findFirst({
        where: { boardId: board.id, type: "RESTORE_CARD" },
        orderBy: { seq: "desc" },
      });
      expect(command).not.toBeNull();
      const expected = boardReducer(
        [deleted],
        command?.payload as unknown as BoardAction,
        { withActivity: false },
      )[0];
      const after = await content();
      expect(after).toEqual(expected);
    });

    it("omits an unknown priority instead of failing the restore (TASK-156)", async () => {
      const board = await prisma.board.create({
        data: { title: "Odd priority board" },
      });
      await prisma.boardMember.create({
        data: {
          boardId: board.id,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      await prisma.column.create({
        data: {
          id: "odd-column",
          boardId: board.id,
          title: "Odd",
          position: 0,
        },
      });
      await prisma.card.create({
        data: {
          id: "odd-card",
          columnId: "odd-column",
          title: "Hand-edited",
          position: 0,
          // Not on the CARD_PRIORITIES ladder — a hand-edited row.
          priority: "ultra",
        },
      });

      await server()
        .post("/api/v1/admin/entities/cards/bulk")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: ["odd-card"], action: "delete" })
        .expect(201);

      // The snapshot drops the bogus value, so the command validates and
      // the restore succeeds instead of answering 400.
      await server()
        .post("/api/v1/admin/entities/cards/odd-card/restore")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      const restored = await prisma.card.findUniqueOrThrow({
        where: { id: "odd-card" },
      });
      expect(restored.deletedAt).toBeNull();
      expect(restored.priority).toBeNull();
      const content = await server()
        .get(`/api/v1/admin/boards/${board.id}/content`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(content.body.cards["odd-card"].priority).toBeUndefined();
    });

    it("keeps the attachment badge exact through delete and restore (TASK-149)", async () => {
      const board = await prisma.board.create({
        data: { title: "Badge board" },
      });
      await prisma.boardMember.create({
        data: {
          boardId: board.id,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(),
        },
      });
      await prisma.column.create({
        data: {
          id: "badge-column",
          boardId: board.id,
          title: "Files",
          position: 0,
        },
      });
      await prisma.card.create({
        data: {
          id: "badge-card",
          columnId: "badge-column",
          title: "Has a file",
          position: 0,
          attachmentCount: 1,
        },
      });
      const storage = app.get(StorageService);
      await storage.ensureDirs();
      const storedName = "badge-probe.bin";
      await writeFile(storage.attachmentPath(storedName), "badge-bytes");
      const attachment = await prisma.attachment.create({
        data: {
          cardId: "badge-card",
          boardId: board.id,
          uploadedById: userId,
          fileName: "badge.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
          storedName,
        },
      });

      const badge = () =>
        prisma.card
          .findUniqueOrThrow({ where: { id: "badge-card" } })
          .then((row) => row.attachmentCount);

      await server()
        .delete(`/api/v1/admin/attachments/${attachment.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(await badge()).toBe(0);

      await server()
        .post(`/api/v1/admin/entities/attachments/${attachment.id}/restore`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      expect(await badge()).toBe(1);
    });

    it("reports runtime and database latency on the dashboard", async () => {
      const res = await server()
        .get("/api/v1/admin/metrics")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.runtime).toMatchObject({
        version: expect.any(String),
        nodeEnv: "test",
      });
      expect(res.body.runtime.uptimeSec).toBeGreaterThanOrEqual(0);
      expect(res.body.runtime.databaseLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("master management (owners only)", () => {
    let operatorToken: string;
    let operatorId: string;
    let operatorPassword: string;

    it("lets an owner mint another master and shows the password once", async () => {
      const res = await server()
        .post("/api/v1/admin/admins")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: "operator@example.com", displayName: "Operator" })
        .expect(201);

      expect(res.body.admin).toMatchObject({
        email: "operator@example.com",
        role: "OPERATOR",
        disabledAt: null,
      });
      expect(typeof res.body.temporaryPassword).toBe("string");
      expect(res.body.admin.passwordHash).toBeUndefined();
      operatorId = res.body.admin.id;
      operatorPassword = res.body.temporaryPassword;

      const audit = await prisma.adminAuditLog.findFirst({
        where: { action: "admin.create", targetId: operatorId },
      });
      expect(audit?.adminEmail).toBe(ADMIN_EMAIL);

      const login = await server()
        .post("/api/v1/admin/auth/login")
        .send({
          email: "operator@example.com",
          password: res.body.temporaryPassword,
        })
        .expect(200);
      operatorToken = login.body.accessToken;
      expect(login.body.admin.role).toBe("OPERATOR");
    });

    it("mints an OWNER when asked, not always an OPERATOR (TASK-89)", async () => {
      const res = await server()
        .post("/api/v1/admin/admins")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: "second-owner@example.com", role: "OWNER" })
        .expect(201);
      expect(res.body.admin.role).toBe("OWNER");

      // Clean up so the master count asserted later stays stable.
      await server()
        .delete(`/api/v1/admin/admins/${res.body.admin.id as string}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
    });

    it("gives operators full data access but no master management", async () => {
      await server()
        .get("/api/v1/admin/metrics")
        .set("Authorization", `Bearer ${operatorToken}`)
        .expect(200);

      await server()
        .get("/api/v1/admin/admins")
        .set("Authorization", `Bearer ${operatorToken}`)
        .expect(403);
      await server()
        .post("/api/v1/admin/admins")
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({ email: "escalation@example.com" })
        .expect(403);

      const audit = await prisma.adminAuditLog.findFirst({
        where: { action: "admin.create", adminEmail: "operator@example.com" },
      });
      expect(audit).toBeNull();
    });

    it("keeps global ops, flags, comms and maintenance owner-only (TASK-79)", async () => {
      const operator = () => ({ Authorization: `Bearer ${operatorToken}` });

      // An operator must not be able to flip global state…
      await server()
        .put("/api/v1/admin/ops")
        .set(operator())
        .send({ maintenanceMode: true })
        .expect(403);
      await server()
        .patch("/api/v1/admin/flags/registration_open")
        .set(operator())
        .send({ enabled: false })
        .expect(403);

      // …rewrite or blast comms…
      await server()
        .post("/api/v1/admin/announcements")
        .set(operator())
        .send({ title: "Maintenance", body: "We are down" })
        .expect(403);
      await server()
        .post("/api/v1/admin/email/send")
        .set(operator())
        .send({ to: "all@example.com", subject: "Hi", body: "Hello" })
        .expect(403);
      await server()
        .put("/api/v1/admin/email-templates/verification_code")
        .set(operator())
        .send({ subject: "Hi {{code}}", bodyHtml: "<p>{{code}}</p>" })
        .expect(403);
      await server()
        .delete("/api/v1/admin/email-templates/verification_code")
        .set(operator())
        .expect(403);

      // …run a destructive sweep or reach the user-action escape hatches.
      await server()
        .post("/api/v1/admin/maintenance/run")
        .set(operator())
        .send({ job: "purge-soft-deleted" })
        .expect(403);
      await server()
        .post(`/api/v1/admin/users/${userId}/password/reset`)
        .set(operator())
        .expect(403);
      await server()
        .post(`/api/v1/admin/users/${userId}/promote`)
        .set(operator())
        .expect(403);
      await server()
        .post(`/api/v1/admin/users/${userId}/impersonate`)
        .set(operator())
        .expect(403);
      await server()
        .get(`/api/v1/admin/users/${userId}/export`)
        .set(operator())
        .expect(403);
      await server()
        .delete(`/api/v1/admin/users/${userId}`)
        .set(operator())
        .expect(403);
    });

    it("lets only owners edit the IP allowlist (TASK-65)", async () => {
      await server()
        .put("/api/v1/admin/security")
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({ ipAllowlist: "10.0.0.0/8" })
        .expect(403);

      // A list that excludes the caller's own address is refused: it is
      // enforced on every admin request, so it would lock the owner out.
      await server()
        .put("/api/v1/admin/security")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ipAllowlist: "10.0.0.0/8" })
        .expect(400);

      const local = "10.0.0.0/8,127.0.0.1,::ffff:127.0.0.1,::1";
      const saved = await server()
        .put("/api/v1/admin/security")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ipAllowlist: local })
        .expect(200);
      expect(saved.body.ipAllowlist).toBe(local);

      // Enforced per request, not only at sign-in: with the list narrowed
      // behind the session's back, the very same token stops working.
      const owner = await prisma.adminUser.findUniqueOrThrow({
        where: { email: ADMIN_EMAIL },
      });
      await prisma.adminUser.update({
        where: { id: owner.id },
        data: { ipAllowlist: "10.0.0.0/8" },
      });
      await server()
        .get("/api/v1/admin/security")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(403);
      await prisma.adminUser.update({
        where: { id: owner.id },
        data: { ipAllowlist: local },
      });

      // Clear it again so the owner's own sign-in is not gated for later tests.
      const cleared = await server()
        .put("/api/v1/admin/security")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ipAllowlist: null })
        .expect(200);
      expect(cleared.body.ipAllowlist).toBeNull();
    });

    it("manages another master's allowlist and enforces it immediately (TASK-158)", async () => {
      const endpoint = `/api/v1/admin/masters/${operatorId}/allowlist`;
      const owner = { Authorization: `Bearer ${adminToken}` };
      const operator = { Authorization: `Bearer ${operatorToken}` };
      const login = await server()
        .post("/api/v1/admin/auth/login")
        .send({ email: "operator@example.com", password: operatorPassword })
        .expect(200);
      const refreshCookie = findCookie(login, ADMIN_REFRESH_COOKIE)!;
      await server().get(endpoint).set(operator).expect(403);
      await server()
        .put(endpoint)
        .set(operator)
        .send({ ipAllowlist: null })
        .expect(403);
      await server()
        .get(`/api/v1/admin/masters/missing/allowlist`)
        .set(owner)
        .expect(404);
      await server().put(endpoint).set(owner).send({}).expect(400);
      await server()
        .put(endpoint)
        .set(owner)
        .send({ ipAllowlist: "10.0.0.0/33" })
        .expect(400);
      await server()
        .put(`/api/v1/admin/masters/${adminId}/allowlist`)
        .set(owner)
        .send({ ipAllowlist: "10.0.0.0/8" })
        .expect(400);

      try {
        const saved = await server()
          .put(endpoint)
          .set(owner)
          .send({ ipAllowlist: " 10.0.0.0/8 , 192.0.2.1 " })
          .expect(200);
        expect(saved.body.ipAllowlist).toBe("10.0.0.0/8,192.0.2.1");
        const fetched = await server().get(endpoint).set(owner).expect(200);
        expect(fetched.body).toEqual(saved.body);
        await server().get("/api/v1/admin/security").set(operator).expect(403);
        await server().get("/api/v1/admin/security").set(operator).expect(403);
        const auditFailure = jest
          .spyOn(prisma.adminAuditLog, "upsert")
          .mockRejectedValueOnce(new Error("audit unavailable"));
        try {
          await server()
            .get("/api/v1/admin/security")
            .set(operator)
            .expect(403);
        } finally {
          auditFailure.mockRestore();
        }
        await server()
          .post("/api/v1/admin/auth/refresh")
          .set("Cookie", refreshCookie)
          .expect(403);
        const deniedLogin = await server()
          .post("/api/v1/admin/auth/login")
          .send({ email: "operator@example.com", password: operatorPassword })
          .expect(403);
        expect(deniedLogin.body.code).toBe("ip_not_allowed");
        const events = await prisma.adminAuditLog.findMany({
          where: { adminId: operatorId, action: "admin.login_failed" },
        });
        for (const stage of ["login", "refresh", "request"]) {
          expect(
            events.some((event) => {
              const details = event.details as Record<string, unknown>;
              return (
                details.reason === "ip_not_allowed" &&
                details.stage === stage &&
                typeof details.ip === "string" &&
                (stage !== "request" || event.eventCount >= 2)
              );
            }),
          ).toBe(true);
        }
        const security = await server()
          .get("/api/v1/admin/security")
          .set(owner)
          .expect(200);
        expect(security.body.alerts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              adminEmail: "operator@example.com",
              reason: "ip_not_allowed",
              stage: "request",
              count: expect.any(Number),
              ip: expect.any(String),
            }),
            expect.objectContaining({
              adminEmail: "operator@example.com",
              reason: "ip_not_allowed",
              stage: "refresh",
            }),
            expect.objectContaining({
              adminEmail: "operator@example.com",
              reason: "ip_not_allowed",
              stage: "login",
            }),
          ]),
        );
        const audit = await prisma.adminAuditLog.findFirst({
          where: {
            action: "security.ip_allowlist_changed",
            adminId,
            targetType: "admin",
            targetId: operatorId,
          },
          orderBy: { createdAt: "desc" },
        });
        expect(audit?.details).toMatchObject({
          ipAllowlist: "10.0.0.0/8,192.0.2.1",
        });
      } finally {
        await server()
          .put(endpoint)
          .set(owner)
          .send({ ipAllowlist: null })
          .expect(200);
      }
      await server().get("/api/v1/admin/security").set(operator).expect(200);
    });

    it("lists masters for an owner", async () => {
      const res = await server()
        .get("/api/v1/admin/admins")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.total).toBe(2);
      const owner = res.body.items.find(
        (item: { email: string }) => item.email === ADMIN_EMAIL,
      );
      expect(owner.role).toBe("OWNER");
      // Schema-literal master rows: lockout counter instead of a count of
      // live sessions (gone — sessions have their own page).
      expect(owner.failedLogins).toBeGreaterThanOrEqual(0);
      expect(owner.sessions).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("$argon2");
    });

    it("refuses to let an owner disable themselves", async () => {
      await server()
        .patch(`/api/v1/admin/admins/${adminId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ disabled: true })
        .expect(403);
    });

    it("resets a master password and kills their sessions", async () => {
      const res = await server()
        .post(`/api/v1/admin/admins/${operatorId}/password/reset`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
      expect(typeof res.body.temporaryPassword).toBe("string");

      await prisma.adminRefreshToken
        .findMany({
          where: { adminId: operatorId },
        })
        .then((tokens) => {
          expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
        });

      const audit = await prisma.adminAuditLog.findFirst({
        where: { action: "admin.password_reset", targetId: operatorId },
      });
      expect(audit).not.toBeNull();
    });

    it("blocks a master and invalidates their access token", async () => {
      const res = await server()
        .patch(`/api/v1/admin/admins/${operatorId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ disabled: true })
        .expect(200);
      expect(res.body.disabledAt).toBeGreaterThan(0);

      // The strategy re-checks the row on every request: the token that was
      // valid a moment ago is dead now, without waiting for expiry.
      await server()
        .get("/api/v1/admin/metrics")
        .set("Authorization", `Bearer ${operatorToken}`)
        .expect(401);

      const audit = await prisma.adminAuditLog.findFirst({
        where: { action: "admin.disable", targetId: operatorId },
      });
      expect(audit).not.toBeNull();

      const enabled = await server()
        .patch(`/api/v1/admin/admins/${operatorId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ disabled: false })
        .expect(200);
      expect(enabled.body.disabledAt).toBeNull();
    });

    it("removes a master that has signed in (refresh tokens do not block it)", async () => {
      // The operator logged in earlier, so it owns refresh tokens; deleting
      // the master must clear them first or the FK-bound delete answers 500.
      await server()
        .delete(`/api/v1/admin/admins/${operatorId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(
        await prisma.adminUser.findUnique({ where: { id: operatorId } }),
      ).toBeNull();
      expect(
        await prisma.adminRefreshToken.count({
          where: { adminId: operatorId },
        }),
      ).toBe(0);
    });
  });

  describe("email templates & master unlock", () => {
    it("shows the built-in letter until an override is saved, then restores it", async () => {
      const initial = await server()
        .get("/api/v1/admin/email-templates")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const builtIn = initial.body.find(
        (row: { key: string }) => row.key === "verification_code",
      );
      // Not empty: the editor is prefilled with the built-in letter.
      expect(builtIn.custom).toBe(false);
      expect(builtIn.subject).toContain("{{code}}");
      expect(builtIn.bodyHtml).toContain("{{code}}");
      expect(builtIn.placeholders).toEqual(["code", "minutes"]);

      const saved = await server()
        .put("/api/v1/admin/email-templates/verification_code")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ subject: "Hi {{code}}", bodyHtml: "<p>{{code}}</p>" })
        .expect(200);
      expect(saved.body.custom).toBe(true);
      expect(saved.body.subject).toBe("Hi {{code}}");

      const reset = await server()
        .delete("/api/v1/admin/email-templates/verification_code")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(reset.body.custom).toBe(false);
      expect(reset.body.subject).toContain("{{code}}");
    });

    it("lets an owner clear a master's lockout", async () => {
      const created = await server()
        .post("/api/v1/admin/admins")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: "locked@example.com" })
        .expect(201);
      const lockedId: string = created.body.admin.id;
      await prisma.adminUser.update({
        where: { id: lockedId },
        data: {
          failedLogins: 5,
          lockedUntil: new Date(Date.now() + 600_000),
        },
      });

      const unlocked = await server()
        .patch(`/api/v1/admin/admins/${lockedId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ unlock: true })
        .expect(200);
      expect(unlocked.body.lockedUntil).toBeNull();
      expect(unlocked.body.failedLogins).toBe(0);
    });
  });

  it("logs out idempotently and clears the admin cookie", async () => {
    const login = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    const cookie = cookieValue(login, ADMIN_REFRESH_COOKIE);

    const res = await server()
      .post("/api/v1/admin/auth/logout")
      .set("Cookie", `${ADMIN_REFRESH_COOKIE}=${cookie}`)
      .expect(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(findCookie(res, ADMIN_REFRESH_COOKIE)).toContain(
      "Path=/api/v1/admin/auth",
    );

    await server()
      .post("/api/v1/admin/auth/refresh")
      .set("Cookie", `${ADMIN_REFRESH_COOKIE}=${cookie}`)
      .expect(401);
  });
});
