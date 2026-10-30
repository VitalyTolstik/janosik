import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Board, BoardAction } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const OWNER_EMAIL = "task-spec-owner@example.com";
const PASSWORD = "correct horse battery";

/**
 * The task contract (TASK-157): `SET_CARD_TASK_SPEC` persists the
 * `acceptanceCriteria` / `definitionOfDone` lists, an empty list clears a
 * field, and the strict validator rejects an oversized item with `400`.
 */
describe("Card task spec (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
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

    ownerToken = await register(OWNER_EMAIL, "Owner");

    boardId = await server()
      .post("/api/v1/boards")
      .set(auth(ownerToken))
      .send({ title: "Task spec board" })
      .expect(201)
      .then((res) => res.body.id as string);
    await command({
      type: "ADD_COLUMN",
      newColumnId: "col-1",
      title: "Todo",
    });
    await command({
      type: "ADD_CARD",
      newCardId: "card-1",
      columnId: "col-1",
      title: "First",
    });
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function command(action: Record<string, unknown>): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(ownerToken))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      })
      .expect(200);
  }

  async function card(): Promise<Board["cards"][string]> {
    const board = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(ownerToken))
      .expect(200)
      .then((res) => res.body as Board);
    return board.cards["card-1"];
  }

  it("persists both fields", async () => {
    await command({
      type: "SET_CARD_TASK_SPEC",
      cardId: "card-1",
      acceptanceCriteria: ["runs", "passes CI"],
      definitionOfDone: ["tests green"],
    });
    const current = await card();
    expect(current.acceptanceCriteria).toEqual(["runs", "passes CI"]);
    expect(current.definitionOfDone).toEqual(["tests green"]);
  });

  it("clears a field with an empty list and leaves the other", async () => {
    await command({
      type: "SET_CARD_TASK_SPEC",
      cardId: "card-1",
      acceptanceCriteria: [],
    });
    const current = await card();
    expect(current.acceptanceCriteria).toBeUndefined();
    expect(current.definitionOfDone).toEqual(["tests green"]);
  });

  it("rejects an oversized item with 400", async () => {
    const res = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(ownerToken))
      .send({
        commandId: randomUUID(),
        action: {
          boardId,
          at: Date.now(),
          type: "SET_CARD_TASK_SPEC",
          cardId: "card-1",
          definitionOfDone: ["x".repeat(501)],
        } as unknown as BoardAction,
      })
      .expect(400);
    expect(res.body.field).toBe("action.definitionOfDone[0]");
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
