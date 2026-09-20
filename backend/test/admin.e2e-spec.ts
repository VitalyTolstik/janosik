import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ADMIN_REFRESH_COOKIE,
  cookieValue,
  findCookie,
} from "./support/cookies";

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

    // FK-safe cleanup of the tables this spec touches.
    await prisma.adminAuditLog.deleteMany();
    await prisma.adminRefreshToken.deleteMany();
    await prisma.adminUser.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.command.deleteMany();
    await prisma.checklistItem.deleteMany();
    await prisma.checklist.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.cardLink.deleteMany();
    await prisma.cardLabel.deleteMany();
    await prisma.card.deleteMany();
    await prisma.column.deleteMany();
    await prisma.label.deleteMany();
    await prisma.boardMember.deleteMany();
    await prisma.board.deleteMany();
    await prisma.apiToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

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

    const res = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(429);
    expect(res.body.message).toBe("Account is temporarily locked");

    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: "admin.login_locked", adminId },
    });
    expect(audit).not.toBeNull();

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
    expect(created.body.items[0].adminEmail).toBe(adminEmail);
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

    // The old cookie is now a theft signal: reuse kills every session.
    await server()
      .post("/api/v1/admin/auth/refresh")
      .set("Cookie", `${ADMIN_REFRESH_COOKIE}=${stolenCookie}`)
      .expect(401);
    await server()
      .post("/api/v1/admin/auth/refresh")
      .set("Cookie", `${ADMIN_REFRESH_COOKIE}=${freshCookie}`)
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
