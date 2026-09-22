import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";

const EMAIL = "verify-me@example.com";
const SECOND_EMAIL = "auto-verified@example.com";
const PASSWORD = "correct horse battery";

/**
 * Registration email confirmation (TASK-53). SMTP is not configured in the
 * test env, so the mailer's `enabled` getter is mocked to decide which flow
 * a registration takes while `send()` keeps landing in the outbox — that is
 * where the codes are read from.
 *
 * Throttle budget (the counters are per-process and never reset): register
 * 5/min (2 calls), verify-email 10/min (8 calls), verify-email/resend
 * 3/hour (2 calls) — every budget stays clear.
 */
describe("Registration email verification (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;
  let enabledSpy: jest.SpyInstance;
  let accessToken: string;

  const server = () => request(app.getHttpServer());

  /** The 6-digit code of the latest verification email sent to `to`. */
  const lastCodeSentTo = (to: string): string => {
    const sent = [...mailer.outbox].reverse().find((mail) => mail.to === to);
    expect(sent).toBeDefined();
    const code = sent!.text.match(/\b\d{6}\b/)?.[0];
    expect(code).toBeDefined();
    return code!;
  };

  /** Every digit bumped — guaranteed to differ from the real code. */
  const wrongCode = (code: string): string =>
    code
      .split("")
      .map((digit) => String((Number(digit) + 1) % 10))
      .join("");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    mailer = app.get(MailerService);
    enabledSpy = jest.spyOn(mailer, "enabled", "get");

    await prisma.emailVerificationCode.deleteMany();
    await prisma.emailChangeCode.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    enabledSpy.mockRestore();
    await app.close();
  });

  it("registers unverified when a mail transport is live and emails the code", async () => {
    enabledSpy.mockReturnValue(true);
    const res = await server()
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);

    expect(res.body.user.emailVerifiedAt).toBeNull();
    accessToken = res.body.accessToken;
    // Only the sha256 of the code is ever persisted.
    const pending = await prisma.emailVerificationCode.findFirst({
      where: { userId: res.body.user.id },
    });
    expect(pending).not.toBeNull();
    expect(pending!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pending!.codeHash).not.toBe(lastCodeSentTo(EMAIL));
    expect(pending!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("lets an unverified account sign in (the gate is the UI's)", async () => {
    const res = await server()
      .post("/api/v1/auth/login")
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    expect(res.body.user.emailVerifiedAt).toBeNull();
    accessToken = res.body.accessToken;
  });

  it("burns the code after five wrong guesses", async () => {
    const code = lastCodeSentTo(EMAIL);
    const wrong = wrongCode(code);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await server()
        .post("/api/v1/auth/verify-email")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ code: wrong })
        .expect(400);
    }
    // The fifth wrong guess destroyed the code — even the right one is gone.
    await server()
      .post("/api/v1/auth/verify-email")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code })
      .expect(400);
  });

  it("resends a fresh code", async () => {
    const res = await server()
      .post("/api/v1/auth/verify-email/resend")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
    const pending = await prisma.emailVerificationCode.findFirstOrThrow();
    expect(pending.attempts).toBe(0);
    expect(pending.consumedAt).toBeNull();
  });

  it("verifies with the right code and stamps the user", async () => {
    const res = await server()
      .post("/api/v1/auth/verify-email")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: lastCodeSentTo(EMAIL) })
      .expect(200);
    expect(res.body.user.emailVerifiedAt).toBeGreaterThan(0);

    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL },
    });
    expect(dbUser.emailVerifiedAt).not.toBeNull();
  });

  it("rejects further verifies and resends once verified", async () => {
    await server()
      .post("/api/v1/auth/verify-email")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "000000" })
      .expect(400);
    await server()
      .post("/api/v1/auth/verify-email/resend")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(400);
  });

  it("auto-verifies when no mail transport is configured", async () => {
    enabledSpy.mockReturnValue(false);
    const res = await server()
      .post("/api/v1/auth/register")
      .send({ email: SECOND_EMAIL, password: PASSWORD })
      .expect(201);
    expect(res.body.user.emailVerifiedAt).toBeGreaterThan(0);
    // No live code email was written for the auto-verified account (the one
    // consumed row belongs to the earlier verification).
    const codes = await prisma.emailVerificationCode.findMany();
    expect(codes.every((row) => row.consumedAt !== null)).toBe(true);
  });
});
