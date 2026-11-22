import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { BoardAction } from "@janosik/shared";

import { AppModule } from "@/app.module";
import { ADMIN_JWT_AUDIENCE, ADMIN_TOKEN_TYPE } from "@/admin/admin.types";
import { USER_JWT_AUDIENCE } from "@/auth/auth.types";
import { securityStamp } from "@/auth/security-stamp";
import { env } from "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const ADMIN_EMAIL = "1853-admin@example.com";
const OWNER_EMAIL = "1853-owner@example.com";
const MEMBER_EMAIL = "1853-member@example.com";
const VIEWER_EMAIL = "1853-viewer@example.com";
const EXPIRED_EMAIL = "1853-expired@example.com";
const OUTSIDER_EMAIL = "1853-outsider@example.com";
const UNNAMED_EMAIL = "1853-unnamed@example.com";

const REVISION_KEYS = [
  "actorType",
  "afterText",
  "agentName",
  "beforeText",
  "cause",
  "createdAt",
  "editorId",
  "editorName",
  "id",
  "revisionNumber",
];

/**
 * TASK-185.3 — read-only comment revisions API.
 *
 * Covers both routes, the discussion visibility roles, deleted parents,
 * pagination/cursor edge cases, per-page incompleteness reasons, the §3.5
 * mismatch answer, editor naming and the public-share boundary. No card UI or
 * admin counter/dialog fields belong to this suite (185.4/185.5).
 */
describe("Comment revisions API (TASK-185.3, e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const jwt = new JwtService({ secret: env.JWT_SECRET });

  let adminToken: string;
  let owner: { token: string; id: string };
  let member: { token: string; id: string };
  let viewer: { token: string; id: string };
  let expired: { token: string; id: string };
  let outsider: { token: string; id: string };
  let unnamed: { id: string };

  let boardId: string;
  let cardId: string;
  let commentId: string;

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
    await wipeAll(prisma);

    const master = await prisma.adminUser.create({
      data: {
        email: ADMIN_EMAIL,
        displayName: "Master",
        role: "OWNER",
        // Tokens are minted below; the login throttle is not under test here.
        passwordHash: "unused",
      },
    });
    adminToken = await jwt.signAsync(
      { sub: master.id, typ: ADMIN_TOKEN_TYPE },
      { audience: ADMIN_JWT_AUDIENCE },
    );

    owner = await createUser(OWNER_EMAIL, "Owner");
    member = await createUser(MEMBER_EMAIL, "Member");
    viewer = await createUser(VIEWER_EMAIL, "Viewer");
    expired = await createUser(EXPIRED_EMAIL, "Expired Viewer");
    outsider = await createUser(OUTSIDER_EMAIL, "Outsider");
    unnamed = {
      id: (
        await prisma.user.create({
          data: { email: UNNAMED_EMAIL, displayName: null },
        })
      ).id,
    };

    const board = await server()
      .post("/api/v1/boards")
      .set(auth(owner.token))
      .send({ title: "Revisions API" })
      .expect(201);
    boardId = board.body.id as string;
    await command(owner, {
      type: "ADD_COLUMN",
      newColumnId: "col-revisions",
      title: "Todo",
    });
    cardId = "card-revisions";
    await command(owner, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId: "col-revisions",
      title: "History",
    });

    await addMember(member.id, "MEMBER");
    await addMember(viewer.id, "VIEWER");
    await addMember(expired.id, "VIEWER", new Date(Date.now() - 60_000));

    commentId = await createComment(cardId, owner.token, "Original body");
    await editComment(commentId, owner.token, "First edit");
    await editComment(commentId, owner.token, "Second edit");
    await editComment(commentId, owner.token, "Third edit");
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
    // Mint the access token directly: this suite is about revisions access,
    // and the shared login throttle is not part of its contract.
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

  async function addMember(
    userId: string,
    role: "MEMBER" | "VIEWER",
    expiresAt?: Date,
  ): Promise<void> {
    await prisma.boardMember.create({
      data: {
        boardId,
        userId,
        role,
        acceptedAt: new Date(),
        ...(expiresAt ? { expiresAt } : {}),
      },
    });
  }

  async function command(
    actor: { token: string },
    action: Record<string, unknown>,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(actor.token))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action } as BoardAction,
      })
      .expect(200);
  }

  async function createComment(
    targetCardId: string,
    token: string,
    text: string,
  ): Promise<string> {
    const res = await server()
      .post(`/api/v1/cards/${targetCardId}/comments`)
      .set(auth(token))
      .send({ text })
      .expect(201);
    return res.body.id as string;
  }

  function editComment(commentIdToEdit: string, token: string, text: string) {
    return server()
      .patch(`/api/v1/comments/${commentIdToEdit}`)
      .set(auth(token))
      .send({ text });
  }

  function revisions(commentIdToRead: string, token: string) {
    return server()
      .get(`/api/v1/comments/${commentIdToRead}/revisions`)
      .set(auth(token));
  }

  function adminRevisions(commentIdToRead: string) {
    return server()
      .get(`/api/v1/admin/comments/${commentIdToRead}/revisions`)
      .set("Authorization", `Bearer ${adminToken}`);
  }

  async function newCard(prefix: string): Promise<string> {
    const target = `card-${prefix}-${randomUUID().slice(0, 8)}`;
    await command(owner, {
      type: "ADD_CARD",
      newCardId: target,
      columnId: "col-revisions",
      title: `Card ${prefix}`,
    });
    return target;
  }

  /**
   * Seed a valid revision chain without the HTTP writer, for the shapes the
   * writer cannot easily produce on demand (same timestamps, null editor,
   * legacy reason, gap).
   */
  async function seedChain(options: {
    targetCardId: string;
    revisions: number;
    reason?: "legacy_cutover" | "revision_limit" | "gdpr_erase" | null;
    editorId?: string | null;
    sameTimestamp?: boolean;
    agentName?: string | null;
    gap?: boolean;
    empty?: boolean;
  }): Promise<string> {
    const cutover = new Date(Date.now() - 60_000);
    const base = Date.now() - 30_000;
    const texts = Array.from(
      { length: options.revisions + 1 },
      (_, index) => `Seed text ${index}`,
    );
    const createdAt = (index: number) =>
      new Date(options.sameTimestamp ? base : base + index * 1_000);
    const finalAt = createdAt(options.revisions);
    const comment = await prisma.comment.create({
      data: {
        cardId: options.targetCardId,
        authorId: owner.id,
        text: options.empty ? "Never edited" : texts[options.revisions],
        lastRevisionNumber: options.revisions,
        historyCutoverAt: cutover,
        historyVerifiedEditedAt: options.empty ? null : finalAt,
        historyVerifiedRevisionNumber: options.empty ? null : options.revisions,
        historyIncompleteReason: options.reason ?? null,
        ...(options.empty
          ? {}
          : {
              editedAt: options.gap
                ? new Date(finalAt.getTime() + 5_000)
                : finalAt,
            }),
      },
    });
    for (let index = 1; index <= options.revisions; index += 1) {
      await prisma.commentRevision.create({
        data: {
          commentId: comment.id,
          revisionNumber: index,
          beforeText: texts[index - 1],
          afterText: texts[index],
          createdAt: createdAt(index),
          editorId:
            options.editorId === undefined ? owner.id : options.editorId,
          actorType: options.agentName ? "agent" : "human",
          agentName: options.agentName ?? null,
          cause: "author_edit",
        },
      });
    }
    return comment.id;
  }

  it("serves the newest-first history to ADMIN, MEMBER, VIEWER and a read PAT", async () => {
    const ownerPage = await revisions(commentId, owner.token).expect(200);
    expect(ownerPage.body).toMatchObject({
      nextCursor: null,
      historyIncomplete: false,
      historyIncompleteReason: null,
    });
    expect(
      ownerPage.body.items.map(
        (item: { revisionNumber: number }) => item.revisionNumber,
      ),
    ).toEqual([3, 2, 1]);
    expect(ownerPage.body.items[0]).toMatchObject({
      afterText: "Third edit",
      beforeText: "Second edit",
      editorId: owner.id,
      editorName: "Owner",
      actorType: "human",
      agentName: null,
      cause: "author_edit",
    });
    for (const item of ownerPage.body.items) {
      expect(Object.keys(item).sort()).toEqual(REVISION_KEYS);
      expect(typeof item.createdAt).toBe("number");
    }

    await revisions(commentId, member.token).expect(200);
    await revisions(commentId, viewer.token).expect(200);

    const pat = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(owner.token))
      .send({ name: "reader", scopePreset: "observer", readOnly: false })
      .expect(201);
    await revisions(commentId, pat.body.token as string).expect(200);

    // The history view does not widen the write role: a VIEWER still cannot
    // edit the comment.
    await editComment(commentId, viewer.token, "Viewer edit").expect(403);
  });

  it("answers 403 for an expired VIEWER and a non-member before parsing a cursor", async () => {
    await revisions(commentId, expired.token).expect(403);
    await revisions(commentId, outsider.token).expect(403);
    await revisions(commentId, outsider.token)
      .query({ cursor: "not-a-cursor", limit: "0" })
      .expect(403);
    await revisions("missing-comment", outsider.token)
      .query({ cursor: "not-a-cursor" })
      .expect(404);
  });

  it("answers 404 for a missing or deleted comment or parent, member or not", async () => {
    await revisions("missing-comment", owner.token).expect(404);
    await revisions("missing-comment", outsider.token).expect(404);

    const deleted = await createComment(cardId, owner.token, "Delete me");
    await server()
      .delete(`/api/v1/comments/${deleted}`)
      .set(auth(owner.token))
      .expect(200);
    await revisions(deleted, owner.token).expect(404);
    await revisions(deleted, outsider.token).expect(404);

    const parentCard = await newCard("deleted-parent");
    const child = await createComment(parentCard, owner.token, "On a card");
    await prisma.card.update({
      where: { id: parentCard },
      data: { deletedAt: new Date() },
    });
    await revisions(child, owner.token).expect(404);
    await revisions(child, outsider.token).expect(404);
    await adminRevisions(child).expect(404);

    const parentColumnComment = await createComment(
      cardId,
      owner.token,
      "On a column",
    );
    await prisma.column.update({
      where: { id: "col-revisions" },
      data: { deletedAt: new Date() },
    });
    await revisions(parentColumnComment, owner.token).expect(404);
    await revisions(parentColumnComment, outsider.token).expect(404);
    // Give the shared column back before the rest of the suite.
    await prisma.column.update({
      where: { id: "col-revisions" },
      data: { deletedAt: null },
    });
  });

  it("paginates with a bound opaque cursor and validates limit and cursor", async () => {
    const paged = await seedChain({
      targetCardId: await newCard("paging"),
      revisions: 4,
    });

    const first = await revisions(paged, member.token)
      .query({ limit: 2 })
      .expect(200);
    expect(
      first.body.items.map(
        (item: { revisionNumber: number }) => item.revisionNumber,
      ),
    ).toEqual([4, 3]);
    expect(typeof first.body.nextCursor).toBe("string");

    const second = await revisions(paged, member.token)
      .query({ limit: 2, cursor: first.body.nextCursor })
      .expect(200);
    expect(
      second.body.items.map(
        (item: { revisionNumber: number }) => item.revisionNumber,
      ),
    ).toEqual([2, 1]);
    expect(second.body.nextCursor).toBeNull();

    // The cursor keeps working after the row it pointed at was trimmed: it
    // carries only the comment id and the revision number boundary.
    const trimCursor = await revisions(paged, member.token)
      .query({ limit: 2 })
      .expect(200);
    await prisma.commentRevision.delete({
      where: {
        commentId_revisionNumber: { commentId: paged, revisionNumber: 3 },
      },
    });
    const afterTrim = await revisions(paged, member.token)
      .query({ limit: 2, cursor: trimCursor.body.nextCursor })
      .expect(200);
    expect(
      afterTrim.body.items.map(
        (item: { revisionNumber: number }) => item.revisionNumber,
      ),
    ).toEqual([2, 1]);

    for (const limit of ["0", "101", "-1", "1.5", "ten"]) {
      await revisions(paged, member.token).query({ limit }).expect(400);
    }
    await revisions(paged, member.token)
      .query({ cursor: "not-a-cursor" })
      .expect(400);

    const foreign = await seedChain({
      targetCardId: await newCard("foreign"),
      revisions: 1,
    });
    const foreignCursor = await revisions(foreign, member.token)
      .query({ limit: 1 })
      .expect(200);
    // limit 1 with only one row has no next cursor: make one by asking for 1
    // on a two-row chain instead.
    expect(foreignCursor.body.nextCursor).toBeNull();
    await seedChainRevision(foreign);
    const twoRowCursor = await revisions(foreign, member.token)
      .query({ limit: 1 })
      .expect(200);
    expect(typeof twoRowCursor.body.nextCursor).toBe("string");

    await revisions(paged, member.token)
      .query({ cursor: twoRowCursor.body.nextCursor })
      .expect(400);
  });

  it("orders by revision number when timestamps are equal", async () => {
    const equal = await seedChain({
      targetCardId: await newCard("equal-time"),
      revisions: 3,
      sameTimestamp: true,
    });
    const page = await revisions(equal, member.token).expect(200);
    expect(
      page.body.items.map(
        (item: { revisionNumber: number }) => item.revisionNumber,
      ),
    ).toEqual([3, 2, 1]);
  });

  it("carries the reason on every page, including an empty history", async () => {
    const legacy = await seedChain({
      targetCardId: await newCard("legacy"),
      revisions: 0,
      reason: "legacy_cutover",
      empty: true,
    });
    const emptyPage = await revisions(legacy, member.token).expect(200);
    expect(emptyPage.body).toEqual({
      items: [],
      nextCursor: null,
      historyIncomplete: true,
      historyIncompleteReason: "legacy_cutover",
    });

    const incomplete = await seedChain({
      targetCardId: await newCard("incomplete-page"),
      revisions: 3,
      reason: "revision_limit",
    });
    const first = await revisions(incomplete, member.token)
      .query({ limit: 1 })
      .expect(200);
    expect(first.body.historyIncomplete).toBe(true);
    expect(first.body.historyIncompleteReason).toBe("revision_limit");
    expect(first.body.nextCursor).not.toBeNull();
    const second = await revisions(incomplete, member.token)
      .query({ limit: 1, cursor: first.body.nextCursor })
      .expect(200);
    expect(second.body.historyIncomplete).toBe(true);
    expect(second.body.historyIncompleteReason).toBe("revision_limit");
  });

  it("returns an empty writer_gap page on a §3.5 mismatch before the sweep writes it", async () => {
    const gap = await seedChain({
      targetCardId: await newCard("gap"),
      revisions: 2,
      gap: true,
    });
    const expected = {
      items: [],
      nextCursor: null,
      historyIncomplete: true,
      historyIncompleteReason: "writer_gap",
    };
    expect((await revisions(gap, member.token).expect(200)).body).toEqual(
      expected,
    );
    expect((await adminRevisions(gap).expect(200)).body).toEqual(expected);

    // Read-only: serving the gap did not persist a reason.
    const row = await prisma.comment.findUniqueOrThrow({
      where: { id: gap },
      select: { historyIncompleteReason: true },
    });
    expect(row.historyIncompleteReason).toBeNull();
  });

  it("uses the current public editor name and null for a null or unnamed editor", async () => {
    await prisma.user.update({
      where: { id: owner.id },
      data: { displayName: "Owner Renamed" },
    });
    const renamed = await revisions(commentId, member.token).expect(200);
    expect(renamed.body.items[0].editorName).toBe("Owner Renamed");

    const noEditor = await seedChain({
      targetCardId: await newCard("null-editor"),
      revisions: 1,
      editorId: null,
      agentName: "agent-one",
    });
    const noEditorPage = await revisions(noEditor, member.token).expect(200);
    expect(noEditorPage.body.items[0]).toMatchObject({
      editorId: null,
      editorName: null,
      actorType: "agent",
      agentName: "agent-one",
    });

    const unnamedEditor = await seedChain({
      targetCardId: await newCard("unnamed-editor"),
      revisions: 1,
      editorId: unnamed.id,
    });
    const unnamedPage = await revisions(unnamedEditor, member.token).expect(
      200,
    );
    expect(unnamedPage.body.items[0]).toMatchObject({
      editorId: unnamed.id,
      editorName: null,
    });
  });

  it("never exposes token or session attribution in the revision DTO", async () => {
    const worker = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(owner.token))
      .send({ name: "history-agent", scopePreset: "worker", readOnly: false })
      .expect(201);
    const session = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions`)
      .set(auth(worker.body.token as string))
      .send({ name: "history session" })
      .expect(201);
    const agentComment = await createComment(
      cardId,
      worker.body.token as string,
      "Agent original",
    );
    await server()
      .patch(`/api/v1/comments/${agentComment}`)
      .set(auth(worker.body.token as string))
      .set("X-Agent-Session", session.body.id as string)
      .send({ text: "Agent edit" })
      .expect(200);

    const page = await revisions(agentComment, owner.token).expect(200);
    expect(page.body.items[0]).toMatchObject({
      actorType: "agent",
      agentName: "history-agent",
      cause: "author_edit",
    });
    expect(Object.keys(page.body.items[0]).sort()).toEqual(REVISION_KEYS);
    expect(JSON.stringify(page.body)).not.toMatch(
      /apiTokenId|agentSessionId|jnk_/,
    );
  });

  it("serves the admin route without board membership and rejects user tokens", async () => {
    const page = await adminRevisions(commentId).expect(200);
    expect(
      page.body.items.map(
        (item: { revisionNumber: number }) => item.revisionNumber,
      ),
    ).toEqual([3, 2, 1]);
    expect(page.body.items[0].editorName).toBe("Owner Renamed");

    // A user JWT is useless on the master contour, and no share or member
    // route was opened by adding the master reader.
    await adminRevisions(commentId).set(auth(owner.token)).expect(401);

    const deleted = await createComment(cardId, owner.token, "Admin 404");
    await server()
      .delete(`/api/v1/comments/${deleted}`)
      .set(auth(owner.token))
      .expect(200);
    await adminRevisions(deleted).expect(404);
    await adminRevisions("missing-comment").expect(404);
    await adminRevisions(commentId).query({ limit: "0" }).expect(400);

    // Both routes are read-only: there is no mutation handler behind this
    // path on either contour.
    await server()
      .post(`/api/v1/comments/${commentId}/revisions`)
      .set(auth(owner.token))
      .expect(404);
    await server()
      .post(`/api/v1/admin/comments/${commentId}/revisions`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);
  });

  it("keeps revisions and history metadata out of live and snapshot shares", async () => {
    const live = await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(auth(owner.token))
      .send({ mode: "live", includeComments: true })
      .expect(201);
    const snapshot = await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(auth(owner.token))
      .send({ mode: "snapshot", includeComments: true })
      .expect(201);

    for (const share of [live.body, snapshot.body]) {
      const page = await server()
        .get(`/api/v1/share/${share.token as string}/cards/${cardId}/comments`)
        .expect(200);
      expect(page.body.items.length).toBeGreaterThan(0);
      for (const item of page.body.items) {
        expect(item).not.toHaveProperty("revisionNumber");
        expect(item).not.toHaveProperty("revisionId");
        expect(item).not.toHaveProperty("beforeText");
        expect(item).not.toHaveProperty("afterText");
        expect(item).not.toHaveProperty("historyIncomplete");
        expect(item).not.toHaveProperty("historyIncompleteReason");
        expect(item).not.toHaveProperty("lastRevisionNumber");
        expect(item).not.toHaveProperty("historyCutoverAt");
        expect(item).not.toHaveProperty("historyVerifiedEditedAt");
        expect(item).not.toHaveProperty("historyVerifiedRevisionNumber");
      }
      const body = JSON.stringify(page.body);
      expect(body).not.toMatch(
        /revisionNumber|historyIncomplete|beforeText|historyCutoverAt/,
      );

      // A share token is not a user credential and does not open the
      // revisions route.
      await server()
        .get(`/api/v1/comments/${commentId}/revisions`)
        .set("Authorization", `Bearer ${share.token as string}`)
        .expect(401);
    }

    // The persisted snapshot comment projection has the same allowlist.
    const rows = await prisma.boardShareSnapshotComment.findMany({
      where: { shareId: snapshot.body.id as string },
      select: { payload: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(
      /revisionNumber|historyIncomplete|beforeText|historyCutoverAt/,
    );
  });

  /** Add one more revision to a seeded chain, preserving its valid state. */
  async function seedChainRevision(commentIdToExtend: string): Promise<void> {
    const comment = await prisma.comment.findUniqueOrThrow({
      where: { id: commentIdToExtend },
      select: {
        text: true,
        lastRevisionNumber: true,
        historyCutoverAt: true,
        editedAt: true,
      },
    });
    const next = comment.lastRevisionNumber + 1;
    const at = new Date(
      Math.max(
        Date.now(),
        comment.historyCutoverAt.getTime() + 1,
        (comment.editedAt?.getTime() ?? 0) + 1,
      ),
    );
    await prisma.comment.update({
      where: { id: commentIdToExtend },
      data: {
        text: `${comment.text} (extended)`,
        lastRevisionNumber: next,
        editedAt: at,
        historyVerifiedEditedAt: at,
        historyVerifiedRevisionNumber: next,
      },
    });
    await prisma.commentRevision.create({
      data: {
        commentId: commentIdToExtend,
        revisionNumber: next,
        beforeText: comment.text,
        afterText: `${comment.text} (extended)`,
        createdAt: at,
        editorId: owner.id,
        cause: "author_edit",
      },
    });
  }
});
