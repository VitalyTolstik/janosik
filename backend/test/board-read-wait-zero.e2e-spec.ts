import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import {
  BOARD_READ_LIMITS,
  type BoardReadLimits,
} from "@/common/board-read.service";
import { PrismaService } from "@/common/prisma/prisma.service";

const EMAIL = "board-read-wait-zero@example.com";
const PASSWORD = "correct horse battery";

const LIMITS: BoardReadLimits = {
  maxConcurrent: 1,
  queueMax: 0,
  waitMs: 0,
  timeoutMs: 1_500,
  retryAfterSeconds: 1,
  compressMinBytes: 1024,
};

/**
 * TASK-200.6: WAIT_MS=0 still has a usable shared deadline for the conditional
 * stamp and the full aggregate transaction (`maxWait=0`, transaction gets the
 * remaining budget). A full 200 and a 304 must both work with no semaphore or
 * pool wait.
 */
describe("Board read with WAIT_MS=0 (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BOARD_READ_LIMITS)
      .useValue(LIMITS)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    prisma = app.get(PrismaService);
    await wipe();
    token = await register();
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function register(): Promise<string> {
    const response = await server()
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD, displayName: "Wait zero" })
      .expect(201);
    return response.body.accessToken as string;
  }

  async function wipe(): Promise<void> {
    await prisma.attachment.deleteMany();
    await prisma.cardLink.deleteMany();
    await prisma.cardLabel.deleteMany();
    await prisma.checklistItem.deleteMany();
    await prisma.checklist.deleteMany();
    await prisma.commentRevision.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.command.deleteMany();
    await prisma.card.deleteMany();
    await prisma.column.deleteMany();
    await prisma.label.deleteMany();
    await prisma.boardMember.deleteMany();
    await prisma.boardShare.deleteMany();
    await prisma.board.deleteMany();
    await prisma.apiToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  }

  it("serves a full 200 and then a 304 without queue or pool wait", async () => {
    const created = await server()
      .post("/api/v1/boards")
      .set(auth())
      .send({ title: "Wait zero board" })
      .expect(201);
    const boardId = created.body.id as string;

    const fresh = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth())
      .set("If-None-Match", 'W/"stale"')
      .expect(200);
    expect(fresh.body.id).toBe(boardId);
    const etag = String(fresh.headers.etag);
    expect(etag).toMatch(/^W\//);

    await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth())
      .set("If-None-Match", etag)
      .expect(304);
  });
});
