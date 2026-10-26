import { Test } from "@nestjs/testing";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { AppModule } from "@/app.module";
import { PrismaService } from "@/common/prisma/prisma.service";
import { setupApp } from "@/common/app-setup";

const PASSWORD = "Password123!";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * TASK-70 — media derivatives: an uploaded image gets an ffmpeg thumbnail and
 * a video gets a poster frame, both served by dedicated routes (with a
 * fallback to the full blob when a derivative is missing).
 */
describe("Media derivatives (TASK-70)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let server: () => ReturnType<typeof request>;
  let token: string;
  let boardId: string;
  const suffix = Date.now();
  const cardId = `card-${suffix}`;
  const columnId = `col-${suffix}`;

  const image = path.join(__dirname, "fixtures", "sample-image.png");
  const clip = path.join(__dirname, "fixtures", "sample-video.mp4");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(PrismaService);
    server = () => request(app.getHttpServer());

    const email = `md-${suffix}@test.local`;
    const reg = await server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName: "Md" })
      .expect(201);
    token = reg.body.accessToken;
    const board = await server()
      .post("/api/v1/boards")
      .set(auth(token))
      .send({ title: "Media board" })
      .expect(201);
    boardId = board.body.id;
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: crypto.randomUUID(),
        action: {
          boardId,
          at: Date.now(),
          type: "ADD_COLUMN",
          newColumnId: columnId,
          title: "C",
        },
      })
      .expect(200);
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: crypto.randomUUID(),
        action: {
          boardId,
          at: Date.now(),
          type: "ADD_CARD",
          newCardId: cardId,
          columnId,
          title: "First",
        },
      })
      .expect(200);
  }, 30000);

  afterAll(async () => {
    await db.attachment.deleteMany({ where: { cardId } });
    await db.activity.deleteMany({ where: { boardId } });
    await db.command.deleteMany({ where: { boardId } });
    await db.card.deleteMany({ where: { id: cardId } });
    await db.column.deleteMany({ where: { boardId } });
    await db.boardMember.deleteMany({ where: { boardId } });
    await db.boardShare.deleteMany({ where: { boardId } });
    await db.board.deleteMany({ where: { id: boardId } });
    await db.refreshToken.deleteMany({
      where: { user: { email: { startsWith: `md-${suffix}` } } },
    });
    await db.user.deleteMany({
      where: { email: { startsWith: `md-${suffix}` } },
    });
    await app.close();
  });

  async function upload(name: string, mime: string, data: Buffer) {
    return server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(token))
      .attach("file", data, { filename: name, contentType: mime })
      .expect(201);
  }

  async function waitFor(
    attachmentId: string,
    field: "thumbnailName" | "posterName",
    timeoutMs = 45_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await db.attachment.findUnique({
        where: { id: attachmentId },
      });
      if (row && row[field]) return;
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for ${field}: derivativeStatus=${row?.derivativeStatus}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  it("makes a thumbnail for an image and serves it", async () => {
    const created = await upload("pixel.png", "image/png", readFileSync(image));
    expect(created.body.hasThumbnail).toBe(false);
    await waitFor(created.body.id, "thumbnailName");

    const thumb = await server()
      .get(`/api/v1/attachments/${created.body.id}/thumbnail`)
      .set(auth(token))
      .expect(200);
    expect(thumb.headers["content-type"]).toContain("image/jpeg");
  }, 60000);

  it("makes a poster for a video and serves it", async () => {
    const created = await upload("clip.mp4", "video/mp4", readFileSync(clip));
    await waitFor(created.body.id, "posterName");

    const poster = await server()
      .get(`/api/v1/attachments/${created.body.id}/poster`)
      .set(auth(token))
      .expect(200);
    expect(poster.headers["content-type"]).toContain("image/jpeg");
  }, 60000);

  it("404s a poster that does not exist", async () => {
    const created = await upload(
      "doc.pdf",
      "application/pdf",
      readFileSync(image),
    );
    await server()
      .get(`/api/v1/attachments/${created.body.id}/poster`)
      .set(auth(token))
      .expect(404);
  });
});
