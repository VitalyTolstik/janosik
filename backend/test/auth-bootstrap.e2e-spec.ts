import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";
import { wipeAll } from "./support/wipe";

const EMAIL = "bootstrap@example.com";
const PASSWORD = "correct horse battery";

/**
 * H1 (TASK-180.3): a fresh install without SMTP can still create its first
 * account. `/auth/config` used to require a mail transport, hiding the
 * register form even though `POST /auth/register` explicitly allows the
 * one-time bootstrap — the UI and API now agree.
 */
describe("No-SMTP bootstrap contract (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let enabledSpy: jest.SpyInstance;
  const originalBootstrap = process.env.ALLOW_BOOTSTRAP_USER;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    const mailer = app.get(MailerService);
    // The global e2e setup simulates a live transport; this suite is the one
    // that exercises a bare install.
    enabledSpy = jest.spyOn(mailer, "enabled", "get").mockReturnValue(false);
    process.env.ALLOW_BOOTSTRAP_USER = "true";
  });

  afterAll(async () => {
    enabledSpy.mockRestore();
    if (originalBootstrap === undefined)
      delete process.env.ALLOW_BOOTSTRAP_USER;
    else process.env.ALLOW_BOOTSTRAP_USER = originalBootstrap;
    await wipeAll(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());

  it("offers registration on an empty no-SMTP install", async () => {
    const config = await server().get("/api/v1/auth/config").expect(200);
    expect(config.body.allowRegistration).toBe(true);
  });

  it("creates and verifies the first account through the same form", async () => {
    const res = await server()
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD, displayName: "First owner" })
      .expect(201);
    expect(res.body.user.email).toBe(EMAIL);
    expect(res.body.user.emailVerifiedAt).toEqual(expect.any(Number));
  });

  it("hides registration again once the one-shot bootstrap is spent", async () => {
    const config = await server().get("/api/v1/auth/config").expect(200);
    expect(config.body.allowRegistration).toBe(false);

    await server()
      .post("/api/v1/auth/register")
      .send({ email: "second@example.com", password: PASSWORD })
      .expect(503);
  });

  it("keeps the form closed when ALLOW_BOOTSTRAP_USER is off", async () => {
    await wipeAll(prisma);
    process.env.ALLOW_BOOTSTRAP_USER = "false";
    const config = await server().get("/api/v1/auth/config").expect(200);
    expect(config.body.allowRegistration).toBe(false);
    await server()
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD })
      .expect(503);
  });
});
