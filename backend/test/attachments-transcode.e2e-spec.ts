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
 * TASK-50 — the video "ужиматор": video uploads take a real ffmpeg pass in
 * the background (ffmpeg-static binary, same as production) and end up as
 * a compact MP4 behind the same content URL; failures keep the original.
 */
describe("Video transcode (TASK-50)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let server: () => request.SuperTest<request.Test>;
  let token: string;
  let boardId: string;
  let cardId: string;

  // A 1-second color-bars clip generated once by ffmpeg itself (committed).
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

    const email = `tr-${Date.now()}@test.local`;
    const reg = await server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName: "Tr" })
      .expect(201);
    token = reg.body.accessToken;
    const board = await server()
      .post("/api/v1/boards")
      .set(auth(token))
      .send({ title: "Transcode board" })
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
          newColumnId: "col-1",
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
          newCardId: "card-1",
          columnId: "col-1",
          title: "First",
        },
      })
      .expect(200);
    cardId = "card-1";
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
      where: { user: { email: { startsWith: "tr-" } } },
    });
    await db.user.deleteMany({ where: { email: { startsWith: "tr-" } } });
    await app.close();
  });

  async function upload(name: string, mime: string, data: Buffer) {
    return server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(token))
      .attach("file", data, { filename: name, contentType: mime })
      .expect(201);
  }

  async function waitStatus(
    attachmentId: string,
    want: "done" | "failed",
    timeoutMs = 90_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await server()
        .get(`/api/v1/cards/${cardId}/attachments`)
        .set(auth(token))
        .expect(200);
      const row = (res.body as { id: string; transcodeStatus: string }[]).find(
        (item) => item.id === attachmentId,
      );
      if (row !== undefined && row.transcodeStatus === want) return row;
      if (
        row !== undefined &&
        row.transcodeStatus === "failed" &&
        want === "done"
      ) {
        throw new Error("encode failed while waiting for done");
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for "${want}"`);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  it("encodes a video upload into a compact MP4 behind the same URL", async () => {
    const original = await upload("clip.mp4", "video/mp4", readFileSync(clip));
    expect(original.body.transcodeStatus).toBe("pending");

    const row = await waitStatus(original.body.id, "done");
    expect((row as { mimeType: string }).mimeType).toBe("video/mp4");

    const content = await server()
      .get(`/api/v1/attachments/${original.body.id}/content`)
      .set(auth(token))
      .expect(200);
    expect(content.headers["content-type"]).toBe("video/mp4");
    expect(content.body.length).toBeGreaterThan(0);

    // The original blob is gone — the MP4 replaced it on disk.
    const stored = await db.attachment.findUniqueOrThrow({
      where: { id: original.body.id },
      select: { storedName: true },
    });
    expect(stored.storedName).toMatch(/\.mp4$/);
  }, 120_000);

  it("keeps the original playable when ffmpeg cannot decode the file", async () => {
    // A real MP4 container header (so the magic-byte check accepts it —
    // TASK-76) followed by bytes ffmpeg cannot decode.
    const broken = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from("ftypisom", "latin1"),
      Buffer.from("not a decodable video"),
    ]);
    const garbage = await upload("broken.mp4", "video/mp4", broken);
    expect(garbage.body.transcodeStatus).toBe("pending");

    await waitStatus(garbage.body.id, "failed");
    const content = await server()
      .get(`/api/v1/attachments/${garbage.body.id}/content`)
      .set(auth(token))
      .expect(200);
    expect(Buffer.from(content.body).equals(broken)).toBe(true);
  }, 120_000);

  it("leaves non-video files at transcodeStatus none", async () => {
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050201009a61d11b0000000049454e44ae426082",
      "hex",
    );
    const res = await upload("pic.png", "image/png", png);
    expect(res.body.transcodeStatus).toBe("none");
  });
});
