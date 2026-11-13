import { INestApplication, PayloadTooLargeException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import { createHash, randomUUID } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import type { Board, BoardEnvelope } from "@janosik/shared";
import { MAX_IMPORT_BYTES } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import { USER_JWT_AUDIENCE } from "@/auth/auth.types";
import { securityStamp } from "@/auth/security-stamp";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardsService } from "@/boards/boards.service";
import { MaintenanceService } from "@/ops/maintenance.service";
import { MailerService } from "@/mailer/mailer.service";
import { StorageService } from "@/attachments/storage.service";

const EMAIL = "limits@example.com";
const OTHER_EMAIL = "limits-other@example.com";
const PASSWORD = "correct horse battery";
const ADMIN_EMAIL = "limits-admin@example.com";
const ADMIN_PASSWORD = "master password 123";

/**
 * TASK-166.6 — limits and data safety. Every test starts from a clean slate
 * and seeds exactly what it needs, so failures point at one behaviour.
 */
describe("Limits & data safety (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let jwt: JwtService;
  let token: string;
  let userId: string;
  let passwordHash: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    mailer = app.get(MailerService);
    jwt = app.get(JwtService);
    passwordHash = await argonHash(PASSWORD, { type: argon2id });
  });

  beforeEach(async () => {
    delete process.env.MAX_BOARDS_PER_USER;
    await wipe(prisma);
    mailer.outbox.length = 0;
    ({ token, userId } = await createSessionUser(EMAIL));
  });

  afterEach(() => {
    delete process.env.MAX_BOARDS_PER_USER;
    delete process.env.BACKUP_DIR;
  });

  afterAll(async () => {
    delete process.env.MAX_BOARDS_PER_USER;
    delete process.env.BACKUP_DIR;
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (value: string) => ({ Authorization: `Bearer ${value}` });

  async function createSessionUser(
    email: string,
    options: { password?: boolean } = {},
  ): Promise<{ token: string; userId: string }> {
    // Direct provisioning keeps this limits file independent of the auth
    // registration throttle (5/min) while still exercising real JWTs.
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: options.password === false ? null : passwordHash,
        displayName: "Limits",
        emailVerifiedAt: new Date(),
      },
    });
    const accessToken = await jwt.signAsync(
      { sub: user.id, authMethod: "password", stamp: securityStamp(user) },
      { audience: USER_JWT_AUDIENCE },
    );
    return { token: accessToken, userId: user.id };
  }

  /** Re-sign after a credential change (the stamp is part of the token). */
  async function freshAccessToken(id: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    return jwt.signAsync(
      { sub: user.id, authMethod: "password", stamp: securityStamp(user) },
      { audience: USER_JWT_AUDIENCE },
    );
  }

  async function createBoardWith(
    accessToken: string,
    title: string,
  ): Promise<Board> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(accessToken))
      .send({ title })
      .expect(201);
    return res.body as Board;
  }

  async function exportEnvelope(
    boardId: string,
    accessToken = token,
  ): Promise<BoardEnvelope> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}/export`)
      .set(auth(accessToken))
      .expect(200);
    return (
      res.body?.app === "janosik" ? res.body : JSON.parse(res.text)
    ) as BoardEnvelope;
  }

  async function downloadBundle(exportId: string): Promise<{
    text: string;
    data: Record<string, unknown>;
  }> {
    const res = await server()
      .get(`/api/v1/users/me/export/${exportId}/download`)
      .set(auth(token))
      .expect(200);
    return { text: res.text, data: JSON.parse(res.text) };
  }

  async function loginAdmin(): Promise<string> {
    const passwordHash = await argonHash(ADMIN_PASSWORD, { type: argon2id });
    await prisma.adminUser.create({
      data: {
        email: ADMIN_EMAIL,
        displayName: "Master",
        role: "OWNER",
        passwordHash,
      },
    });
    const login = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    return login.body.accessToken as string;
  }

  describe("board cap (D19)", () => {
    it("creates more than 10 boards when no cap is configured", async () => {
      for (let index = 0; index < 11; index += 1) {
        await createBoardWith(token, `Unlimited ${index}`);
      }
      const list = await server()
        .get("/api/v1/boards")
        .set(auth(token))
        .expect(200);
      expect(list.body.length).toBe(11);
    });

    it("enforces a positive operator cap and reports it in /auth/config", async () => {
      process.env.MAX_BOARDS_PER_USER = "2";
      const config = await server().get("/api/v1/auth/config").expect(200);
      expect(config.body.limits).toEqual({
        boards: 2,
        importBytes: MAX_IMPORT_BYTES,
      });

      await createBoardWith(token, "First");
      await createBoardWith(token, "Second");
      const over = await server()
        .post("/api/v1/boards")
        .set(auth(token))
        .send({ title: "Over cap" })
        .expect(409);
      expect(over.body).toMatchObject({
        code: "limit_exceeded",
        limit: 2,
        current: 2,
      });
    });

    it("serializes concurrent creates under one advisory lock", async () => {
      process.env.MAX_BOARDS_PER_USER = "3";
      await createBoardWith(token, "One");
      await createBoardWith(token, "Two");
      const [a, b] = await Promise.all([
        server().post("/api/v1/boards").set(auth(token)).send({ title: "A" }),
        server().post("/api/v1/boards").set(auth(token)).send({ title: "B" }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const list = await server()
        .get("/api/v1/boards")
        .set(auth(token))
        .expect(200);
      expect(list.body).toHaveLength(3);
    });

    it("rejects an import above the cap without creating a board", async () => {
      const first = await createBoardWith(token, "One");
      const second = await createBoardWith(token, "Two");
      const [a, b] = await Promise.all([
        exportEnvelope(first.id),
        exportEnvelope(second.id),
      ]);
      const envelope = { ...a, boards: [...a.boards, ...b.boards] };
      process.env.MAX_BOARDS_PER_USER = "2";
      const before = await prisma.board.count();
      const res = await server()
        .post("/api/v1/boards/import")
        .set(auth(token))
        .send(envelope)
        .expect(409);
      expect(res.body.code).toBe("limit_exceeded");
      expect(await prisma.board.count()).toBe(before);
    });
  });

  describe("import / export (D20)", () => {
    it("exports schema 3 with the board policy and imports it back", async () => {
      const board = await createBoardWith(token, "Policy export");
      const policy = {
        schemaVersion: 1,
        destructive: "deny",
        requireApprovalFor: ["delete_card", "workflow.update"],
        approverRoles: ["ADMIN"],
        maxCommandsPerRun: 40,
        maxCardsPerRun: 20,
        approvalTtlMinutes: 30,
      };
      await prisma.board.update({
        where: { id: board.id },
        data: { agentPolicy: policy },
      });

      const envelope = await exportEnvelope(board.id);
      expect(envelope.schemaVersion).toBe(3);
      expect(envelope.boards[0].agentPolicy).toEqual(policy);

      const imported = await server()
        .post("/api/v1/boards/import")
        .set(auth(token))
        .send(envelope)
        .expect(201);
      expect(imported.body[0].agentPolicy).toEqual(policy);
    });

    it("still imports v1 and v2 files (policy = null)", async () => {
      const board = await createBoardWith(token, "Legacy import");
      const envelope = await exportEnvelope(board.id);
      for (const version of [1, 2]) {
        const legacy = {
          ...envelope,
          schemaVersion: version,
          boards: envelope.boards.map((entry) => {
            const legacyBoard = { ...entry };
            delete legacyBoard.agentPolicy;
            return legacyBoard;
          }),
        };
        const imported = await server()
          .post("/api/v1/boards/import")
          .set(auth(token))
          .send(legacy)
          .expect(201);
        expect(imported.body[0].agentPolicy).toBeUndefined();
      }
    });

    it("previews an import with dryRun=1 without writing", async () => {
      const board = await createBoardWith(token, "Dry run");
      const envelope = await exportEnvelope(board.id);
      const before = await prisma.board.count();
      const preview = await server()
        .post("/api/v1/boards/import?dryRun=1")
        .set(auth(token))
        .send(envelope)
        .expect(201);
      expect(preview.body).toMatchObject({
        boards: 1,
        cards: 0,
        columns: 0,
        labels: 0,
        withinLimit: true,
      });
      expect(await prisma.board.count()).toBe(before);
    });

    it("refuses an export above 25 MB through the real route", async () => {
      const board = await createBoardWith(token, "Huge board");
      const columnId = randomUUID();
      await prisma.column.create({
        data: {
          id: columnId,
          boardId: board.id,
          title: "Column",
          position: 0,
        },
      });
      await prisma.card.createMany({
        data: Array.from({ length: 420 }, (_, index) => ({
          id: randomUUID(),
          columnId,
          title: `Card ${index}`,
          description: "x".repeat(64_000),
          position: index,
        })),
      });

      const res = await server()
        .get(`/api/v1/boards/${board.id}/export`)
        .set(auth(token))
        .expect(413);
      expect(res.body).toMatchObject({
        code: "payload_too_large",
        limit: 25 * 1024 * 1024,
      });
    });
  });

  describe("route-specific body limits", () => {
    it("answers 413 payload_too_large for an import over 25 MB", async () => {
      const huge = {
        app: "janosik",
        schemaVersion: 3,
        exportedAt: Date.now(),
        boards: [],
        padding: "x".repeat(MAX_IMPORT_BYTES + 1024),
      };
      const res = await server()
        .post("/api/v1/boards/import")
        .set(auth(token))
        .set("Content-Type", "application/json")
        .send(JSON.stringify(huge))
        .expect(413);
      expect(res.body).toMatchObject({
        code: "payload_too_large",
        limit: MAX_IMPORT_BYTES,
      });
      expect(res.body.message).toContain("25 MB");
    });

    it("answers 413 payload_too_large for a command body over 10 MB", async () => {
      const board = await createBoardWith(token, "Command cap");
      const body = {
        action: {
          type: "RENAME_BOARD",
          title: "x".repeat(10 * 1024 * 1024 + 1024),
        },
      };
      const res = await server()
        .post(`/api/v1/boards/${board.id}/commands`)
        .set(auth(token))
        .send(body)
        .expect(413);
      expect(res.body).toMatchObject({
        code: "payload_too_large",
        limit: 10 * 1024 * 1024,
      });
      expect(res.body.message).toContain("10 MB");
    });

    it("answers 413 with a KB message for a small-route body", async () => {
      const res = await server()
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ padding: "x".repeat(300 * 1024) }))
        .expect(413);
      expect(res.body.message).toContain("256 KB");
    });

    it("answers 413 with a code for an oversized single command", async () => {
      const board = await createBoardWith(token, "Single command cap");
      const res = await server()
        .post(`/api/v1/boards/${board.id}/commands`)
        .set(auth(token))
        .send({
          commandId: "oversized-command",
          action: {
            type: "RENAME_BOARD",
            title: "x".repeat(3 * 1024 * 1024),
          },
        })
        .expect(413);
      expect(res.body).toMatchObject({
        code: "payload_too_large",
        field: "action",
        limit: 2 * 1024 * 1024,
      });
    });
  });

  describe("board and token audit", () => {
    it("records a board delete with the owner and board title", async () => {
      const board = await createBoardWith(token, "Audited board");
      await server()
        .delete(`/api/v1/boards/${board.id}`)
        .set(auth(token))
        .expect(200);
      const row = await prisma.securityAuditLog.findFirst({
        where: { action: "board.deleted", targetId: board.id },
      });
      expect(row).toMatchObject({
        userId,
        actorId: userId,
        targetType: "board",
        details: { boardTitle: "Audited board" },
      });
    });

    it("records token creation and revocation", async () => {
      const created = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(token))
        .send({ name: "audited", expiresAt: null })
        .expect(201);
      const tokenId = created.body.apiToken.id as string;
      await server()
        .delete(`/api/v1/users/me/tokens/${tokenId}`)
        .set(auth(token))
        .expect(200);
      const rows = await prisma.securityAuditLog.findMany({
        where: { targetType: "api_token", targetId: tokenId },
        orderBy: { createdAt: "asc" },
      });
      expect(rows.map((row) => row.action)).toEqual([
        "token.created",
        "token.revoked",
      ]);
    });

    it("records a bulk admin revocation as a user event with token ids", async () => {
      const created = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(token))
        .send({ name: "bulk", expiresAt: null })
        .expect(201);
      const tokenId = created.body.apiToken.id as string;
      const adminToken = await loginAdmin();
      await server()
        .post(`/api/v1/admin/users/${userId}/tokens/revoke`)
        .set(auth(adminToken))
        .expect(201);
      const row = await prisma.securityAuditLog.findFirst({
        where: {
          userId,
          action: "token.revoked",
          targetType: "user",
          targetId: userId,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(row?.details).toMatchObject({
        reason: "admin_user_tokens_revoked",
        tokenIds: [tokenId],
      });
    });
  });

  describe("self-service export (D22)", () => {
    it("builds a bounded bundle without secrets or VIEWER boards", async () => {
      const own = await createBoardWith(token, "Owned");
      const other = await createSessionUser(OTHER_EMAIL);
      const shared = await createBoardWith(other.token, "Only viewed");
      await prisma.boardMember.create({
        data: {
          boardId: shared.id,
          userId,
          role: "VIEWER",
          acceptedAt: new Date(),
        },
      });
      const pat = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(token))
        .send({ name: "bundle-check", expiresAt: null })
        .expect(201);
      const stored = await prisma.apiToken.findUniqueOrThrow({
        where: { id: pat.body.apiToken.id },
      });

      const res = await server()
        .post("/api/v1/users/me/export")
        .set(auth(token))
        .expect(202);
      expect(["ready", "pending"]).toContain(res.body.status);
      const { text, data } = await downloadBundle(res.body.id as string);
      const boards = data.boards as Array<{ boards: Array<{ id: string }> }>;
      expect(boards).toHaveLength(1);
      expect(boards[0].boards[0].id).toBe(own.id);
      expect(boards[0].boards[0].id).not.toBe(shared.id);
      expect(text).not.toContain(stored.tokenHash);
      expect(text).not.toContain("passwordHash");
      expect(text).not.toContain("tokenHash");
      expect(text).not.toContain("refreshToken");
    });

    it("reports skipped oversized boards instead of silently dropping them", async () => {
      const good = await createBoardWith(token, "Good");
      const skipped = await createBoardWith(token, "Skipped");
      const boards = app.get(BoardsService);
      const spy = jest
        .spyOn(boards, "assertExportFitsPreflight")
        .mockImplementation(async (boardId: string) => {
          if (boardId === skipped.id) {
            throw new PayloadTooLargeException({
              message: "board preflight too large",
              code: "payload_too_large",
            });
          }
        });
      try {
        const res = await server()
          .post("/api/v1/users/me/export")
          .set(auth(token))
          .expect(202);
        const { data } = await downloadBundle(res.body.id as string);
        expect(
          (data.boards as Array<{ boards: Array<{ id: string }> }>)[0].boards[0]
            .id,
        ).toBe(good.id);
        expect(data.warnings).toContainEqual({
          boardId: skipped.id,
          reason: "board preflight too large",
        });
      } finally {
        spy.mockRestore();
      }
    });

    it("hides another account's export id", async () => {
      const other = await createSessionUser(OTHER_EMAIL);
      const res = await server()
        .post("/api/v1/users/me/export")
        .set(auth(token))
        .expect(202);
      await server()
        .get(`/api/v1/users/me/export/${res.body.id}`)
        .set(auth(other.token))
        .expect(404);
    });

    it("refuses a second export while one is pending", async () => {
      await prisma.dataExport.create({
        data: {
          userId,
          userEmail: EMAIL,
          filename: "pending.json",
          createdBy: EMAIL,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const res = await server()
        .post("/api/v1/users/me/export")
        .set(auth(token))
        .expect(409);
      expect(res.body.code).toBe("export_in_progress");
    });

    it("replaces the previous ready export instead of piling up artifacts", async () => {
      const first = await server()
        .post("/api/v1/users/me/export")
        .set(auth(token))
        .expect(202);
      expect(first.body.status).toBe("ready");
      const second = await server()
        .post("/api/v1/users/me/export")
        .set(auth(token))
        .expect(202);
      expect(second.body.id).not.toBe(first.body.id);
      expect(
        await prisma.dataExport.count({
          where: { userId, status: "ready" },
        }),
      ).toBe(1);
      expect(
        await prisma.dataExport.findUnique({ where: { id: first.body.id } }),
      ).toBeNull();
    });

    it("keeps the old ready export downloadable while a new one is pending", async () => {
      const ready = await server()
        .post("/api/v1/users/me/export")
        .set(auth(token))
        .expect(202);
      await prisma.dataExport.create({
        data: {
          userId,
          userEmail: EMAIL,
          status: "pending",
          filename: "new-pending.json",
          createdBy: EMAIL,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await server()
        .post("/api/v1/users/me/export")
        .set(auth(token))
        .expect(409);
      await server()
        .get(`/api/v1/users/me/export/${ready.body.id}/download`)
        .set(auth(token))
        .expect(200);
    });

    it("refuses PATs on export and account-deletion routes", async () => {
      const created = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(token))
        .send({ name: "pat", expiresAt: null })
        .expect(201);
      const pat = created.body.token as string;
      for (const [method, url] of [
        ["post", "/api/v1/users/me/export"],
        ["get", "/api/v1/users/me/export/000000000000000000000000"],
        ["get", "/api/v1/users/me/export/000000000000000000000000/download"],
        ["post", "/api/v1/users/me/delete/request-code"],
        ["delete", "/api/v1/users/me"],
      ] as const) {
        const res = await server()[method](url).set(auth(pat)).send({});
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("pat_forbidden");
      }
    });
  });

  describe("self-service account deletion (D22)", () => {
    it("uses the latest schedule window across a re-enable", async () => {
      await server()
        .delete("/api/v1/users/me")
        .set(auth(token))
        .send({ confirmEmail: EMAIL, password: PASSWORD })
        .expect(202);
      const first = await prisma.securityAuditLog.findFirstOrThrow({
        where: { userId, action: "account.delete_scheduled" },
        orderBy: { createdAt: "desc" },
      });

      await prisma.user.update({
        where: { id: userId },
        data: { disabledAt: null },
      });
      const login = await server()
        .post("/api/v1/auth/login")
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
      const fresh = login.body.accessToken as string;
      await server()
        .delete("/api/v1/users/me")
        .set(auth(fresh))
        .send({ confirmEmail: EMAIL, password: PASSWORD })
        .expect(202);
      const second = await prisma.securityAuditLog.findFirstOrThrow({
        where: { userId, action: "account.delete_scheduled" },
        orderBy: { createdAt: "desc" },
      });
      expect(second.id).not.toBe(first.id);

      const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
      await prisma.securityAuditLog.update({
        where: { id: first.id },
        data: { createdAt: eightDaysAgo },
      });
      const maintenance = app.get(MaintenanceService);
      await maintenance.run("sweep-accounts");
      expect(
        await prisma.user.findUnique({ where: { id: userId } }),
      ).not.toBeNull();

      await prisma.securityAuditLog.update({
        where: { id: second.id },
        data: { createdAt: eightDaysAgo },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { disabledAt: new Date(Date.now() - 9 * 86_400_000) },
      });
      await maintenance.run("sweep-accounts");
      expect(
        await prisma.user.findUnique({ where: { id: userId } }),
      ).toBeNull();
      expect(
        await prisma.securityAuditLog.findFirst({
          where: { action: "account.deleted", userId },
        }),
      ).not.toBeNull();
      // The audit trail is never deleted as part of the erasure.
      expect(
        await prisma.securityAuditLog.count({
          where: { userId, action: "account.delete_scheduled" },
        }),
      ).toBe(2);
    });

    it("does not delete an account when an admin disabled it after the schedule", async () => {
      await server()
        .delete("/api/v1/users/me")
        .set(auth(token))
        .send({ confirmEmail: EMAIL, password: PASSWORD })
        .expect(202);
      const schedule = await prisma.securityAuditLog.findFirstOrThrow({
        where: { userId, action: "account.delete_scheduled" },
        orderBy: { createdAt: "desc" },
      });
      await prisma.securityAuditLog.update({
        where: { id: schedule.id },
        data: { createdAt: new Date(Date.now() - 8 * 86_400_000) },
      });
      // The admin disable is *newer* than the self-service schedule.
      await prisma.user.update({
        where: { id: userId },
        data: { disabledAt: new Date(Date.now() - 2 * 86_400_000) },
      });
      await app.get(MaintenanceService).run("sweep-accounts");
      expect(
        await prisma.user.findUnique({ where: { id: userId } }),
      ).not.toBeNull();
    });

    it("cleans avatar, live shares and empty boards with pending invites", async () => {
      const board = await createBoardWith(token, "Orphan board");
      const other = await createSessionUser(OTHER_EMAIL);
      await prisma.boardMember.create({
        data: {
          boardId: board.id,
          userId: other.userId,
          role: "MEMBER",
          acceptedAt: null,
        },
      });
      const share = await prisma.boardShare.create({
        data: {
          token: randomUUID(),
          boardId: board.id,
          mode: "live",
          createdBy: userId,
          includeComments: true,
          includeAttachments: false,
        },
      });
      const storage = app.get(StorageService);
      await storage.ensureDirs();
      const avatarName = storage.storedName("avatar.png");
      await writeFile(storage.avatarPath(avatarName), "avatar");
      await prisma.user.update({
        where: { id: userId },
        data: { avatarPath: avatarName },
      });

      await server()
        .delete("/api/v1/users/me")
        .set(auth(token))
        .send({ confirmEmail: EMAIL, password: PASSWORD })
        .expect(202);
      const schedule = await prisma.securityAuditLog.findFirstOrThrow({
        where: { userId, action: "account.delete_scheduled" },
        orderBy: { createdAt: "desc" },
      });
      await prisma.securityAuditLog.update({
        where: { id: schedule.id },
        data: { createdAt: new Date(Date.now() - 8 * 86_400_000) },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { disabledAt: new Date(Date.now() - 9 * 86_400_000) },
      });
      await app.get(MaintenanceService).run("sweep-accounts");

      expect(
        await prisma.user.findUnique({ where: { id: userId } }),
      ).toBeNull();
      const deletedBoard = await prisma.board.findUnique({
        where: { id: board.id },
      });
      expect(deletedBoard?.deletedAt).not.toBeNull();
      const revoked = await prisma.boardShare.findUnique({
        where: { id: share.id },
      });
      expect(revoked?.revokedAt).not.toBeNull();
      await expect(access(storage.avatarPath(avatarName))).rejects.toThrow();
    });

    it("sweeps a stored board.cleanup_failed marker", async () => {
      const board = await createBoardWith(token, "Reaper integration");
      await prisma.boardMember.deleteMany({ where: { boardId: board.id } });
      await prisma.securityAuditLog.create({
        data: {
          userId,
          actorId: userId,
          action: "board.cleanup_failed",
          targetType: "board",
          targetId: board.id,
          details: { reason: "simulated" },
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });
      await app.get(MaintenanceService).run("sweep-orphan-boards");
      expect(
        (await prisma.board.findUnique({ where: { id: board.id } }))?.deletedAt,
      ).not.toBeNull();
      expect(
        await prisma.securityAuditLog.findFirst({
          where: {
            action: "board.cleanup_recovered",
            targetType: "board",
            targetId: board.id,
          },
        }),
      ).not.toBeNull();
    });

    it("writes account.delete_cancelled when an admin re-enables", async () => {
      await server()
        .delete("/api/v1/users/me")
        .set(auth(token))
        .send({ confirmEmail: EMAIL, password: PASSWORD })
        .expect(202);
      const adminToken = await loginAdmin();
      await server()
        .patch(`/api/v1/admin/users/${userId}`)
        .set(auth(adminToken))
        .send({ disabled: false })
        .expect(200);
      const cancelled = await prisma.securityAuditLog.findFirst({
        where: { userId, action: "account.delete_cancelled" },
      });
      expect(cancelled).toMatchObject({
        actorType: "admin",
        targetType: "user",
        details: { reason: "admin_reenable" },
      });
      expect(
        await prisma.securityAuditLog.count({
          where: { userId, action: "account.delete_scheduled" },
        }),
      ).toBe(1);
    });

    it("reports deletionMethod from hasPassword, not the login method", async () => {
      const me = await server()
        .get("/api/v1/auth/me")
        .set(auth(token))
        .expect(200);
      expect(me.body).toMatchObject({
        hasPassword: true,
        deletionMethod: "password",
        authMethod: "password",
      });

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: null },
      });
      const oauthOnly = await server()
        .get("/api/v1/auth/me")
        .set(auth(await freshAccessToken(userId)))
        .expect(200);
      expect(oauthOnly.body).toMatchObject({
        hasPassword: false,
        deletionMethod: "email_code",
      });
    });

    it("uses OAuth proof + email code for an OAuth-only account", async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: null },
      });
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      const proof = await jwt.signAsync(
        {
          sub: userId,
          authMethod: "oauth",
          authTime: Date.now(),
          stamp: securityStamp(current),
        },
        { audience: USER_JWT_AUDIENCE },
      );
      const oauthToken = await freshAccessToken(userId);

      const codeRes = await server()
        .post("/api/v1/users/me/delete/request-code")
        .set(auth(oauthToken))
        .send({ oauthProof: proof })
        .expect(200);
      expect(codeRes.body.queued).toBe(true);

      const mail = mailer.outbox[mailer.outbox.length - 1];
      const code = /(\d{6})/.exec(mail.text)?.[1];
      expect(code).toMatch(/^\d{6}$/);

      await server()
        .delete("/api/v1/users/me")
        .set(auth(oauthToken))
        .send({
          confirmEmail: EMAIL,
          oauthProof: proof,
          emailCode: code,
        })
        .expect(202);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.disabledAt).not.toBeNull();
    });

    it("refuses a password JWT and an 11-minute-old OAuth proof", async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: null },
      });
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      const oauthToken = await freshAccessToken(userId);
      const wrong = await server()
        .post("/api/v1/users/me/delete/request-code")
        .set(auth(oauthToken))
        .send({ oauthProof: oauthToken })
        .expect(401);
      expect(wrong.body.code).toBe("oauth_proof_invalid");

      const stale = await jwt.signAsync(
        {
          sub: userId,
          authMethod: "oauth",
          authTime: Date.now() - 11 * 60_000,
          stamp: securityStamp(current),
        },
        { audience: USER_JWT_AUDIENCE },
      );
      const res = await server()
        .post("/api/v1/users/me/delete/request-code")
        .set(auth(oauthToken))
        .send({ oauthProof: stale })
        .expect(401);
      expect(res.body.code).toBe("oauth_proof_invalid");
    });

    it("keeps an old OAuth-only refresh token marked as oauth", async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: null },
      });
      const raw = "old-refresh-without-prefix";
      await prisma.refreshToken.create({
        data: {
          userId,
          tokenHash: createHash("sha256").update(raw).digest("hex"),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const res = await server()
        .post("/api/v1/auth/refresh")
        .set("Cookie", `refresh_token=${raw}`)
        .expect(200);
      expect(res.body.user).toMatchObject({
        authMethod: "oauth",
        hasPassword: false,
      });
    });
  });

  describe("retention status", () => {
    it("returns the honest backup status and the effective retention", async () => {
      process.env.BACKUP_DIR = "";
      const adminToken = await loginAdmin();
      const res = await server()
        .get("/api/v1/admin/retention")
        .set(auth(adminToken))
        .expect(200);
      expect(res.body).toMatchObject({
        retentionDays: 30,
        purgeable: { cards: 0, comments: 0, attachments: 0, columns: 0 },
        backups: {
          mode: "unconfigured",
          location: null,
          automatic: false,
          lastBackupAt: null,
          verified: false,
        },
      });
    });

    it("keeps deletion lifecycle markers beyond the audit window", async () => {
      await prisma.securityAuditLog.create({
        data: {
          userId,
          actorId: userId,
          action: "account.delete_scheduled",
          targetType: "user",
          targetId: userId,
          createdAt: new Date(Date.now() - 400 * 86_400_000),
        },
      });
      await prisma.securityAuditLog.create({
        data: {
          userId,
          actorId: userId,
          action: "board.cleanup_failed",
          targetType: "board",
          targetId: "board-old",
          createdAt: new Date(Date.now() - 400 * 86_400_000),
        },
      });
      await app.get(MaintenanceService).run("sweep-security-audit");
      expect(
        await prisma.securityAuditLog.count({
          where: { userId, action: "account.delete_scheduled" },
        }),
      ).toBe(1);
      expect(
        await prisma.securityAuditLog.count({
          where: { userId, action: "board.cleanup_failed" },
        }),
      ).toBe(1);
    });
  });

  async function wipe(db: PrismaService): Promise<void> {
    await db.agentSession.deleteMany();
    await db.approvalRequest.deleteMany();
    await db.idempotencyRecord.deleteMany();
    await db.securityAuditLog.deleteMany();
    await db.dataExport.deleteMany();
    await db.emailVerificationCode.deleteMany();
    await db.emailChangeCode.deleteMany();
    await db.passwordResetToken.deleteMany();
    await db.attachment.deleteMany();
    await db.cardLink.deleteMany();
    await db.cardLabel.deleteMany();
    await db.checklistItem.deleteMany();
    await db.checklist.deleteMany();
    await db.comment.deleteMany();
    await db.activity.deleteMany();
    await db.command.deleteMany();
    await db.card.deleteMany();
    await db.column.deleteMany();
    await db.label.deleteMany();
    await db.boardMember.deleteMany();
    await db.apiToken.deleteMany();
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.adminRefreshToken.deleteMany();
    await db.adminAuditLog.deleteMany();
    await db.adminUser.deleteMany();
    await db.user.deleteMany();
  }
});
