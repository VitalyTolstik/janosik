import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Board, BoardEnvelope } from "@janosik/shared";
import { normalizeBoards } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import { BoardsService } from "@/boards/boards.service";
import { CommandsService } from "@/commands/commands.service";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const ADMIN_EMAIL = "boards-admin@example.com";
const MEMBER_EMAIL = "boards-member@example.com";
const VIEWER_EMAIL = "boards-viewer@example.com";
const OUTSIDER_EMAIL = "boards-outsider@example.com";
const PASSWORD = "correct horse battery";

/**
 * Boards, membership roles, soft-delete and import/export (TASK-25 §7.7-4).
 *
 * The board tables and users are wiped before and after this file so no
 * board rows can block the `user.deleteMany()` other e2e specs perform.
 */
describe("Boards API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let memberToken: string;
  let viewerToken: string;
  let outsiderToken: string;
  let adminId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipe(prisma);

    adminToken = await register(ADMIN_EMAIL, "Admin");
    memberToken = await register(MEMBER_EMAIL, "Member");
    viewerToken = await register(VIEWER_EMAIL, "Viewer");
    outsiderToken = await register(OUTSIDER_EMAIL, "Outsider");

    const me = await server()
      .get("/api/v1/auth/me")
      .set(auth(adminToken))
      .expect(200);
    adminId = me.body.id;
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  /**
   * Invitations are opt-in (TASK-35 addendum): a fresh invite is a pending
   * row, so the invitee must accept before the board routes open up.
   */
  async function acceptInvitation(
    token: string,
    boardId: string,
  ): Promise<void> {
    const list = await server()
      .get("/api/v1/invitations")
      .set(auth(token))
      .expect(200);
    const invitation = list.body.find(
      (row: { boardId: string }) => row.boardId === boardId,
    );
    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(token))
      .expect(200);
  }

  async function createBoard(
    title: string,
    token = adminToken,
  ): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(token))
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  async function userIdOf(token: string): Promise<string> {
    const me = await server()
      .get("/api/v1/auth/me")
      .set(auth(token))
      .expect(200);
    return me.body.id as string;
  }

  function applyCommand(
    boardId: string,
    action: Record<string, unknown>,
    token = adminToken,
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now() - 60_000, ...action },
      });
  }

  describe("CRUD + aggregate", () => {
    it("creates a board with the caller as ADMIN and returns the aggregate", async () => {
      const res = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Roadmap board" })
        .expect(201);

      const board = res.body as Board;
      expect(board.id).toEqual(expect.any(String));
      expect(board.title).toBe("Roadmap board");
      expect(board.columns).toEqual([]);
      expect(board.cards).toEqual({});
      expect(board.labels).toEqual([]);
      expect(typeof board.createdAt).toBe("number");
      expect(typeof board.updatedAt).toBe("number");
      expect(board.archivedAt).toBeUndefined();

      // Shape contract: the aggregate is already the normalized frontend model.
      expect(normalizeBoards([board])[0]).toEqual(board);

      const members = await server()
        .get(`/api/v1/boards/${board.id}/members`)
        .set(auth(adminToken))
        .expect(200);
      expect(members.body).toEqual([
        {
          userId: expect.any(String),
          displayName: "Admin",
          email: ADMIN_EMAIL,
          role: "ADMIN",
          expiresAt: null,
          avatarColor: null,
          avatarPath: null,
        },
      ]);

      // The chosen color (TASK-36.1) rides the member directory.
      await server()
        .patch("/api/v1/users/me")
        .set(auth(adminToken))
        .send({ avatarColor: "indigo" })
        .expect(200);
      const colored = await server()
        .get(`/api/v1/boards/${board.id}/members`)
        .set(auth(adminToken))
        .expect(200);
      expect(colored.body[0].avatarColor).toBe("indigo");
    });

    it("creates the requested first-run starter with commands", async () => {
      const res = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({
          title: "Launch plan",
          template: "starter",
          templateLocale: "en",
        })
        .expect(201);

      const board = res.body as Board;
      expect(board.title).toBe("Launch plan");
      expect(board.columns.map((column) => column.title)).toEqual([
        "To do",
        "In progress",
        "Done",
      ]);
      const cards = Object.values(board.cards);
      expect(cards).toHaveLength(1);
      expect(cards[0]?.title).toBe("Welcome to your board");
      expect(cards[0]?.checklists?.[0]?.title).toBe("First steps");
      expect(cards[0]?.checklists?.[0]?.items.map((item) => item.text)).toEqual(
        [
          "Rename the board to your project",
          "Add your first real card",
          "Invite a teammate",
        ],
      );
      // Starter content is real history: 3 columns + card + checklist + 3 items.
      const commands = await server()
        .get(`/api/v1/boards/${board.id}/commands`)
        .set(auth(adminToken))
        .expect(200);
      expect(commands.body).toHaveLength(8);
      expect(commands.body[0]?.action).toMatchObject({ type: "ADD_COLUMN" });
    });

    it("creates a Russian starter and an empty board without template", async () => {
      const ru = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Запуск", template: "starter", templateLocale: "ru" })
        .expect(201);
      expect(
        ru.body.columns.map((column: { title: string }) => column.title),
      ).toEqual(["Сделать", "В работе", "Готово"]);
      expect(Object.values(ru.body.cards)[0]).toMatchObject({
        title: "Добро пожаловать на доску",
      });

      const empty = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Plain" })
        .expect(201);
      expect(empty.body.columns).toEqual([]);
      expect(empty.body.cards).toEqual({});
    });

    it("replays a starter create and rejects invalid template fields", async () => {
      const key = randomUUID();
      const body = {
        title: "Replay starter",
        template: "starter",
        templateLocale: "en",
      };
      const first = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body)
        .expect(201);
      const second = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body)
        .expect(201);
      expect(second.body).toEqual(first.body);

      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Bad template", template: "nope" })
        .expect(400);
      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Bad locale", templateLocale: "ru" })
        .expect(400);
      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({
          title: "Bad locale",
          template: "starter",
          templateLocale: "de",
        })
        .expect(400);
      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Bad locale", template: null, templateLocale: "ru" })
        .expect(400);
    });

    it("discards the fresh board when the starter batch fails and retries the key", async () => {
      const commands = app.get(CommandsService);
      const spy = jest
        .spyOn(commands, "applyBatch")
        .mockRejectedValueOnce(new Error("starter failure"));
      const key = randomUUID();
      const body = { title: "Doomed starter", template: "starter" };
      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body)
        .expect(500);
      spy.mockRestore();

      const afterFailure = await server()
        .get("/api/v1/boards")
        .set(auth(adminToken))
        .expect(200);
      expect(
        afterFailure.body.some(
          (board: { title: string }) => board.title === "Doomed starter",
        ),
      ).toBe(false);

      const retry = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body)
        .expect(201);
      expect(retry.body.title).toBe("Doomed starter");
      const afterRetry = await server()
        .get("/api/v1/boards")
        .set(auth(adminToken))
        .expect(200);
      expect(
        afterRetry.body.filter(
          (board: { title: string }) => board.title === "Doomed starter",
        ),
      ).toHaveLength(1);
    });

    it("keeps the key when the failed starter cannot be cleaned up", async () => {
      const commands = app.get(CommandsService);
      const boards = app.get(BoardsService);
      const commandSpy = jest
        .spyOn(commands, "applyBatch")
        .mockRejectedValueOnce(new Error("starter failure"));
      const cleanupSpy = jest
        .spyOn(boards, "discardFreshBoard")
        .mockResolvedValue(false);
      const key = randomUUID();
      const body = { title: "Cleanup doom", template: "starter" };
      const failed = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body)
        .expect(503);
      commandSpy.mockRestore();
      cleanupSpy.mockRestore();
      expect(failed.body).toMatchObject({
        code: "starter_cleanup_failed",
        retryable: false,
        details: { boardId: expect.any(String) },
      });

      // The empty board may exist; the same key must never mint a second one.
      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body)
        .expect(409);
      const list = await server()
        .get("/api/v1/boards")
        .set(auth(adminToken))
        .expect(200);
      expect(
        list.body.filter(
          (board: { title: string }) => board.title === "Cleanup doom",
        ),
      ).toHaveLength(1);
    });

    it("returns the board id when the create read itself fails", async () => {
      const boards = app.get(BoardsService);
      const readSpy = jest
        .spyOn(boards, "getAggregate")
        .mockRejectedValue(new Error("read failed"));
      const key = randomUUID();
      const body = { title: "Create read doom", template: "starter" };
      const failed = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body)
        .expect(503);
      readSpy.mockRestore();
      expect(failed.body).toMatchObject({
        code: "board_read_failed",
        retryable: false,
        details: { boardId: expect.any(String) },
      });

      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body)
        .expect(409);
      const list = await server()
        .get("/api/v1/boards")
        .set(auth(adminToken))
        .expect(200);
      const boardsWithTitle = list.body.filter(
        (board: { title: string }) => board.title === "Create read doom",
      );
      expect(boardsWithTitle).toHaveLength(1);
      expect(boardsWithTitle[0].id).toBe(failed.body.details.boardId);
    });

    it("creates the starter through an account-wide admin PAT", async () => {
      const tokenResponse = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(adminToken))
        .send({
          name: "starter pat",
          expiresAt: null,
          scopePreset: "admin",
          trustedCi: false,
        })
        .expect(201);
      const pat = tokenResponse.body.token as string;
      const created = await server()
        .post("/api/v1/boards")
        .set(auth(pat))
        .send({ title: "PAT starter", template: "starter" })
        .expect(201);
      expect(created.body.columns).toHaveLength(3);

      const commands = await server()
        .get(`/api/v1/boards/${created.body.id}/commands`)
        .set(auth(adminToken))
        .expect(200);
      expect(commands.body).toHaveLength(8);
      expect(
        commands.body.every(
          (command: {
            actorType?: string;
            apiTokenId?: string;
            runId?: string;
          }) =>
            command.actorType === "agent" &&
            command.apiTokenId === tokenResponse.body.apiToken.id &&
            typeof command.runId === "string",
        ),
      ).toBe(true);
    });

    it("keeps the key and board id when the starter aggregate read fails", async () => {
      const boards = app.get(BoardsService);
      const original = boards.getAggregate.bind(boards);
      let calls = 0;
      const readSpy = jest
        .spyOn(boards, "getAggregate")
        .mockImplementation(async (boardId: string) => {
          calls += 1;
          // First call is createBoard's own return; the controller read then
          // fails three times.
          if (calls >= 2) throw new Error("read failed");
          return original(boardId);
        });
      const key = randomUUID();
      const body = { title: "Read doom", template: "starter" };
      const failed = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body)
        .expect(503);
      readSpy.mockRestore();
      expect(failed.body).toMatchObject({
        code: "starter_read_failed",
        retryable: false,
        details: { boardId: expect.any(String) },
      });

      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body)
        .expect(409);
      const list = await server()
        .get("/api/v1/boards")
        .set(auth(adminToken))
        .expect(200);
      const boardsWithTitle = list.body.filter(
        (board: { title: string }) => board.title === "Read doom",
      );
      expect(boardsWithTitle).toHaveLength(1);
      expect(boardsWithTitle[0].id).toBe(failed.body.details.boardId);
    });

    it("lists only the boards the caller is a member of", async () => {
      const adminList = await server()
        .get("/api/v1/boards")
        .set(auth(adminToken))
        .expect(200);
      const roadmap = adminList.body.find(
        (board: { title: string }) => board.title === "Roadmap board",
      );
      expect(roadmap).toMatchObject({
        title: "Roadmap board",
        counters: { cards: 0, columns: 0 },
      });
      expect(
        adminList.body.every(
          (board: { role: string }) => board.role === "ADMIN",
        ),
      ).toBe(true);

      const outsiderList = await server()
        .get("/api/v1/boards")
        .set(auth(outsiderToken))
        .expect(200);
      expect(outsiderList.body).toEqual([]);
    });

    it("rejects a blank title with 400", async () => {
      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "   " })
        .expect(400);
    });
  });

  describe("membership roles", () => {
    let boardId: string;

    beforeAll(async () => {
      const res = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Roles board" })
        .expect(201);
      boardId = res.body.id;

      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: MEMBER_EMAIL, role: "MEMBER" })
        .expect(201);
      await acceptInvitation(memberToken, boardId);
      const member = await server()
        .get("/api/v1/boards")
        .set(auth(memberToken))
        .expect(200);
      expect(member.body).toHaveLength(1);

      const viewerRes = await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: VIEWER_EMAIL, role: "VIEWER" })
        .expect(201);
      await acceptInvitation(viewerToken, boardId);
      expect(viewerRes.body).toMatchObject({
        email: VIEWER_EMAIL,
        role: "VIEWER",
        expiresAt: null,
      });
    });

    it("answers an invite for an unknown email like any other (no enumeration)", async () => {
      const res = await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: "nobody@example.com", role: "MEMBER" })
        .expect(201);
      expect(res.body).toMatchObject({
        userId: "",
        email: "nobody@example.com",
        role: "MEMBER",
      });
    });

    it("409s a duplicate invite", async () => {
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: MEMBER_EMAIL, role: "MEMBER" })
        .expect(409);
    });

    it("lets ADMIN, MEMBER and VIEWER read the aggregate", async () => {
      for (const token of [adminToken, memberToken, viewerToken]) {
        const res = await server()
          .get(`/api/v1/boards/${boardId}`)
          .set(auth(token))
          .expect(200);
        expect(res.body.id).toBe(boardId);
      }
    });

    it("403s a non-member on the aggregate and 404s an unknown board", async () => {
      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(outsiderToken))
        .expect(403);
      await server()
        .get("/api/v1/boards/does-not-exist")
        .set(auth(adminToken))
        .expect(404);
    });

    it("403s MEMBER and VIEWER on ADMIN-only membership mutations", async () => {
      for (const token of [memberToken, viewerToken]) {
        await server()
          .post(`/api/v1/boards/${boardId}/members`)
          .set(auth(token))
          .send({ email: OUTSIDER_EMAIL, role: "VIEWER" })
          .expect(403);
        await server()
          .patch(`/api/v1/boards/${boardId}/members/${adminId}`)
          .set(auth(token))
          .send({ role: "MEMBER" })
          .expect(403);
      }
    });

    it("ignores expiresAt for ADMIN/MEMBER and stores it for VIEWER", async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const res = await server()
        .patch(`/api/v1/boards/${boardId}/members/${adminId}`)
        .set(auth(adminToken))
        .send({ role: "ADMIN", expiresAt: future })
        .expect(200);
      expect(res.body.expiresAt).toBeNull();

      const members = await server()
        .get(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .expect(200);
      const viewer = members.body.find(
        (m: { email: string }) => m.email === VIEWER_EMAIL,
      );
      const viewerId = viewer.userId;

      const patched = await server()
        .patch(`/api/v1/boards/${boardId}/members/${viewerId}`)
        .set(auth(adminToken))
        .send({ expiresAt: future })
        .expect(200);
      expect(patched.body.expiresAt).toBe(new Date(future).getTime());
      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(viewerToken))
        .expect(200);
    });

    it("403s and lazily cleans an expired VIEWER", async () => {
      const members = await server()
        .get(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .expect(200);
      const viewerId = members.body.find(
        (m: { email: string }) => m.email === VIEWER_EMAIL,
      ).userId;

      await server()
        .patch(`/api/v1/boards/${boardId}/members/${viewerId}`)
        .set(auth(adminToken))
        .send({ expiresAt: new Date(Date.now() - 1000).toISOString() })
        .expect(200);

      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(viewerToken))
        .expect(403);

      const after = await server()
        .get(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .expect(200);
      expect(after.body.map((m: { email: string }) => m.email)).not.toContain(
        VIEWER_EMAIL,
      );
    });

    it("keeps an expired VIEWER visible and lets an admin re-invite or remove them (M15)", async () => {
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: OUTSIDER_EMAIL, role: "VIEWER" })
        .expect(201);
      await acceptInvitation(outsiderToken, boardId);

      const me = await server()
        .get("/api/v1/auth/me")
        .set(auth(outsiderToken))
        .expect(200);
      const outsiderId = me.body.id as string;
      await prisma.boardMember.update({
        where: { boardId_userId: { boardId, userId: outsiderId } },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      // The lapsed row is no longer access, but it is still a membership an
      // ADMIN must be able to see and revoke.
      const activeOnly = await server()
        .get(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .expect(200);
      expect(
        activeOnly.body.some(
          (member: { email: string }) => member.email === OUTSIDER_EMAIL,
        ),
      ).toBe(false);

      await server()
        .get(`/api/v1/boards/${boardId}/members?includeExpired=1`)
        .set(auth(memberToken))
        .expect(403);

      const visible = await server()
        .get(`/api/v1/boards/${boardId}/members?includeExpired=1`)
        .set(auth(adminToken))
        .expect(200);
      expect(
        visible.body.some(
          (member: { email: string; expiresAt: number | null }) =>
            member.email === OUTSIDER_EMAIL &&
            member.expiresAt !== null &&
            member.expiresAt < Date.now(),
        ),
      ).toBe(true);

      // Re-inviting turns the lapsed accepted row into a fresh pending
      // invitation instead of answering 409 forever.
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: OUTSIDER_EMAIL, role: "VIEWER" })
        .expect(201);
      const pending = await prisma.boardMember.findUniqueOrThrow({
        where: { boardId_userId: { boardId, userId: outsiderId } },
      });
      expect(pending.acceptedAt).toBeNull();

      // And the pending row is removable like any other invitation.
      await server()
        .delete(`/api/v1/boards/${boardId}/members/${outsiderId}`)
        .set(auth(adminToken))
        .expect(200);

      // Repeat with an accepted-but-expired row: deletion must work directly.
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: OUTSIDER_EMAIL, role: "VIEWER" })
        .expect(201);
      await acceptInvitation(outsiderToken, boardId);
      await prisma.boardMember.update({
        where: { boardId_userId: { boardId, userId: outsiderId } },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await server()
        .delete(`/api/v1/boards/${boardId}/members/${outsiderId}`)
        .set(auth(adminToken))
        .expect(200);
      expect(
        await prisma.boardMember.findUnique({
          where: { boardId_userId: { boardId, userId: outsiderId } },
        }),
      ).toBeNull();
    });

    it("protects the last ADMIN from demotion and removal", async () => {
      await server()
        .patch(`/api/v1/boards/${boardId}/members/${adminId}`)
        .set(auth(adminToken))
        .send({ role: "MEMBER" })
        .expect(409);
      await server()
        .delete(`/api/v1/boards/${boardId}/members/${adminId}`)
        .set(auth(adminToken))
        .expect(409);
    });
  });

  /**
   * TASK-177.2 (G-02): self-leave is a first-class member action. It must
   * remove access without touching authored content, and it must never leave
   * a board without an ADMIN.
   */
  describe("self-leave", () => {
    it("lets a MEMBER leave and keeps their authored card and attribution", async () => {
      const boardId = await createBoard("Member leaves");
      const memberId = await userIdOf(memberToken);
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: MEMBER_EMAIL, role: "MEMBER" })
        .expect(201);
      await acceptInvitation(memberToken, boardId);

      // Authored content before leaving: one column and one card.
      await applyCommand(
        boardId,
        { type: "ADD_COLUMN", newColumnId: "col-leave", title: "Todo" },
        memberToken,
      ).expect(200);
      await applyCommand(
        boardId,
        {
          type: "ADD_CARD",
          newCardId: "card-leave",
          columnId: "col-leave",
          title: "Written by a leaver",
        },
        memberToken,
      ).expect(200);

      await server()
        .delete(`/api/v1/boards/${boardId}/members/me`)
        .set(auth(memberToken))
        .expect(200);

      const listed = await server()
        .get("/api/v1/boards")
        .set(auth(memberToken))
        .expect(200);
      expect(listed.body.map((board: Board) => board.id)).not.toContain(
        boardId,
      );

      // Direct board URL is denied after leaving (no stale access).
      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(memberToken))
        .expect(403);

      expect(
        await prisma.boardMember.findUnique({
          where: { boardId_userId: { boardId, userId: memberId } },
        }),
      ).toBeNull();

      // The card stays on the board and still names its author.
      const aggregate = await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(adminToken))
        .expect(200);
      expect(aggregate.body.cards["card-leave"]).toMatchObject({
        title: "Written by a leaver",
        lastActorId: memberId,
      });

      // Own departure is recorded as `member_left`, not `member_removed`.
      const activity = await prisma.activity.findFirst({
        where: { boardId, type: "member_left" },
      });
      expect(activity).toMatchObject({
        actorId: memberId,
        details: expect.objectContaining({ userId: memberId, role: "MEMBER" }),
      });
    });

    it("lets a VIEWER leave", async () => {
      const boardId = await createBoard("Viewer leaves");
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: VIEWER_EMAIL, role: "VIEWER" })
        .expect(201);
      await acceptInvitation(viewerToken, boardId);

      await server()
        .delete(`/api/v1/boards/${boardId}/members/me`)
        .set(auth(viewerToken))
        .expect(200);
      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(viewerToken))
        .expect(403);
    });

    it("refuses the last ADMIN with a clear last_admin code, then allows it once another admin exists", async () => {
      const boardId = await createBoard("Admin leaves");

      const refused = await server()
        .delete(`/api/v1/boards/${boardId}/members/me`)
        .set(auth(adminToken))
        .expect(409);
      expect(refused.body).toMatchObject({
        code: "last_admin",
        action: "leave",
      });
      // The board is still there and the caller is still its ADMIN.
      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(adminToken))
        .expect(200);

      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: OUTSIDER_EMAIL, role: "ADMIN" })
        .expect(201);
      await acceptInvitation(outsiderToken, boardId);

      await server()
        .delete(`/api/v1/boards/${boardId}/members/me`)
        .set(auth(adminToken))
        .expect(200);
      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(adminToken))
        .expect(403);
      // The remaining ADMIN still owns the board.
      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(outsiderToken))
        .expect(200);
    });

    it("keeps the leaver's display identity on comments and the Watch feed", async () => {
      const boardId = await createBoard("Leaver attribution");
      const memberId = await userIdOf(memberToken);
      await applyCommand(boardId, {
        type: "ADD_COLUMN",
        newColumnId: "col-attribution",
        title: "Todo",
      }).expect(200);
      await applyCommand(boardId, {
        type: "ADD_CARD",
        newCardId: "card-attribution",
        columnId: "col-attribution",
        title: "Comment target",
      }).expect(200);
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: MEMBER_EMAIL, role: "MEMBER" })
        .expect(201);
      await acceptInvitation(memberToken, boardId);

      const comment = await server()
        .post("/api/v1/cards/card-attribution/comments")
        .set(auth(memberToken))
        .send({ text: "Written by a member who leaves" })
        .expect(201);
      expect(comment.body).toMatchObject({
        authorName: "Member",
        authorEmail: MEMBER_EMAIL,
      });

      await server()
        .delete(`/api/v1/boards/${boardId}/members/me`)
        .set(auth(memberToken))
        .expect(200);
      // A lost-response retry is idempotent, not a 403.
      await server()
        .delete(`/api/v1/boards/${boardId}/members/me`)
        .set(auth(memberToken))
        .expect(200);

      const comments = await server()
        .get("/api/v1/cards/card-attribution/comments")
        .set(auth(adminToken))
        .expect(200);
      expect(comments.body.items[0]).toMatchObject({
        authorId: memberId,
        authorName: "Member",
        authorEmail: MEMBER_EMAIL,
      });

      const watch = await server()
        .get(`/api/v1/boards/${boardId}/activity?limit=100`)
        .set(auth(adminToken))
        .expect(200);
      const commentEntry = watch.body.items.find(
        (entry: { type: string }) => entry.type === "comment_added",
      );
      const leftEntry = watch.body.items.find(
        (entry: { type: string }) => entry.type === "member_left",
      );
      expect(commentEntry).toMatchObject({
        actorId: memberId,
        actorName: "Member",
        actorEmail: MEMBER_EMAIL,
      });
      expect(leftEntry).toMatchObject({
        actorId: memberId,
        actorName: "Member",
        actorEmail: MEMBER_EMAIL,
      });
      // The roster no longer contains the leaver, so the client must use
      // these fields instead of rendering `?`.
      expect(
        await prisma.boardMember.findUnique({
          where: { boardId_userId: { boardId, userId: memberId } },
        }),
      ).toBeNull();
    });

    it("does not count a pending ADMIN as the other admin", async () => {
      const boardId = await createBoard("Pending admin");
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: OUTSIDER_EMAIL, role: "ADMIN" })
        .expect(201);

      const refused = await server()
        .delete(`/api/v1/boards/${boardId}/members/me`)
        .set(auth(adminToken))
        .expect(409);
      expect(refused.body.code).toBe("last_admin");

      await acceptInvitation(outsiderToken, boardId);
      await server()
        .delete(`/api/v1/boards/${boardId}/members/me`)
        .set(auth(adminToken))
        .expect(200);
    });

    it("does not count an expired ADMIN as the other admin", async () => {
      const boardId = await createBoard("Expired admin");
      const outsiderId = await userIdOf(outsiderToken);
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: OUTSIDER_EMAIL, role: "ADMIN" })
        .expect(201);
      await acceptInvitation(outsiderToken, boardId);
      await prisma.boardMember.update({
        where: { boardId_userId: { boardId, userId: outsiderId } },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const refused = await server()
        .delete(`/api/v1/boards/${boardId}/members/me`)
        .set(auth(adminToken))
        .expect(409);
      expect(refused.body.code).toBe("last_admin");

      await prisma.boardMember.update({
        where: { boardId_userId: { boardId, userId: outsiderId } },
        data: { expiresAt: null },
      });
      await server()
        .delete(`/api/v1/boards/${boardId}/members/me`)
        .set(auth(adminToken))
        .expect(200);
    });

    it("keeps admin remove-other behaviour on the sibling route", async () => {
      const boardId = await createBoard("Admin removes");
      const memberId = await userIdOf(memberToken);
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: MEMBER_EMAIL, role: "MEMBER" })
        .expect(201);
      await acceptInvitation(memberToken, boardId);

      // A MEMBER cannot remove the admin (or anyone else) through the old
      // route — the self route must not have widened the admin route.
      await server()
        .delete(
          `/api/v1/boards/${boardId}/members/${await userIdOf(adminToken)}`,
        )
        .set(auth(memberToken))
        .expect(403);

      await server()
        .delete(`/api/v1/boards/${boardId}/members/${memberId}`)
        .set(auth(adminToken))
        .expect(200);
      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(memberToken))
        .expect(403);
      const activity = await prisma.activity.findFirst({
        where: { boardId, type: "member_removed" },
      });
      expect(activity?.details).toMatchObject({ userId: memberId });
    });
  });

  describe("soft-delete", () => {
    it("hides a deleted board and cascades the flag to its children", async () => {
      const imported = await server()
        .post("/api/v1/boards/import")
        .set(auth(adminToken))
        .send(richEnvelope("Delete me"))
        .expect(201);
      const boardId = imported.body[0].id as string;

      await server()
        .delete(`/api/v1/boards/${boardId}`)
        .set(auth(adminToken))
        .expect(200);

      const listed = await server()
        .get("/api/v1/boards")
        .set(auth(adminToken))
        .expect(200);
      expect(listed.body.map((b: { id: string }) => b.id)).not.toContain(
        boardId,
      );

      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(adminToken))
        .expect(404);

      const row = await prisma.board.findUnique({ where: { id: boardId } });
      expect(row?.deletedAt).not.toBeNull();
      const columns = await prisma.column.findMany({ where: { boardId } });
      expect(columns.length).toBeGreaterThan(0);
      expect(columns.every((column) => column.deletedAt !== null)).toBe(true);
      const cards = await prisma.card.findMany({
        where: { column: { boardId } },
      });
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.every((card) => card.deletedAt !== null)).toBe(true);
    });

    it("403s a MEMBER trying to delete the board", async () => {
      const board = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Member cannot delete" })
        .expect(201);
      await server()
        .post(`/api/v1/boards/${board.body.id}/members`)
        .set(auth(adminToken))
        .send({ email: MEMBER_EMAIL, role: "MEMBER" })
        .expect(201);
      await acceptInvitation(memberToken, board.body.id);
      await server()
        .delete(`/api/v1/boards/${board.body.id}`)
        .set(auth(memberToken))
        .expect(403);
    });
  });

  describe("Recently deleted (TASK-177.7)", () => {
    async function deleted(boardId: string) {
      return (
        await server()
          .get(`/api/v1/boards/${boardId}/deleted`)
          .set(auth(adminToken))
          .expect(200)
      ).body as {
        retentionDays: number;
        truncated: boolean;
        items: Array<{ type: string; id: string; title: string }>;
      };
    }

    it("restores cards, columns, comments and files during retention", async () => {
      const boardId = await createBoard("Recently deleted board");
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: MEMBER_EMAIL, role: "MEMBER" })
        .expect(201);
      await acceptInvitation(memberToken, boardId);
      const columnId = randomUUID();
      const cardId = randomUUID();
      const secondColumnId = randomUUID();
      const secondCardId = randomUUID();
      await applyCommand(boardId, {
        type: "ADD_COLUMN",
        newColumnId: columnId,
        title: "To do",
      }).expect(200);
      await applyCommand(boardId, {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId,
        title: "Retired card",
      }).expect(200);
      await applyCommand(boardId, {
        type: "ADD_COLUMN",
        newColumnId: secondColumnId,
        title: "Later",
      }).expect(200);
      await applyCommand(boardId, {
        type: "ADD_CARD",
        newCardId: secondCardId,
        columnId: secondColumnId,
        title: "Column cargo",
      }).expect(200);

      // Card: delete → reload the list → restore → live again.
      await applyCommand(boardId, { type: "DELETE_CARD", cardId }).expect(200);
      let page = await deleted(boardId);
      expect(page.retentionDays).toBeGreaterThan(0);
      expect(page.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "cards", id: cardId }),
        ]),
      );
      await server()
        .post(`/api/v1/boards/${boardId}/deleted/cards/${cardId}/restore`)
        .set(auth(memberToken))
        .expect(200);
      let aggregate = await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(adminToken))
        .expect(200);
      expect(aggregate.body.cards[cardId]).toMatchObject({
        title: "Retired card",
      });
      expect((await deleted(boardId)).items.map((row) => row.id)).not.toContain(
        cardId,
      );

      // A deleted column takes its cards with it and brings them back.
      await applyCommand(boardId, {
        type: "DELETE_COLUMN",
        columnId: secondColumnId,
      }).expect(200);
      page = await deleted(boardId);
      expect(page.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "columns", id: secondColumnId }),
        ]),
      );
      expect(page.items.map((row) => row.id)).not.toContain(secondCardId);
      await server()
        .post(
          `/api/v1/boards/${boardId}/deleted/columns/${secondColumnId}/restore`,
        )
        .set(auth(memberToken))
        .expect(200);
      aggregate = await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(adminToken))
        .expect(200);
      expect(
        aggregate.body.columns.map((row: { id: string }) => row.id),
      ).toContain(secondColumnId);
      expect(aggregate.body.cards[secondCardId]).toMatchObject({
        title: "Column cargo",
      });

      // Comment: author delete → restore in place → visible in the thread.
      const comment = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "Please keep this note" })
        .expect(201);
      await server()
        .delete(`/api/v1/comments/${comment.body.id}`)
        .set(auth(adminToken))
        .expect(200);
      expect((await deleted(boardId)).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "comments", id: comment.body.id }),
        ]),
      );
      await server()
        .post(
          `/api/v1/boards/${boardId}/deleted/comments/${comment.body.id}/restore`,
        )
        .set(auth(memberToken))
        .expect(200);
      const thread = await server()
        .get(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .expect(200);
      expect(thread.body.items.map((row: { id: string }) => row.id)).toContain(
        comment.body.id,
      );

      // File: delete → restore → list + blob are back.
      const file = await server()
        .post(`/api/v1/cards/${cardId}/attachments`)
        .set(auth(adminToken))
        .attach("file", Buffer.from("hello"), {
          filename: "note.txt",
          contentType: "text/plain",
        })
        .expect(201);
      await server()
        .delete(`/api/v1/attachments/${file.body.id}`)
        .set(auth(adminToken))
        .expect(200);
      expect((await deleted(boardId)).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "attachments", id: file.body.id }),
        ]),
      );
      await server()
        .post(
          `/api/v1/boards/${boardId}/deleted/attachments/${file.body.id}/restore`,
        )
        .set(auth(memberToken))
        .expect(200);
      const files = await server()
        .get(`/api/v1/cards/${cardId}/attachments`)
        .set(auth(adminToken))
        .expect(200);
      expect(files.body.map((row: { id: string }) => row.id)).toContain(
        file.body.id,
      );
      await server()
        .get(`/api/v1/attachments/${file.body.id}/content`)
        .set(auth(adminToken))
        .expect(200);
    });

    it("keeps the view behind board membership and refuses an expired row", async () => {
      const boardId = await createBoard("Deleted permissions");
      await server()
        .get(`/api/v1/boards/${boardId}/deleted`)
        .set(auth(outsiderToken))
        .expect(403);

      const columnId = randomUUID();
      const cardId = randomUUID();
      await applyCommand(boardId, {
        type: "ADD_COLUMN",
        newColumnId: columnId,
        title: "To do",
      }).expect(200);
      await applyCommand(boardId, {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId,
        title: "Old card",
      }).expect(200);
      await applyCommand(boardId, { type: "DELETE_CARD", cardId }).expect(200);
      await prisma.card.update({
        where: { id: cardId },
        data: { deletedAt: new Date(Date.now() - 400 * 86_400_000) },
      });

      // Past the 30-day fallback the list hides it and a direct restore is
      // a 410 rather than a resurrection outside retention.
      expect((await deleted(boardId)).items.map((row) => row.id)).not.toContain(
        cardId,
      );
      await server()
        .post(`/api/v1/boards/${boardId}/deleted/cards/${cardId}/restore`)
        .set(auth(adminToken))
        .expect(410);
    });
  });

  describe("import / export round-trip", () => {
    it("preserves cover, dueDate, wipLimit and archivedAt across two imports", async () => {
      const source = richEnvelope("Round trip").boards[0];

      const first = await server()
        .post("/api/v1/boards/import")
        .set(auth(adminToken))
        .send(richEnvelope("Round trip"))
        .expect(201);
      const firstAggregate = first.body[0] as Board;

      // The server aggregate matches the shared frontend model exactly.
      expect(normalizeBoards([firstAggregate])[0]).toEqual(firstAggregate);
      expectRoundTripContent(firstAggregate, source);

      const exported = await server()
        .get(`/api/v1/boards/${firstAggregate.id}/export`)
        .set(auth(adminToken))
        .expect(200);
      const envelope = exported.body as BoardEnvelope;
      expect(envelope.app).toBe("janosik");
      expect(envelope.schemaVersion).toBe(3);
      expect(envelope.boards).toHaveLength(1);

      const second = await server()
        .post("/api/v1/boards/import")
        .set(auth(adminToken))
        .send(envelope)
        .expect(201);
      const secondExport = await server()
        .get(`/api/v1/boards/${second.body[0].id}/export`)
        .set(auth(adminToken))
        .expect(200);

      expect(canonicalize(envelope.boards[0])).toEqual(
        canonicalize(secondExport.body.boards[0]),
      );
    });

    it("lets a VIEWER export the board", async () => {
      const board = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Viewer export" })
        .expect(201);
      await server()
        .post(`/api/v1/boards/${board.body.id}/members`)
        .set(auth(adminToken))
        .send({ email: VIEWER_EMAIL, role: "VIEWER" })
        .expect(201);
      await acceptInvitation(viewerToken, board.body.id);
      const res = await server()
        .get(`/api/v1/boards/${board.body.id}/export`)
        .set(auth(viewerToken))
        .expect(200);
      expect(res.body.boards[0].id).toBe(board.body.id);
    });

    it("imports every board of one envelope atomically (TASK-149)", async () => {
      const first = richEnvelope("Atomic A").boards[0];
      const second = {
        ...richEnvelope("Atomic B").boards[0],
        id: "src-board-atomic-b",
      };
      const res = await server()
        .post("/api/v1/boards/import")
        .set(auth(adminToken))
        .send({
          app: "janosik",
          schemaVersion: 1,
          exportedAt: Date.now(),
          boards: [first, second],
        })
        .expect(201);

      expect(res.body).toHaveLength(2);
      const ids = res.body.map((board: Board) => board.id);
      expect(new Set(ids).size).toBe(2);
      // Content survived the batched inserts: labels, columns and cards.
      for (const board of res.body as Board[]) {
        expect(board.labels.length).toBeGreaterThan(0);
        expect(board.columns.some((column) => column.cardIds.length > 0)).toBe(
          true,
        );
        expect(Object.keys(board.cards).length).toBeGreaterThan(0);
      }
    });

    it("rejects a malformed envelope with 400", async () => {
      await server()
        .post("/api/v1/boards/import")
        .set(auth(adminToken))
        .send({ app: "not-janosik", schemaVersion: 1, boards: [] })
        .expect(400);
    });
  });

  /** A rich single-board envelope used by the import/export tests. */
  function richEnvelope(title: string): BoardEnvelope {
    return {
      app: "janosik",
      schemaVersion: 1,
      exportedAt: Date.now(),
      boards: [
        {
          id: "src-board",
          title,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_100_000,
          labels: [
            { id: "label-design", name: "Design", color: "red" },
            { id: "label-bug", name: "Bug", color: "green" },
          ],
          columns: [
            {
              id: "col-todo",
              title: "Todo",
              cardIds: ["card-a", "card-b"],
              wipLimit: 3,
              createdAt: 1_700_000_000_000,
            },
            {
              id: "col-doing",
              title: "Doing",
              cardIds: [],
              createdAt: 1_700_000_000_000,
            },
          ],
          cards: {
            "card-a": {
              id: "card-a",
              title: "Card A",
              description: "Some notes",
              labelIds: ["label-design"],
              dueDate: 1_700_500_000_000,
              cover: { type: "color", value: "blue" },
              checklists: [
                {
                  id: "checklist-1",
                  title: "Steps",
                  items: [
                    { id: "item-1", text: "one", done: true },
                    { id: "item-2", text: "two", done: false },
                  ],
                },
              ],
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_100_000,
            },
            "card-b": {
              id: "card-b",
              title: "Card B",
              labelIds: ["label-bug"],
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_000_000,
            },
            "card-c": {
              id: "card-c",
              title: "Archived card",
              labelIds: [],
              archivedAt: 1_700_200_000_000,
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_200_000_000,
            },
          },
        } as Board,
      ],
    };
  }

  /** Assert the fields the round-trip guarantee is about. */
  function expectRoundTripContent(aggregate: Board, source: Board): void {
    const todo = aggregate.columns.find((c) => c.title === "Todo");
    expect(todo?.wipLimit).toBe(3);

    // Archived cards are in the map with archivedAt but out of column arrays.
    const archived = Object.values(aggregate.cards).find(
      (card) => card.title === "Archived card",
    );
    expect(archived?.archivedAt).toBe(1_700_200_000_000);
    expect(
      aggregate.columns.some((c) => c.cardIds.includes(archived!.id)),
    ).toBe(false);

    const cardA = Object.values(aggregate.cards).find(
      (card) => card.title === "Card A",
    );
    expect(cardA?.dueDate).toBe(1_700_500_000_000);
    expect(cardA?.cover).toEqual({ type: "color", value: "blue" });
    expect(cardA?.checklists).toHaveLength(1);
    expect(cardA?.checklists?.[0].items[0]).toMatchObject({
      text: "one",
      done: true,
    });
    expect(cardA?.labelIds).toHaveLength(1);
    expect(source.columns[0].cardIds).toHaveLength(2);
  }

  /** Ids are remapped on import, so compare content, not identity. */
  function canonicalize(board: Board): unknown {
    const labelName = (id: string) =>
      board.labels.find((label) => label.id === id)?.name ?? id;
    const cards = Object.values(board.cards)
      .map((card) => ({
        title: card.title,
        description: card.description ?? null,
        dueDate: card.dueDate ?? null,
        cover: card.cover ?? null,
        archivedAt: card.archivedAt ?? null,
        labels: [...card.labelIds].map(labelName).sort(),
        checklists: (card.checklists ?? []).map((checklist) => ({
          title: checklist.title,
          items: checklist.items.map((item) => ({
            text: item.text,
            done: item.done,
          })),
        })),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
    return {
      title: board.title,
      archivedAt: board.archivedAt ?? null,
      columns: board.columns.map((column) => ({
        title: column.title,
        wipLimit: column.wipLimit ?? null,
        cardTitles: column.cardIds
          .map((id) => board.cards[id]?.title ?? id)
          .sort(),
      })),
      cards,
      labels: board.labels
        .map((label) => ({ name: label.name, color: label.color }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async function wipe(db: PrismaService): Promise<void> {
    await db.attachment.deleteMany();
    await db.cardLink.deleteMany();
    await db.cardLabel.deleteMany();
    await db.checklistItem.deleteMany();
    await db.checklist.deleteMany();
    await db.commentRevision.deleteMany();
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
    await db.user.deleteMany();
  }
});
