import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { ActivityFeedPage } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const OWNER_EMAIL = "actor-type-owner@example.com";
const PASSWORD = "correct horse battery";

/**
 * Actor attribution (TASK-157): a command issued through a browser session
 * is `"human"`, one issued with a personal API token is `"agent"`, and both
 * carry the type into the activity feed.
 */
describe("Actor type (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let session: string;
  let pat: string;
  let boardId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipe(prisma);

    session = await server()
      .post("/api/v1/auth/register")
      .send({ email: OWNER_EMAIL, password: PASSWORD, displayName: "Owner" })
      .expect(201)
      .then((res) => res.body.accessToken as string);

    boardId = await server()
      .post("/api/v1/boards")
      .set(auth(session))
      .send({ title: "Actor board" })
      .expect(201)
      .then((res) => res.body.id as string);
    await command(
      { type: "ADD_COLUMN", newColumnId: "col-1", title: "Todo" },
      session,
    );
    await command(
      {
        type: "ADD_CARD",
        newCardId: "card-1",
        columnId: "col-1",
        title: "First",
      },
      session,
    );

    pat = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(session))
      .send({ name: "agent", expiresAt: null })
      .expect(201)
      .then((res) => res.body.token as string);
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function command(
    action: Record<string, unknown>,
    token: string,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      })
      .expect(200);
  }

  it("marks a session command human and a PAT command agent", async () => {
    await command({ type: "TOUCH_CARD", cardId: "card-1" }, session);
    await command({ type: "TOUCH_CARD", cardId: "card-1" }, pat);

    const feed = await server()
      .get(`/api/v1/boards/${boardId}/activity`)
      .set(auth(session))
      .expect(200)
      .then((res) => res.body as ActivityFeedPage);

    const byCommand = feed.items.filter((entry) => entry.type === "TOUCH_CARD");
    // Newest first: the PAT command landed last.
    expect(byCommand[0]?.actorType).toBe("agent");
    expect(byCommand[1]?.actorType).toBe("human");
  });

  async function wipe(db: PrismaService): Promise<void> {
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
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.apiToken.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
