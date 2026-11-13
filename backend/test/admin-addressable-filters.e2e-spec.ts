import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const ADMIN_EMAIL = "filters-master@example.com";
const ADMIN_PASSWORD = "filters master password";
const USER_EMAIL = "filters-user@example.com";

/**
 * TASK-176.6 — addressable admin filters. Two boards deliberately share a
 * title and a label name; every list is scoped by the exact id, never by a
 * name search. Deleted and archived rows keep the documented status
 * semantics and pagination stays exact.
 */
describe("Admin addressable filters (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userId: string;

  const server = () => request(app.getHttpServer());
  const at = (offset: number) => Date.UTC(2026, 0, 1) + offset * 1000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    await prisma.adminUser.create({
      data: {
        email: ADMIN_EMAIL,
        displayName: "Filters master",
        role: "OWNER",
        passwordHash: await argonHash(ADMIN_PASSWORD, { type: argon2id }),
      },
    });
    const login = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    adminToken = login.body.accessToken;

    const user = await prisma.user.create({
      data: { email: USER_EMAIL, passwordHash: "unused" },
    });
    userId = user.id;

    for (const side of ["a", "b"] as const) {
      const boardId = `board-${side}`;
      await prisma.board.create({
        data: { id: boardId, title: "Same board title" },
      });
      await prisma.boardMember.create({
        data: {
          boardId,
          userId,
          role: "ADMIN",
          acceptedAt: new Date(at(0)),
        },
      });
      await prisma.column.create({
        data: {
          id: `col-${side}`,
          boardId,
          title: "Backlog",
          position: 0,
        },
      });
      await prisma.label.create({
        data: {
          id: `label-${side}`,
          boardId,
          name: "urgent",
          color: "red",
          position: 0,
        },
      });
    }

    // Three cards on A (one archived, one deleted), one on B.
    const cards = [
      ["card-a-1", "col-a", "A one", null, null],
      ["card-a-2", "col-a", "A two", null, null],
      ["card-a-3", "col-a", "A three", null, null],
      ["card-a-archived", "col-a", "A archived", new Date(at(10)), null],
      ["card-a-deleted", "col-a", "A deleted", null, new Date(at(11))],
      ["card-b-1", "col-b", "B one", null, null],
    ] as const;
    for (const [id, columnId, title, archivedAt, deletedAt] of cards) {
      await prisma.card.create({
        data: {
          id,
          columnId,
          title,
          position: 0,
          archivedAt,
          deletedAt,
        },
      });
    }
    await prisma.cardLabel.create({
      data: { cardId: "card-a-1", labelId: "label-a", position: 0 },
    });
    await prisma.cardLabel.create({
      data: { cardId: "card-b-1", labelId: "label-b", position: 0 },
    });

    await prisma.comment.createMany({
      data: [
        {
          id: "comment-a-live",
          cardId: "card-a-1",
          authorId: userId,
          text: "live on A",
          createdAt: new Date(at(20)),
        },
        {
          id: "comment-a-deleted",
          cardId: "card-a-1",
          authorId: userId,
          text: "deleted on A",
          deletedAt: new Date(at(21)),
          createdAt: new Date(at(21)),
        },
        {
          id: "comment-b-live",
          cardId: "card-b-1",
          authorId: userId,
          text: "live on B",
          createdAt: new Date(at(22)),
        },
      ],
    });

    await prisma.attachment.createMany({
      data: [
        {
          id: "file-a-live",
          cardId: "card-a-1",
          boardId: "board-a",
          fileName: "a-live.pdf",
          storedName: "filters-a-live",
          mimeType: "application/pdf",
          sizeBytes: 10,
          uploadedById: userId,
        },
        {
          id: "file-a-deleted",
          cardId: "card-a-1",
          boardId: "board-a",
          fileName: "a-deleted.pdf",
          storedName: "filters-a-deleted",
          mimeType: "application/pdf",
          sizeBytes: 10,
          uploadedById: userId,
          deletedAt: new Date(at(23)),
        },
        {
          id: "file-b-live",
          cardId: "card-b-1",
          boardId: "board-b",
          fileName: "b-live.pdf",
          storedName: "filters-b-live",
          mimeType: "application/pdf",
          sizeBytes: 10,
          uploadedById: userId,
        },
      ],
    });

    await prisma.command.createMany({
      data: [
        {
          id: "command-a-1",
          boardId: "board-a",
          actorId: userId,
          type: "ADD_CARD",
          payload: { newCardId: "card-a-1" },
          result: { seq: 1, versions: {} },
          touches: ["card:card-a-1", "column:col-a"],
          createdAt: new Date(at(30)),
        },
        {
          id: "command-b-1",
          boardId: "board-b",
          actorId: userId,
          type: "ADD_CARD",
          payload: { newCardId: "card-b-1" },
          result: { seq: 1, versions: {} },
          touches: ["card:card-b-1", "column:col-b"],
          createdAt: new Date(at(31)),
        },
      ],
    });

    await prisma.activity.createMany({
      data: [
        {
          id: "activity-a-1",
          boardId: "board-a",
          cardId: "card-a-1",
          actorId: userId,
          type: "comment_added",
          details: { commentId: "comment-a-live" },
          createdAt: new Date(at(40)),
        },
        {
          id: "activity-b-1",
          boardId: "board-b",
          cardId: "card-b-1",
          actorId: userId,
          type: "comment_added",
          details: { commentId: "comment-b-live" },
          createdAt: new Date(at(41)),
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) =>
    server()
      .get(`/api/v1/admin/entities/${path}`)
      .set("Authorization", `Bearer ${adminToken}`);

  it("keeps same-name boards apart on every board-scoped list", async () => {
    const cards = await get("cards?boardId=board-a").expect(200);
    expect(cards.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(["card-a-1", "card-a-2", "card-a-3"]),
    );
    expect(
      cards.body.items.every(
        (row: { boardId: string }) => row.boardId === "board-a",
      ),
    ).toBe(true);

    const comments = await get("comments?boardId=board-a").expect(200);
    expect(
      comments.body.items.every(
        (row: { id: string }) => row.id !== "comment-b-live",
      ),
    ).toBe(true);
    expect(comments.body.items.map((row: { id: string }) => row.id)).toContain(
      "comment-a-live",
    );

    const files = await get("attachments?boardId=board-a").expect(200);
    expect(
      files.body.items.map((row: { id: string }) => row.id).sort(),
    ).toEqual(["file-a-deleted", "file-a-live"]);

    const commands = await get("commands?boardId=board-a").expect(200);
    expect(commands.body.items.map((row: { id: string }) => row.id)).toEqual([
      "command-a-1",
    ]);

    const activity = await get("activity?boardId=board-a").expect(200);
    expect(activity.body.items.map((row: { id: string }) => row.id)).toEqual([
      "activity-a-1",
    ]);
  });

  it("filters cards by exact column, label and card id", async () => {
    const byColumn = await get("cards?columnId=col-a").expect(200);
    expect(
      byColumn.body.items.every(
        (row: { columnId: string }) => row.columnId === "col-a",
      ),
    ).toBe(true);
    expect(
      byColumn.body.items.some((row: { id: string }) => row.id === "card-b-1"),
    ).toBe(false);

    const byLabel = await get("cards?labelId=label-a").expect(200);
    expect(byLabel.body.items.map((row: { id: string }) => row.id)).toEqual([
      "card-a-1",
    ]);

    const byCard = await get("cards?cardId=card-b-1").expect(200);
    expect(byCard.body.items.map((row: { id: string }) => row.id)).toEqual([
      "card-b-1",
    ]);
  });

  it("combines board and column filters instead of widening them", async () => {
    const mismatch = await get("cards?boardId=board-a&columnId=col-b").expect(
      200,
    );
    expect(mismatch.body.total).toBe(0);
    expect(mismatch.body.items).toEqual([]);
  });

  it("keeps pagination exact with a structural filter", async () => {
    const page = await get("cards?boardId=board-a&limit=2&offset=2").expect(
      200,
    );
    expect(page.body.total).toBe(5);
    expect(page.body.limit).toBe(2);
    expect(page.body.offset).toBe(2);
    expect(page.body.items).toHaveLength(2);
    expect(
      page.body.items.every(
        (row: { boardId: string }) => row.boardId === "board-a",
      ),
    ).toBe(true);
  });

  it("documents deleted/archived inclusion and the status filter", async () => {
    const all = await get("cards?boardId=board-a").expect(200);
    expect(all.body.total).toBe(5);
    expect(all.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(["card-a-archived", "card-a-deleted"]),
    );

    const active = await get("cards?boardId=board-a&status=active").expect(200);
    expect(active.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(["card-a-1", "card-a-2", "card-a-3"]),
    );
    expect(
      active.body.items.some(
        (row: { id: string }) =>
          row.id === "card-a-archived" || row.id === "card-a-deleted",
      ),
    ).toBe(false);

    const deletedComments = await get(
      "comments?boardId=board-a&status=deleted",
    ).expect(200);
    expect(
      deletedComments.body.items.map((row: { id: string }) => row.id),
    ).toEqual(["comment-a-deleted"]);

    const liveComments = await get(
      "comments?boardId=board-a&status=active",
    ).expect(200);
    expect(
      liveComments.body.items.map((row: { id: string }) => row.id),
    ).toEqual(["comment-a-live"]);
    expect(
      liveComments.body.items.some(
        (row: { id: string }) => row.id === "comment-a-deleted",
      ),
    ).toBe(false);

    const allComments = await get("comments?boardId=board-a").expect(200);
    expect(allComments.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(["comment-a-live", "comment-a-deleted"]),
    );
  });

  it("rejects malformed id filters with 400", async () => {
    await get("cards?boardId=bad%24id").expect(400);
    await get("cards?columnId=../etc").expect(400);
    await get("comments?labelId=").expect(200);
  });
});
