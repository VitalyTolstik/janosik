import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const EMAIL = "auth-config@example.com";
const PASSWORD = "correct horse battery";

/**
 * Public auth config (TASK-38a): the sign-in screen learns whether sign-up is
 * open before a session exists, and the server enforces the very same flag.
 * The flag row is toggled directly here so the spec is independent of the
 * admin panel.
 */
describe("Auth config (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.featureFlag.deleteMany({
      where: { key: "registration_open" },
    });
    await prisma.refreshToken.deleteMany({ where: { user: { email: EMAIL } } });
    await prisma.user.deleteMany({ where: { email: EMAIL } });
  });

  afterAll(async () => {
    await prisma.featureFlag.deleteMany({
      where: { key: "registration_open" },
    });
    await prisma.refreshToken.deleteMany({ where: { user: { email: EMAIL } } });
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app.close();
  });

  const server = () => request(app.getHttpServer());

  it("reports open registration and public shares by default", async () => {
    const res = await server().get("/api/v1/auth/config").expect(200);
    expect(res.body).toEqual({
      allowRegistration: true,
      allowPublicShares: true,
    });
  });

  it("flips to closed when the flag is off and refuses sign-up", async () => {
    await prisma.featureFlag.upsert({
      where: { key: "registration_open" },
      create: { key: "registration_open", enabled: false },
      update: { enabled: false },
    });

    const config = await server().get("/api/v1/auth/config").expect(200);
    expect(config.body.allowRegistration).toBe(false);

    // The UI hides the form, but the server is the real gate.
    await server()
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD })
      .expect(403);
  });
});
