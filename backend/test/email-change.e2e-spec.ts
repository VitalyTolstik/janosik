import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";
import {
  ADMIN_REFRESH_COOKIE,
  cookieValue,
  refreshCookie,
} from "./support/cookies";

const OLD_EMAIL = "old-address@example.com";
const NEW_EMAIL = "new-address@example.com";
const TAKEN_EMAIL = "taken-address@example.com";
const PASSWORD = "correct horse battery";
const ADMIN_EMAIL = "master@example.com";
const ADMIN_PASSWORD = "master correct horse battery";

/**
 * Email change (TASK-51) — the double opt-in flow and the master override.
 * SMTP is not configured in the test env, so emails land in the mailer
 * outbox instead of an inbox and codes are read from there.
 *
 * Throttle budget (the counters are per-process and never reset): the
 * request endpoint allows 3/hour and the confirm endpoint 5/min, so this
 * spec spends each budget exactly once.
 */
describe("Email change API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let accessToken: string;
  let callerRefresh: string;
  let userId: string;

  const server = () => request(app.getHttpServer());

  const lastCodeSentTo = (to: string): string => {
    const sent = [...mailer.outbox].reverse().find((mail) => mail.to === to);
    expect(sent).toBeDefined();
    const code = sent!.text.match(/\b\d{6}\b/)?.[0];
    expect(code).toBeDefined();
    return code!;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    mailer = app.get(MailerService);

    await prisma.emailChangeCode.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    await prisma.adminRefreshToken.deleteMany();
    await prisma.adminUser.deleteMany();

    await prisma.adminUser.create({
      data: {
        email: ADMIN_EMAIL,
        displayName: "Master",
        role: "OWNER",
        passwordHash: await argonHash(ADMIN_PASSWORD, { type: argon2id }),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers the protagonists", async () => {
    const first = await server()
      .post("/api/v1/auth/register")
      .send({ email: OLD_EMAIL, password: PASSWORD, displayName: "Vera" })
      .expect(201);
    accessToken = first.body.accessToken;
    callerRefresh = cookieValue(first, "refresh_token");
    userId = first.body.user.id;

    await server()
      .post("/api/v1/auth/register")
      .send({ email: TAKEN_EMAIL, password: PASSWORD })
      .expect(201);
  });

  it("rejects the request with a wrong current password (request 1/3)", async () => {
    const res = await server()
      .post("/api/v1/auth/email/change/request")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ newEmail: NEW_EMAIL, currentPassword: "wrong horse" })
      .expect(401);
    expect(res.body.message).toBe("Current password is incorrect");
    expect(await prisma.emailChangeCode.count()).toBe(0);
  });

  it("rejects an address that is already registered (request 2/3)", async () => {
    await server()
      .post("/api/v1/auth/email/change/request")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ newEmail: TAKEN_EMAIL, currentPassword: PASSWORD })
      .expect(409);
    expect(await prisma.emailChangeCode.count()).toBe(0);
  });

  it("sends a 6-digit code to the new address (request 3/3)", async () => {
    const res = await server()
      .post("/api/v1/auth/email/change/request")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ newEmail: NEW_EMAIL, currentPassword: PASSWORD })
      .expect(200);
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());

    const pending = await prisma.emailChangeCode.findFirstOrThrow({
      where: { userId },
    });
    expect(pending).toMatchObject({ newEmail: NEW_EMAIL, attempts: 0 });
    // Only the sha256 of the code is ever stored.
    expect(pending.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(lastCodeSentTo(NEW_EMAIL)).toMatch(/^\d{6}$/);
  });

  it("burns attempts on wrong codes (confirm 1-2/5)", async () => {
    await server()
      .post("/api/v1/auth/email/change/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "000000" })
      .expect(400);
    await server()
      .post("/api/v1/auth/email/change/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "000001" })
      .expect(400);

    const pending = await prisma.emailChangeCode.findFirstOrThrow({
      where: { userId },
    });
    expect(pending.attempts).toBe(2);
    expect(pending.consumedAt).toBeNull();
  });

  it("rejects malformed codes (confirm 3/5)", async () => {
    await server()
      .post("/api/v1/auth/email/change/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "12345" })
      .expect(400);
  });

  it("confirms: email moves, other sessions die, caller is re-issued (confirm 4/5)", async () => {
    // A second device holds a live session that must not survive.
    const other = await server()
      .post("/api/v1/auth/login")
      .send({ email: OLD_EMAIL, password: PASSWORD })
      .expect(200);
    const otherRefresh = cookieValue(other, "refresh_token");

    const code = lastCodeSentTo(NEW_EMAIL);
    const res = await server()
      .post("/api/v1/auth/email/change/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      // The route lives under /auth so the caller's cookie identifies its
      // session; supertest does not persist cookies, so it is set by hand.
      .set("Cookie", `refresh_token=${callerRefresh}`)
      .send({ code })
      .expect(200);

    expect(res.body.user.email).toBe(NEW_EMAIL);
    expect(typeof res.body.accessToken).toBe("string");
    // The caller's session is rotated, not killed.
    expect(refreshCookie(res)).toBeDefined();

    // The other device's refresh token is revoked.
    await server()
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${otherRefresh}`)
      .expect(401);

    // A notice reached the old address.
    expect(mailer.outbox.some((mail) => mail.to === OLD_EMAIL)).toBe(true);

    callerRefresh = cookieValue(res, "refresh_token");
  });

  it("the consumed code cannot be replayed (confirm 5/5)", async () => {
    const code = lastCodeSentTo(NEW_EMAIL);
    const current = await server()
      .post("/api/v1/auth/login")
      .send({ email: NEW_EMAIL, password: PASSWORD })
      .expect(200);
    await server()
      .post("/api/v1/auth/email/change/confirm")
      .set("Authorization", `Bearer ${current.body.accessToken}`)
      .send({ code })
      .expect(400);
  });

  it("the old email stops working for login; the new one works", async () => {
    await server()
      .post("/api/v1/auth/login")
      .send({ email: OLD_EMAIL, password: PASSWORD })
      .expect(401);
    await server()
      .post("/api/v1/auth/login")
      .send({ email: NEW_EMAIL, password: PASSWORD })
      .expect(200);
  });

  it("the master moves the email without any code and the audit trail hears it", async () => {
    const login = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    const adminToken = login.body.accessToken;
    const adminCookie = `${ADMIN_REFRESH_COOKIE}=${cookieValue(
      login,
      ADMIN_REFRESH_COOKIE,
    )}`;

    const res = await server()
      .patch(`/api/v1/admin/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Cookie", adminCookie)
      .send({ email: OLD_EMAIL })
      .expect(200);
    expect(res.body.email).toBe(OLD_EMAIL);

    // The master override revokes every user session, including the caller's.
    await server()
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${callerRefresh}`)
      .expect(401);

    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        targetType: "user",
        targetId: userId,
        action: "user.email_changed",
      },
    });
    expect(audit).toMatchObject({
      details: { from: NEW_EMAIL, to: OLD_EMAIL },
    });

    // The master cannot move onto an address someone else owns.
    await server()
      .patch(`/api/v1/admin/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Cookie", adminCookie)
      .send({ email: TAKEN_EMAIL })
      .expect(409);

    // The notification reached the address that was just abandoned.
    expect(
      mailer.outbox.some(
        (mail) => mail.to === NEW_EMAIL && mail.subject.includes("changed"),
      ),
    ).toBe(true);
  });
});
