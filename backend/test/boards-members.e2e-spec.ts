import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Board, BoardEnvelope } from "@janosik/shared";
import { normalizeBoards } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
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

    it("lists only the boards the caller is a member of", async () => {
      const adminList = await server()
        .get("/api/v1/boards")
        .set(auth(adminToken))
        .expect(200);
      expect(adminList.body).toHaveLength(1);
      expect(adminList.body[0]).toMatchObject({
        title: "Roadmap board",
        counters: { cards: 0, columns: 0 },
      });

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

    it("404s an invite for an unknown email", async () => {
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(adminToken))
        .send({ email: "nobody@example.com", role: "MEMBER" })
        .expect(404);
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
      expect(envelope.schemaVersion).toBe(1);
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
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
