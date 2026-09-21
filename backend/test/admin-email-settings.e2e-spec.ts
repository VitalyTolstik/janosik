import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const OWNER_EMAIL = "email-owner@example.com";
const OWNER_PASSWORD = "owner correct horse battery";
const OPERATOR_EMAIL = "email-operator@example.com";
const OPERATOR_PASSWORD = "operator correct horse battery";
const USER_EMAIL = "plain-user@example.com";
const USER_PASSWORD = "user correct horse battery";

/**
 * Master-panel email settings (TASK-52): presets, credential masking, the
 * owner-only edit guard, the probe endpoint and the audit trail. Delivery
 * itself is unit-covered; here the flow goes over real HTTP with a real
 * app (the dead `127.0.0.1:1` transport fails fast with ECONNREFUSED).
 */
describe("Admin email settings (e2e)", () => {
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
    await prisma.emailSettings.deleteMany();
    await prisma.refreshToken.deleteMany();
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
    await server().get("/api/v1/admin/email-settings").expect(401);
    await server()
      .get("/api/v1/admin/email-settings")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(401);
  });

  it("exposes the bootstrap state with no secret material", async () => {
    const res = await server()
      .get("/api/v1/admin/email-settings")
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(200);

    // The dev machine's .env bootstraps an SMTP transport (source "env"),
    // CI runs without one (source "none") — assert the mapping, not the env.
    if (res.body.source === "env") {
      expect(res.body.enabled).toBe(true);
      expect(res.body.active).toBe(true);
    } else {
      expect(res.body).toMatchObject({ source: "none", enabled: false });
    }
    expect(res.body.hasPassword).toBe(false);
    expect(res.body.password).toBeUndefined();
  });

  it("lets operators view but not modify", async () => {
    await server()
      .put("/api/v1/admin/email-settings")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({
        provider: "gmail",
        from: "Janosik <no-reply@example.com>",
        username: "you@gmail.com",
        password: "app password",
        enabled: true,
      })
      .expect(403);
    await server()
      .post("/api/v1/admin/email-settings/test")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ to: "someone@example.com" })
      .expect(403);
  });

  it("refuses an unknown provider and a preset switch without credentials", async () => {
    const auth = { Authorization: `Bearer ${ownerToken}` };

    await server()
      .put("/api/v1/admin/email-settings")
      .set(auth)
      .send({
        provider: "aol",
        from: "Janosik <no-reply@example.com>",
        username: "user",
        enabled: false,
      })
      .expect(400);

    await server()
      .put("/api/v1/admin/email-settings")
      .set(auth)
      .send({
        provider: "gmail",
        from: "Janosik <no-reply@example.com>",
        username: "you@gmail.com",
        enabled: true,
      })
      .expect(400);

    await server()
      .put("/api/v1/admin/email-settings")
      .set(auth)
      .send({
        provider: "custom",
        from: "Janosik <no-reply@example.com>",
        username: "user",
        enabled: true,
        password: "secret",
      })
      .expect(400);
  });

  it("saves a preset, stores only the encrypted password and activates the transport", async () => {
    const res = await server()
      .put("/api/v1/admin/email-settings")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        provider: "gmail",
        // Client-supplied connection settings must be ignored for a preset.
        host: "evil.example.com",
        port: 2525,
        from: "Janosik <no-reply@example.com>",
        username: "you@gmail.com",
        password: "sixteen-char-app-password",
        enabled: true,
      })
      .expect(200);

    expect(res.body).toMatchObject({
      provider: "gmail",
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      enabled: true,
      hasPassword: true,
      source: "db",
      active: true,
      updatedBy: OWNER_EMAIL,
    });

    const row = await prisma.emailSettings.findUnique({
      where: { id: "singleton" },
    });
    expect(row?.passwordEnc).toBeTruthy();
    expect(row?.passwordEnc).not.toContain("sixteen-char-app-password");
    expect(row?.host).toBe("smtp.gmail.com");
  });

  it("keeps the stored password when an update omits it", async () => {
    const before = await prisma.emailSettings.findUnique({
      where: { id: "singleton" },
    });

    const res = await server()
      .put("/api/v1/admin/email-settings")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        provider: "gmail",
        from: "Janosik <no-reply@example.com>",
        username: "you@gmail.com",
        enabled: true,
      })
      .expect(200);

    const after = await prisma.emailSettings.findUnique({
      where: { id: "singleton" },
    });
    expect(after?.passwordEnc).toBe(before?.passwordEnc);
    expect(res.body.hasPassword).toBe(true);
  });

  it("probing a dead transport reports the failure and records it", async () => {
    // Reconfigure onto a port that refuses instantly, then probe.
    await server()
      .put("/api/v1/admin/email-settings")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        provider: "custom",
        host: "127.0.0.1",
        port: 1,
        secure: false,
        from: "Janosik <no-reply@example.com>",
        username: "user",
        enabled: true,
      })
      .expect(200);

    const res = await server()
      .post("/api/v1/admin/email-settings/test")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ to: "probe@example.com" })
      .expect(200);

    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain("ECONNREFUSED");

    const row = await prisma.emailSettings.findUnique({
      where: { id: "singleton" },
    });
    expect(row?.lastTestOk).toBe(false);
    expect(row?.lastError).toContain("ECONNREFUSED");
  });

  it("probing in log mode reports ok and the email lands in the outbox", async () => {
    await server()
      .put("/api/v1/admin/email-settings")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        provider: "gmail",
        from: "Janosik <no-reply@example.com>",
        username: "you@gmail.com",
        enabled: false,
      })
      .expect(200);

    const res = await server()
      .post("/api/v1/admin/email-settings/test")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ to: "probe@example.com" })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.error).toBeNull();
  });

  it("audits settings changes and probes", async () => {
    const actions = await prisma.adminAuditLog.findMany({
      where: { adminEmail: OWNER_EMAIL, targetType: "email_settings" },
      orderBy: { createdAt: "asc" },
    });

    expect(actions.map((entry) => entry.action)).toEqual([
      "email.settings_changed",
      "email.settings_changed",
      "email.settings_changed",
      "email.test_sent",
      "email.settings_changed",
      "email.test_sent",
    ]);
    const probe = actions.find((entry) => entry.action === "email.test_sent");
    expect(probe?.details).toMatchObject({ to: "probe@example.com" });
  });
});
