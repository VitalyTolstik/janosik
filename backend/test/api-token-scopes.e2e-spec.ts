import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const OWNER_EMAIL = "token-scopes@example.com";
const PASSWORD = "correct horse battery";

/**
 * Per-token scopes (TASK-157): a read-only token refuses writes, a
 * board-scoped token reaches only its board, and a per-token rate limit
 * answers 429 once its budget is spent.
 */
describe("API token scopes (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let session: string;
  let boardA: string;
  let boardB: string;

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

    boardA = await createBoard("Board A");
    boardB = await createBoard("Board B");
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createBoard(title: string): Promise<string> {
    return server()
      .post("/api/v1/boards")
      .set(auth(session))
      .send({ title })
      .expect(201)
      .then((res) => res.body.id as string);
  }

  async function createToken(body: Record<string, unknown>): Promise<string> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(session))
      .send(body)
      .expect(201)
      .then((res) => res.body.token as string);
  }

  it("refuses a write from a read-only token", async () => {
    const pat = await createToken({ name: "reader", readOnly: true });
    await server().get(`/api/v1/boards/${boardA}`).set(auth(pat)).expect(200);

    const res = await server()
      .post(`/api/v1/boards/${boardA}/commands`)
      .set(auth(pat))
      .send({
        commandId: randomUUID(),
        action: {
          boardId: boardA,
          at: Date.now(),
          type: "ADD_COLUMN",
          newColumnId: "col-ro",
          title: "Todo",
        },
      })
      .expect(403);
    expect(res.body.code).toBe("pat_read_only");
  });

  it("keeps a board-scoped token on its board", async () => {
    const pat = await createToken({ name: "scoped", boardId: boardA });
    await server().get(`/api/v1/boards/${boardA}`).set(auth(pat)).expect(200);
    await server().get(`/api/v1/boards/${boardB}`).set(auth(pat)).expect(403);

    const list = await server()
      .get("/api/v1/boards")
      .set(auth(pat))
      .expect(200);
    expect((list.body as Array<{ id: string }>).map((b) => b.id)).toEqual([
      boardA,
    ]);

    await server()
      .post("/api/v1/boards")
      .set(auth(pat))
      .send({ title: "Outside scope" })
      .expect(403);
    await server()
      .post("/api/v1/boards/import")
      .set(auth(pat))
      .send({})
      .expect(403);
  });

  it("enforces the per-token rate limit with headers and the 429 envelope", async () => {
    const pat = await createToken({
      name: "fast",
      rateLimitPerMinute: 2,
    });
    const first = await server()
      .get(`/api/v1/boards/${boardA}`)
      .set(auth(pat))
      .expect(200);
    expect(first.headers["x-ratelimit-limit"]).toBe("2");
    expect(first.headers["x-ratelimit-remaining"]).toBe("1");
    expect(first.headers["x-ratelimit-scope"]).toBe("token");
    expect(first.headers["ratelimit-limit"]).toBe("2");
    expect(Number(first.headers["x-ratelimit-reset"])).toBeGreaterThan(
      Math.floor(Date.now() / 1000) - 1,
    );

    const second = await server()
      .get(`/api/v1/boards/${boardA}`)
      .set(auth(pat))
      .expect(200);
    expect(second.headers["x-ratelimit-remaining"]).toBe("0");

    const denied = await server()
      .get(`/api/v1/boards/${boardA}`)
      .set(auth(pat))
      .expect(429);
    expect(denied.headers["retry-after"]).toBeDefined();
    expect(Number(denied.headers["retry-after"])).toBeGreaterThan(0);
    expect(denied.headers["x-ratelimit-remaining"]).toBe("0");
    expect(denied.headers["x-ratelimit-scope"]).toBe("token");
    expect(denied.body).toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfter: Number(denied.headers["retry-after"]),
      requestId: denied.headers["x-request-id"],
      limit: 2,
      scope: "token",
    });
  });

  it("isolates per-token budgets", async () => {
    const exhausted = await createToken({
      name: "exhausted",
      rateLimitPerMinute: 1,
    });
    await server()
      .get(`/api/v1/boards/${boardA}`)
      .set(auth(exhausted))
      .expect(200);
    await server()
      .get(`/api/v1/boards/${boardA}`)
      .set(auth(exhausted))
      .expect(429);

    const fresh = await createToken({
      name: "fresh",
      rateLimitPerMinute: 1,
    });
    await server().get(`/api/v1/boards/${boardA}`).set(auth(fresh)).expect(200);
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
