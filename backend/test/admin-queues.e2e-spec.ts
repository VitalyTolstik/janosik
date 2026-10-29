import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

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

    await prisma.adminAuditLog.deleteMany();
    await prisma.adminRefreshToken.deleteMany();
    await prisma.adminUser.deleteMany();
    await prisma.dataExport.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

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
