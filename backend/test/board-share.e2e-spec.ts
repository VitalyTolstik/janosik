import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { BoardShareDto } from "@janosik/shared";
import { argon2id, hash as argonHash } from "argon2";
import { randomUUID } from "node:crypto";
import http from "node:http";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { StorageService } from "@/attachments/storage.service";
import { ShareService } from "@/share/share.service";
import { MaintenanceService } from "@/ops/maintenance.service";
import { access, utimes, writeFile } from "node:fs/promises";

const ADMIN_EMAIL = "share-admin@example.com";
const ADMIN_PASSWORD = "share admin correct horse";
const VIEWER_EMAIL = "share-viewer@example.com";
const VIEWER_PASSWORD = "share viewer correct horse";
const OUTSIDER_EMAIL = "share-outsider@example.com";
const OUTSIDER_PASSWORD = "share outsider correct horse";

/**
 * Public read-only board sharing (TASK-58). Exercises both modes end to end:
 * an anonymous token reader, the write-free guarantee, privacy filtering and
 * the lifecycle (revoke / expire / board-gone). The suite self-cleans content
 * tables in `beforeAll` (the e2e DB persists across runs).
 */
/** Delete every table this suite touches, so no leftovers seed a later one. */
async function wipe(db: PrismaService): Promise<void> {
  await db.boardShareAuditLog.deleteMany();
  await db.boardShare.deleteMany();
  await db.command.deleteMany();
  await db.activity.deleteMany();
  await db.comment.deleteMany();
  await db.attachment.deleteMany();
  await db.cardLabel.deleteMany();
  await db.checklistItem.deleteMany();
  await db.checklist.deleteMany();
  await db.cardLink.deleteMany();
  await db.card.deleteMany();
  await db.column.deleteMany();
  await db.label.deleteMany();
  await db.boardMember.deleteMany();
  await db.board.deleteMany();
  await db.apiToken.deleteMany();
  await db.refreshToken.deleteMany();
  await db.user.deleteMany();
}

describe("Public board shares (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let adminToken: string;
  let viewerToken: string;
  let outsiderToken: string;
  let adminId: string;
  let viewerId: string;

  const server = () => request(app.getHttpServer());

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function newBoard(title: string): Promise<{
    boardId: string;
    columnId: string;
    cardId: string;
  }> {
    const board = (
      await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title })
        .expect(201)
    ).body;
    const columnId = `col-${randomUUID()}`;
    const cardId = `card-${randomUUID()}`;
    await server()
      .post(`/api/v1/boards/${board.id}/commands`)
      .set(auth(adminToken))
      .send({
        commandId: randomUUID(),
        action: {
          boardId: board.id,
          at: Date.now(),
          type: "ADD_COLUMN",
          newColumnId: columnId,
          title: "Todo",
        },
      })
      .expect(200);
    await server()
      .post(`/api/v1/boards/${board.id}/commands`)
      .set(auth(adminToken))
      .send({
        commandId: randomUUID(),
        action: {
          boardId: board.id,
          at: Date.now(),
          type: "ADD_CARD",
          newCardId: cardId,
          columnId,
          title: "Shared card",
        },
      })
      .expect(200);
    return { boardId: board.id, columnId, cardId };
  }

  async function createShare(
    boardId: string,
    body: Record<string, unknown>,
  ): Promise<BoardShareDto> {
    return (
      await server()
        .post(`/api/v1/boards/${boardId}/shares`)
        .set(auth(adminToken))
        .send(body)
        .expect(201)
    ).body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    const address = app.getHttpServer().address();
    baseUrl =
      typeof address === "object" && address !== null
        ? `http://127.0.0.1:${address.port}`
        : "http://127.0.0.1";

    await wipe(prisma);

    const admin = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash: await argonHash(ADMIN_PASSWORD, { type: argon2id }),
        emailVerifiedAt: new Date(),
      },
    });
    adminId = admin.id;
    const viewer = await prisma.user.create({
      data: {
        email: VIEWER_EMAIL,
        passwordHash: await argonHash(VIEWER_PASSWORD, { type: argon2id }),
        emailVerifiedAt: new Date(),
      },
    });
    viewerId = viewer.id;
    await prisma.user.create({
      data: {
        email: OUTSIDER_EMAIL,
        passwordHash: await argonHash(OUTSIDER_PASSWORD, { type: argon2id }),
        emailVerifiedAt: new Date(),
      },
    });

    const login = async (email: string, password: string) =>
      (
        await server()
          .post("/api/v1/auth/login")
          .send({ email, password })
          .expect(200)
      ).body.accessToken;
    adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    viewerToken = await login(VIEWER_EMAIL, VIEWER_PASSWORD);
    outsiderToken = await login(OUTSIDER_EMAIL, OUTSIDER_PASSWORD);
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  it("enforces the live limit under concurrent creation and permits a replacement after revocation", async () => {
    const { boardId } = await newBoard("Share limits");
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        server()
          .post(`/api/v1/boards/${boardId}/shares`)
          .set(auth(adminToken))
          .send({ mode: "live" }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(5);
    expect(
      responses.filter((response) => response.status === 409),
    ).toHaveLength(3);
    const first = responses.find((response) => response.status === 201)!;
    await server()
      .delete(`/api/v1/boards/${boardId}/shares/${first.body.id}/permanent`)
      .set(auth(adminToken))
      .expect(400);
    await server()
      .delete(`/api/v1/boards/${boardId}/shares/${first.body.id}`)
      .set(auth(adminToken))
      .expect(200);
    await server()
      .delete(`/api/v1/boards/${boardId}/shares/${first.body.id}`)
      .set(auth(adminToken))
      .expect(200);
    await server()
      .delete(`/api/v1/boards/${boardId}/shares/${first.body.id}/permanent`)
      .set(auth(adminToken))
      .expect(204);
    expect(
      await prisma.boardShare.findUnique({ where: { id: first.body.id } }),
    ).toBeNull();
    const history = await prisma.boardShareAuditLog.findMany({
      where: { shareId: first.body.id },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((event) => event.action)).toEqual([
      "created",
      "revoked",
      "deleted",
    ]);
    expect(
      history.every(
        (event) =>
          event.boardId === boardId &&
          event.actorId === adminId &&
          event.actorType === "user",
      ),
    ).toBe(true);
    expect(JSON.stringify(history)).not.toContain(first.body.token);
    await createShare(boardId, { mode: "live" });
  });

  it("only board ADMINs can create shares (viewer and outsider denied)", async () => {
    const { boardId } = await newBoard("Share perms");
    await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(auth(outsiderToken))
      .send({ mode: "live" })
      .expect(403);
    await prisma.boardMember.create({
      data: {
        boardId,
        userId: viewerId,
        role: "VIEWER",
        acceptedAt: new Date(),
      },
    });
    await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(auth(viewerToken))
      .send({ mode: "live" })
      .expect(403);
    // Anonymous cannot even list.
    await server().get(`/api/v1/boards/${boardId}/shares`).expect(401);
  });

  it("snapshot: anonymous read-only, no emails, survives board deletion", async () => {
    const { boardId, cardId } = await newBoard("Share snapshot");
    const share = await createShare(boardId, {
      mode: "snapshot",
      includeComments: false,
      includeAttachments: false,
    });
    expect(share.mode).toBe("snapshot");

    const before = await server()
      .get(`/api/v1/share/${share.token}`)
      .expect(200);
    expect(before.body.mode).toBe("snapshot");
    expect(before.body.board.cards[cardId]).toBeDefined();
    // Privacy: the roster never carries an email.
    for (const member of before.body.members) {
      expect(member).not.toHaveProperty("email");
    }

    await server()
      .delete(`/api/v1/boards/${boardId}`)
      .set(auth(adminToken))
      .expect(200);

    const after = await server()
      .get(`/api/v1/share/${share.token}`)
      .expect(200);
    expect(after.body.board.cards[cardId]).toBeDefined();
  });

  it("does not expose the board's agent pause state on a public share", async () => {
    const { boardId } = await newBoard("Share pause state");
    await prisma.board.update({
      where: { id: boardId },
      data: {
        agentsPausedAt: new Date(),
        agentsPausedBy: adminId,
        agentsPauseReason: "internal incident",
      },
    });
    try {
      const live = await createShare(boardId, { mode: "live" });
      const snapshot = await createShare(boardId, { mode: "snapshot" });
      for (const token of [live.token, snapshot.token]) {
        const res = await server().get(`/api/v1/share/${token}`).expect(200);
        expect(res.body.board).not.toHaveProperty("agentsPausedAt");
        expect(res.body.board).not.toHaveProperty("agentsPausedBy");
        expect(res.body.board).not.toHaveProperty("agentsPauseReason");
        expect(JSON.stringify(res.body)).not.toContain("agentsPause");
      }
    } finally {
      await prisma.board.update({
        where: { id: boardId },
        data: {
          agentsPausedAt: null,
          agentsPausedBy: null,
          agentsPauseReason: null,
        },
      });
    }
  });

  it("freezes comment pages, attachment metadata and bytes through edits, archive, delete and purge (M18)", async () => {
    const { boardId, cardId } = await newBoard("Frozen nested data");
    const comment = async (text: string) =>
      (
        await server()
          .post(`/api/v1/cards/${cardId}/comments`)
          .set(auth(adminToken))
          .send({ text })
          .expect(201)
      ).body;
    const first = await comment("Captured comment");
    const second = await comment("Captured second comment");
    // Exercise the id tie-breaker in the opaque comment cursor.
    await prisma.comment.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: { createdAt: new Date(first.createdAt) },
    });
    const attachment = (
      await server()
        .post(`/api/v1/cards/${cardId}/attachments`)
        .set(auth(adminToken))
        .attach("file", Buffer.from("captured bytes"), "capture.txt")
        .expect(201)
    ).body;
    const share = await createShare(boardId, {
      mode: "snapshot",
      includeComments: true,
      includeAttachments: true,
    });
    const base = `/api/v1/share/${share.token}`;
    const commentUrl = `${base}/cards/${cardId}/comments`;
    const attachmentUrl = `${base}/cards/${cardId}/attachments`;
    const contentUrl = `${base}/attachments/${attachment.id}/content`;
    const before = (await server().get(base).expect(200)).body;
    const comments = (await server().get(commentUrl).expect(200)).body;
    const firstPage = (
      await server().get(commentUrl).query({ limit: 1 }).expect(200)
    ).body;
    expect(firstPage.items).toEqual(comments.items.slice(0, 1));
    expect(typeof firstPage.nextCursor).toBe("string");
    const nextPage = (
      await server()
        .get(commentUrl)
        .query({
          limit: 1,
          cursor: firstPage.nextCursor,
        })
        .expect(200)
    ).body;
    expect(nextPage).toEqual({
      items: comments.items.slice(1),
      nextCursor: null,
    });
    expect(
      comments.items.map(({ text }: { text: string }) => text).sort(),
    ).toEqual(["Captured comment", "Captured second comment"]);
    const attachments = (await server().get(attachmentUrl).expect(200)).body;
    expect(attachments).toEqual([
      expect.objectContaining({ id: attachment.id, fileName: "capture.txt" }),
    ]);

    const storage = app.get(StorageService);
    const source = await prisma.attachment.findUniqueOrThrow({
      where: { id: attachment.id },
    });
    const copy = await prisma.boardShareSnapshotBlob.findFirstOrThrow({
      where: { shareId: share.id },
    });
    expect(copy.storedName).not.toBe(source.storedName);
    await server()
      .patch(`/api/v1/comments/${first.id}`)
      .set(auth(adminToken))
      .send({ text: "Edited original" })
      .expect(200);
    await server()
      .delete(`/api/v1/comments/${second.id}`)
      .set(auth(adminToken))
      .expect(200);
    await comment("Later comment");
    await prisma.attachment.update({
      where: { id: attachment.id },
      data: { fileName: "edited.txt" },
    });
    await writeFile(storage.attachmentPath(source.storedName), "edited bytes");
    const late = (
      await server()
        .post(`/api/v1/cards/${cardId}/attachments`)
        .set(auth(adminToken))
        .attach("file", Buffer.from("later bytes"), "later.txt")
        .expect(201)
    ).body;
    const expectFrozen = async () => {
      expect((await server().get(base).expect(200)).body).toEqual(before);
      expect((await server().get(commentUrl).expect(200)).body).toEqual(
        comments,
      );
      expect((await server().get(attachmentUrl).expect(200)).body).toEqual(
        attachments,
      );
      await server().get(contentUrl).expect(200, "captured bytes");
      await server().get(`${base}/attachments/${late.id}/content`).expect(404);
    };
    await expectFrozen();
    await server()
      .delete(`/api/v1/attachments/${attachment.id}`)
      .set(auth(adminToken))
      .expect(200);
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(adminToken))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), type: "ARCHIVE_BOARD" },
      })
      .expect(200);
    await expectFrozen();
    await server()
      .delete(`/api/v1/boards/${boardId}`)
      .set(auth(adminToken))
      .expect(200);
    await expectFrozen();

    await prisma.board.update({
      where: { id: boardId },
      data: { deletedAt: new Date(0) },
    });
    const maintenance = app.get(MaintenanceService);
    await maintenance.purgeSoftDeleted();
    expect(
      await prisma.board.findUnique({ where: { id: boardId } }),
    ).toBeNull();
    expect(
      await prisma.attachment.findUnique({ where: { id: attachment.id } }),
    ).toBeNull();
    await expect(
      access(storage.attachmentPath(source.storedName)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await utimes(storage.attachmentPath(copy.storedName), 0, 0);
    await maintenance.sweepOrphanBlobs();
    await expectFrozen();

    await prisma.boardShare.update({
      where: { id: share.id },
      data: { expiresAt: new Date(0) },
    });
    await maintenance.sweepShares();
    await maintenance.sweepOrphanBlobs();
    await expect(
      access(storage.attachmentPath(copy.storedName)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("only exposes opted-in data after capture or refresh (M18)", async () => {
    const { boardId, cardId } = await newBoard("Refresh nested data");
    const attachment = (
      await server()
        .post(`/api/v1/cards/${cardId}/attachments`)
        .set(auth(adminToken))
        .attach("file", Buffer.from("refresh bytes"), "refresh.txt")
        .expect(201)
    ).body;
    const share = await createShare(boardId, { mode: "snapshot" });
    const ownerUrl = `/api/v1/boards/${boardId}/shares/${share.id}`;
    const base = `/api/v1/share/${share.token}`;
    const contentUrl = `${base}/attachments/${attachment.id}/content`;
    await server()
      .patch(ownerUrl)
      .set(auth(adminToken))
      .send({ includeComments: true, includeAttachments: true })
      .expect(200);
    expect((await server().get(base).expect(200)).body).toMatchObject({
      includeComments: false,
      includeAttachments: false,
    });
    await server().get(`${base}/cards/${cardId}/comments`).expect(404);
    await server().get(contentUrl).expect(404);

    await server()
      .post(`${ownerUrl}/refresh`)
      .set(auth(adminToken))
      .expect(201);
    expect((await server().get(base).expect(200)).body).toMatchObject({
      includeComments: true,
      includeAttachments: true,
    });
    await server()
      .get(`${base}/cards/${cardId}/comments`)
      .expect(200, { items: [], nextCursor: null });
    await server().get(contentUrl).expect(200, "refresh bytes");

    const priorCopy = await prisma.boardShareSnapshotBlob.findFirstOrThrow({
      where: { shareId: share.id },
    });
    await server()
      .post(`${ownerUrl}/refresh`)
      .set(auth(adminToken))
      .expect(201);
    const copies = await prisma.boardShareSnapshotBlob.findMany({
      where: { shareId: share.id },
    });
    expect(copies).toHaveLength(1);
    expect(copies[0].storedName).not.toBe(priorCopy.storedName);
    await server().get(contentUrl).expect(200, "refresh bytes");

    await server()
      .patch(ownerUrl)
      .set(auth(adminToken))
      .send({ includeAttachments: false })
      .expect(200);
    await server().get(contentUrl).expect(404);
  });

  it("live: reads the board and is revoked with it (deleting a board)", async () => {
    const { boardId, cardId } = await newBoard("Share live");
    const share = await createShare(boardId, { mode: "live" });
    const snapshot = await createShare(boardId, { mode: "snapshot" });

    const payload = await server()
      .get(`/api/v1/share/${share.token}`)
      .expect(200);
    expect(payload.body.mode).toBe("live");
    expect(typeof payload.body.seq).toBe("number");
    expect(payload.body.board.cards[cardId]).toBeDefined();

    await server()
      .delete(`/api/v1/boards/${boardId}`)
      .set(auth(adminToken))
      .expect(200);

    // Deleting the board revokes its live links (the panel shows "revoked")
    // instead of leaving a link that answers 410.
    await server().get(`/api/v1/share/${share.token}`).expect(404);
    const row = await prisma.boardShare.findUnique({
      where: { id: share.id },
    });
    expect(row?.revokedAt).not.toBeNull();

    // A snapshot is a frozen copy — it survives the board's deletion.
    await server().get(`/api/v1/share/${snapshot.token}`).expect(200);
  });

  it("live: an archived board answers 410 Gone", async () => {
    const { boardId } = await newBoard("Share archived");
    const share = await createShare(boardId, { mode: "live" });

    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(adminToken))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), type: "ARCHIVE_BOARD" },
      })
      .expect(200);

    await server().get(`/api/v1/share/${share.token}`).expect(410);
  });

  it("is write-free: any POST through a token is 405", async () => {
    const { boardId } = await newBoard("Share read-only");
    const share = await createShare(boardId, { mode: "live" });
    await server().post(`/api/v1/share/${share.token}`).expect(405);
    await server()
      .post(`/api/v1/share/${share.token}/commands`)
      .send({})
      .expect(405);
    await server()
      .post(`/api/v1/share/${share.token}/cards/x/comments`)
      .send({ text: "hi" })
      .expect(405);
  });

  it("revoke and expiry both answer 404 for the token", async () => {
    const { boardId } = await newBoard("Share lifecycle");
    const revoked = await createShare(boardId, { mode: "live" });
    await server()
      .delete(`/api/v1/boards/${boardId}/shares/${revoked.id}`)
      .set(auth(adminToken))
      .expect(200);
    await server().get(`/api/v1/share/${revoked.token}`).expect(404);

    const expired = await createShare(boardId, { mode: "live" });
    // Rejecting a past TTL is a 400; expiry itself is proven by writing one.
    await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(auth(adminToken))
      .send({ mode: "live", expiresAt: "2000-01-01T00:00:00.000Z" })
      .expect(400);
    await prisma.boardShare.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await server().get(`/api/v1/share/${expired.token}`).expect(404);
  });

  it("uses expiresInHours in preference to an absolute expiry", async () => {
    const { boardId } = await newBoard("Relative expiry");
    const startedAt = Date.now();
    const { expiresAt } = await createShare(boardId, {
      mode: "live",
      expiresAt: "2000-01-01T00:00:00.000Z",
      expiresInHours: 2,
    });
    expect(expiresAt).toBeGreaterThanOrEqual(startedAt + 7_200_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7_200_000);
  });

  it("validates a supplied absolute expiry even with expiresInHours", async () => {
    const { boardId } = await newBoard("Invalid absolute expiry");
    const { body } = await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(auth(adminToken))
      .send({ mode: "live", expiresAt: "not a date", expiresInHours: 2 })
      .expect(400);
    expect(body).toMatchObject({
      code: "validation_failed",
      message: expect.stringContaining("expiresAt"),
    });
  });

  it("comments/attachments are gated by their flags", async () => {
    const { boardId, cardId } = await newBoard("Share flags");
    const closed = await createShare(boardId, {
      mode: "live",
      includeComments: false,
      includeAttachments: false,
    });
    await server()
      .get(`/api/v1/share/${closed.token}/cards/${cardId}/comments`)
      .expect(404);
    await server()
      .get(`/api/v1/share/${closed.token}/cards/${cardId}/attachments`)
      .expect(404);

    const open = await createShare(boardId, {
      mode: "live",
      includeComments: true,
    });
    await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(adminToken))
      .send({ text: "public comment" })
      .expect(201);
    const page = await server()
      .get(`/api/v1/share/${open.token}/cards/${cardId}/comments`)
      .expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].text).toBe("public comment");
  });

  it("serves a shared attachment as a download, never inline (TASK-76)", async () => {
    const { boardId, cardId } = await newBoard("Share attachment");
    const share = await createShare(boardId, {
      mode: "live",
      includeAttachments: true,
    });
    const storage = app.get(StorageService);
    await storage.ensureDirs();
    const storedName = `share-probe-${randomUUID()}.png`;
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050201009a61d11b0000000049454e44ae426082",
      "hex",
    );
    await writeFile(storage.attachmentPath(storedName), png);
    const attachment = await prisma.attachment.create({
      data: {
        cardId,
        boardId,
        uploadedById: adminId,
        fileName: "pixel.png",
        mimeType: "image/png",
        sizeBytes: png.length,
        storedName,
      },
    });

    const res = await server()
      .get(`/api/v1/share/${share.token}/attachments/${attachment.id}/content`)
      .expect(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).not.toContain("inline");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves an OG preview image", async () => {
    const { boardId } = await newBoard("Share og");
    const share = await createShare(boardId, { mode: "snapshot" });
    const res = await server()
      .get(`/api/v1/share/${share.token}/og.png`)
      .expect(200)
      .expect("Content-Type", /image\/png/);
    expect(res.body.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(res.headers["x-robots-tag"]).toContain("noindex");
  });

  it("rate-limits one token (per-token budget, §7.9.4)", async () => {
    const { boardId } = await newBoard("Share rate limit");
    const share = await createShare(boardId, { mode: "snapshot" });
    // The test env pins the per-token budget to 50; the 51st request trips it.
    let last = 200;
    for (let i = 0; i < 52; i += 1) {
      const res = await server().get(`/api/v1/share/${share.token}`);
      last = res.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it("increments the view counter on each payload read", async () => {
    const { boardId } = await newBoard("Share views");
    const share = await createShare(boardId, { mode: "snapshot" });
    await server().get(`/api/v1/share/${share.token}`).expect(200);
    await server().get(`/api/v1/share/${share.token}`).expect(200);
    const row = await prisma.boardShare.findUnique({
      where: { id: share.id },
    });
    expect(row?.views).toBe(2);
    expect(row?.lastViewedAt).not.toBeNull();
  });

  it("ALLOW_PUBLIC_SHARES=false turns every token into a 404", async () => {
    const { boardId } = await newBoard("Share switch");
    const share = await createShare(boardId, { mode: "snapshot" });
    const service = app.get(ShareService) as unknown as {
      isPublicSharingEnabled: () => boolean;
    };
    const spy = jest
      .spyOn(service, "isPublicSharingEnabled")
      .mockReturnValue(false);
    try {
      await server().get(`/api/v1/share/${share.token}`).expect(404);
    } finally {
      spy.mockRestore();
    }
    await server().get(`/api/v1/share/${share.token}`).expect(200);
  });

  it("streams live commands over SSE to an anonymous reader", async () => {
    const { boardId, columnId, cardId } = await newBoard("Share sse");
    const share = await createShare(boardId, { mode: "live" });
    const payload = await server()
      .get(`/api/v1/share/${share.token}`)
      .expect(200);

    const frames: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        `${baseUrl}/api/v1/share/${share.token}/events?since=${payload.body.seq}`,
        { headers: { Accept: "text/event-stream" } },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`SSE status ${res.statusCode ?? 0}`));
            return;
          }
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            for (const line of chunk.split("\n")) {
              if (line.startsWith("data:")) {
                const data = line.slice(5).trim();
                if (data === "ping" || data === "") continue;
                frames.push(data);
                if (data.includes("MOVE_CARD")) {
                  req.destroy();
                  resolve();
                }
              }
            }
          });
        },
      );
      req.on("error", (error) => {
        if (frames.some((frame) => frame.includes("MOVE_CARD"))) resolve();
        else reject(error);
      });
      // Give the stream a moment to attach, then move the card as the admin.
      setTimeout(() => {
        void server()
          .post(`/api/v1/boards/${boardId}/commands`)
          .set(auth(adminToken))
          .send({
            commandId: randomUUID(),
            action: {
              boardId,
              at: Date.now(),
              type: "MOVE_CARD",
              cardId,
              fromColumnId: columnId,
              fromIndex: 0,
              toColumnId: columnId,
              toIndex: 0,
            },
          })
          .then((res) => {
            if (res.status !== 200) {
              reject(new Error(`move command answered ${res.status}`));
            }
          });
      }, 300);
      setTimeout(() => {
        req.destroy();
        if (!frames.some((frame) => frame.includes("MOVE_CARD"))) {
          reject(new Error(`no MOVE_CARD frame; got ${frames.length} frames`));
        }
      }, 8_000);
    });
    expect(frames.some((frame) => frame.includes("MOVE_CARD"))).toBe(true);
    // Identity-leak guard: no presence/membership frames on the public stream.
    expect(frames.some((frame) => frame.includes('"presence"'))).toBe(false);
    expect(frames.some((frame) => frame.includes('"membership"'))).toBe(false);
    // The admin stays signed in for later specs (ids unused beyond setup).
    expect(adminId).toBeTruthy();
  }, 20_000);
});
