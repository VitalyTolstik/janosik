import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "queues-owner@example.com";
const OWNER_PASSWORD = "owner correct horse battery";
const USER_EMAIL = "queues-user@example.com";

/**
 * Background queues over HTTP (TASK-68/71/73): running a maintenance sweep,
 * requesting a data export (small account → built inline) and downloading its
 * artifact, plus the queue-dashboard ticket being disabled by default.
 */
describe("Admin queues (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let userId: string;

  const server = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await wipeAll(prisma);

    await prisma.adminUser.create({
      data: {
        email: OWNER_EMAIL,
        role: "OWNER",
        passwordHash: await argonHash(OWNER_PASSWORD, { type: argon2id }),
      },
    });
    userId = (
      await prisma.user.create({
        data: { email: USER_EMAIL },
        select: { id: true },
      })
    ).id;

    ownerToken = (
      await server()
        .post("/api/v1/admin/auth/login")
        .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("runs a maintenance sweep on demand", async () => {
    const res = await server()
      .post("/api/v1/admin/maintenance/run")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ job: "all" })
      .expect(200);
    expect(res.body.queued).toBe(false);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);
  });

  it("retains open and recent agent data and removes it when its board is purged (M23)", async () => {
    const live = await prisma.board.create({
      data: { title: "Live retention fixture" },
    });
    const purged = await prisma.board.create({
      data: { title: "Expired board fixture", deletedAt: new Date(0) },
    });
    const old = new Date(0);
    const recent = new Date();
    const agent = { userId, apiTokenId: "retention-token", boardId: live.id };
    const approval = {
      boardId: live.id,
      requestedBy: userId,
      requestedByTokenId: agent.apiTokenId,
      summary: "Retention fixture",
      kind: "destructive",
      actionType: "DELETE_CARD",
      plan: {},
      planHash: "retention-plan",
      createdAt: old,
      expiresAt: old,
    };
    await prisma.agentSession.createMany({
      data: [
        { ...agent, id: "old-session", status: "completed", endedAt: old },
        {
          ...agent,
          id: "recent-session",
          status: "cancelled",
          endedAt: recent,
          startedAt: old,
        },
        { ...agent, id: "open-session", startedAt: old, lastHeartbeatAt: old },
        { ...agent, boardId: purged.id, id: "purged-session" },
      ],
    });
    await prisma.approvalRequest.createMany({
      data: [
        { ...approval, id: "old-rejected", status: "rejected", decidedAt: old },
        { ...approval, id: "old-expired", status: "expired" },
        {
          ...approval,
          id: "old-cancelled",
          status: "cancelled",
          decidedAt: old,
        },
        {
          ...approval,
          id: "old-consumed",
          status: "consumed",
          consumedAt: old,
        },
        {
          ...approval,
          id: "recent-consumed",
          status: "consumed",
          decidedAt: old,
          consumedAt: recent,
        },
        {
          ...approval,
          id: "recent-cancelled",
          status: "cancelled",
          decidedAt: recent,
        },
        { ...approval, id: "pending" },
        { ...approval, id: "approved", status: "approved", decidedAt: old },
        { ...approval, boardId: purged.id, id: "purged-approval" },
      ],
    });
    const run = async (job: string, removed: number) => {
      const res = await server()
        .post("/api/v1/admin/maintenance/run")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ job })
        .expect(200);
      expect(res.body.results).toEqual([{ job, removed }]);
    };
    await run("sweep-agent-sessions", 1);
    await run("sweep-approvals", 4);
    await run("sweep-agent-sessions", 0);
    await run("sweep-approvals", 0);
    expect(
      await prisma.agentSession.findUnique({ where: { id: "purged-session" } }),
    ).not.toBeNull();
    expect(
      await prisma.approvalRequest.findUnique({
        where: { id: "purged-approval" },
      }),
    ).not.toBeNull();
    await run("purge-soft-deleted", 1);
    expect(
      await prisma.board.findUnique({ where: { id: purged.id } }),
    ).toBeNull();
    expect(
      await prisma.agentSession.count({ where: { boardId: purged.id } }),
    ).toBe(0);
    expect(
      await prisma.approvalRequest.count({ where: { boardId: purged.id } }),
    ).toBe(0);
    expect(
      (await prisma.agentSession.findMany({ where: { boardId: live.id } }))
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["open-session", "recent-session"]);
    expect(
      (await prisma.approvalRequest.findMany({ where: { boardId: live.id } }))
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["approved", "pending", "recent-cancelled", "recent-consumed"]);
  });

  it("rejects an unknown maintenance job", async () => {
    await server()
      .post("/api/v1/admin/maintenance/run")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ job: "nope" })
      .expect(400);
  });

  it("builds a small export inline and serves the artifact", async () => {
    const created = await server()
      .post(`/api/v1/admin/users/${userId}/export`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    expect(created.body.status).toBe("ready");

    const download = await server()
      .get(`/api/v1/admin/exports/${created.body.id}/download`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(download.headers["content-disposition"]).toContain("attachment");

    const list = await server()
      .get("/api/v1/admin/exports")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(list.body.length).toBeGreaterThan(0);
  });

  it("erases a user's data exports on GDPR delete (TASK-148)", async () => {
    await server()
      .post(`/api/v1/admin/users/${userId}/export`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    expect(
      await prisma.dataExport.count({ where: { userId } }),
    ).toBeGreaterThan(0);

    await server()
      .delete(`/api/v1/admin/users/${userId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    // The rows and their artifacts must not outlive the erased account.
    expect(await prisma.dataExport.count({ where: { userId } })).toBe(0);
  });

  it("404s the queue ticket while the dashboard is disabled", async () => {
    await server()
      .post("/api/v1/admin/queue-ticket")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(404);
  });
});
