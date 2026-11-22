import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { BoardAction, CommentDto } from "@janosik/shared";

import { AppModule } from "@/app.module";
import { ADMIN_JWT_AUDIENCE, ADMIN_TOKEN_TYPE } from "@/admin/admin.types";
import { AdminService } from "@/admin/admin.service";
import { ExportsService } from "@/admin/exports.service";
import { USER_JWT_AUDIENCE } from "@/auth/auth.types";
import { securityStamp } from "@/auth/security-stamp";
import { env } from "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MaintenanceService } from "@/ops/maintenance.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "1856-owner@example.com";
const OTHER_EMAIL = "1856-other@example.com";
const MASTER_EMAIL = "1856-master@example.com";

// The acceptance pass compiles a large Nest module before the first hook;
// give the cold start headroom on a busy runner.
jest.setTimeout(60_000);

/**
 * TASK-185.6 — epic acceptance for comment edit history.
 *
 * This suite closes the cross-cutting Definition-of-Done gaps that the
 * per-subtask suites do not own: the reconciliation sweep, legacy reasons on
 * both revisions routes, delete → History/Watch/admin feeds → restore,
 * the 50-revision window on both APIs with an independent Activity sweep, the
 * GDPR bundle on both export paths, and the admin row fields on deleted rows.
 */
describe("Comment history acceptance (TASK-185.6, e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let maintenance: MaintenanceService;
  let adminService: AdminService;
  let exportsService: ExportsService;
  const jwt = new JwtService({ secret: env.JWT_SECRET });

  let owner: { token: string; id: string };
  let other: { token: string; id: string };
  let masterToken: string;

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
    maintenance = app.get(MaintenanceService);
    adminService = app.get(AdminService);
    exportsService = app.get(ExportsService);
    await wipeAll(prisma);

    owner = await createUser(OWNER_EMAIL, "Owner");
    // Fail before the suite with an auth error rather than a cascade of 401s
    // if the test token and the running strategy disagree.
    await server().get("/api/v1/auth/me").set(auth(owner.token)).expect(200);
    other = await createUser(OTHER_EMAIL, "Other");
    const master = await prisma.adminUser.create({
      data: {
        email: MASTER_EMAIL,
        displayName: "Master",
        role: "OWNER",
        passwordHash: "unused",
      },
    });
    masterToken = await jwt.signAsync(
      { sub: master.id, typ: ADMIN_TOKEN_TYPE },
      { audience: ADMIN_JWT_AUDIENCE },
    );
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  async function createUser(
    email: string,
    displayName: string,
  ): Promise<{ token: string; id: string }> {
    const user = await prisma.user.create({
      data: { email, displayName, emailVerifiedAt: new Date() },
    });
    const token = await jwt.signAsync(
      {
        sub: user.id,
        authMethod: "password",
        stamp: securityStamp(user),
        sid: randomUUID(),
      },
      { audience: USER_JWT_AUDIENCE },
    );
    return { token, id: user.id };
  }

  async function command(
    boardId: string,
    token: string,
    action: Record<string, unknown>,
  ): Promise<void> {
    const scoped = {
      boardId,
      at: Date.now(),
      ...action,
    } as BoardAction;
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({ commandId: randomUUID(), action: scoped })
      .expect(200);
  }

  /** Every acceptance case owns a board, so feed totals stay deterministic. */
  async function newBoard(prefix: string): Promise<{
    boardId: string;
    cardId: string;
    columnId: string;
  }> {
    const board = await server()
      .post("/api/v1/boards")
      .set(auth(owner.token))
      .send({ title: `History acceptance ${prefix}` });
    if (board.status !== 201) {
      throw new Error(`create board ${board.status}: ${board.text}`);
    }
    const boardId = board.body.id as string;
    const columnId = `col-${prefix}`;
    await command(boardId, owner.token, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    const cardId = `card-${prefix}`;
    await command(boardId, owner.token, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Acceptance",
    });
    await prisma.boardMember.create({
      data: {
        boardId,
        userId: other.id,
        role: "MEMBER",
        acceptedAt: new Date(),
      },
    });
    return { boardId, cardId, columnId };
  }

  async function createComment(
    cardId: string,
    text: string,
    token = owner.token,
  ): Promise<CommentDto> {
    return (
      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(token))
        .send({ text, kind: "note" })
        .expect(201)
    ).body as CommentDto;
  }

  function editComment(commentId: string, text: string, token = owner.token) {
    return server()
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(token))
      .send({ text });
  }

  function revisions(commentId: string, token = owner.token) {
    return server()
      .get(`/api/v1/comments/${commentId}/revisions?limit=100`)
      .set(auth(token));
  }

  function adminRevisions(commentId: string) {
    return server()
      .get(`/api/v1/admin/comments/${commentId}/revisions?limit=100`)
      .set(auth(masterToken));
  }

  async function cardFeed(
    cardId: string,
    query = "",
  ): Promise<{
    items: Array<{
      type: string;
      changes?: unknown;
      commentId?: string;
      actorId?: string;
    }>;
    nextCursor: string | null;
  }> {
    return (
      await server()
        .get(`/api/v1/cards/${cardId}/activity${query}`)
        .set(auth(owner.token))
        .expect(200)
    ).body;
  }

  async function boardFeed(
    boardId: string,
    query = "",
  ): Promise<{
    items: Array<{ type: string; changes?: unknown }>;
    nextCursor: string | null;
  }> {
    return (
      await server()
        .get(`/api/v1/boards/${boardId}/activity${query}`)
        .set(auth(owner.token))
        .expect(200)
    ).body;
  }

  it("reconciles an old writer, strips unconfirmed text and continues the chain", async () => {
    const { boardId, cardId } = await newBoard("sweep");
    const comment = await createComment(cardId, "Clean");
    await editComment(comment.id, "Revision one").expect(200);
    const revision = await prisma.commentRevision.findFirstOrThrow({
      where: { commentId: comment.id, revisionNumber: 1 },
    });
    const oldWriterAt = new Date(Date.now() + 5_000);
    await prisma.comment.update({
      where: { id: comment.id },
      data: { text: "Old writer text", editedAt: oldWriterAt },
    });

    // A second old-writer signature: a forged text snapshot with a legacy
    // `details.commentId` and no typed column, plus a legacy add link the
    // sweep must fill.
    const forged = await prisma.activity.create({
      data: {
        boardId,
        cardId,
        type: "comment_updated",
        actorId: owner.id,
        details: {
          commentId: comment.id,
          beforeText: "Unconfirmed before",
          afterText: "Unconfirmed after",
          text: "Unconfirmed after",
        },
      },
    });
    const legacyAdd = await prisma.activity.create({
      data: {
        boardId,
        cardId,
        type: "comment_added",
        actorId: owner.id,
        details: { commentId: comment.id, text: "Clean" },
      },
    });

    // Before the sweep both routes refuse the unverified chain.
    const before = await revisions(comment.id).expect(200);
    expect(before.body.items).toEqual([]);
    expect(before.body.historyIncompleteReason).toBe("writer_gap");
    const adminBefore = await adminRevisions(comment.id).expect(200);
    expect(adminBefore.body.items).toEqual([]);
    expect(adminBefore.body.historyIncompleteReason).toBe("writer_gap");

    const sweep = await maintenance.run("sweep-comment-history");
    expect(sweep).toEqual([{ job: "sweep-comment-history", removed: 1 }]);

    const adopted = await prisma.comment.findUniqueOrThrow({
      where: { id: comment.id },
    });
    expect(adopted.text).toBe("Old writer text");
    expect(adopted.historyIncompleteReason).toBe("writer_gap");
    expect(adopted.historyVerifiedEditedAt?.getTime()).toBe(
      oldWriterAt.getTime(),
    );
    expect(adopted.historyVerifiedRevisionNumber).toBeNull();
    expect(adopted.lastRevisionNumber).toBe(1);
    expect(
      await prisma.commentRevision.count({
        where: { commentId: comment.id },
      }),
    ).toBe(1);

    const forgedAfter = await prisma.activity.findUniqueOrThrow({
      where: { id: forged.id },
    });
    expect(forgedAfter.commentId).toBe(comment.id);
    expect(forgedAfter.details).toEqual({ commentId: comment.id });
    const filled = await prisma.activity.findUniqueOrThrow({
      where: { id: legacyAdd.id },
    });
    expect(filled.commentId).toBe(comment.id);

    // The confirmed revision is available again, with the persisted reason.
    const after = await revisions(comment.id).expect(200);
    expect(after.body.historyIncompleteReason).toBe("writer_gap");
    expect(after.body.items).toHaveLength(1);
    expect(after.body.items[0].id).toBe(revision.id);
    const adminAfter = await adminRevisions(comment.id).expect(200);
    expect(adminAfter.body.items).toHaveLength(1);

    // The next edit starts from the actual text under a fresh number.
    await editComment(comment.id, "Fresh chain").expect(200);
    const resumed = await prisma.comment.findUniqueOrThrow({
      where: { id: comment.id },
    });
    expect(resumed.lastRevisionNumber).toBe(2);
    expect(resumed.historyVerifiedRevisionNumber).toBe(2);
    expect(resumed.historyIncompleteReason).toBe("writer_gap");
    expect(
      await prisma.commentRevision.findFirstOrThrow({
        where: { commentId: comment.id, revisionNumber: 2 },
      }),
    ).toMatchObject({
      beforeText: "Old writer text",
      afterText: "Fresh chain",
    });

    // Idempotent second run.
    const again = await maintenance.run("sweep-comment-history");
    expect(again).toEqual([{ job: "sweep-comment-history", removed: 0 }]);

    // Soft-deleted rows are part of the sweep too: a restore must not bring
    // back an unreconciled chain.
    const removed = await createComment(cardId, "Deleted clean");
    await editComment(removed.id, "Deleted revision").expect(200);
    await server()
      .delete(`/api/v1/comments/${removed.id}`)
      .set(auth(owner.token))
      .expect(200);
    await prisma.comment.update({
      where: { id: removed.id },
      data: { text: "Deleted old writer", editedAt: new Date() },
    });
    expect(await maintenance.run("sweep-comment-history")).toEqual([
      { job: "sweep-comment-history", removed: 1 },
    ]);
    const deletedRow = await prisma.comment.findUniqueOrThrow({
      where: { id: removed.id },
    });
    expect(deletedRow.deletedAt).not.toBeNull();
    expect(deletedRow.historyIncompleteReason).toBe("writer_gap");
    expect(deletedRow.historyVerifiedRevisionNumber).toBeNull();
    expect(
      await prisma.commentRevision.count({
        where: { commentId: removed.id },
      }),
    ).toBe(1);
  });

  it("serves legacy_cutover on both routes before and after the first revision", async () => {
    const { cardId } = await newBoard("legacy");
    const comment = await createComment(cardId, "Legacy body");
    const legacyAt = new Date(Date.now() - 1_000);
    await prisma.comment.update({
      where: { id: comment.id },
      data: {
        text: "Legacy body",
        editedAt: legacyAt,
        historyVerifiedEditedAt: legacyAt,
        historyVerifiedRevisionNumber: null,
        historyIncompleteReason: "legacy_cutover",
      },
    });

    for (const response of [
      await revisions(comment.id).expect(200),
      await adminRevisions(comment.id).expect(200),
    ]) {
      expect(response.body.items).toEqual([]);
      expect(response.body.historyIncomplete).toBe(true);
      expect(response.body.historyIncompleteReason).toBe("legacy_cutover");
    }

    await editComment(comment.id, "After cutover").expect(200);
    const row = await prisma.comment.findUniqueOrThrow({
      where: { id: comment.id },
    });
    expect(row.lastRevisionNumber).toBe(1);
    expect(row.historyIncompleteReason).toBe("legacy_cutover");

    for (const response of [
      await revisions(comment.id).expect(200),
      await adminRevisions(comment.id).expect(200),
    ]) {
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({
        revisionNumber: 1,
        beforeText: "Legacy body",
        afterText: "After cutover",
      });
      expect(response.body.historyIncompleteReason).toBe("legacy_cutover");
    }
  });

  it("hides a deleted edit before paging and restores it with its diff and revision", async () => {
    const { boardId, cardId } = await newBoard("delete-feed");
    const firstComment = await createComment(cardId, "Before delete");
    await editComment(firstComment.id, "After edit").expect(200);
    const secondComment = await createComment(cardId, "Second before");
    await editComment(secondComment.id, "Second after").expect(200);
    for (const comment of [firstComment, secondComment]) {
      await server()
        .delete(`/api/v1/comments/${comment.id}`)
        .set(auth(owner.token))
        .expect(200);
    }

    // Two one-row pages: the edit is absent before the take, and the cursor
    // crosses the tombstone boundary without a hole.
    const deletedOne = await cardFeed(cardId, "?type=comment_deleted&limit=1");
    expect(deletedOne.items).toHaveLength(1);
    expect(deletedOne.items[0]).not.toHaveProperty("changes");
    expect(typeof deletedOne.nextCursor).toBe("string");
    const deletedTwo = await cardFeed(
      cardId,
      `?type=comment_deleted&limit=1&cursor=${encodeURIComponent(
        deletedOne.nextCursor as string,
      )}`,
    );
    expect(deletedTwo.items).toHaveLength(1);
    expect(deletedTwo.items[0]).not.toHaveProperty("changes");
    expect(deletedTwo.nextCursor).toBeNull();

    const addedOne = await cardFeed(cardId, "?type=comment_added&limit=1");
    expect(addedOne.items).toHaveLength(1);
    expect(addedOne.items[0]?.changes).toBeUndefined();
    expect(typeof addedOne.nextCursor).toBe("string");
    const addedTwo = await cardFeed(
      cardId,
      `?type=comment_added&limit=1&cursor=${encodeURIComponent(
        addedOne.nextCursor as string,
      )}`,
    );
    expect(addedTwo.items).toHaveLength(1);
    expect(addedTwo.nextCursor).toBeNull();
    expect(
      (await cardFeed(cardId, "?type=comment_updated")).items,
    ).toHaveLength(0);
    // The board/Watch feed uses the same visibility predicate.
    expect(
      (await boardFeed(boardId, "?type=comment_updated")).items,
    ).toHaveLength(0);

    const timeline = await server()
      .get(`/api/v1/admin/cards/${cardId}/detail?section=timeline&limit=50`)
      .set(auth(masterToken))
      .expect(200);
    expect(
      timeline.body.timeline
        .filter((entry: { type: string }) => entry.type.startsWith("comment_"))
        .map((entry: { type: string }) => entry.type)
        .sort(),
    ).toEqual([
      "comment_added",
      "comment_added",
      "comment_deleted",
      "comment_deleted",
    ]);
    expect(JSON.stringify(timeline.body)).not.toContain("After edit");
    const totalWhileDeleted = timeline.body.windows.timeline.total as number;

    await server()
      .post(`/api/v1/admin/entities/comments/${firstComment.id}/restore`)
      .set(auth(masterToken))
      .expect(201);

    const timelineAfter = await server()
      .get(`/api/v1/admin/cards/${cardId}/detail?section=timeline&limit=50`)
      .set(auth(masterToken))
      .expect(200);
    expect(timelineAfter.body.windows.timeline.total).toBe(
      totalWhileDeleted + 1,
    );

    const restored = await cardFeed(cardId, "?type=comment_updated");
    expect(restored.items).toHaveLength(1);
    expect(restored.items[0]?.changes).toEqual([
      { field: "comment", from: "Before delete", to: "After edit" },
    ]);
    expect(
      (await boardFeed(boardId, "?type=comment_updated")).items,
    ).toHaveLength(1);
    const tombstones = await cardFeed(cardId, "?type=comment_deleted");
    expect(tombstones.items).toHaveLength(2);
    expect(tombstones.items.every((entry) => entry.changes === undefined)).toBe(
      true,
    );
    const added = await cardFeed(cardId, "?type=comment_added&limit=50");
    expect(added.items).toHaveLength(2);
    const restoredAdded = added.items.find(
      (entry: { commentId?: string }) => entry.commentId === firstComment.id,
    );
    expect(restoredAdded?.changes).toEqual([
      { field: "comment", from: null, to: "Before delete" },
    ]);
    // The still-deleted comment's add row is a metadata tombstone.
    const otherAdded = added.items.find(
      (entry: { commentId?: string }) => entry.commentId !== firstComment.id,
    );
    expect(otherAdded).toBeDefined();
    expect(otherAdded).not.toHaveProperty("changes");

    const history = await revisions(firstComment.id).expect(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.historyIncompleteReason).toBeNull();
  });

  it("hides a deleted parent's edit and brings it back after the parent restore", async () => {
    const { boardId, cardId } = await newBoard("parent-feed");
    const comment = await createComment(cardId, "Parent body");
    await editComment(comment.id, "Parent edit").expect(200);
    await command(boardId, owner.token, { type: "DELETE_CARD", cardId });

    // The member History route follows the revisions-route boundary: a
    // deleted card is 404. The master timeline still shows the two
    // tombstones and filters the edit out before paging.
    await server()
      .get(`/api/v1/cards/${cardId}/activity?limit=50`)
      .set(auth(owner.token))
      .expect(404);
    const hidden = await server()
      .get(`/api/v1/admin/cards/${cardId}/detail?section=timeline&limit=50`)
      .set(auth(masterToken))
      .expect(200);
    expect(
      hidden.body.timeline.some(
        (entry: { type: string }) => entry.type === "comment_updated",
      ),
    ).toBe(false);
    expect(
      hidden.body.timeline.filter((entry: { type: string }) =>
        entry.type.startsWith("comment_"),
      ),
    ).toEqual([
      expect.objectContaining({ type: "comment_added", details: null }),
    ]);

    await server()
      .post(`/api/v1/admin/entities/cards/${cardId}/restore`)
      .set(auth(masterToken))
      .expect(201);

    const visible = await cardFeed(cardId, "?limit=50");
    const update = visible.items.find(
      (entry) => entry.type === "comment_updated",
    );
    expect(update?.changes).toEqual([
      { field: "comment", from: "Parent body", to: "Parent edit" },
    ]);
  });

  it("returns revision_limit on both routes and keeps revisions when Activity is swept", async () => {
    const { boardId, cardId } = await newBoard("trim");
    const comment = await createComment(cardId, "v1");
    const now = new Date();
    const cutover = new Date(now.getTime() - 60_000);
    await prisma.comment.update({
      where: { id: comment.id },
      data: {
        text: "v51",
        editedAt: now,
        historyCutoverAt: cutover,
        historyVerifiedEditedAt: now,
        historyVerifiedRevisionNumber: 51,
        lastRevisionNumber: 51,
        historyIncompleteReason: "revision_limit",
      },
    });
    await prisma.commentRevision.createMany({
      data: Array.from({ length: 50 }, (_, index) => {
        const number = index + 2;
        return {
          commentId: comment.id,
          revisionNumber: number,
          beforeText: `v${number - 1}`,
          afterText: `v${number}`,
          createdAt: new Date(cutover.getTime() + number * 1_000),
          editorId: owner.id,
          cause: "author_edit" as const,
        };
      }),
    });
    await prisma.commentRevision.update({
      where: {
        commentId_revisionNumber: { commentId: comment.id, revisionNumber: 51 },
      },
      data: { createdAt: now },
    });
    const stale = new Date(Date.now() - 40 * 86_400_000);
    await prisma.activity.createMany({
      data: [1, 2, 3].map((number) => ({
        boardId,
        cardId,
        type: "comment_updated",
        commentId: comment.id,
        actorId: owner.id,
        createdAt: stale,
        details: {
          commentId: comment.id,
          revisionId: `stale-revision-${number}`,
          beforeText: `old-${number}`,
          afterText: `new-${number}`,
          text: `new-${number}`,
        },
      })),
    });

    const memberPage = await revisions(comment.id).expect(200);
    expect(memberPage.body.items).toHaveLength(50);
    expect(memberPage.body.items[0].revisionNumber).toBe(51);
    expect(memberPage.body.items.at(-1).revisionNumber).toBe(2);
    expect(memberPage.body.historyIncompleteReason).toBe("revision_limit");
    const adminPage = await adminRevisions(comment.id).expect(200);
    expect(adminPage.body.items).toHaveLength(50);
    expect(adminPage.body.historyIncompleteReason).toBe("revision_limit");

    expect(await maintenance.sweepActivity()).toBe(3);
    expect(
      await prisma.commentRevision.count({ where: { commentId: comment.id } }),
    ).toBe(50);
    expect(
      await prisma.activity.count({
        where: { commentId: comment.id, type: "comment_updated" },
      }),
    ).toBe(0);
    const afterSweep = await revisions(comment.id).expect(200);
    expect(afterSweep.body.items).toHaveLength(50);
    expect(afterSweep.body.historyIncompleteReason).toBe("revision_limit");
  });

  it("excludes revision snapshots and foreign-author edits from both GDPR export paths", async () => {
    const { cardId } = await newBoard("export");
    const subject = await createComment(cardId, "Own secret old");
    await editComment(subject.id, "Own current").expect(200);

    const foreign = await prisma.comment.create({
      data: {
        cardId,
        authorId: other.id,
        text: "Foreign current",
      },
    });
    await prisma.commentRevision.create({
      data: {
        commentId: foreign.id,
        revisionNumber: 1,
        beforeText: "Foreign secret old",
        afterText: "Foreign current",
        createdAt: new Date(),
        editorId: owner.id,
        cause: "author_edit",
      },
    });
    await prisma.comment.update({
      where: { id: foreign.id },
      data: {
        editedAt: new Date(),
        historyVerifiedEditedAt: new Date(),
        historyVerifiedRevisionNumber: 1,
        lastRevisionNumber: 1,
      },
    });

    const sync = await adminService.buildUserBundle(owner.id);
    const exportedComments = sync.data.comments as Array<{
      id: string;
      text: string;
    }>;
    expect(exportedComments.find((row) => row.id === subject.id)?.text).toBe(
      "Own current",
    );
    expect(exportedComments.some((row) => row.id === foreign.id)).toBe(false);
    const syncJson = JSON.stringify(sync.data);
    expect(syncJson).not.toContain("Own secret old");
    expect(syncJson).not.toContain("Foreign secret old");
    expect(syncJson).not.toMatch(/beforeText|afterText|revisionId/);

    // Background exports run the same builder from the queue row.
    const pending = await prisma.dataExport.create({
      data: {
        userId: owner.id,
        userEmail: OWNER_EMAIL,
        filename: `janosik-user-${owner.id}.json`,
        createdBy: MASTER_EMAIL,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await exportsService.build(pending.id);
    const ready = await prisma.dataExport.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(ready.status).toBe("ready");
    const downloaded = await exportsService.download(pending.id);
    const background = JSON.parse(
      await readFile(downloaded.absPath, "utf8"),
    ) as {
      comments: Array<{ id: string; text: string }>;
    };
    expect(background.comments.find((row) => row.id === subject.id)?.text).toBe(
      "Own current",
    );
    expect(background.comments.some((row) => row.id === foreign.id)).toBe(
      false,
    );
    const backgroundJson = JSON.stringify(background);
    expect(backgroundJson).not.toContain("Own secret old");
    expect(backgroundJson).not.toContain("Foreign secret old");
    expect(backgroundJson).not.toMatch(/beforeText|afterText|revisionId/);
  });

  it("exposes revision counters without collecting any comment text", async () => {
    const { cardId } = await newBoard("metrics");
    const comment = await createComment(cardId, "METRIC SECRET BODY");
    await editComment(comment.id, "METRIC SECRET EDIT").expect(200);

    const res = await server()
      .get("/api/v1/admin/observability")
      .set(auth(masterToken))
      .expect(200);
    const history = res.body.commentHistory as {
      revisions: { count: number; bytes: number };
      activity: { count: number; bytes: number };
    };
    expect(history.revisions.count).toBeGreaterThanOrEqual(1);
    expect(history.revisions.bytes).toBeGreaterThan(0);
    expect(history.activity.count).toBeGreaterThanOrEqual(1);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("METRIC SECRET");
    expect(json).not.toContain("beforeText");
    expect(json).not.toContain("afterText");
  });

  it("returns null history fields for deleted admin comment rows, live counts otherwise", async () => {
    const { cardId } = await newBoard("admin-row");
    const comment = await createComment(cardId, "Admin row");
    await editComment(comment.id, "Admin row edited").expect(200);

    const live = await server()
      .get(`/api/v1/admin/entities/comments?status=all&limit=50`)
      .set(auth(masterToken))
      .expect(200);
    const liveRow = live.body.items.find(
      (row: { id: string }) => row.id === comment.id,
    );
    expect(liveRow).toMatchObject({
      revisionCount: 1,
      historyIncomplete: false,
      text: "Admin row edited",
    });

    await server()
      .delete(`/api/v1/admin/comments/${comment.id}`)
      .set(auth(masterToken))
      .expect(200);
    const deleted = await server()
      .get(`/api/v1/admin/entities/comments?status=all&limit=50`)
      .set(auth(masterToken))
      .expect(200);
    const deletedRow = deleted.body.items.find(
      (row: { id: string }) => row.id === comment.id,
    );
    expect(deletedRow).toMatchObject({
      revisionCount: null,
      historyIncomplete: null,
    });
    expect(deletedRow.text).toBe("Admin row edited");

    const userDetail = await server()
      .get(
        `/api/v1/admin/users/${owner.id}/detail?section=comments&includeDeleted=true&limit=50`,
      )
      .set(auth(masterToken))
      .expect(200);
    const detailRow = userDetail.body.comments.find(
      (row: { id: string }) => row.id === comment.id,
    );
    expect(detailRow).toMatchObject({
      revisionCount: null,
      historyIncomplete: null,
    });
  });
});
