import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";
import { wipeAll } from "./support/wipe";

const PASSWORD = "correct horse battery";

/**
 * Fresh-install bootstrap without SMTP: the first account is the only one
 * that may be created and auto-verified without a mail transport. The flag
 * is inert as soon as any user exists.
 */
describe("First-user bootstrap (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let enabledSpy: jest.SpyInstance;
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
    enabledSpy = jest
      .spyOn(app.get(MailerService), "enabled", "get")
      .mockReturnValue(false);
  });

  afterAll(async () => {
    delete process.env.ALLOW_BOOTSTRAP_USER;
    enabledSpy.mockRestore();
    await app.close();
  });

  it("refuses registration without mail when the bootstrap flag is off", async () => {
    process.env.ALLOW_BOOTSTRAP_USER = "false";
    await server()
      .post("/api/v1/auth/register")
      .send({ email: "bootstrap-off@example.test", password: PASSWORD })
      .expect(503);
    expect(await prisma.user.count()).toBe(0);
  });

  it("creates and verifies exactly the first account with the flag on", async () => {
    process.env.ALLOW_BOOTSTRAP_USER = "true";
    const first = await server()
      .post("/api/v1/auth/register")
      .send({ email: "bootstrap-first@example.test", password: PASSWORD })
      .expect(201);
    expect(first.body.user.emailVerifiedAt).toEqual(expect.any(Number));

    await server()
      .post("/api/v1/auth/register")
      .send({ email: "bootstrap-second@example.test", password: PASSWORD })
      .expect(503);
    expect(await prisma.user.count()).toBe(1);
  });
});
