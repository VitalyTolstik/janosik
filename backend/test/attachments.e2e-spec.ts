import { Test } from "@nestjs/testing";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "crypto";

import { AppModule } from "@/app.module";
import { PrismaService } from "@/common/prisma/prisma.service";
import { setupApp } from "@/common/app-setup";

const PASSWORD = "Password123!";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("Attachments (TASK-47)", () => {
  async function register(
    server: request.SuperTest<request.Test>,
    email: string,
    displayName: string,
  ): Promise<{ token: string; id: string }> {
    const res = await server
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201);
    return { token: res.body.accessToken, id: res.body.user.id };
  }

  let app: INestApplication;
  let db: PrismaService;
  let server: () => request.SuperTest<request.Test>;
  let admin: { token: string; id: string };
  let member: { token: string; id: string };
  let viewer: { token: string; id: string };
  let outsider: { token: string; id: string };
  let boardId: string;
  let cardId: string;

  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050201009a61d11b0000000049454e44ae426082",
    "hex",
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(PrismaService);
    server = () => request(app.getHttpServer());

    await wipe();
    admin = await register(
      server(),
      `att-admin-${Date.now()}@test.local`,
      "Admin",
    );
    member = await register(
      server(),
      `att-member-${Date.now()}@test.local`,
      "Member",
    );
    viewer = await register(
      server(),
      `att-viewer-${Date.now()}@test.local`,
      "Viewer",
    );
    outsider = await register(
      server(),
      `att-out-${Date.now()}@test.local`,
      "Out",
    );

    const board = await server()
      .post("/api/v1/boards")
      .set(auth(admin.token))
      .send({ title: "Attachments board" })
      .expect(201);
    boardId = board.body.id;

    const inviteAndAccept = async (
      inviter: { token: string },
      guest: { token: string; id: string },
      email: string,
      role: "MEMBER" | "VIEWER",
    ): Promise<void> => {
      const created = await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(inviter.token))
        .send({ email, role })
        .expect(201);
      void created;
      const invitations = await server()
        .get("/api/v1/invitations")
        .set(auth(guest.token))
        .expect(200);
      const pending = invitations.body.find(
        (i: { boardId: string }) => i.boardId === boardId,
      );
      await server()
        .post(`/api/v1/invitations/${pending.id}/accept`)
        .set(auth(guest.token))
        .expect(200);
    };

    const memberEmail = (await db.user.findUnique({
      where: { id: member.id },
    }))!.email;
    const viewerEmail = (await db.user.findUnique({
      where: { id: viewer.id },
    }))!.email;
    await inviteAndAccept(admin, member, memberEmail, "MEMBER");
    await inviteAndAccept(admin, viewer, viewerEmail, "VIEWER");

    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(admin.token))
      .send({
        commandId: randomUUID(),
        action: { type: "ADD_COLUMN", newColumnId: "col-1", title: "C", at: 0 },
      })
      .expect(200);
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(admin.token))
      .send({
        commandId: randomUUID(),
        action: {
          type: "ADD_CARD",
          newCardId: "card-1",
          columnId: "col-1",
          title: "Card",
          at: 0,
        },
      })
      .expect(200);
    cardId = "card-1";
  });

  afterAll(async () => {
    await wipe();
    // Blobs bypass the DB wipe — clear the test upload tree.
    await rm(path.join(process.cwd(), "data"), {
      recursive: true,
      force: true,
    });
    await app.close();
  });

  async function wipe(): Promise<void> {
    await db.attachment.deleteMany();
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
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }

  it("uploads, lists and streams a file (members only)", async () => {
    const res = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(member.token))
      .attach("file", png, { filename: "pixel.png", contentType: "image/png" })
      .expect(201);
    expect(res.body).toMatchObject({
      cardId,
      fileName: "pixel.png",
      mimeType: "image/png",
      sizeBytes: png.length,
      uploadedById: member.id,
    });

    const list = await server()
      .get(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(viewer.token))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].fileName).toBe("pixel.png");

    const stream = await server()
      .get(`/api/v1/attachments/${res.body.id}/content`)
      .set(auth(member.token))
      .expect(200);
    expect(stream.headers["content-type"]).toContain("image/png");
    expect(stream.headers["content-disposition"]).toContain("attachment");
    expect(stream.body).toEqual(png);

    // Non-members are rejected without board access.
    await server()
      .get(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(outsider.token))
      .expect(403);
  });

  it("keeps UTF-8 filenames intact (multer latin1 mojibake)", async () => {
    // macOS screenshot names carry a U+202F before AM/PM; busboy decodes
    // multipart filenames as latin1, so the stored name must be re-decoded.
    const name = "Screenshot 2026-09-19 at 2.50.55\u202FPM.png";
    const res = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(member.token))
      .attach("file", png, { filename: name, contentType: "image/png" })
      .expect(201);
    expect(res.body.fileName).toBe(name);
    expect(res.body.fileName).not.toContain("\u00E2\u20AC\u00AF");
    // Later assertions count the card's attachments — remove the probe.
    await server()
      .delete(`/api/v1/attachments/${res.body.id as string}`)
      .set(auth(member.token))
      .expect(200);
  });

  it("rejects bad types and oversized files", async () => {
    await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(admin.token))
      .attach("file", Buffer.from("<svg onload=alert(1)/>"), {
        filename: "evil.svg",
        contentType: "image/svg+xml",
      })
      .expect(400);

    await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(admin.token))
      .attach("file", Buffer.alloc(26_214_401, 7), {
        filename: "big.bin",
        contentType: "application/octet-stream",
      })
      .expect(413);
  });

  it("refuses content whose bytes contradict the declared type (TASK-76)", async () => {
    // HTML dressed as a PNG: the bytes carry no PNG signature, so the server
    // rejects it instead of storing a `image/png` it would then serve.
    await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(member.token))
      .attach("file", Buffer.from("<html><script>alert(1)</script></html>"), {
        filename: "evil.png",
        contentType: "image/png",
      })
      .expect(400);
  });

  it("stores the detected type, not the declared one (TASK-76)", async () => {
    const res = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(member.token))
      .attach("file", png, {
        filename: "actually-a-png.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    // The bytes win: a real PNG is stored (and served) as `image/png`.
    expect(res.body.mimeType).toBe("image/png");
    await server()
      .delete(`/api/v1/attachments/${res.body.id as string}`)
      .set(auth(member.token))
      .expect(200);
  });

  it("keeps the card-face count in the aggregate and the activity feed", async () => {
    const snapshot = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(admin.token))
      .expect(200);
    expect(snapshot.body.cards[cardId].attachmentCount).toBe(1);

    const feed = await server()
      .get(`/api/v1/cards/${cardId}/activity`)
      .set(auth(member.token))
      .expect(200);
    const kinds = feed.body.items.map((e: { type: string }) => e.type);
    expect(kinds).toContain("attachment_added");
  });

  it("lets only the uploader or an ADMIN delete", async () => {
    const res = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(admin.token))
      .attach("file", png, { filename: "second.png", contentType: "image/png" })
      .expect(201);
    const id = res.body.id;

    // A VIEWER cannot write at all.
    await server()
      .delete(`/api/v1/attachments/${id}`)
      .set(auth(viewer.token))
      .expect(403);
    // A non-uploader MEMBER cannot delete someone else's file…
    await server()
      .delete(`/api/v1/attachments/${id}`)
      .set(auth(member.token))
      .expect(403);
    // …but the ADMIN can.
    await server()
      .delete(`/api/v1/attachments/${id}`)
      .set(auth(admin.token))
      .expect(200);

    await server()
      .get(`/api/v1/attachments/${id}/content`)
      .set(auth(member.token))
      .expect(404);

    const snapshot = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(admin.token))
      .expect(200);
    expect(snapshot.body.cards[cardId].attachmentCount).toBe(1);
  });

  describe("inline media (pasted into bodies, TASK-48)", () => {
    it("uploads hidden inline media without the card badge count", async () => {
      const res = await server()
        .post(`/api/v1/cards/${cardId}/attachments?inline=1`)
        .set(auth(member.token))
        .attach("file", png, {
          filename: "pasted.png",
          contentType: "image/png",
        })
        .expect(201);
      const inlineId = res.body.id as string;

      const list = await server()
        .get(`/api/v1/cards/${cardId}/attachments`)
        .set(auth(admin.token))
        .expect(200);
      expect(list.body.map((a: { id: string }) => a.id)).not.toContain(
        inlineId,
      );

      // Still streamable — the body markdown references exactly this URL.
      await server()
        .get(`/api/v1/attachments/${inlineId}/content`)
        .set(auth(viewer.token))
        .expect(200);

      const snapshot = await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(admin.token))
        .expect(200);
      expect(snapshot.body.cards[cardId].attachmentCount).toBe(1);
    });

    it("does not delete another board's inline media (TASK-81)", async () => {
      // The outsider owns a separate board with its own inline attachment.
      const otherBoard = await server()
        .post("/api/v1/boards")
        .set(auth(outsider.token))
        .send({ title: "Other board" })
        .expect(201);
      const otherBoardId = otherBoard.body.id as string;
      await server()
        .post(`/api/v1/boards/${otherBoardId}/commands`)
        .set(auth(outsider.token))
        .send({
          commandId: randomUUID(),
          action: {
            type: "ADD_COLUMN",
            newColumnId: "col-b",
            title: "C",
            at: 0,
          },
        })
        .expect(200);
      await server()
        .post(`/api/v1/boards/${otherBoardId}/commands`)
        .set(auth(outsider.token))
        .send({
          commandId: randomUUID(),
          action: {
            type: "ADD_CARD",
            newCardId: "card-b",
            columnId: "col-b",
            title: "Card",
            at: 0,
          },
        })
        .expect(200);
      const foreign = await server()
        .post("/api/v1/cards/card-b/attachments?inline=1")
        .set(auth(outsider.token))
        .attach("file", png, {
          filename: "foreign.png",
          contentType: "image/png",
        })
        .expect(201);
      const foreignId = foreign.body.id as string;

      // A member of *this* board pastes the foreign id and deletes the
      // comment — the soft-delete must stay scoped to this board.
      const comment = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(member.token))
        .send({ text: `see /api/v1/attachments/${foreignId}/content` })
        .expect(201);
      await server()
        .delete(`/api/v1/comments/${comment.body.id as string}`)
        .set(auth(member.token))
        .expect(200);

      const still = await server()
        .get(`/api/v1/attachments/${foreignId}/content`)
        .set(auth(outsider.token))
        .expect(200);
      expect(still.body).toEqual(png);
    });

    it("soft-deletes inline media referenced by a deleted comment", async () => {
      const res = await server()
        .post(`/api/v1/cards/${cardId}/attachments?inline=1`)
        .set(auth(member.token))
        .attach("file", png, {
          filename: "in-comment.png",
          contentType: "image/png",
        })
        .expect(201);
      const inlineId = res.body.id as string;

      // A regular attachment referenced from the same text must survive.
      const regular = await server()
        .post(`/api/v1/cards/${cardId}/attachments`)
        .set(auth(member.token))
        .attach("file", png, {
          filename: "regular.png",
          contentType: "image/png",
        })
        .expect(201);

      const comment = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(member.token))
        .send({
          text: `shot /api/v1/attachments/${inlineId}/content and /api/v1/attachments/${regular.body.id as string}/content`,
        })
        .expect(201);
      await server()
        .delete(`/api/v1/comments/${comment.body.id as string}`)
        .set(auth(member.token))
        .expect(200);

      await server()
        .get(`/api/v1/attachments/${inlineId}/content`)
        .set(auth(member.token))
        .expect(404);
      await server()
        .get(`/api/v1/attachments/${regular.body.id as string}/content`)
        .set(auth(member.token))
        .expect(200);

      // The badge counts only the regular attachment (1 + this one).
      const snapshot = await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(admin.token))
        .expect(200);
      expect(snapshot.body.cards[cardId].attachmentCount).toBe(2);
    });
  });

  describe("avatars", () => {
    it("uploads, replaces and streams the avatar image", async () => {
      const res = await server()
        .patch("/api/v1/users/me/avatar")
        .set(auth(member.token))
        .attach("file", png, { filename: "me.png", contentType: "image/png" })
        .expect(200);
      expect(res.body.avatarPath).toEqual(expect.any(String));

      const stream = await server()
        .get(`/api/v1/users/${member.id}/avatar`)
        .set(auth(outsider.token))
        .expect(200);
      expect(stream.headers["content-type"]).toBe("image/png");
      expect(stream.headers["cache-control"]).toContain("immutable");

      // Replacing keeps exactly one blob behind the path.
      const second = await server()
        .patch("/api/v1/users/me/avatar")
        .set(auth(member.token))
        .attach("file", png, { filename: "me2.png", contentType: "image/png" })
        .expect(200);
      expect(second.body.avatarPath).not.toBe(res.body.avatarPath);
    });

    it("rejects non-images and oversize files", async () => {
      await server()
        .patch("/api/v1/users/me/avatar")
        .set(auth(member.token))
        .attach("file", Buffer.from("hello"), {
          filename: "note.txt",
          contentType: "text/plain",
        })
        .expect(400);

      // HTML dressed as an image is refused by the magic-byte check (TASK-76).
      await server()
        .patch("/api/v1/users/me/avatar")
        .set(auth(member.token))
        .attach("file", Buffer.from("<html><script>alert(1)</script></html>"), {
          filename: "evil.png",
          contentType: "image/png",
        })
        .expect(400);

      await server()
        .patch("/api/v1/users/me/avatar")
        .set(auth(member.token))
        .attach("file", Buffer.alloc(2_097_153, 1), {
          filename: "huge.png",
          contentType: "image/png",
        })
        .expect(413);
    });

    it("answers 404 without an avatar", async () => {
      await server()
        .get(`/api/v1/users/${outsider.id}/avatar`)
        .set(auth(outsider.token))
        .expect(404);
    });
  });
});
