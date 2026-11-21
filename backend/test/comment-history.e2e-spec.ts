import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { BoardAction } from "@janosik/shared";

import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { AccountDeletionService } from "@/users/account-deletion.service";
import { AdminService } from "@/admin/admin.service";
import { MaintenanceService } from "@/ops/maintenance.service";
import { writeCommentUpdate } from "@/comments/comment-history";

const ADMIN_EMAIL = "history-admin@example.com";
const AUTHOR_EMAIL = "history-author@example.com";
const ERASER_EMAIL = "history-eraser@example.com";
const DOOMED_EMAIL = "history-doomed@example.com";
const RACE_WRITER_EMAIL = "history-race-writer@example.com";
const RACE_TRIM_EMAIL = "history-race-trim@example.com";
const PASSWORD = "correct horse battery";

const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050201009a61d11b0000000049454e44ae426082",
  "hex",
);

/**
 * TASK-185.1 — comment history foundation.
 *
 * Covers the cutover fence, the common text writer used by PATCH and the
 * attachment scrub, reconciliation (including the no-op path), the 50-row
 * trim, purge cleanup and GDPR erase. The read APIs and UI arrive in later
 * 185.x subtasks and are intentionally absent here.
 */
describe("Comment history foundation (TASK-185.1, e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let realtime: RealtimeService;
  let maintenance: MaintenanceService;
  let adminService: AdminService;
  let accountDeletion: AccountDeletionService;

  let admin: { token: string; id: string };
  let author: { token: string; id: string };
  let eraser: { token: string; id: string };
  let doomed: { token: string; id: string };
  let raceWriter: { token: string; id: string };
  let raceTrim: { token: string; id: string };

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
    maintenance = app.get(MaintenanceService);
    adminService = app.get(AdminService);
    accountDeletion = app.get(AccountDeletionService);
    await wipe();
    admin = await register(ADMIN_EMAIL, "Admin");
    author = await register(AUTHOR_EMAIL, "Author");
    eraser = await register(ERASER_EMAIL, "Eraser");
    doomed = await register(DOOMED_EMAIL, "Doomed");
    // Dedicated editors for the erase-race tests: created directly so the
    // suite stays under the registration rate limit (no login is needed).
    raceWriter = {
      token: "",
      id: (
        await prisma.user.create({
          data: { email: RACE_WRITER_EMAIL, displayName: "Race Writer" },
        })
      ).id,
    };
    raceTrim = {
      token: "",
      id: (
        await prisma.user.create({
          data: { email: RACE_TRIM_EMAIL, displayName: "Race Trim" },
        })
      ).id,
    };
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

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

  async function invite(
    boardId: string,
    ownerToken: string,
    guest: { token: string; id: string },
    email: string,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerToken))
      .send({ email, role: "MEMBER" })
      .expect(201);
    const invitations = await server()
      .get("/api/v1/invitations")
      .set(auth(guest.token))
      .expect(200);
    const pending = invitations.body.find(
      (row: { boardId: string }) => row.boardId === boardId,
    );
    await server()
      .post(`/api/v1/invitations/${pending.id as string}/accept`)
      .set(auth(guest.token))
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
    token: string,
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
    owner: { token: string } = admin,
  ): Promise<{ boardId: string; cardId: string }> {
    const board = await server()
      .post("/api/v1/boards")
      .set(auth(owner.token))
      .send({ title })
      .expect(201);
    const boardId = board.body.id as string;
    await apply(
      boardId,
      scoped(boardId, {
        type: "ADD_COLUMN",
        newColumnId: `col-${prefix}`,
        title: "Todo",
      }),
      owner.token,
    );
    await apply(
      boardId,
      scoped(boardId, {
        type: "ADD_CARD",
        newCardId: `card-${prefix}`,
        columnId: `col-${prefix}`,
        title: "Card",
      }),
      owner.token,
    );
    return { boardId, cardId: `card-${prefix}` };
  }

  async function createComment(
    cardId: string,
    token: string,
    text: string,
  ): Promise<{ id: string }> {
    const res = await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(token))
      .send({ text })
      .expect(201);
    return { id: res.body.id as string };
  }

  function editComment(
    commentId: string,
    token: string,
    body: { text?: string; kind?: string },
  ) {
    return server()
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(token))
      .send(body);
  }

  async function uploadAttachment(
    cardId: string,
    token: string,
    name = "history.png",
    headers: Record<string, string> = {},
  ): Promise<string> {
    const res = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(token))
      .set(headers)
      .attach("file", png, { filename: name, contentType: "image/png" })
      .expect(201);
    return res.body.id as string;
  }

  async function createPat(
    name: string,
    scopePreset: "worker" | "admin" = "worker",
  ): Promise<{ token: string; id: string }> {
    const res = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(admin.token))
      .send({ name, expiresAt: null, scopePreset, trustedCi: false })
      .expect(201);
    return {
      token: res.body.token as string,
      id: (res.body.apiToken as { id: string }).id,
    };
  }

  async function startAgent(
    token: string,
    boardId: string,
    name: string,
  ): Promise<string> {
    const res = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions`)
      .set(auth(token))
      .send({ name })
      .expect(201);
    return res.body.id as string;
  }

  const agentHeader = (
    token: string,
    sessionId: string,
  ): Record<string, string> => ({
    ...auth(token),
    "X-Agent-Session": sessionId,
  });

  const lockBoard = (
    tx: Pick<Prisma.TransactionClient, "$executeRaw">,
    boardId: string,
  ) =>
    tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${boardId}, 0))`;

  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  /** A valid revision chain without going through the HTTP writer. */
  async function seedForeignRevision(
    cardId: string,
    editorId: string,
    text = "Foreign text",
  ): Promise<string> {
    const comment = await prisma.comment.create({
      data: { cardId, authorId: author.id, text },
    });
    const editedAt = new Date(Date.now() + 1_000);
    await prisma.comment.update({
      where: { id: comment.id },
      data: {
        editedAt,
        historyVerifiedEditedAt: editedAt,
        historyVerifiedRevisionNumber: 1,
        lastRevisionNumber: 1,
      },
    });
    await prisma.commentRevision.create({
      data: {
        commentId: comment.id,
        revisionNumber: 1,
        beforeText: "Original",
        afterText: text,
        createdAt: editedAt,
        editorId,
        cause: "author_edit",
      },
    });
    return comment.id;
  }

  const commentUpdates = (commentId: string) =>
    prisma.activity.findMany({
      where: {
        type: "comment_updated",
        details: { path: ["commentId"], equals: commentId },
      },
      orderBy: { createdAt: "asc" },
    });

  it("writes revision #1 with one verified timestamp, then ignores no-ops", async () => {
    const { boardId, cardId } = await boardWithCard("History writer", "hw");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const created = await createComment(cardId, author.token, "Original");
    const events: unknown[] = [];
    const subscription = realtime
      .watch(boardId)
      .subscribe((event) => events.push(event));
    try {
      const first = await editComment(created.id, author.token, {
        text: "First edit",
      }).expect(200);
      const firstEditedAt = first.body.editedAt as number;

      const row = await prisma.comment.findUniqueOrThrow({
        where: { id: created.id },
      });
      const revisions = await prisma.commentRevision.findMany({
        where: { commentId: created.id },
        orderBy: { revisionNumber: "asc" },
      });
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({
        revisionNumber: 1,
        beforeText: "Original",
        afterText: "First edit",
        editorId: author.id,
        actorType: "human",
        cause: "author_edit",
      });
      expect(row.lastRevisionNumber).toBe(1);
      expect(row.historyVerifiedRevisionNumber).toBe(1);
      expect(row.editedAt?.getTime()).toBe(firstEditedAt);
      expect(row.historyVerifiedEditedAt?.getTime()).toBe(firstEditedAt);
      expect(row.historyCutoverAt.getTime()).toBeLessThan(firstEditedAt);
      expect(row.historyIncompleteReason).toBeNull();
      expect(revisions[0]!.createdAt.getTime()).toBe(firstEditedAt);
      expect(revisions[0]!.createdAt.getTime()).toBeGreaterThan(
        row.historyCutoverAt.getTime(),
      );

      const activities = await commentUpdates(created.id);
      expect(activities).toHaveLength(1);
      expect(activities[0]!.details).toMatchObject({
        commentId: created.id,
        revisionId: revisions[0]!.id,
        beforeText: "Original",
        afterText: "First edit",
        cause: "author_edit",
        text: "First edit",
      });

      // A repeated (and whitespace-normalised) PATCH is a text no-op: no
      // revision, no editedAt move, no second text event.
      await editComment(created.id, author.token, {
        text: "  First edit  ",
      }).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const afterNoop = await prisma.comment.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(afterNoop.editedAt?.getTime()).toBe(firstEditedAt);
      expect(
        await prisma.commentRevision.count({
          where: { commentId: created.id },
        }),
      ).toBe(1);
      expect(await commentUpdates(created.id)).toHaveLength(1);
      expect(
        events.filter(
          (event) => (event as { kind?: string }).kind === "comment_updated",
        ),
      ).toHaveLength(1);

      // Kind-only: the kind moves, the text revision chain does not.
      const kindOnly = await editComment(created.id, author.token, {
        kind: "question",
      }).expect(200);
      expect(kindOnly.body.editedAt).toBe(firstEditedAt);
      const afterKind = await commentUpdates(created.id);
      expect(afterKind).toHaveLength(2);
      expect(afterKind[1]!.details).toEqual({
        commentId: created.id,
        beforeKind: "note",
        afterKind: "question",
      });
      expect(
        await prisma.commentRevision.count({
          where: { commentId: created.id },
        }),
      ).toBe(1);

      const second = await editComment(created.id, author.token, {
        text: "Second edit",
      }).expect(200);
      const chain = await prisma.commentRevision.findMany({
        where: { commentId: created.id },
        orderBy: { revisionNumber: "asc" },
      });
      expect(chain.map((revision) => revision.revisionNumber)).toEqual([1, 2]);
      expect(chain[1]!.createdAt.getTime()).toBeGreaterThan(
        chain[0]!.createdAt.getTime(),
      );
      const afterSecond = await prisma.comment.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(afterSecond.editedAt?.getTime()).toBe(second.body.editedAt);
      expect(afterSecond.lastRevisionNumber).toBe(2);
      expect(afterSecond.historyVerifiedRevisionNumber).toBe(2);
      expect(afterSecond.historyVerifiedEditedAt?.getTime()).toBe(
        chain[1]!.createdAt.getTime(),
      );
    } finally {
      subscription.unsubscribe();
    }
  });

  it("serialises concurrent identical edits into one revision", async () => {
    const { boardId, cardId } = await boardWithCard("History race", "hr");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const created = await createComment(cardId, author.token, "Start");

    const [one, two] = await Promise.all([
      editComment(created.id, author.token, { text: "Same text" }),
      editComment(created.id, author.token, { text: "Same text" }),
    ]);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    const revisions = await prisma.commentRevision.findMany({
      where: { commentId: created.id },
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      revisionNumber: 1,
      beforeText: "Start",
      afterText: "Same text",
    });
    expect(await commentUpdates(created.id)).toHaveLength(1);
  });

  it("fences the revision timestamp strictly after cutover", async () => {
    const { boardId, cardId } = await boardWithCard("History fence", "hf");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const created = await createComment(cardId, author.token, "Fence start");
    const cutover = new Date(Date.now() + 2_000);
    await prisma.comment.update({
      where: { id: created.id },
      data: { historyCutoverAt: cutover },
    });

    const edited = await editComment(created.id, author.token, {
      text: "Fence edit",
    }).expect(200);
    const revision = await prisma.commentRevision.findFirstOrThrow({
      where: { commentId: created.id },
    });
    expect((edited.body.editedAt as number) > cutover.getTime()).toBe(true);
    expect(revision.createdAt.getTime()).toBe(edited.body.editedAt as number);
  });

  it("detects an old writer after revision #1, including the no-op path", async () => {
    const { boardId, cardId } = await boardWithCard("History gap", "hg");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);

    // Changed editedAt.
    const changed = await createComment(cardId, author.token, "Clean");
    await editComment(changed.id, author.token, {
      text: "Revision one",
    }).expect(200);
    const events: unknown[] = [];
    const subscription = realtime
      .watch(boardId)
      .subscribe((event) => events.push(event));
    try {
      await prisma.comment.update({
        where: { id: changed.id },
        data: {
          text: "Old writer text",
          editedAt: new Date(Date.now() + 5_000),
        },
      });
      const rejected = await editComment(changed.id, author.token, {
        text: "Attempted edit",
      }).expect(409);
      expect(rejected.body.code).toBe("comment_history_gap");
      const row = await prisma.comment.findUniqueOrThrow({
        where: { id: changed.id },
      });
      expect(row.text).toBe("Old writer text");
      expect(row.historyIncompleteReason).toBe("writer_gap");
      expect(
        await prisma.commentRevision.count({
          where: { commentId: changed.id },
        }),
      ).toBe(1);
      expect(await commentUpdates(changed.id)).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(
        events.filter(
          (event) => (event as { kind?: string }).kind === "comment_updated",
        ),
      ).toHaveLength(0);
    } finally {
      subscription.unsubscribe();
    }

    // Same editedAt, changed text: a no-op PATCH still has to reconcile.
    const noop = await createComment(cardId, author.token, "Noop clean");
    await editComment(noop.id, author.token, { text: "Noop revision" }).expect(
      200,
    );
    await prisma.comment.update({
      where: { id: noop.id },
      data: { text: "Old writer, no timestamp" },
    });
    await editComment(noop.id, author.token, {
      text: "Old writer, no timestamp",
    }).expect(409);
    const noopRow = await prisma.comment.findUniqueOrThrow({
      where: { id: noop.id },
    });
    expect(noopRow.historyIncompleteReason).toBe("writer_gap");
    expect(
      await prisma.commentRevision.count({ where: { commentId: noop.id } }),
    ).toBe(1);

    // Old writer after backfill, before revision #1.
    const beforeFirst = await createComment(cardId, author.token, "Backfilled");
    await prisma.comment.update({
      where: { id: beforeFirst.id },
      data: {
        text: "Old writer before first revision",
        editedAt: new Date(Date.now() + 5_000),
        historyVerifiedEditedAt: null,
        historyVerifiedRevisionNumber: null,
        lastRevisionNumber: 0,
      },
    });
    await editComment(beforeFirst.id, author.token, {
      text: "Nope",
    }).expect(409);
    expect(
      await prisma.commentRevision.count({
        where: { commentId: beforeFirst.id },
      }),
    ).toBe(0);
  });

  it("keeps legacy_cutover after the first real edit creates revision #1", async () => {
    const { boardId, cardId } = await boardWithCard("History legacy", "hl");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const created = await createComment(cardId, author.token, "Legacy text");
    const row = await prisma.comment.findUniqueOrThrow({
      where: { id: created.id },
    });
    const legacyEditedAt = new Date(row.createdAt.getTime() + 1_000);
    await prisma.comment.update({
      where: { id: created.id },
      data: {
        editedAt: legacyEditedAt,
        historyVerifiedEditedAt: legacyEditedAt,
        historyVerifiedRevisionNumber: null,
        lastRevisionNumber: 0,
        historyIncompleteReason: "legacy_cutover",
      },
    });

    await editComment(created.id, author.token, {
      text: "Post-cutover edit",
    }).expect(200);
    const after = await prisma.comment.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(after.lastRevisionNumber).toBe(1);
    expect(after.historyVerifiedRevisionNumber).toBe(1);
    expect(after.historyIncompleteReason).toBe("legacy_cutover");
    const revision = await prisma.commentRevision.findFirstOrThrow({
      where: { commentId: created.id },
    });
    expect(revision.revisionNumber).toBe(1);
    expect(revision.beforeText).toBe("Legacy text");
    expect(revision.createdAt.getTime()).toBeGreaterThan(
      after.historyCutoverAt.getTime(),
    );
  });

  it("trims to 50 revisions and removes the trimmed revision's Activity", async () => {
    const { boardId, cardId } = await boardWithCard("History trim", "ht");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const created = await createComment(cardId, author.token, "v0");
    // A legacy marker survives ordinary edits and is later outranked by the
    // trim's revision_limit marker.
    await prisma.comment.update({
      where: { id: created.id },
      data: { historyIncompleteReason: "legacy_cutover" },
    });

    await editComment(created.id, author.token, { text: "v1" }).expect(200);
    const firstRevision = await prisma.commentRevision.findFirstOrThrow({
      where: { commentId: created.id, revisionNumber: 1 },
    });
    expect(
      (await commentUpdates(created.id)).map(
        (row) => (row.details as { revisionId?: string }).revisionId,
      ),
    ).toContain(firstRevision.id);

    for (let index = 2; index <= 51; index += 1) {
      await editComment(created.id, author.token, {
        text: `v${index}`,
      }).expect(200);
    }

    const revisions = await prisma.commentRevision.findMany({
      where: { commentId: created.id },
      orderBy: { revisionNumber: "asc" },
    });
    expect(revisions).toHaveLength(50);
    expect(revisions[0]!.revisionNumber).toBe(2);
    expect(revisions.at(-1)!.revisionNumber).toBe(51);
    expect(revisions[0]!.beforeText).toBe("v1");
    expect(revisions.at(-1)!.afterText).toBe("v51");

    const row = await prisma.comment.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.lastRevisionNumber).toBe(51);
    expect(row.historyVerifiedRevisionNumber).toBe(51);
    expect(row.historyIncompleteReason).toBe("revision_limit");
    const updates = await commentUpdates(created.id);
    expect(updates).toHaveLength(50);
    expect(
      updates.some(
        (activity) =>
          (activity.details as { revisionId?: string }).revisionId ===
          firstRevision.id,
      ),
    ).toBe(false);
    expect(row.editedAt?.getTime()).toBe(revisions.at(-1)!.createdAt.getTime());

    await editComment(created.id, author.token, { text: "v52" }).expect(200);
    const next = await prisma.commentRevision.findMany({
      where: { commentId: created.id },
      orderBy: { revisionNumber: "asc" },
      select: { revisionNumber: true },
    });
    expect(next.map((revision) => revision.revisionNumber)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 3),
    );
  });

  it("scrubs a deleted attachment through the writer and aborts on a gap", async () => {
    const { boardId, cardId } = await boardWithCard("History scrub", "hs");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const attachmentId = await uploadAttachment(cardId, admin.token);
    const url = `/api/v1/attachments/${attachmentId}/content`;
    const created = await createComment(
      cardId,
      author.token,
      `Before\n\n${url}\n\nAfter`,
    );

    await server()
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set(auth(admin.token))
      .expect(200);
    const comment = await prisma.comment.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(comment.text).toBe("Before\n\nAfter");
    const revision = await prisma.commentRevision.findFirstOrThrow({
      where: { commentId: created.id },
    });
    expect(revision).toMatchObject({
      revisionNumber: 1,
      editorId: admin.id,
      cause: "attachment_deleted",
    });
    expect(revision.beforeText).toContain(url);
    expect(revision.afterText).toBe("Before\n\nAfter");
    const activity = (await commentUpdates(created.id))[0]!;
    expect(activity.details).toMatchObject({
      commentId: created.id,
      revisionId: revision.id,
      cause: "attachment_deleted",
      afterText: "Before\n\nAfter",
      text: "Before\n\nAfter",
    });

    // Gap: the attachment deletion must not leave partial edits.
    const doomedAttachment = await uploadAttachment(
      cardId,
      admin.token,
      "gap.png",
    );
    const doomedUrl = `/api/v1/attachments/${doomedAttachment}/content`;
    const gapComment = await createComment(
      cardId,
      author.token,
      `Keep ${doomedUrl} intact`,
    );
    await prisma.comment.update({
      where: { id: gapComment.id },
      data: {
        text: `Old writer kept ${doomedUrl}`,
        editedAt: new Date(Date.now() + 5_000),
      },
    });
    const revisionsBefore = await prisma.commentRevision.count({
      where: { commentId: gapComment.id },
    });
    const updatesBefore = (await commentUpdates(gapComment.id)).length;

    const rejected = await server()
      .delete(`/api/v1/attachments/${doomedAttachment}`)
      .set(auth(admin.token))
      .expect(409);
    expect(rejected.body.code).toBe("comment_history_gap");

    const gapRow = await prisma.comment.findUniqueOrThrow({
      where: { id: gapComment.id },
    });
    expect(gapRow.text).toBe(`Old writer kept ${doomedUrl}`);
    expect(gapRow.historyIncompleteReason).toBe("writer_gap");
    expect(
      await prisma.commentRevision.count({
        where: { commentId: gapComment.id },
      }),
    ).toBe(revisionsBefore);
    expect(await commentUpdates(gapComment.id)).toHaveLength(updatesBefore);
    const attachmentRow = await prisma.attachment.findUniqueOrThrow({
      where: { id: doomedAttachment },
    });
    expect(attachmentRow.deletedAt).toBeNull();
    await server()
      .get(`/api/v1/attachments/${doomedAttachment}/content`)
      .set(auth(admin.token))
      .expect(200);
  });

  it("keeps edit → attachment delete → edit chains continuous", async () => {
    const { boardId, cardId } = await boardWithCard("History continuity", "hc");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);

    // Edit → attachment delete → edit.
    const firstAttachment = await uploadAttachment(
      cardId,
      author.token,
      "one.png",
    );
    const firstUrl = `/api/v1/attachments/${firstAttachment}/content`;
    const first = await createComment(
      cardId,
      author.token,
      `First ${firstUrl}`,
    );
    await editComment(first.id, author.token, {
      text: `First edited ${firstUrl}`,
    }).expect(200);
    await server()
      .delete(`/api/v1/attachments/${firstAttachment}`)
      .set(auth(author.token))
      .expect(200);
    await editComment(first.id, author.token, { text: "First final" }).expect(
      200,
    );

    const firstRevisions = await prisma.commentRevision.findMany({
      where: { commentId: first.id },
      orderBy: { revisionNumber: "asc" },
    });
    expect(firstRevisions.map((row) => row.revisionNumber)).toEqual([1, 2, 3]);
    expect(firstRevisions.map((row) => row.cause)).toEqual([
      "author_edit",
      "attachment_deleted",
      "author_edit",
    ]);
    expect(firstRevisions[0]!.afterText).toBe(firstRevisions[1]!.beforeText);
    expect(firstRevisions[1]!.afterText).toBe(firstRevisions[2]!.beforeText);
    expect(firstRevisions[2]!.afterText).toBe("First final");
    expect(firstRevisions[1]!.beforeText).toContain(firstUrl);

    // Attachment delete → edit (revision #1 starts the chain).
    const secondAttachment = await uploadAttachment(
      cardId,
      author.token,
      "two.png",
    );
    const secondUrl = `/api/v1/attachments/${secondAttachment}/content`;
    const second = await createComment(
      cardId,
      author.token,
      `Second ${secondUrl}`,
    );
    await server()
      .delete(`/api/v1/attachments/${secondAttachment}`)
      .set(auth(author.token))
      .expect(200);
    await editComment(second.id, author.token, { text: "Second final" }).expect(
      200,
    );
    const secondRevisions = await prisma.commentRevision.findMany({
      where: { commentId: second.id },
      orderBy: { revisionNumber: "asc" },
    });
    expect(secondRevisions.map((row) => row.revisionNumber)).toEqual([1, 2]);
    expect(secondRevisions.map((row) => row.cause)).toEqual([
      "attachment_deleted",
      "author_edit",
    ]);
    expect(secondRevisions[0]!.afterText).toBe(secondRevisions[1]!.beforeText);
    expect(secondRevisions[1]!.afterText).toBe("Second final");
  });

  it("attributes an agent attachment scrub and treats a repeated delete as a no-op", async () => {
    const { boardId, cardId } = await boardWithCard(
      "History agent scrub",
      "ha",
    );
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const agent = await createPat("History scrub agent");
    const sessionId = await startAgent(agent.token, boardId, "scrubber");
    const attachmentId = await uploadAttachment(
      cardId,
      agent.token,
      "agent.png",
      { "X-Agent-Session": sessionId },
    );
    const url = `/api/v1/attachments/${attachmentId}/content`;
    const comment = await createComment(cardId, author.token, `Agent ${url}`);

    await server()
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set(agentHeader(agent.token, sessionId))
      .expect(200);
    const revision = await prisma.commentRevision.findFirstOrThrow({
      where: { commentId: comment.id },
    });
    expect(revision).toMatchObject({
      revisionNumber: 1,
      editorId: admin.id,
      actorType: "agent",
      apiTokenId: agent.id,
      agentSessionId: sessionId,
      agentName: "History scrub agent",
      cause: "attachment_deleted",
    });
    const activity = (await commentUpdates(comment.id))[0]!;
    expect(activity).toMatchObject({
      actorId: admin.id,
      actorType: "agent",
      apiTokenId: agent.id,
      agentSessionId: sessionId,
      agentName: "History scrub agent",
    });

    const revisionsBefore = await prisma.commentRevision.count({
      where: { commentId: comment.id },
    });
    const updatesBefore = (await commentUpdates(comment.id)).length;
    // A non-uploader MEMBER is refused even though the row is already deleted;
    // the idempotent no-op is only after the uploader/admin check.
    await server()
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set(auth(author.token))
      .expect(403);
    await server()
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set(agentHeader(agent.token, sessionId))
      .expect(200);
    expect(
      await prisma.commentRevision.count({ where: { commentId: comment.id } }),
    ).toBe(revisionsBefore);
    expect(await commentUpdates(comment.id)).toHaveLength(updatesBefore);
  });

  it("releases a claimed approval when the attachment scrub hits a history gap", async () => {
    const { boardId, cardId } = await boardWithCard("History approval", "hap");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const agent = await createPat("History approval agent", "admin");
    const sessionId = await startAgent(agent.token, boardId, "approver");
    const attachmentId = await uploadAttachment(
      cardId,
      author.token,
      "approval.png",
    );
    const url = `/api/v1/attachments/${attachmentId}/content`;
    const comment = await createComment(cardId, author.token, `Keep ${url}`);
    await prisma.comment.update({
      where: { id: comment.id },
      data: {
        text: `Old writer kept ${url}`,
        editedAt: new Date(Date.now() + 5_000),
      },
    });

    const created = await server()
      .post(`/api/v1/boards/${boardId}/approvals`)
      .set(agentHeader(agent.token, sessionId))
      .send({
        kind: "destructive",
        ttlMinutes: 30,
        plan: {
          schemaVersion: 1,
          boardId,
          operations: [
            {
              op: "attachment.delete",
              target: { boardId, attachmentId },
              body: {},
            },
          ],
        },
      })
      .expect(201);
    const approvalId = created.body.id as string;
    const planHash = created.body.planHash as string;
    await server()
      .post(`/api/v1/boards/${boardId}/approvals/${approvalId}/decision`)
      .set(auth(admin.token))
      .send({ decision: "approve", planHash })
      .expect(200);

    const rejected = await server()
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set(agentHeader(agent.token, sessionId))
      .set("X-Approval-Id", approvalId)
      .expect(409);
    expect(rejected.body.code).toBe("comment_history_gap");
    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: approvalId },
        })
      ).status,
    ).toBe("approved");

    // Repair the verified point (the 185.2 sweep will automate this) and
    // reuse the same approval.
    const row = await prisma.comment.findUniqueOrThrow({
      where: { id: comment.id },
    });
    await prisma.comment.update({
      where: { id: comment.id },
      data: { historyVerifiedEditedAt: row.editedAt },
    });
    await server()
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set(agentHeader(agent.token, sessionId))
      .set("X-Approval-Id", approvalId)
      .expect(200);
    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: approvalId },
        })
      ).status,
    ).toBe("consumed");
    expect(
      await prisma.commentRevision.count({ where: { commentId: comment.id } }),
    ).toBe(1);
  });

  it("rolls back the revision when the write fails after the insert", async () => {
    const { boardId, cardId } = await boardWithCard("History rollback", "hrb");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const created = await createComment(cardId, author.token, "Rollback base");

    await expect(
      prisma.$transaction((tx) =>
        writeCommentUpdate(tx, {
          commentId: created.id,
          boardId,
          text: "Must not persist",
          editorId: author.id,
          attribution: {
            actorType: "human",
            apiTokenId: null,
            agentSessionId: null,
            runId: null,
            agentName: null,
          },
          cause: "author_edit",
          reconcileMedia: async () => {
            throw new Error("rollback probe");
          },
        }),
      ),
    ).rejects.toThrow("rollback probe");
    const row = await prisma.comment.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.text).toBe("Rollback base");
    expect(row.editedAt).toBeNull();
    expect(row.lastRevisionNumber).toBe(0);
    expect(row.historyVerifiedRevisionNumber).toBeNull();
    expect(
      await prisma.commentRevision.count({ where: { commentId: created.id } }),
    ).toBe(0);
    expect(await commentUpdates(created.id)).toHaveLength(0);
  });

  it("serialises PATCH and delete and re-reads the tombstone text under the lock", async () => {
    const { boardId, cardId } = await boardWithCard(
      "History delete race",
      "hdr",
    );
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);

    const race = await createComment(cardId, author.token, "Race start");
    const [editResponse, deleteResponse] = await Promise.all([
      editComment(race.id, author.token, { text: "Race edited" }),
      server().delete(`/api/v1/comments/${race.id}`).set(auth(author.token)),
    ]);
    expect(deleteResponse.status).toBe(200);
    expect([200, 404]).toContain(editResponse.status);
    const raceRow = await prisma.comment.findUniqueOrThrow({
      where: { id: race.id },
    });
    expect(raceRow.deletedAt).not.toBeNull();
    const raceRevisions = await prisma.commentRevision.count({
      where: { commentId: race.id },
    });
    if (editResponse.status === 200) {
      expect(raceRevisions).toBe(1);
      expect(raceRow.text).toBe("Race edited");
    } else {
      expect(raceRevisions).toBe(0);
      expect(raceRow.text).toBe("Race start");
    }

    // The tombstone snapshot must use the edited body, not the pre-lock read.
    const edited = await createComment(cardId, author.token, "Before edit");
    await editComment(edited.id, author.token, { text: "After edit" }).expect(
      200,
    );
    await server()
      .delete(`/api/v1/comments/${edited.id}`)
      .set(auth(author.token))
      .expect(200);
    const tombstone = await prisma.activity.findFirstOrThrow({
      where: {
        type: "comment_deleted",
        details: { path: ["commentId"], equals: edited.id },
      },
    });
    expect(tombstone.details).toMatchObject({ text: "After edit" });
    await server()
      .delete(`/api/v1/comments/${edited.id}`)
      .set(auth(author.token))
      .expect(404);
  });

  it("serialises GDPR erase with a board writer and a concurrent trim", async () => {
    const { boardId, cardId } = await boardWithCard(
      "History erase race",
      "her",
    );

    // Erase waits for a valid writer that appends revision #2 first. The new
    // revision's editorId is the erased user: the FK takes KEY SHARE on the
    // User row while the erase holds FOR NO KEY UPDATE.
    await prisma.boardMember.create({
      data: {
        boardId,
        userId: raceWriter.id,
        role: "MEMBER",
        acceptedAt: new Date(),
      },
    });
    const written = await seedForeignRevision(
      cardId,
      raceWriter.id,
      "Race before writer",
    );
    const writerHeld = deferred();
    const writerRelease = deferred();
    const writer = prisma.$transaction(async (tx) => {
      await lockBoard(tx, boardId);
      writerHeld.resolve();
      await writerRelease.promise;
      const at = new Date(Date.now() + 5_000);
      await tx.comment.update({
        where: { id: written },
        data: {
          text: "Race writer text",
          editedAt: at,
          historyVerifiedEditedAt: at,
          historyVerifiedRevisionNumber: 2,
          lastRevisionNumber: 2,
        },
      });
      await tx.commentRevision.create({
        data: {
          commentId: written,
          revisionNumber: 2,
          beforeText: "Race before writer",
          afterText: "Race writer text",
          createdAt: at,
          editorId: raceWriter.id,
          cause: "author_edit",
        },
      });
    });
    await writerHeld.promise;
    const writerErase = accountDeletion.deleteAccount(raceWriter.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    writerRelease.resolve();
    await Promise.all([writer, writerErase]);

    const writtenRow = await prisma.comment.findUniqueOrThrow({
      where: { id: written },
    });
    expect(writtenRow.text).toBe("Race writer text");
    expect(writtenRow.historyIncompleteReason).toBe("gdpr_erase");
    expect(writtenRow.historyVerifiedRevisionNumber).toBeNull();
    expect(writtenRow.lastRevisionNumber).toBe(2);
    expect(
      await prisma.commentRevision.count({ where: { commentId: written } }),
    ).toBe(0);

    // A trim that commits while erase waits must not downgrade gdpr_erase.
    const trimmed = await seedForeignRevision(
      cardId,
      raceTrim.id,
      "Race before trim",
    );
    const trimHeld = deferred();
    const trimRelease = deferred();
    const trim = prisma.$transaction(async (tx) => {
      await lockBoard(tx, boardId);
      trimHeld.resolve();
      await trimRelease.promise;
      await tx.comment.update({
        where: { id: trimmed },
        data: { historyIncompleteReason: "revision_limit" },
      });
    });
    await trimHeld.promise;
    const trimErase = accountDeletion.deleteAccount(raceTrim.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    trimRelease.resolve();
    await Promise.all([trim, trimErase]);

    const trimmedRow = await prisma.comment.findUniqueOrThrow({
      where: { id: trimmed },
    });
    expect(trimmedRow.historyIncompleteReason).toBe("gdpr_erase");
    expect(trimmedRow.historyVerifiedRevisionNumber).toBeNull();
    expect(
      await prisma.commentRevision.count({ where: { commentId: trimmed } }),
    ).toBe(0);
  });

  it("does not purge a comment restored while the purge waits for the board lock", async () => {
    const { boardId, cardId } = await boardWithCard(
      "History restore race",
      "hrp",
    );
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const comment = await createComment(cardId, author.token, "Restore me");
    await editComment(comment.id, author.token, {
      text: "Restore me edited",
    }).expect(200);
    await server()
      .delete(`/api/v1/comments/${comment.id}`)
      .set(auth(author.token))
      .expect(200);
    await prisma.comment.update({
      where: { id: comment.id },
      data: { deletedAt: new Date(Date.now() - 45 * 86_400_000) },
    });

    const held = deferred();
    const release = deferred();
    const restore = prisma.$transaction(async (tx) => {
      await lockBoard(tx, boardId);
      held.resolve();
      await release.promise;
      await tx.comment.update({
        where: { id: comment.id },
        data: { deletedAt: null },
      });
    });
    await held.promise;
    const purge = maintenance.purgeSoftDeleted();
    await new Promise((resolve) => setTimeout(resolve, 50));
    release.resolve();
    await Promise.all([restore, purge]);

    const row = await prisma.comment.findUnique({
      where: { id: comment.id },
    });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).toBeNull();
    expect(
      await prisma.commentRevision.count({ where: { commentId: comment.id } }),
    ).toBe(1);
  });

  it("does not purge a board restored while the purge waits for the board lock", async () => {
    const { boardId, cardId } = await boardWithCard(
      "History board restore",
      "hbr",
    );
    const comment = await createComment(cardId, admin.token, "Board comment");
    await editComment(comment.id, admin.token, {
      text: "Board comment edited",
    }).expect(200);
    await prisma.board.update({
      where: { id: boardId },
      data: { deletedAt: new Date(Date.now() - 45 * 86_400_000) },
    });

    const held = deferred();
    const release = deferred();
    const staleAt = new Date(Date.now() - 45 * 86_400_000);
    const restore = prisma.$transaction(async (tx) => {
      await lockBoard(tx, boardId);
      held.resolve();
      await release.promise;
      // Restore the board while its cards/comments are (or become) stale.
      await tx.board.update({
        where: { id: boardId },
        data: { deletedAt: null },
      });
      await tx.card.update({
        where: { id: cardId },
        data: { deletedAt: staleAt },
      });
      await tx.comment.update({
        where: { id: comment.id },
        data: { deletedAt: staleAt },
      });
    });
    await held.promise;
    const purge = maintenance.purgeSoftDeleted();
    await new Promise((resolve) => setTimeout(resolve, 50));
    release.resolve();
    await Promise.all([restore, purge]);

    expect(
      await prisma.board.findUnique({ where: { id: boardId } }),
    ).not.toBeNull();
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    expect(card?.deletedAt).not.toBeNull();
    const commentRow = await prisma.comment.findUnique({
      where: { id: comment.id },
    });
    expect(commentRow?.deletedAt).not.toBeNull();
    expect(
      await prisma.boardMember.count({ where: { boardId } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.commentRevision.count({ where: { commentId: comment.id } }),
    ).toBe(1);
  });

  it("hard purge removes revisions and comment Activity (comment and card paths)", async () => {
    const { boardId, cardId } = await boardWithCard("History purge", "hp");
    await invite(boardId, admin.token, author, AUTHOR_EMAIL);
    const comment = await createComment(cardId, author.token, "Purge me");
    await editComment(comment.id, author.token, { text: "Purged text" }).expect(
      200,
    );
    await server()
      .delete(`/api/v1/comments/${comment.id}`)
      .set(auth(author.token))
      .expect(200);
    await prisma.comment.update({
      where: { id: comment.id },
      data: { deletedAt: new Date(Date.now() - 45 * 86_400_000) },
    });

    // Card path: the comment itself is live, only its parent is stale.
    const card = await boardWithCard("History purge card", "hpc");
    await invite(card.boardId, admin.token, author, AUTHOR_EMAIL);
    const cardComment = await createComment(
      card.cardId,
      author.token,
      "Card purge",
    );
    await editComment(cardComment.id, author.token, {
      text: "Card purge edited",
    }).expect(200);
    await prisma.card.update({
      where: { id: card.cardId },
      data: { deletedAt: new Date(Date.now() - 45 * 86_400_000) },
    });

    await maintenance.purgeSoftDeleted();

    expect(
      await prisma.comment.findUnique({ where: { id: comment.id } }),
    ).toBeNull();
    expect(
      await prisma.comment.findUnique({ where: { id: cardComment.id } }),
    ).toBeNull();
    expect(
      await prisma.commentRevision.count({
        where: { commentId: { in: [comment.id, cardComment.id] } },
      }),
    ).toBe(0);
    expect(
      await prisma.activity.count({
        where: {
          type: { in: ["comment_added", "comment_updated", "comment_deleted"] },
          OR: [
            { details: { path: ["commentId"], equals: comment.id } },
            { details: { path: ["commentId"], equals: cardComment.id } },
          ],
        },
      }),
    ).toBe(0);
  });

  it("GDPR erase clears the author's chain and history the user edited elsewhere", async () => {
    // Author's own chain disappears with the authored comment.
    const own = await boardWithCard("History gdpr own", "hgo");
    await invite(own.boardId, admin.token, doomed, DOOMED_EMAIL);
    const ownComment = await createComment(
      own.cardId,
      doomed.token,
      "Doomed original",
    );
    await editComment(ownComment.id, doomed.token, {
      text: "Doomed edited",
    }).expect(200);

    // Another author's comment edited by the erased user via an attachment
    // scrub: the revision must survive until erase, then vanish with the
    // related update Activity while the current text stays.
    const foreign = await boardWithCard("History gdpr foreign", "hgf", eraser);
    await invite(foreign.boardId, eraser.token, author, AUTHOR_EMAIL);
    const attachmentId = await uploadAttachment(
      foreign.cardId,
      eraser.token,
      "eraser.png",
    );
    const url = `/api/v1/attachments/${attachmentId}/content`;
    const foreignComment = await createComment(
      foreign.cardId,
      author.token,
      `Foreign ${url} text`,
    );
    await server()
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set(auth(eraser.token))
      .expect(200);
    const afterScrub = await prisma.comment.findUniqueOrThrow({
      where: { id: foreignComment.id },
    });
    const lastRevisionNumber = afterScrub.lastRevisionNumber;
    const verifiedEditedAt = afterScrub.historyVerifiedEditedAt?.getTime();
    expect(lastRevisionNumber).toBe(1);
    // Simulate a trim that happened before the erase: gdpr_erase must win.
    await prisma.comment.update({
      where: { id: foreignComment.id },
      data: { historyIncompleteReason: "revision_limit" },
    });

    // A second foreign chain is unverified: its number must stay for the
    // sweep after erase.
    const unverified = await seedForeignRevision(
      foreign.cardId,
      eraser.id,
      "Unverified chain",
    );
    await prisma.comment.update({
      where: { id: unverified },
      data: { text: "Unverified old writer" },
    });

    // Export boundary: comments carry their current projection, never the
    // revision snapshots or their ids.
    const bundle = await adminService.buildUserBundle(author.id);
    const exportedComments = bundle.data.comments as Array<
      Record<string, unknown>
    >;
    const exported = exportedComments.find(
      (row) => row.id === foreignComment.id,
    );
    expect(exported).toEqual({
      id: foreignComment.id,
      cardId: foreign.cardId,
      text: afterScrub.text,
      createdAt: afterScrub.createdAt.getTime(),
    });
    const serialized = JSON.stringify(bundle.data);
    expect(serialized).not.toContain("beforeText");
    expect(serialized).not.toContain("revisionId");

    expect(await accountDeletion.deleteAccount(eraser.id)).not.toBeNull();
    const foreignAfter = await prisma.comment.findUniqueOrThrow({
      where: { id: foreignComment.id },
    });
    expect(foreignAfter.text).toBe(afterScrub.text);
    expect(foreignAfter.lastRevisionNumber).toBe(lastRevisionNumber);
    expect(foreignAfter.historyVerifiedEditedAt?.getTime()).toBe(
      verifiedEditedAt,
    );
    expect(foreignAfter.historyVerifiedRevisionNumber).toBeNull();
    expect(foreignAfter.historyIncompleteReason).toBe("gdpr_erase");
    expect(
      await prisma.commentRevision.count({
        where: { commentId: foreignComment.id },
      }),
    ).toBe(0);
    expect(await commentUpdates(foreignComment.id)).toHaveLength(0);

    // The unverified chain keeps its number for the next sweep.
    const unverifiedAfter = await prisma.comment.findUniqueOrThrow({
      where: { id: unverified },
    });
    expect(unverifiedAfter.text).toBe("Unverified old writer");
    expect(unverifiedAfter.historyIncompleteReason).toBe("gdpr_erase");
    expect(unverifiedAfter.lastRevisionNumber).toBe(1);
    expect(unverifiedAfter.historyVerifiedRevisionNumber).toBe(1);
    expect(
      await prisma.commentRevision.count({ where: { commentId: unverified } }),
    ).toBe(0);

    // The next edit continues under a new monotonic number; the confirmed
    // chain means there is no false writer_gap.
    await editComment(foreignComment.id, author.token, {
      text: "After erasure",
    }).expect(200);
    const continued = await prisma.commentRevision.findFirstOrThrow({
      where: { commentId: foreignComment.id },
    });
    expect(continued.revisionNumber).toBe(lastRevisionNumber + 1);
    const continuedRow = await prisma.comment.findUniqueOrThrow({
      where: { id: foreignComment.id },
    });
    expect(continuedRow.historyIncompleteReason).toBe("gdpr_erase");
    expect(continuedRow.lastRevisionNumber).toBe(lastRevisionNumber + 1);
    expect(continuedRow.historyVerifiedRevisionNumber).toBe(
      lastRevisionNumber + 1,
    );
    expect(continuedRow.editedAt).not.toBeNull();

    expect(await accountDeletion.deleteAccount(doomed.id)).not.toBeNull();
    expect(
      await prisma.comment.findUnique({ where: { id: ownComment.id } }),
    ).toBeNull();
    expect(
      await prisma.commentRevision.count({
        where: { commentId: ownComment.id },
      }),
    ).toBe(0);
    expect(
      await prisma.activity.count({
        where: { details: { path: ["commentId"], equals: ownComment.id } },
      }),
    ).toBe(0);
  });

  async function wipe(): Promise<void> {
    await prisma.commentRevision.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.cardLink.deleteMany();
    await prisma.cardLabel.deleteMany();
    await prisma.checklistItem.deleteMany();
    await prisma.checklist.deleteMany();
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
});
