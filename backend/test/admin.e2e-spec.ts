import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { argon2id, hash as argonHash } from "argon2";
import { writeFile } from "node:fs/promises";
import { boardReducer } from "@janosik/shared";
import type { BoardAction } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import { env } from "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { StorageService } from "@/attachments/storage.service";
import {
  ADMIN_QUEUES_JWT_AUDIENCE,
  ADMIN_QUEUES_TOKEN_TYPE,
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
