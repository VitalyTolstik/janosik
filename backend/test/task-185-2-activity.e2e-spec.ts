import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type {
  ActivityFeedPage,
  BoardAction,
  BoardSseEvent,
  CommentDto,
} from "@janosik/shared";

import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { AdminService } from "@/admin/admin.service";
import type { AdminPrincipal } from "@/admin/admin.types";

const ADMIN_EMAIL = "1852-admin@example.com";
const AUTHOR_EMAIL = "1852-author@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-185.2 — Activity/SSE contract for comment history.
 *
 * Covers the typed `Activity.commentId`, the protected HTTP projection
 * (confirmed revision diff, legacy one-sided snapshot, gap suppression),
 * the live-comment predicate for edits, tombstones, and the compatible SSE
 * frames (typed ids, no text, master deletion without attribution).
 */
describe("Comment activity and SSE (TASK-185.2, e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let realtime: RealtimeService;
  let adminService: AdminService;

  let owner: { token: string; id: string };
  let author: { token: string; id: string };
  let principal: AdminPrincipal;

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    realtime = app.get(RealtimeService);
    adminService = app.get(AdminService);
    await wipe();
    owner = await register(ADMIN_EMAIL, "Owner");
    author = await register(AUTHOR_EMAIL, "Author");
    const admin = await prisma.adminUser.create({
      data: {
        email: "1852-master@example.com",
        passwordHash: "not-used",
        displayName: "Master",
        role: "OWNER",
      },
    });
    principal = {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: "OWNER",
      createdAt: admin.createdAt.getTime(),
      lastLoginAt: null,
    };
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  async function wipe(): Promise<void> {
    await prisma.adminAuditLog.deleteMany();
    await prisma.adminRefreshToken.deleteMany();
    await prisma.adminUser.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.cardLink.deleteMany();
    await prisma.cardLabel.deleteMany();
    await prisma.checklistItem.deleteMany();
    await prisma.checklist.deleteMany();
    await prisma.commentRevision.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.command.deleteMany();
    await prisma.card.deleteMany();
    await prisma.column.deleteMany();
    await prisma.label.deleteMany();
    await prisma.boardMember.deleteMany();
    await prisma.apiToken.deleteMany();
    await prisma.boardShare.deleteMany();
    await prisma.board.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.securityAuditLog.deleteMany();
    await prisma.user.deleteMany();
  }

  async function register(
    email: string,
    displayName: string,
  ): Promise<{ token: string; id: string }> {
    const res = await server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201);
    return {
      token: res.body.accessToken as string,
      id: res.body.user.id as string,
    };
  }

  async function invite(boardId: string): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(owner.token))
      .send({ email: AUTHOR_EMAIL, role: "MEMBER" })
      .expect(201);
    const invitations = await server()
      .get("/api/v1/invitations")
      .set(auth(author.token))
      .expect(200);
    const pending = invitations.body.find(
      (row: { boardId: string }) => row.boardId === boardId,
    );
    await server()
      .post(`/api/v1/invitations/${pending.id as string}/accept`)
      .set(auth(author.token))
      .expect(200);
  }

  function scoped(
    boardId: string,
    action: Record<string, unknown>,
  ): BoardAction {
    return { boardId, at: Date.now(), ...action } as BoardAction;
  }

  async function apply(
    boardId: string,
    action: BoardAction,
    token = owner.token,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({ commandId: randomUUID(), action })
      .expect(200);
  }

  async function boardWithCard(
    title: string,
    prefix: string,
  ): Promise<{ boardId: string; cardId: string }> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(owner.token))
      .send({ title })
      .expect(201);
    const boardId = res.body.id as string;
    await invite(boardId);
    await apply(
      boardId,
      scoped(boardId, {
        type: "ADD_COLUMN",
        newColumnId: `col-${prefix}`,
        title: "Todo",
      }),
    );
    await apply(
      boardId,
      scoped(boardId, {
        type: "ADD_CARD",
        newCardId: `card-${prefix}`,
        columnId: `col-${prefix}`,
        title: "Card",
      }),
    );
    return { boardId, cardId: `card-${prefix}` };
  }

  async function createComment(
    cardId: string,
    text = "First draft",
  ): Promise<CommentDto> {
    const res = await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(author.token))
      .send({ text, kind: "note" })
      .expect(201);
    return res.body as CommentDto;
  }

  function editComment(commentId: string, body: Record<string, unknown>) {
    return server()
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(author.token))
      .send(body);
  }

  async function cardFeed(
    cardId: string,
    query = "",
  ): Promise<ActivityFeedPage> {
    const res = await server()
      .get(`/api/v1/cards/${cardId}/activity${query}`)
      .set(auth(owner.token))
      .expect(200);
    return res.body as ActivityFeedPage;
  }

  function subscribe(boardId: string): {
    events: BoardSseEvent[];
    close: () => void;
  } {
    const events: BoardSseEvent[] = [];
    const subscription = realtime
      .watch(boardId)
      .subscribe((event) => events.push(event));
    return { events, close: () => subscription.unsubscribe() };
  }

  const commentUpdates = (commentId: string) =>
    prisma.activity.findMany({
      where: { commentId, type: "comment_updated" },
      orderBy: { createdAt: "asc" },
    });

  it("fills Activity.commentId for create, edit and delete", async () => {
    const { cardId } = await boardWithCard("Activity column", "ac");
    const created = await createComment(cardId, "Original");
    const edited = await editComment(created.id, { text: "Edited" }).expect(
      200,
    );
    expect(edited.body.editedAt).toEqual(expect.any(Number));
    await server()
      .delete(`/api/v1/comments/${created.id}`)
      .set(auth(author.token))
      .expect(200);

    const rows = await prisma.activity.findMany({
      where: { commentId: created.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => row.type)).toEqual([
      "comment_added",
      "comment_updated",
      "comment_deleted",
    ]);
    expect(rows.every((row) => row.commentId === created.id)).toBe(true);
    // New deletion snapshots carry no text.
    expect(rows[2]!.details).toEqual({ commentId: created.id });
  });

  it("returns the confirmed revision diff on the protected feed", async () => {
    const { cardId } = await boardWithCard("HTTP diff", "hd");
    const created = await createComment(cardId, "Original");
    await editComment(created.id, { text: "Edited" }).expect(200);

    const revision = await prisma.commentRevision.findFirstOrThrow({
      where: { commentId: created.id },
    });
    const feed = await cardFeed(cardId);
    const updated = feed.items.find(
      (entry) => entry.type === "comment_updated",
    );
    expect(updated?.changes).toEqual([
      { field: "comment", from: "Original", to: "Edited" },
    ]);
    expect(updated?.commentId).toBe(created.id);
    // Raw details and the raw comment id never reach Watch.
    expect(updated?.details).toBeUndefined();
    expect(updated?.detail).toBeUndefined();
    const activity = await commentUpdates(created.id);
    expect(activity[0]!.commentId).toBe(created.id);
    expect(activity[0]!.details).toMatchObject({
      commentId: created.id,
      revisionId: revision.id,
      beforeText: "Original",
      afterText: "Edited",
      cause: "author_edit",
      text: "Edited",
    });
  });

  it("shows a legacy pre-cutover edit as a one-sided snapshot", async () => {
    const { boardId, cardId } = await boardWithCard("Legacy watch", "lw");
    const created = await createComment(cardId, "Legacy current");
    // A future fence makes the synthetic row pre-cutover without touching
    // the actual comment text or creating a revision.
    await prisma.comment.update({
      where: { id: created.id },
      data: { historyCutoverAt: new Date(Date.now() + 60_000) },
    });
    await prisma.activity.create({
      data: {
        boardId,
        cardId,
        type: "comment_updated",
        actorId: author.id,
        details: {
          commentId: created.id,
          text: "Legacy snapshot",
        },
        createdAt: new Date(Date.now() - 120_000),
      },
    });

    const feed = await cardFeed(cardId);
    const updated = feed.items.find(
      (entry) => entry.type === "comment_updated",
    );
    expect(updated?.changes).toEqual([
      { field: "comment", from: null, to: "Legacy snapshot" },
    ]);
    expect(updated?.details).toBeUndefined();
    expect(updated?.detail).toBeUndefined();
  });

  it("suppresses text when a post-cutover edit has no confirmed revision", async () => {
    const { boardId, cardId } = await boardWithCard("Revision gap", "rg");
    const created = await createComment(cardId, "Current");
    await prisma.activity.create({
      data: {
        boardId,
        cardId,
        type: "comment_updated",
        commentId: created.id,
        actorId: author.id,
        details: {
          commentId: created.id,
          revisionId: "missing-revision",
          beforeText: "Leaked before",
          afterText: "Leaked after",
          text: "Leaked after",
        },
        createdAt: new Date(),
      },
    });

    const feed = await cardFeed(cardId);
    const updated = feed.items.find(
      (entry) => entry.type === "comment_updated",
    );
    expect(updated).toBeDefined();
    expect(updated?.changes).toBeUndefined();
    expect(updated?.details).toBeUndefined();
    expect(updated?.detail).toBeUndefined();
    expect(JSON.stringify(updated)).not.toContain("Leaked");
  });

  it("filters deleted edits before pagination but keeps add/delete tombstones", async () => {
    const { cardId } = await boardWithCard("Tombstones", "tb");
    const created = await createComment(cardId, "Secret body");
    await editComment(created.id, { text: "Secret edit" }).expect(200);
    await server()
      .delete(`/api/v1/comments/${created.id}`)
      .set(auth(author.token))
      .expect(200);

    const feed = await cardFeed(cardId, "?limit=2");
    expect(feed.items.some((entry) => entry.type === "comment_updated")).toBe(
      false,
    );
    expect(feed.nextCursor).not.toBeNull();
    const page2 = await cardFeed(cardId, `?limit=2&cursor=${feed.nextCursor}`);
    const all = [...feed.items, ...page2.items];
    expect(all.some((entry) => entry.type === "comment_updated")).toBe(false);
    const added = all.find((entry) => entry.type === "comment_added");
    const deleted = all.find((entry) => entry.type === "comment_deleted");
    expect(added).toBeDefined();
    expect(deleted).toBeDefined();
    // Tombstones carry metadata only: no text and no raw details.
    expect(added?.changes).toBeUndefined();
    expect(deleted?.changes).toBeUndefined();
    expect(added?.details).toBeUndefined();
    expect(deleted?.details).toBeUndefined();
    expect(JSON.stringify(all)).not.toContain("Secret");
  });

  it("publishes typed comment_updated frames without text or details", async () => {
    const { boardId, cardId } = await boardWithCard("SSE text", "st");
    const stream = subscribe(boardId);
    try {
      const created = await createComment(cardId, "Original");
      const edited = await editComment(created.id, { text: "Edited" }).expect(
        200,
      );
      const revision = await prisma.commentRevision.findFirstOrThrow({
        where: { commentId: created.id },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const frame = stream.events.find(
        (event) =>
          event.type === "activity" &&
          event.kind === "comment_updated" &&
          event.commentId === created.id,
      );
      expect(frame).toMatchObject({
        type: "activity",
        boardId,
        cardId,
        actorId: author.id,
        kind: "comment_updated",
        commentId: created.id,
        revisionId: revision.id,
        detail: created.id,
      });
      expect(JSON.stringify(frame)).not.toContain("Edited");
      expect(frame).not.toHaveProperty("details");

      const kindOnly = await editComment(created.id, {
        kind: "question",
      }).expect(200);
      expect(kindOnly.body.editedAt).toBe(edited.body.editedAt);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const kindFrame = stream.events.find(
        (event) =>
          event.type === "activity" &&
          event.kind === "comment_updated" &&
          event.commentId === created.id &&
          !("revisionId" in event),
      );
      expect(kindFrame).toMatchObject({
        kind: "comment_updated",
        commentId: created.id,
        detail: created.id,
      });
      expect(kindFrame).not.toHaveProperty("revisionId");
      expect(JSON.stringify(kindFrame)).not.toContain("question");
    } finally {
      stream.close();
    }
  });

  it("publishes one author deletion and keeps the duplicate quiet", async () => {
    const { boardId, cardId } = await boardWithCard("SSE delete", "sd");
    const created = await createComment(cardId, "Delete me");
    const stream = subscribe(boardId);
    try {
      await server()
        .delete(`/api/v1/comments/${created.id}`)
        .set(auth(author.token))
        .expect(200);
      await server()
        .delete(`/api/v1/comments/${created.id}`)
        .set(auth(author.token))
        .expect(404);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const deletes = stream.events.filter(
        (event) =>
          event.type === "activity" && event.kind === "comment_deleted",
      );
      expect(deletes).toHaveLength(1);
      expect(deletes[0]).toMatchObject({
        commentId: created.id,
        detail: created.id,
        actorId: author.id,
      });
      expect(deletes[0]).not.toHaveProperty("details");
      expect(JSON.stringify(deletes[0])).not.toContain("Delete me");
    } finally {
      stream.close();
    }
  });

  it("publishes master moderation/bulk deletes without actor or attribution", async () => {
    const { boardId, cardId } = await boardWithCard("Master delete", "md");
    const moderated = await createComment(cardId, "Moderated");
    const bulk = await createComment(cardId, "Bulk deleted");
    const stream = subscribe(boardId);
    try {
      await adminService.deleteComment(moderated.id, principal);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const moderationFrame = stream.events.find(
        (event) =>
          event.type === "activity" &&
          event.kind === "comment_deleted" &&
          event.commentId === moderated.id,
      );
      expect(moderationFrame).toMatchObject({
        boardId,
        cardId,
        kind: "comment_deleted",
        commentId: moderated.id,
        detail: moderated.id,
      });
      expect(moderationFrame).not.toHaveProperty("actorId");
      expect(moderationFrame).not.toHaveProperty("actorType");
      expect(moderationFrame).not.toHaveProperty("apiTokenId");
      expect(moderationFrame).not.toHaveProperty("agentSessionId");
      expect(moderationFrame).not.toHaveProperty("agentName");
      expect(JSON.stringify(moderationFrame)).not.toContain("Moderated");

      // A duplicate moderation delete keeps the 200 contract but publishes
      // nothing.
      await adminService.deleteComment(moderated.id, principal);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        stream.events.filter(
          (event) =>
            event.type === "activity" &&
            event.kind === "comment_deleted" &&
            event.commentId === moderated.id,
        ),
      ).toHaveLength(1);

      const result = await adminService.bulkEntity(
        "comments",
        [bulk.id],
        "delete",
        principal,
      );
      expect(result).toEqual({ affected: 1 });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const bulkFrame = stream.events.find(
        (event) =>
          event.type === "activity" &&
          event.kind === "comment_deleted" &&
          event.commentId === bulk.id,
      );
      expect(bulkFrame).toMatchObject({
        commentId: bulk.id,
        detail: bulk.id,
      });
      expect(bulkFrame).not.toHaveProperty("actorId");
      expect(bulkFrame).not.toHaveProperty("actorType");
      // A duplicate bulk delete is a silent no-op.
      await adminService.bulkEntity("comments", [bulk.id], "delete", principal);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        stream.events.filter(
          (event) =>
            event.type === "activity" &&
            event.kind === "comment_deleted" &&
            event.commentId === bulk.id,
        ),
      ).toHaveLength(1);

      // The master frame is not an Activity tombstone: no feed row with the
      // master id was written.
      expect(
        await prisma.activity.count({
          where: { type: "comment_deleted", commentId: moderated.id },
        }),
      ).toBe(0);
    } finally {
      stream.close();
    }
  });
});
