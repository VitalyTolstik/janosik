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
import { AccountDeletionService } from "@/users/account-deletion.service";
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
  let accountDeletion: AccountDeletionService;
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
    accountDeletion = app.get(AccountDeletionService);
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
      id?: string;
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
    const nonStringLink = await prisma.activity.create({
      data: {
        boardId,
        cardId,
        type: "comment_added",
        actorId: owner.id,
        details: { commentId: 12345, text: "Not a string id" },
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
    expect(sweep).toEqual([
      {
        job: "sweep-comment-history",
        removed: 4,
        detail:
          "1 comments reconciled; 2 Activity links filled; 1 snapshots stripped",
      },
    ]);

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
    const notFilled = await prisma.activity.findUniqueOrThrow({
      where: { id: nonStringLink.id },
    });
    expect(notFilled.commentId).toBeNull();

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
    expect(again).toEqual([
      {
        job: "sweep-comment-history",
        removed: 0,
        detail:
          "0 comments reconciled; 0 Activity links filled; 0 snapshots stripped",
      },
    ]);

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
      {
        job: "sweep-comment-history",
        removed: 1,
        detail:
          "1 comments reconciled; 0 Activity links filled; 0 snapshots stripped",
      },
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
    // A non-null reason and the revision number must survive delete/restore.
    await prisma.comment.update({
      where: { id: firstComment.id },
      data: { historyIncompleteReason: "legacy_cutover" },
    });
    const secondAddId = (
      await prisma.activity.findFirstOrThrow({
        where: { commentId: secondComment.id, type: "comment_added" },
        select: { id: true },
      })
    ).id;
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
    // The still-deleted comment's add row is a metadata tombstone, matched by
    // its own Activity id (the tombstone has no typed comment id).
    const otherAdded = added.items.find((entry) => entry.id === secondAddId);
    expect(otherAdded).toBeDefined();
    expect(otherAdded).not.toHaveProperty("changes");

    const history = await revisions(firstComment.id).expect(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.historyIncompleteReason).toBe("legacy_cutover");
    const restoredRow = await prisma.comment.findUniqueOrThrow({
      where: { id: firstComment.id },
    });
    expect(restoredRow.lastRevisionNumber).toBe(1);
    expect(restoredRow.historyVerifiedRevisionNumber).toBe(1);
    expect(restoredRow.historyIncompleteReason).toBe("legacy_cutover");
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

  it("purges legacy null-typed comment Activity with the comment", async () => {
    const stale = new Date(Date.now() - 40 * 86_400_000);

    const allRun = await newBoard("purge-legacy-all");
    const allComment = await createComment(allRun.cardId, "Purge all");
    await editComment(allComment.id, "Purge all edited").expect(200);
    await prisma.comment.update({
      where: { id: allComment.id },
      data: { deletedAt: stale },
    });
    const allActivity = await prisma.activity.create({
      data: {
        boardId: allRun.boardId,
        cardId: allRun.cardId,
        type: "comment_updated",
        actorId: owner.id,
        details: {
          commentId: allComment.id,
          beforeText: "LEGACY PURGE SECRET",
          afterText: "LEGACY PURGE SECRET",
          text: "LEGACY PURGE SECRET",
        },
      },
    });

    // `all` repairs and fills the typed link before the purge.
    await maintenance.run("all");
    expect(
      await prisma.comment.findUnique({ where: { id: allComment.id } }),
    ).toBeNull();
    expect(
      await prisma.activity.findUnique({ where: { id: allActivity.id } }),
    ).toBeNull();

    // A direct purge must not rely on the sweep having run first: the delete
    // helper matches the legacy `details.commentId` too.
    const direct = await newBoard("purge-legacy-direct");
    const directComment = await createComment(direct.cardId, "Purge direct");
    await editComment(directComment.id, "Purge direct edited").expect(200);
    await prisma.comment.update({
      where: { id: directComment.id },
      data: { deletedAt: stale },
    });
    const directActivity = await prisma.activity.create({
      data: {
        boardId: direct.boardId,
        cardId: direct.cardId,
        type: "comment_updated",
        actorId: owner.id,
        details: {
          commentId: directComment.id,
          beforeText: "LEGACY DIRECT SECRET",
          afterText: "LEGACY DIRECT SECRET",
          text: "LEGACY DIRECT SECRET",
        },
      },
    });
    expect(await maintenance.run("purge-soft-deleted")).toBeDefined();
    expect(
      await prisma.comment.findUnique({ where: { id: directComment.id } }),
    ).toBeNull();
    expect(
      await prisma.activity.findUnique({ where: { id: directActivity.id } }),
    ).toBeNull();
    expect(
      await prisma.activity.count({
        where: {
          OR: [
            { details: { path: ["commentId"], equals: allComment.id } },
            { details: { path: ["commentId"], equals: directComment.id } },
          ],
        },
      }),
    ).toBe(0);
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

  it("returns gdpr_erase on both routes after an editor erase", async () => {
    const { boardId, cardId } = await newBoard("erase-api");
    const victim = await createUser("1856-erase-victim@example.com", "Victim");
    const author = await createUser("1856-erase-author@example.com", "Author");
    await prisma.boardMember.createMany({
      data: [victim.id, author.id].map((userId) => ({
        boardId,
        userId,
        role: "MEMBER" as const,
        acceptedAt: new Date(),
      })),
    });

    const foreign = await createComment(cardId, "Foreign body", author.token);
    const editedAt = new Date(Date.now() + 1_000);
    await prisma.comment.update({
      where: { id: foreign.id },
      data: {
        text: "Foreign edited",
        editedAt,
        historyVerifiedEditedAt: editedAt,
        historyVerifiedRevisionNumber: 1,
        lastRevisionNumber: 1,
      },
    });
    await prisma.commentRevision.create({
      data: {
        commentId: foreign.id,
        revisionNumber: 1,
        beforeText: "Foreign body",
        afterText: "Foreign edited",
        createdAt: editedAt,
        editorId: victim.id,
        cause: "author_edit",
      },
    });
    await prisma.activity.create({
      data: {
        boardId,
        cardId,
        type: "comment_updated",
        commentId: foreign.id,
        actorId: victim.id,
        details: {
          commentId: foreign.id,
          beforeText: "Foreign body",
          afterText: "Foreign edited",
          text: "Foreign edited",
        },
      },
    });

    // The victim's own comment has a legacy snapshot created by someone else;
    // erasing the author must still remove it by `details.commentId`.
    const own = await createComment(cardId, "Victim own", victim.token);
    const legacy = await prisma.activity.create({
      data: {
        boardId,
        cardId,
        type: "comment_added",
        actorId: author.id,
        details: {
          commentId: own.id,
          text: "ERASE LEGACY SECRET",
        },
      },
    });

    expect(await accountDeletion.deleteAccount(victim.id)).not.toBeNull();
    expect(
      await prisma.activity.findUnique({ where: { id: legacy.id } }),
    ).toBeNull();

    for (const response of [
      await revisions(foreign.id, author.token).expect(200),
      await adminRevisions(foreign.id).expect(200),
    ]) {
      expect(response.body.items).toEqual([]);
      expect(response.body.historyIncomplete).toBe(true);
      expect(response.body.historyIncompleteReason).toBe("gdpr_erase");
    }

    await editComment(foreign.id, "Author continues", author.token).expect(200);
    for (const response of [
      await revisions(foreign.id, author.token).expect(200),
      await adminRevisions(foreign.id).expect(200),
    ]) {
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({
        revisionNumber: 2,
        beforeText: "Foreign edited",
        afterText: "Author continues",
      });
      expect(response.body.historyIncompleteReason).toBe("gdpr_erase");
    }
  });

  it("exposes revision counters without collecting any comment text", async () => {
    const { boardId, cardId } = await newBoard("metrics");
    const comment = await createComment(cardId, "METRIC SECRET BODY");
    await editComment(comment.id, "METRIC SECRET EDIT").expect(200);

    // A legacy oversized chain: 4.2 MB of revision text and 6.3 MB of related
    // Activity text push both budgets over their decimal limits.
    const big = "Z".repeat(2_100_000);
    const editedAt = new Date();
    const bigComment = await prisma.comment.create({
      data: {
        cardId,
        authorId: owner.id,
        text: big,
        editedAt,
        historyCutoverAt: new Date(editedAt.getTime() - 60_000),
        historyVerifiedEditedAt: editedAt,
        historyVerifiedRevisionNumber: 1,
        lastRevisionNumber: 1,
      },
    });
    const bigRevision = await prisma.commentRevision.create({
      data: {
        commentId: bigComment.id,
        revisionNumber: 1,
        beforeText: big,
        afterText: big,
        createdAt: editedAt,
        editorId: owner.id,
        cause: "author_edit",
      },
    });
    await prisma.activity.create({
      data: {
        boardId,
        cardId,
        type: "comment_updated",
        commentId: bigComment.id,
        actorId: owner.id,
        details: {
          commentId: bigComment.id,
          revisionId: bigRevision.id,
          beforeText: big,
          afterText: big,
          text: big,
        },
      },
    });

    // One comment per reason, plus a chain beyond the window.
    for (const reason of [
      "legacy_cutover",
      "gdpr_erase",
      "writer_gap",
    ] as const) {
      await prisma.comment.create({
        data: {
          cardId,
          authorId: owner.id,
          text: `reason ${reason}`,
          historyIncompleteReason: reason,
        },
      });
    }
    await prisma.comment.create({
      data: {
        cardId,
        authorId: owner.id,
        text: "derived trims",
        historyIncompleteReason: "revision_limit",
        lastRevisionNumber: 70,
      },
    });

    const res = await server()
      .get("/api/v1/admin/observability")
      .set(auth(masterToken))
      .expect(200);
    const history = res.body.commentHistory as {
      available: boolean;
      revisions: { count: number; bytes: number };
      activity: { count: number; bytes: number };
      derivedTrimmedRevisions: number;
      incompleteComments: number;
      reasons: Record<string, number>;
      overBudget: { revisions: number; activity: number };
    };
    expect(history.available).toBe(true);
    expect(history.revisions.count).toBeGreaterThanOrEqual(2);
    expect(history.revisions.bytes).toBeGreaterThan(4_000_000);
    expect(history.activity.count).toBeGreaterThanOrEqual(2);
    expect(history.activity.bytes).toBeGreaterThan(6_000_000);
    // The trim suite also leaves one chain at revision 51 (+1).
    expect(history.derivedTrimmedRevisions).toBeGreaterThanOrEqual(21);
    expect(history.incompleteComments).toBeGreaterThanOrEqual(4);
    expect(history.reasons.legacy_cutover).toBeGreaterThanOrEqual(1);
    expect(history.reasons.revision_limit).toBeGreaterThanOrEqual(1);
    expect(history.reasons.gdpr_erase).toBeGreaterThanOrEqual(1);
    expect(history.reasons.writer_gap).toBeGreaterThanOrEqual(1);
    expect(history.overBudget.revisions).toBeGreaterThanOrEqual(1);
    expect(history.overBudget.activity).toBeGreaterThanOrEqual(1);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("METRIC SECRET");
    expect(json).not.toContain(big.slice(0, 200));
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
