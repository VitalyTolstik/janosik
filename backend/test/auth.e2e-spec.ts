import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash } from "node:crypto";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { refreshCookie, refreshCookieValue } from "./support/cookies";

const FIRST_EMAIL = "cycle-first@example.com";
const SECOND_EMAIL = "cycle-second@example.com";
const PASSWORD = "correct horse battery";
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/**
 * Full auth cycle (§7.7 TASK-24 DoD). The user table is emptied up front so
 * the specs stay deterministic no matter which order jest runs them in.
 * Tests share sessions on purpose: the strict 5/min rate limit on
 * login/register leaves no headroom for repeats.
 */
describe("Auth API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let firstUserAccessToken: string;
  let activeSessionToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    // Refresh tokens first: the FK restricts deleting a user with sessions.
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());

  it("registers a user and sets the refresh cookie", async () => {
    const res = await server()
      .post("/api/v1/auth/register")
      .send({ email: FIRST_EMAIL, password: PASSWORD, displayName: "Vera" })
      .expect(201);

    expect(res.body.user).toMatchObject({
      email: FIRST_EMAIL,
      displayName: "Vera",
    });
    // TASK-36: no account is ever auto-promoted — the master account is a
    // separate identity created only by the `admin:create` CLI.
    expect(res.body.user.isSuperAdmin).toBeUndefined();
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.refreshToken).toBeUndefined();
    firstUserAccessToken = res.body.accessToken;

    const cookie = refreshCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/v1/auth");
    // Local dev and e2e run over plain http — no Secure flag there.
    expect(cookie).not.toContain("Secure");
  });

  it("GET /auth/me returns the profile for a valid access token", async () => {
    const res = await server()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${firstUserAccessToken}`)
      .expect(200);
    expect(res.body).toEqual({
      id: expect.any(String),
      email: FIRST_EMAIL,
      displayName: "Vera",
    });
  });

  it("GET /auth/me answers 401 without or with a broken token", async () => {
    await server().get("/api/v1/auth/me").expect(401);
    await server()
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer not-a-jwt")
      .expect(401);
  });

  it("rejects a duplicate email with 409", async () => {
    const res = await server()
      .post("/api/v1/auth/register")
      .send({ email: FIRST_EMAIL, password: PASSWORD })
      .expect(409);
    expect(res.body.statusCode).toBe(409);
  });

  it("rejects invalid payloads with 400", async () => {
    await server()
      .post("/api/v1/auth/register")
      .send({ email: FIRST_EMAIL, password: "short" })
      .expect(400);
  });

  it("answers a generic 401 for wrong credentials", async () => {
    const wrongPassword = await server()
      .post("/api/v1/auth/login")
      .send({ email: FIRST_EMAIL, password: "definitely wrong" })
      .expect(401);
    const unknownEmail = await server()
      .post("/api/v1/auth/login")
      .send({ email: "ghost@example.com", password: PASSWORD })
      .expect(401);
    // Do not reveal which part failed.
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
  });

  it("registers a second account with the same projection", async () => {
    const res = await server()
      .post("/api/v1/auth/register")
      .send({ email: SECOND_EMAIL, password: PASSWORD })
      .expect(201);
    expect(res.body.user.email).toBe(SECOND_EMAIL);
    expect(res.body.user.isSuperAdmin).toBeUndefined();
  });

  it("refresh rotates the cookie and revokes the old token", async () => {
    const login = await server()
      .post("/api/v1/auth/login")
      .send({ email: FIRST_EMAIL, password: PASSWORD })
      .expect(200);
    const oldToken = refreshCookieValue(login);

    const rotated = await server()
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${oldToken}`)
      .expect(200);
    const newToken = refreshCookieValue(rotated);
    expect(newToken).not.toBe(oldToken);
    activeSessionToken = newToken;

    // The fresh access token works, and the new cookie is an active session.
    await server()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${rotated.body.accessToken}`)
      .expect(200);

    // Old token is stored hashed and now revoked; new one still active.
    const revokedRow = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(oldToken) },
    });
    const activeRow = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(newToken) },
    });
    expect(revokedRow?.revokedAt).not.toBeNull();
    expect(activeRow?.revokedAt).toBeNull();
  });

  it("logout clears the cookie, revokes the session and rejects it afterwards", async () => {
    const out = await server()
      .post("/api/v1/auth/logout")
      .set("Cookie", `refresh_token=${activeSessionToken}`)
      .expect(200);
    const cleared = refreshCookie(out);
    expect(cleared).toBeDefined();
    expect(cleared).toContain("Expires=Thu, 01 Jan 1970");

    await server()
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${activeSessionToken}`)
      .expect(401);
  });

  it("logout without a cookie is still 200", async () => {
    await server().post("/api/v1/auth/logout").expect(200);
  });
});
