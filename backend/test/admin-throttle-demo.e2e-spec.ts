import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { FeatureFlagsService } from "@/ops/feature-flags.service";
import { MaintenanceService } from "@/ops/maintenance.service";
import { BoardsService } from "@/boards/boards.service";
import { CommandsService } from "@/commands/commands.service";
import { DemoService } from "@/admin/demo.service";
import type { Prisma } from "@prisma/client";

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
    await prisma.commentRevision.deleteMany();
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
    await prisma.boardShare.deleteMany();
    await prisma.board.deleteMany();
    // Rows that reference a user without a cascade (another suite may have
    // left them behind) must go before the users themselves.
    await prisma.apiToken.deleteMany();
    await prisma.dataExport.deleteMany();
    await prisma.reminderSent.deleteMany();
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

  it("refuses to provision a demo when public sharing is disabled (M4)", async () => {
    await prisma.featureFlag.upsert({
      where: { key: "public_shares" },
      create: { key: "public_shares", enabled: false },
      update: { enabled: false },
    });
    try {
      const res = await server()
        .post("/api/v1/admin/demo/start")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ users: 2, cards: 2, run: false })
        .expect(409);
      expect(res.body.code).toBe("public_shares_disabled");
      expect(await prisma.demoRun.count()).toBe(0);
      expect(
        await prisma.user.count({
          where: { email: { contains: "@janosik.demo" } },
        }),
      ).toBe(0);
    } finally {
      await prisma.featureFlag.update({
        where: { key: "public_shares" },
        data: { enabled: true },
      });
    }
  });

  it("re-checks public sharing after cleanup (M4)", async () => {
    const flags = app.get(FeatureFlagsService);
    const spy = jest
      .spyOn(flags, "isEnabled")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    try {
      const res = await server()
        .post("/api/v1/admin/demo/start")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ users: 2, cards: 2, run: false })
        .expect(409);
      expect(res.body.code).toBe("public_shares_disabled");
      expect(await prisma.demoRun.count()).toBe(0);
      expect(
        await prisma.user.count({
          where: { email: { contains: "@janosik.demo" } },
        }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("rolls back provisioning when public sharing flips off before the share (M4)", async () => {
    const flags = app.get(FeatureFlagsService);
    const spy = jest
      .spyOn(flags, "isEnabled")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    try {
      const res = await server()
        .post("/api/v1/admin/demo/start")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ users: 2, cards: 2, run: false })
        .expect(409);
      expect(res.body.code).toBe("public_shares_disabled");
      expect(await prisma.demoRun.count()).toBe(0);
      expect(
        await prisma.user.count({
          where: { email: { contains: "@janosik.demo" } },
        }),
      ).toBe(0);
      expect(
        await prisma.board.count({
          where: { title: { startsWith: "Демо · рой агентов" } },
        }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
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

  it("serializes simultaneous starts and a stop arriving during provisioning (H9)", async () => {
    const boards = app.get(BoardsService);
    const demo = app.get(DemoService);
    const createBoard = boards.createBoard.bind(boards);
    let resume!: () => void;
    let begin!: () => void;
    const provisioning = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const spy = jest
      .spyOn(boards, "createBoard")
      .mockImplementationOnce(async (...args) => {
        begin();
        await paused;
        return createBoard(...args);
      });
    try {
      const input = { users: 1, cards: 1, run: false };
      const start = demo.start(input, OWNER_EMAIL);
      await provisioning;
      const reserved = await prisma.demoRun.findFirstOrThrow({
        where: { status: "stopping" },
      });
      expect(reserved.manifest).toMatchObject({
        boardId: reserved.boardId,
        createdBoard: true,
        cardIds: [expect.any(String)],
        checklistIds: [expect.any(String)],
        itemIds: [expect.any(String), expect.any(String), expect.any(String)],
      });
      expect(
        await prisma.board.count({ where: { id: reserved.boardId } }),
      ).toBe(0);

      const second = expect(
        demo.start(input, OWNER_EMAIL),
      ).rejects.toMatchObject({ status: 409 });
      const stop = demo.stop(OWNER_EMAIL);
      resume();

      const started = await start;
      expect(started).toMatchObject({ running: true, cards: 1 });
      await second;
      await expect(stop).resolves.toMatchObject({
        running: false,
        cleanupPending: false,
      });
      expect(
        await prisma.demoRun.count({ where: { boardId: started.boardId! } }),
      ).toBe(1);
      expect(
        await prisma.board.count({ where: { id: started.boardId! } }),
      ).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      resume();
      spy.mockRestore();
    }
  });

  it("cleans a dedicated board after sweep-commands removes child ownership history (H9)", async () => {
    const started = await server()
      .post("/api/v1/admin/demo/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ users: 1, cards: 2, run: false })
      .expect(201);
    const boardId: string = started.body.boardId;
    const run = await prisma.demoRun.findFirstOrThrow({ where: { boardId } });
    const manifest = run.manifest as Prisma.JsonObject & {
      cardIds: string[];
      userIds: string[];
      checklistIds: string[];
      itemIds: string[];
      linkIds: string[];
    };
    expect(manifest.checklistIds).toHaveLength(2);
    expect(manifest.itemIds).toHaveLength(6);

    // The current scenario does not create links. Seed one with an exact ID
    // reserved in the same manifest format before issuing its board command.
    const linkId = "demo-link-before-retention";
    await prisma.demoRun.update({
      where: { id: run.id },
      data: { manifest: { ...manifest, linkIds: [linkId] } },
    });
    await app.get(CommandsService).apply(boardId, manifest.userIds[1], {
      commandId: "demo-link-creation-command",
      action: {
        type: "ADD_CARD_LINK",
        boardId,
        at: Date.now(),
        cardId: manifest.cardIds[0],
        targetCardId: manifest.cardIds[1],
        linkId,
        linkType: "blocks",
      },
    });
    await app.get(DemoService).executeRun(run.id);

    const checklistWhere = { id: { in: manifest.checklistIds } };
    const itemWhere = { id: { in: manifest.itemIds } };
    const linkWhere = { id: linkId };
    expect(await prisma.checklist.count({ where: checklistWhere })).toBe(2);
    expect(await prisma.checklistItem.count({ where: itemWhere })).toBe(6);
    expect(await prisma.cardLink.count({ where: linkWhere })).toBe(1);
    const creationCommands = {
      boardId,
      type: { in: ["ADD_CHECKLIST", "ADD_CHECKLIST_ITEM", "ADD_CARD_LINK"] },
    };
    expect(
      (
        await prisma.command.updateMany({
          where: creationCommands,
          data: { createdAt: new Date(0) },
        })
      ).count,
    ).toBe(9);
    await app.get(MaintenanceService).sweepCommands();
    expect(await prisma.command.count({ where: creationCommands })).toBe(0);

    const stopped = await server()
      .post("/api/v1/admin/demo/stop")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    expect(stopped.body).toMatchObject({
      running: false,
      cleanupPending: false,
    });
    expect(await prisma.checklist.count({ where: checklistWhere })).toBe(0);
    expect(await prisma.checklistItem.count({ where: itemWhere })).toBe(0);
    expect(await prisma.cardLink.count({ where: linkWhere })).toBe(0);
    expect(
      await prisma.card.count({ where: { id: { in: manifest.cardIds } } }),
    ).toBe(0);
    expect(await prisma.column.count({ where: { boardId } })).toBe(0);
    expect(await prisma.board.count({ where: { id: boardId } })).toBe(0);
    expect(
      await prisma.demoRun.findUnique({ where: { id: run.id } }),
    ).toMatchObject({ status: "stopped" });
  });

  it("keeps a blocked dedicated cleanup retryable (H9)", async () => {
    const started = await server()
      .post("/api/v1/admin/demo/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ users: 1, cards: 1, run: false })
      .expect(201);
    const boardId: string = started.body.boardId;
    const run = await prisma.demoRun.findFirstOrThrow({ where: { boardId } });
    const userColumn = await prisma.column.create({
      data: {
        id: "user-added-demo-column",
        boardId,
        position: 11,
        title: "Keep this column",
      },
    });
    const blocked = await server()
      .post("/api/v1/admin/demo/stop")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(409);
    expect(blocked.body.code).toBe("demo_cleanup_pending");
    expect(
      await prisma.demoRun.findUnique({ where: { id: run.id } }),
    ).toMatchObject({
      status: "stopping",
      stoppedAt: null,
    });
    const status = await server()
      .get("/api/v1/admin/demo")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(status.body).toMatchObject({
      running: false,
      boardId,
      cleanupPending: true,
      shareToken: null,
    });
    expect(await prisma.column.findMany({ where: { boardId } })).toEqual([
      userColumn,
    ]);
    expect(await prisma.board.count({ where: { id: boardId } })).toBe(1);

    await prisma.column.delete({ where: { id: userColumn.id } });
    await server()
      .post("/api/v1/admin/demo/stop")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    expect(await prisma.board.count({ where: { id: boardId } })).toBe(0);
    expect(
      await prisma.demoRun.findUnique({ where: { id: run.id } }),
    ).toMatchObject({ status: "stopped" });
  });

  it("cleans recorded demo rows without deleting real rows with demo markers (H9)", async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: USER_EMAIL },
    });
    const realMember = await prisma.user.create({
      data: { id: "du-real", email: "demo-real@janosik.demo" },
    });
    const demoUser = await prisma.user.create({
      data: { id: "du-recorded", email: "demo-recorded@janosik.demo" },
    });
    const board = await prisma.board.create({
      data: {
        title: "Демо · рой агентов (real)",
        members: {
          create: [
            { userId: owner.id, role: "ADMIN", acceptedAt: new Date() },
            { userId: realMember.id, role: "MEMBER", acceptedAt: new Date() },
            { userId: demoUser.id, role: "MEMBER", acceptedAt: new Date() },
          ],
        },
      },
    });
    const boardId = board.id;
    const realColumn = "col-real";
    const demoColumn = "col-recorded";
    const realCard = "card-real";
    const otherRealCard = "card-real-other";
    const demoCard = "card-recorded";
    const keptCard = "card-recorded-with-real-link";
    await prisma.column.createMany({
      data: [
        { id: realColumn, boardId, title: "Новые", position: 0 },
        { id: demoColumn, boardId, title: "Новые", position: 1 },
      ],
    });
    await prisma.card.createMany({
      data: [
        {
          id: realCard,
          columnId: realColumn,
          title: "DEMO-01: Real",
          position: 0,
        },
        { id: otherRealCard, columnId: realColumn, title: "Real", position: 1 },
        { id: demoCard, columnId: demoColumn, title: "Recorded", position: 0 },
        {
          id: keptCard,
          columnId: demoColumn,
          title: "Linked by a user",
          position: 1,
        },
      ],
    });
    const realLink = {
      id: "link-real",
      boardId,
      fromCardId: realCard,
      toCardId: otherRealCard,
      type: "blocks",
    };
    const userLinkOnDemoCard = {
      ...realLink,
      id: "link-user-on-demo",
      toCardId: keptCard,
    };
    const demoLink = { ...realLink, id: "link-recorded", fromCardId: demoCard };
    const otherBoard = await prisma.board.create({
      data: {
        title: "Another real board",
        members: {
          create: {
            userId: realMember.id,
            role: "ADMIN",
            acceptedAt: new Date(),
          },
        },
      },
    });
    // A historical cross-board reference still protects its target card.
    const crossBoardLink = {
      ...userLinkOnDemoCard,
      id: "user-cross-board-link",
      boardId: otherBoard.id,
    };
    await prisma.cardLink.createMany({
      data: [realLink, userLinkOnDemoCard, demoLink, crossBoardLink],
    });
    await prisma.command.create({
      data: {
        id: "cmd-recorded-link",
        boardId,
        actorId: demoUser.id,
        type: "ADD_CARD_LINK",
        payload: { type: "ADD_CARD_LINK", linkId: demoLink.id },
        result: {},
      },
    });
    const previousShare = await prisma.boardShare.create({
      data: {
        boardId,
        token: "previous-demo-share",
        createdBy: OWNER_EMAIL,
        mode: "live",
      },
    });
    const realShare = await prisma.boardShare.create({
      data: {
        boardId,
        token: "existing-real-share",
        createdBy: owner.id,
        mode: "live",
      },
    });
    await prisma.demoRun.create({
      data: {
        boardId,
        startedBy: OWNER_EMAIL,
        status: "finished",
        manifest: {
          boardId,
          createdBoard: false,
          shareId: previousShare.id,
          userIds: [demoUser.id],
          columnIds: [demoColumn],
          labelIds: [],
          cardIds: [demoCard, keptCard],
        },
      },
    });

    const expectRealRows = async () => {
      expect(
        await prisma.board.findUnique({ where: { id: boardId } }),
      ).toMatchObject({
        title: board.title,
        deletedAt: null,
      });
      expect(
        await prisma.cardLink.findMany({
          where: { boardId },
          orderBy: { id: "asc" },
        }),
      ).toEqual([
        expect.objectContaining(realLink),
        expect.objectContaining(userLinkOnDemoCard),
      ]);
      expect(
        await prisma.boardMember.findMany({
          where: { boardId, userId: { in: [owner.id, realMember.id] } },
        }),
      ).toHaveLength(2);
      expect(
        await prisma.card.findMany({
          where: { id: { in: [realCard, otherRealCard, keptCard] } },
        }),
      ).toHaveLength(3);
      expect(
        await prisma.boardShare.findUnique({ where: { id: realShare.id } }),
      ).toEqual(realShare);
      expect(
        await prisma.cardLink.findUnique({ where: { id: crossBoardLink.id } }),
      ).toMatchObject(crossBoardLink);
      expect(
        await prisma.boardMember.count({
          where: { boardId: otherBoard.id, userId: realMember.id },
        }),
      ).toBe(1);
    };

    const started = await server()
      .post("/api/v1/admin/demo/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ boardId, users: 1, cards: 1, run: false })
      .expect(201);
    await expectRealRows();
    expect(
      await prisma.boardShare.findUnique({ where: { id: previousShare.id } }),
    ).toBeNull();
    await server().get(`/api/v1/share/${previousShare.token}`).expect(404);
    expect(
      await prisma.card.findUnique({ where: { id: demoCard } }),
    ).toBeNull();
    expect(
      await prisma.user.findUnique({ where: { id: demoUser.id } }),
    ).toBeNull();

    await server()
      .post("/api/v1/admin/demo/stop")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    await expectRealRows();
    expect(await prisma.card.count({ where: { column: { boardId } } })).toBe(3);
    expect(await prisma.column.count({ where: { boardId } })).toBe(2);
    expect(await prisma.boardMember.count({ where: { boardId } })).toBe(2);
    expect(
      await prisma.boardShare.findUnique({
        where: { token: started.body.shareToken },
      }),
    ).toBeNull();
  });

  it("mints a live share for the run and the token reads read-only", async () => {
    const started = await server()
      .post("/api/v1/admin/demo/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ users: 1, cards: 1, run: false })
      .expect(201);
    const token: string = started.body.shareToken;
    expect(typeof token).toBe("string");

    const payload = await server().get(`/api/v1/share/${token}`).expect(200);
    expect(payload.body.mode).toBe("live");
    expect(payload.body.board.title).toContain("Демо");
    // The public contour stays write-free.
    await server().post(`/api/v1/share/${token}`).expect(405);

    // Stopping the run takes the link down with it.
    await server()
      .post("/api/v1/admin/demo/stop")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    await server().get(`/api/v1/share/${token}`).expect(404);
  });
});
