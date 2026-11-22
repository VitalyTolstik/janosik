import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const PASSWORD = "Password123!";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Archived boards are read-only for content, not just for reducer commands.
 * Comments and attachments are ordinary REST writes outside the command log,
 * so their card/comment/attachment routes share the same refusal while reads
 * stay open. This is the contract the UI and MCP both consume.
 */
describe("Archived board REST writes (e2e)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let server: () => ReturnType<typeof request>;
  let token: string;
  let boardId: string;
  let cardId: string;
  let commentId: string;
  let attachmentId: string;

  const note = Buffer.from("attachment body", "utf8");

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

    const registered = await server()
      .post("/api/v1/auth/register")
      .send({
        email: `archived-rest-${Date.now()}@test.local`,
        password: PASSWORD,
        displayName: "Archived REST",
      })
      .expect(201);
    token = registered.body.accessToken;

    const board = await server()
      .post("/api/v1/boards")
      .set(auth(token))
      .send({ title: "Archived REST board" })
      .expect(201);
    boardId = board.body.id;
    cardId = randomUUID();
    await command({
      type: "ADD_COLUMN",
      newColumnId: randomUUID(),
      title: "Todo",
    });
    const aggregate = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(token))
      .expect(200);
    const columnId = aggregate.body.columns[0].id;
    await command({
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Archived card",
    });

    const comment = await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(token))
      .send({ text: "Before archive" })
      .expect(201);
    commentId = comment.body.id;

    const attachment = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(token))
      .attach("file", note, {
        filename: "before.txt",
        contentType: "text/plain",
      })
      .expect(201);
    attachmentId = attachment.body.id;

    await command({ type: "ARCHIVE_BOARD" });
  });

  afterAll(async () => {
    await wipe();
    await rm(path.join(process.cwd(), "data"), {
      recursive: true,
      force: true,
    });
    await app.close();
  });

  function command(action: Record<string, unknown>) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      });
  }

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

  it("keeps reads open and refuses comment/attachment writes until restore", async () => {
    await server()
      .get(`/api/v1/cards/${cardId}/comments`)
      .set(auth(token))
      .expect(200)
      .expect((res) => {
        expect(res.body.items[0]).toMatchObject({
          id: commentId,
          text: "Before archive",
        });
      });
    await server()
      .get(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(token))
      .expect(200)
      .expect((res) => {
        expect(res.body.map((row: { id: string }) => row.id)).toContain(
          attachmentId,
        );
      });

    const create = await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(token))
      .send({ text: "Written through the archive" });
    expect(create.status).toBe(409);
    expect(create.body.message).toMatch(/archived/i);

    const edit = await server()
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(token))
      .send({ text: "Edited through the archive" });
    expect(edit.status).toBe(409);
    expect(edit.body.message).toMatch(/archived/i);

    const removeComment = await server()
      .delete(`/api/v1/comments/${commentId}`)
      .set(auth(token));
    expect(removeComment.status).toBe(409);

    const upload = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(token))
      .attach("file", note, {
        filename: "after.txt",
        contentType: "text/plain",
      });
    expect(upload.status).toBe(409);
    expect(upload.body.message).toMatch(/archived/i);

    const removeAttachment = await server()
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set(auth(token));
    expect(removeAttachment.status).toBe(409);

    await command({ type: "UNARCHIVE_BOARD" }).expect(200);
    await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(token))
      .send({ text: "After restore" })
      .expect(201);
    await server()
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set(auth(token))
      .expect(200);
  });
});
