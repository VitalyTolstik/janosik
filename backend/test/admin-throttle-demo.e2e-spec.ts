import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const OWNER_EMAIL = "throttle-owner@example.com";
const OWNER_PASSWORD = "owner correct horse battery";
const OPERATOR_EMAIL = "throttle-operator@example.com";
const OPERATOR_PASSWORD = "operator correct horse battery";
const USER_EMAIL = "throttle-user@example.com";
const USER_PASSWORD = "user correct horse battery";

/**
 * Master-panel rate limit, live traffic gauge and the demo runner (TASK-57).
 * The demo is seeded with `run:false` so nothing advances on a timer; the
 * point here is the lifecycle — provision, refuse a second run, and purge the
 * exact footprint on stop.
 */
describe("Admin throttle settings & demo runner (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let operatorToken: string;
  let userToken: string;

  const server = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.adminAuditLog.deleteMany();
    await prisma.adminRefreshToken.deleteMany();
    await prisma.adminUser.deleteMany();
    await prisma.demoRun.deleteMany();
    await prisma.throttleSettings.deleteMany();
    await prisma.refreshToken.deleteMany();
    // The e2e DB accumulates across runs — wipe content (child → parent) so a
    // previous demo run's commands/users cannot block this suite's setup.
    await prisma.command.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.cardLabel.deleteMany();
    await prisma.checklistItem.deleteMany();
    await prisma.checklist.deleteMany();
    await prisma.cardLink.deleteMany();
    await prisma.card.deleteMany();
    await prisma.column.deleteMany();
    await prisma.label.deleteMany();
    await prisma.boardMember.deleteMany();
    await prisma.board.deleteMany();
    await prisma.user.deleteMany();

    await prisma.adminUser.createMany({
      data: [
        {
          email: OWNER_EMAIL,
          role: "OWNER",
          passwordHash: await argonHash(OWNER_PASSWORD, { type: argon2id }),
        },
        {
          email: OPERATOR_EMAIL,
          role: "OPERATOR",
          passwordHash: await argonHash(OPERATOR_PASSWORD, { type: argon2id }),
        },
      ],
    });
    await prisma.user.create({
      data: {
        email: USER_EMAIL,
        passwordHash: await argonHash(USER_PASSWORD, { type: argon2id }),
      },
    });

    const login = (email: string, password: string) =>
      server()
        .post("/api/v1/admin/auth/login")
        .send({ email, password })
        .expect(200);
    ownerToken = (await login(OWNER_EMAIL, OWNER_PASSWORD)).body.accessToken;
    operatorToken = (await login(OPERATOR_EMAIL, OPERATOR_PASSWORD)).body
      .accessToken;
    userToken = (
      await server()
        .post("/api/v1/auth/login")
        .send({ email: USER_EMAIL, password: USER_PASSWORD })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects anonymous and user-token access", async () => {
    await server().get("/api/v1/admin/throttle-settings").expect(401);
    await server()
      .get("/api/v1/admin/throttle-settings")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(401);
    await server().get("/api/v1/admin/demo").expect(401);
  });

  it("lets an operator view but not edit the limit", async () => {
    const view = await server()
      .get("/api/v1/admin/throttle-settings")
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(200);
    expect(typeof view.body.limit).toBe("number");

    await server()
      .put("/api/v1/admin/throttle-settings")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ limit: 42 })
      .expect(403);
  });

  it("persists an owner-set limit and reflects it in the traffic gauge", async () => {
    const saved = await server()
      .put("/api/v1/admin/throttle-settings")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ limit: 1234 })
      .expect(200);
    expect(saved.body).toMatchObject({ limit: 1234, source: "db" });

    const traffic = await server()
      .get("/api/v1/admin/traffic")
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(200);
    expect(traffic.body.limit).toBe(1234);
    expect(traffic.body.perSecond).toHaveLength(60);

    await server()
      .put("/api/v1/admin/throttle-settings")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ limit: 0 })
      .expect(400);
  });

  it("runs the demo lifecycle: seed, refuse a second run, purge on stop", async () => {
    await server()
      .get("/api/v1/admin/demo")
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(200);

    // Only owners may start it.
    await server()
      .post("/api/v1/admin/demo/start")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ users: 3, run: false })
      .expect(403);

    const started = await server()
      .post("/api/v1/admin/demo/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ users: 3, cards: 5, run: false })
      .expect(201);
    expect(started.body).toMatchObject({
      running: true,
      users: 4, // dispatcher + 3 agents
      cards: 5, // independent of the agent count
    });
    const boardId: string = started.body.boardId;
    expect(typeof boardId).toBe("string");

    // The dedicated board is fully populated.
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      include: {
        _count: {
          select: { columns: true, labels: true, members: true },
        },
      },
    });
    expect(board).not.toBeNull();
    expect(board?._count.columns).toBe(5);
    expect(board?._count.labels).toBe(5);
    expect(board?._count.members).toBe(4);
    expect(await prisma.card.count({ where: { column: { boardId } } })).toBe(5);

    // A second start while one is live is refused.
    await server()
      .post("/api/v1/admin/demo/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ users: 3, run: false })
      .expect(409);

    // Stop removes exactly the run's footprint: board, cards, demo users.
    const stopped = await server()
      .post("/api/v1/admin/demo/stop")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    expect(stopped.body.running).toBe(false);

    expect(
      await prisma.board.findUnique({ where: { id: boardId } }),
    ).toBeNull();
    expect(
      await prisma.user.count({
        where: { email: { contains: "@janosik.demo" } },
      }),
    ).toBe(0);

    // The stop is audited.
    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: "demo.stopped" },
    });
    expect(audit).not.toBeNull();
  });

  it("owns the board under an existing watcher and keeps that account on cleanup", async () => {
    const watcher = "demo-watcher@example.com";
    await prisma.user.deleteMany({ where: { email: watcher } });
    await prisma.user.create({
      data: { email: watcher, emailVerifiedAt: new Date() },
    });

    const started = await server()
      .post("/api/v1/admin/demo/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ users: 1, cards: 1, run: false, watcherEmail: watcher })
      .expect(201);
    const boardId: string = started.body.boardId;

    const owner = await prisma.boardMember.findFirst({
      where: { boardId, role: "ADMIN" },
      include: { user: true },
    });
    expect(owner?.user.email).toBe(watcher);

    await server()
      .post("/api/v1/admin/demo/stop")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);

    // A real account is never deleted — only its membership is dropped.
    expect(await prisma.user.count({ where: { email: watcher } })).toBe(1);
    await prisma.user.deleteMany({ where: { email: watcher } });
  });

  it("rejects a watcher email with no account", async () => {
    await server()
      .post("/api/v1/admin/demo/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        users: 1,
        cards: 1,
        run: false,
        watcherEmail: "ghost@example.com",
      })
      .expect(400);
  });
});
