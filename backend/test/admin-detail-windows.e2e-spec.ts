import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const ADMIN_EMAIL = "windows-master@example.com";
const ADMIN_PASSWORD = "windows master password";
const USER_EMAIL = "windows-user@example.com";

/**
 * TASK-176.3 — the user/card detail tabs are windows, not samples:
 * exact totals, `N of M` windows, live-only defaults, and an anchor for a
 * comment/attachment a search result pointed at.
 */
describe("Admin detail windows (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userId: string;
  let boardId: string;
  let targetCardId: string;
  let anchorCommentId: string;
  let deletedAnchorId: string;

  const at = (offset: number) => new Date(Date.UTC(2026, 0, 1) + offset * 1000);
  const server = () => request(app.getHttpServer());

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
        displayName: "Windows master",
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
    const board = await prisma.board.create({
      data: { title: "Windows board" },
    });
    boardId = board.id;
    await prisma.boardMember.create({
      data: {
        boardId,
        userId,
        role: "ADMIN",
        acceptedAt: at(0),
      },
    });
    const column = await prisma.column.create({
      data: { id: "window-column", boardId, title: "Backlog", position: 0 },
    });

    // 120 created cards, each with its own create command.
    const cards = Array.from({ length: 120 }, (_, index) => ({
      id: `window-card-${index.toString().padStart(3, "0")}`,
      columnId: column.id,
      title: `Window card ${index}`,
      position: index,
      createdAt: at(index),
      updatedAt: at(index),
      attachmentCount: index === 0 ? 55 : 0,
    }));
    await prisma.card.createMany({ data: cards });
    targetCardId = cards[0]!.id;
    await prisma.command.createMany({
      data: cards.map((card, index) => ({
        id: `cmd-create-${index}`,
        boardId,
        actorId: userId,
        type: "ADD_CARD",
        payload: {
          newCardId: card.id,
          columnId: column.id,
          title: card.title,
        },
        result: { seq: index + 1, versions: {} },
        touches: [`card:${card.id}`],
        createdAt: at(index),
      })),
    });

    // 25 live and 5 deleted comments on the target card.
    await prisma.comment.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        id: `window-comment-${index}`,
        cardId: targetCardId,
        authorId: userId,
        text: `Comment ${index}`,
        createdAt: at(200 + index),
        updatedAt: at(200 + index),
        deletedAt: index >= 25 ? at(500) : null,
      })),
    });
    anchorCommentId = "window-comment-0";
    deletedAnchorId = "window-comment-29";

    // 55 live and 5 deleted attachments.
    await prisma.attachment.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        id: `window-attachment-${index}`,
        cardId: targetCardId,
        boardId,
        fileName: `file-${index}.png`,
        storedName: `stored-${index}.png`,
        mimeType: "image/png",
        sizeBytes: 100 + index,
        uploadedById: userId,
        createdAt: at(300 + index),
        deletedAt: index >= 55 ? at(600) : null,
      })),
    });

    // 25 active + 3 revoked + 2 expired sessions.
    await prisma.refreshToken.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        id: `window-session-${index}`,
        tokenHash: `window-session-hash-${index}`,
        userId,
        createdAt: at(400 + index),
        expiresAt: index >= 28 ? at(10) : new Date("2027-01-01T00:00:00Z"),
        revokedAt: index >= 25 && index < 28 ? at(700) : null,
      })),
    });

    // 25 active + 5 revoked tokens.
    await prisma.apiToken.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        id: `window-token-${index}`,
        userId,
        name: `Token ${index}`,
        tokenHash: `window-token-hash-${index}`,
        createdAt: at(800 + index),
        revokedAt: index >= 25 ? at(900) : null,
      })),
    });

    // A merged timeline of 60 commands touching the card + 10 activity rows.
    await prisma.command.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        id: `cmd-touch-${index}`,
        boardId,
        actorId: userId,
        type: "UPDATE_CARD",
        payload: { cardId: targetCardId, title: `Touch ${index}` },
        result: { seq: 1000 + index, versions: {} },
        touches: [`card:${targetCardId}`],
        createdAt: at(1000 + index),
      })),
    });
    await prisma.activity.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        id: `window-activity-${index}`,
        boardId,
        cardId: targetCardId,
        actorId: userId,
        type: "comment_added",
        details: { index },
        createdAt: at(1200 + index),
      })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const adminGet = (path: string) =>
    server().get(path).set("Authorization", `Bearer ${adminToken}`);

  it("keeps every user-detail tab a window with an exact total", async () => {
    const res = await adminGet(`/api/v1/admin/users/${userId}/detail`).expect(
      200,
    );
    const body = res.body;

    expect(body.counters).toMatchObject({
      boards: 1,
      cardsCreated: 120,
      cardsAssigned: 0,
      comments: 25,
      attachments: 55,
      sessions: 25,
      tokens: 25,
    });
    expect(body.windows.cards).toMatchObject({
      offset: 0,
      limit: 25,
      total: 120,
      hasMore: true,
      includeDeleted: false,
    });
    expect(body.createdCards).toHaveLength(25);

    expect(body.windows.comments).toMatchObject({
      offset: 0,
      limit: 25,
      total: 25,
      hasMore: false,
      includeDeleted: false,
    });
    expect(body.comments).toHaveLength(25);
    expect(
      body.comments.every((comment: { deletedAt: number | null }) => {
        return comment.deletedAt === null;
      }),
    ).toBe(true);
    expect(body.hidden).toMatchObject({
      comments: 5,
      attachments: 5,
      sessions: 5,
      tokens: 5,
    });

    expect(body.windows.attachments).toMatchObject({
      offset: 0,
      limit: 25,
      total: 55,
      hasMore: true,
      includeDeleted: false,
    });
    expect(
      body.attachments.every((file: { deletedAt: number | null }) => {
        return file.deletedAt === null;
      }),
    ).toBe(true);

    expect(body.windows.memberships.total).toBe(1);
    expect(body.windows.sessions).toMatchObject({ total: 25, hasMore: false });
    expect(
      body.sessions.every(
        (session: { revokedAt: number | null; expiresAt: number }) =>
          session.revokedAt === null && session.expiresAt > Date.now(),
      ),
    ).toBe(true);
    expect(body.windows.tokens).toMatchObject({ total: 25, hasMore: false });
    expect(
      body.tokens.every((token: { revokedAt: number | null }) => {
        return token.revokedAt === null;
      }),
    ).toBe(true);
  });

  it("pages the created-card command log past 100 cards", async () => {
    const res = await adminGet(
      `/api/v1/admin/users/${userId}/detail?section=cards&offset=100&limit=25`,
    ).expect(200);

    expect(res.body.createdCards).toHaveLength(20);
    expect(res.body.windows.cards).toMatchObject({
      offset: 100,
      limit: 25,
      total: 120,
      hasMore: false,
    });
  });

  it("lets deleted comments and inactive sessions be requested explicitly", async () => {
    const comments = await adminGet(
      `/api/v1/admin/users/${userId}/detail?section=comments&includeDeleted=true&offset=25&limit=25`,
    ).expect(200);
    expect(comments.body.comments).toHaveLength(5);
    expect(comments.body.windows.comments).toMatchObject({
      offset: 25,
      total: 30,
      hasMore: false,
      includeDeleted: true,
    });

    const sessions = await adminGet(
      `/api/v1/admin/users/${userId}/detail?section=sessions&includeDeleted=true`,
    ).expect(200);
    expect(sessions.body.windows.sessions).toMatchObject({
      total: 30,
      includeDeleted: true,
    });
    expect(sessions.body.sessions).toHaveLength(25);
  });

  it("rejects an unknown section", async () => {
    await adminGet(
      `/api/v1/admin/users/${userId}/detail?section=timeline`,
    ).expect(400);
  });

  it("windows card comments, attachments and the merged timeline", async () => {
    const res = await adminGet(
      `/api/v1/admin/cards/${targetCardId}/detail`,
    ).expect(200);
    const body = res.body;

    expect(body.card.commentIds).toHaveLength(25);
    expect(body.windows.comments).toMatchObject({
      offset: 0,
      limit: 50,
      total: 25,
      hasMore: false,
    });
    expect(body.comments).toHaveLength(25);
    expect(body.hidden.comments).toBe(5);

    expect(body.windows.attachments).toMatchObject({
      offset: 0,
      limit: 50,
      total: 55,
      hasMore: true,
    });
    expect(body.attachments).toHaveLength(50);
    expect(
      body.attachments.every((file: { deletedAt: number | null }) => {
        return file.deletedAt === null;
      }),
    ).toBe(true);
    expect(body.hidden.attachments).toBe(5);

    expect(body.windows.timeline).toMatchObject({
      offset: 0,
      limit: 50,
      total: 71,
      hasMore: true,
    });
    expect(body.timeline).toHaveLength(50);
  });

  it("pages the card timeline instead of slicing it silently", async () => {
    const res = await adminGet(
      `/api/v1/admin/cards/${targetCardId}/detail?section=timeline&offset=50&limit=50`,
    ).expect(200);

    expect(res.body.timeline).toHaveLength(21);
    expect(res.body.windows.timeline).toMatchObject({
      offset: 50,
      total: 71,
      hasMore: false,
    });
  });

  it("includes deleted card comments on request", async () => {
    const res = await adminGet(
      `/api/v1/admin/cards/${targetCardId}/detail?section=comments&includeDeleted=true&limit=100`,
    ).expect(200);

    expect(res.body.comments).toHaveLength(30);
    expect(res.body.windows.comments).toMatchObject({
      total: 30,
      includeDeleted: true,
    });
  });

  it("centres the comment window on an anchor from search", async () => {
    const res = await adminGet(
      `/api/v1/admin/cards/${targetCardId}/detail?section=comments&anchor=${anchorCommentId}&limit=50`,
    ).expect(200);

    expect(res.body.windows.comments).toMatchObject({
      offset: 4,
      total: 30,
      includeDeleted: true,
      anchor: anchorCommentId,
    });
    expect(res.body.comments).toHaveLength(26);
    expect(
      res.body.comments.some(
        (comment: { id: string }) => comment.id === anchorCommentId,
      ),
    ).toBe(true);
  });

  it("finds a soft-deleted anchor without hiding it behind the live filter", async () => {
    const res = await adminGet(
      `/api/v1/admin/cards/${targetCardId}/detail?section=comments&anchor=${deletedAnchorId}&limit=25`,
    ).expect(200);

    expect(res.body.windows.comments.anchor).toBe(deletedAnchorId);
    expect(res.body.windows.comments.includeDeleted).toBe(true);
    expect(
      res.body.comments.some(
        (comment: { id: string; deletedAt: number | null }) =>
          comment.id === deletedAnchorId && comment.deletedAt !== null,
      ),
    ).toBe(true);
  });

  it("centres the attachment window on an anchor from search", async () => {
    const anchor = "window-attachment-0";
    const res = await adminGet(
      `/api/v1/admin/cards/${targetCardId}/detail?section=attachments&anchor=${anchor}&limit=20`,
    ).expect(200);

    expect(res.body.windows.attachments.anchor).toBe(anchor);
    expect(res.body.windows.attachments.includeDeleted).toBe(true);
    expect(res.body.windows.attachments.total).toBe(60);
    expect(
      res.body.attachments.some((file: { id: string }) => file.id === anchor),
    ).toBe(true);
  });
});
