import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  BoardCardDetailDto,
  BoardCardDetailsDto,
  BoardCardPageDto,
  BoardReadSummaryDto,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const ADMIN_EMAIL = "read-model-admin@example.com";
const VIEWER_EMAIL = "read-model-viewer@example.com";
const OUTSIDER_EMAIL = "read-model-outsider@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-200.9 — read model v1: summary, cursor pages, card detail and the
 * legacy full-read capability gate.
 */
describe("Board read model v1 (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let viewerToken: string;
  let outsiderToken: string;
  let boardId: string;
  let archivedBoardId: string;

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
    viewerToken = await register(VIEWER_EMAIL, "Viewer");
    outsiderToken = await register(OUTSIDER_EMAIL, "Outsider");

    boardId = await createBoard("Read model board");
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: "col-1",
      title: "Todo",
    });
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: "col-2",
      title: "Doing",
    });
    await command(boardId, {
      type: "ADD_LABEL",
      label: { id: "label-1", name: "urgent", color: "red" },
    });
    for (const [id, title] of [
      ["card-1", "First"],
      ["card-2", "Second"],
      ["card-3", "Third"],
      ["card-4", "Fourth"],
      ["card-doing", "Doing card"],
      ["card-archived", "Archived card"],
    ] as const) {
      await command(boardId, {
        type: "ADD_CARD",
        newCardId: id,
        columnId: id === "card-doing" ? "col-2" : "col-1",
        title,
      });
    }
    await command(boardId, {
      type: "UPDATE_CARD",
      cardId: "card-2",
      description: "a searchable body",
    });
    await command(boardId, {
      type: "SET_CARD_LABEL",
      cardId: "card-2",
      labelId: "label-1",
      on: true,
    });
    await command(boardId, {
      type: "ADD_CHECKLIST",
      cardId: "card-2",
      newChecklistId: "check-1",
      title: "Steps",
    });
    await command(boardId, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-2",
      checklistId: "check-1",
      newItemId: "item-1",
      text: "do it",
    });
    await command(boardId, {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: "card-2",
      checklistId: "check-1",
      itemId: "item-1",
      done: true,
    });
    await command(boardId, {
      type: "ADD_CARD_LINK",
      cardId: "card-1",
      linkId: "link-1",
      targetCardId: "card-2",
      linkType: "blocks",
    });
    await command(boardId, {
      type: "ARCHIVE_CARD",
      cardId: "card-archived",
    });
    await invite(viewerToken, boardId, VIEWER_EMAIL, "VIEWER");

    archivedBoardId = await createBoard("Archived read model");
    await command(archivedBoardId, {
      type: "ADD_COLUMN",
      newColumnId: "archived-col",
      title: "Todo",
    });
    await command(archivedBoardId, {
      type: "ADD_CARD",
      newCardId: "archived-card",
      columnId: "archived-col",
      title: "Still here",
    });
    await command(archivedBoardId, { type: "ARCHIVE_BOARD" });
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

  async function createBoard(title: string): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  async function command(
    targetBoardId: string,
    action: Record<string, unknown>,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${targetBoardId}/commands`)
      .set(auth(adminToken))
      .send({
        commandId: randomUUID(),
        action: { boardId: targetBoardId, at: Date.now(), ...action },
      })
      .expect(200);
  }

  async function invite(
    token: string,
    targetBoardId: string,
    email: string,
    role: "VIEWER" | "MEMBER",
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${targetBoardId}/members`)
      .set(auth(adminToken))
      .send({ email, role })
      .expect(201);
    const invitations = await server()
      .get("/api/v1/invitations")
      .set(auth(token))
      .expect(200);
    const invitation = invitations.body.find(
      (row: { boardId: string }) => row.boardId === targetBoardId,
    );
    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(token))
      .expect(200);
  }

  it("returns a summary with full id order, counts and no detail bodies", async () => {
    const res = await server()
      .get(`/api/v1/boards/${boardId}/summary`)
      .query({ limit: 2 })
      .set(auth(adminToken))
      .expect(200)
      .expect("X-Board-Seq", /^\d+$/);
    expect(res.headers["x-janosik-read-model"]).toBe("v1");
    expect(res.headers["vary"]).toContain("Accept-Encoding");
    expect(res.headers["etag"]).toMatch(/^W\/"/);

    const body = res.body as BoardReadSummaryDto;
    expect(body.readModel).toBe("v1");
    expect(body.firstPageLimit).toBe(2);
    expect(body.board).toMatchObject({
      id: boardId,
      title: "Read model board",
      role: "ADMIN",
    });
    const todo = body.columns.find((column) => column.id === "col-1")!;
    expect(todo.count).toBe(4);
    expect(todo.archivedCount).toBe(1);
    expect(todo.cardIds).toEqual(["card-1", "card-2", "card-3", "card-4"]);
    expect(todo.cards.map((card) => card.id)).toEqual(["card-1", "card-2"]);
    expect(todo.hasMore).toBe(true);
    expect(todo.nextCursor).toEqual(expect.any(String));
    expect(body.archivedCardIds).toEqual(["card-archived"]);
    expect(body.archivedCards.map((card) => card.id)).toEqual([
      "card-archived",
    ]);
    expect(body.labels).toEqual([
      { id: "label-1", name: "urgent", color: "red" },
    ]);
    expect(body.seq).toEqual(expect.any(Number));

    const card = todo.cards.find((entry) => entry.id === "card-2")!;
    expect(card).toMatchObject({
      title: "Second",
      descriptionChars: "a searchable body".length,
      checklistItemCount: 1,
      checklistDoneCount: 1,
      linkCount: 1,
      blocked: true,
      labelIds: ["label-1"],
    });
    // The whole payload never carries a description, checklist or link row.
    expect(JSON.stringify(body)).not.toContain("a searchable body");
    expect(card).not.toHaveProperty("description");
    expect(card).not.toHaveProperty("checklists");
    expect(card).not.toHaveProperty("links");

    // Conditional validation: same representation, same validator, 304 with
    // no body but the SSE baseline.
    await server()
      .get(`/api/v1/boards/${boardId}/summary`)
      .query({ limit: 2 })
      .set(auth(adminToken))
      .set("If-None-Match", res.headers.etag as string)
      .expect(304)
      .expect("X-Board-Seq", /^\d+$/);
  });

  it("pages a column with a keyset cursor and rejects foreign cursors", async () => {
    const first = await server()
      .get(`/api/v1/boards/${boardId}/cards`)
      .query({ columnId: "col-1", limit: 2 })
      .set(auth(adminToken))
      .expect(200);
    const firstBody = first.body as BoardCardPageDto;
    expect(firstBody.cards.map((card) => card.id)).toEqual([
      "card-1",
      "card-2",
    ]);
    expect(firstBody.total).toBe(4);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(firstBody)).not.toContain("a searchable body");

    const second = await server()
      .get(`/api/v1/boards/${boardId}/cards`)
      .query({
        columnId: "col-1",
        limit: 2,
        cursor: firstBody.nextCursor,
      })
      .set(auth(adminToken))
      .expect(200);
    const secondBody = second.body as BoardCardPageDto;
    expect(secondBody.cards.map((card) => card.id)).toEqual([
      "card-3",
      "card-4",
    ]);
    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.nextCursor).toBeNull();

    // Same cursor on another column is not replayable.
    await server()
      .get(`/api/v1/boards/${boardId}/cards`)
      .query({
        columnId: "col-2",
        limit: 2,
        cursor: firstBody.nextCursor,
      })
      .set(auth(adminToken))
      .expect(400);
    await server()
      .get(`/api/v1/boards/${boardId}/cards`)
      .query({ columnId: "col-1", cursor: "not-a-cursor" })
      .set(auth(adminToken))
      .expect(400);
    // A column from another board is not an id oracle.
    await server()
      .get(`/api/v1/boards/${archivedBoardId}/cards`)
      .query({ columnId: "col-1" })
      .set(auth(adminToken))
      .expect(404);

    const archived = await server()
      .get(`/api/v1/boards/${boardId}/cards`)
      .query({ archived: 1 })
      .set(auth(adminToken))
      .expect(200);
    expect(
      (archived.body as BoardCardPageDto).cards.map((card) => card.id),
    ).toEqual(["card-archived"]);
    expect((archived.body as BoardCardPageDto).archived).toBe(true);
  });

  it("returns one full card detail and hides cards of other boards", async () => {
    const res = await server()
      .get(`/api/v1/boards/${boardId}/cards/card-2`)
      .set(auth(adminToken))
      .expect(200);
    const body = res.body as BoardCardDetailDto;
    expect(body.card).toMatchObject({
      id: "card-2",
      title: "Second",
      description: "a searchable body",
      labelIds: ["label-1"],
      checklists: [
        {
          id: "check-1",
          title: "Steps",
          items: [{ id: "item-1", text: "do it", done: true }],
        },
      ],
    });
    expect(body.card).not.toHaveProperty("links");
    expect(body.columnId).toBe("col-1");
    expect(body.blocked).toBe(true);
    expect(body.linkCount).toBe(1);

    const viewer = await server()
      .get(`/api/v1/boards/${boardId}/cards/card-2`)
      .set(auth(viewerToken))
      .expect(200);
    expect((viewer.body as BoardCardDetailDto).card.description).toBe(
      "a searchable body",
    );

    await server()
      .get(`/api/v1/boards/${archivedBoardId}/cards/card-2`)
      .set(auth(adminToken))
      .expect(404);
    await server()
      .get(`/api/v1/boards/${boardId}/cards/card-2`)
      .set(auth(outsiderToken))
      .expect(403);

    const source = await server()
      .get(`/api/v1/boards/${boardId}/cards/card-1`)
      .set(auth(adminToken))
      .expect(200);
    expect((source.body as BoardCardDetailDto).card.links).toEqual([
      { id: expect.any(String), type: "blocks", targetCardId: "card-2" },
    ]);

    // Batch preimages are bounded and full-detail only.
    const batch = await server()
      .get(`/api/v1/boards/${boardId}/cards`)
      .query({ ids: "card-1,card-2", detail: "full" })
      .set(auth(adminToken))
      .expect(200);
    expect((batch.body as BoardCardDetailsDto).cards).toHaveLength(2);
    await server()
      .get(`/api/v1/boards/${boardId}/cards`)
      .query({ ids: "card-1,card-2" })
      .set(auth(adminToken))
      .expect(400);
    await server()
      .get(`/api/v1/boards/${boardId}/cards`)
      .query({
        ids: Array.from({ length: 51 }, (_, index) => `x-${index}`).join(","),
        detail: "full",
      })
      .set(auth(adminToken))
      .expect(400);
  });

  it("keeps the legacy full read for old clients and gates it explicitly", async () => {
    const legacy = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(adminToken))
      .expect(200)
      .expect("X-Janosik-Read-Model", "full");
    expect(legacy.body.cards["card-2"].description).toBe("a searchable body");

    await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(adminToken))
      .set("X-Janosik-Read-Model", "v1")
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe("read_model_required");
      });
    await server()
      .get(`/api/v1/boards/${boardId}`)
      .query({ projection: "full" })
      .set(auth(adminToken))
      .set("X-Janosik-Read-Model", "v1")
      .expect(200);
    await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(adminToken))
      .set("X-Janosik-Read-Model", "v2")
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe("invalid_read_model");
      });
  });

  it("serves archived boards read-only and enforces membership", async () => {
    const summary = await server()
      .get(`/api/v1/boards/${archivedBoardId}/summary`)
      .set(auth(adminToken))
      .expect(200);
    const body = summary.body as BoardReadSummaryDto;
    expect(body.board.archivedAt).toEqual(expect.any(Number));
    expect(body.columns[0]?.cards.map((card) => card.id)).toEqual([
      "archived-card",
    ]);

    const page = await server()
      .get(`/api/v1/boards/${archivedBoardId}/cards`)
      .query({ columnId: "archived-col" })
      .set(auth(adminToken))
      .expect(200);
    expect((page.body as BoardCardPageDto).cards[0]?.title).toBe("Still here");

    await server()
      .get(`/api/v1/boards/${boardId}/summary`)
      .set(auth(outsiderToken))
      .expect(403);
    await server()
      .get(`/api/v1/boards/${boardId}/cards`)
      .query({ columnId: "col-1" })
      .set(auth(outsiderToken))
      .expect(403);
    await server()
      .get(`/api/v1/boards/${boardId}/summary`)
      .set(auth(viewerToken))
      .expect(200);
  });

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
