import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  AuthUserDto,
  CreateUserTokenResponse,
  UserTokenDto,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { refreshCookieValue } from "./support/cookies";

const PROFILE_EMAIL = "users-profile@example.com";
const OTHER_EMAIL = "users-other@example.com";
const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "fresh correct horse battery";

/**
 * Account self-service (TASK-36.1): profile PATCH, password change with
 * session revocation and personal API tokens (plaintext once, PAT auth,
 * expiry/revocation, ownership).
 */
describe("Users API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let profileToken: string;
  let profileCookie: string;
  let profileId: string;
  let otherToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipe(prisma);

    const profile = await register(PROFILE_EMAIL, "Vera");
    profileToken = profile.accessToken;
    profileCookie = profile.cookie;
    profileId = profile.id;

    const other = await register(OTHER_EMAIL, "Olga");
    otherToken = other.accessToken;
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const cookie = (value: string) => ({ Cookie: `refresh_token=${value}` });

  async function register(
    email: string,
    displayName: string,
  ): Promise<{ accessToken: string; cookie: string; id: string }> {
    const res = await server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201);
    return {
      accessToken: res.body.accessToken as string,
      cookie: refreshCookieValue(res),
      id: res.body.user.id as string,
    };
  }

  async function login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; cookie: string }> {
    const res = await server()
      .post("/api/v1/auth/login")
      .send({ email, password })
      .expect(200);
    return {
      accessToken: res.body.accessToken as string,
      cookie: refreshCookieValue(res),
    };
  }

  describe("PATCH /users/me", () => {
    it("updates display name and avatar color, and the fresh projection", async () => {
      const res = await server()
        .patch("/api/v1/users/me")
        .set(auth(profileToken))
        .send({ displayName: "Vera Prime", avatarColor: "teal" })
        .expect(200);

      const user = res.body as AuthUserDto;
      expect(user).toEqual({
        id: profileId,
        email: PROFILE_EMAIL,
        displayName: "Vera Prime",
        avatarColor: "teal",
        createdAt: expect.any(Number),
      });

      const me = await server()
        .get("/api/v1/auth/me")
        .set(auth(profileToken))
        .expect(200);
      expect(me.body).toEqual(user);
    });

    it("clears a field with null", async () => {
      const res = await server()
        .patch("/api/v1/users/me")
        .set(auth(profileToken))
        .send({ displayName: null, avatarColor: null })
        .expect(200);
      expect(res.body.displayName).toBeNull();
      expect(res.body.avatarColor).toBeNull();
    });

    it("accepts an empty patch as a no-op", async () => {
      const res = await server()
        .patch("/api/v1/users/me")
        .set(auth(profileToken))
        .send({})
        .expect(200);
      expect(res.body).toEqual({
        id: profileId,
        email: PROFILE_EMAIL,
        displayName: null,
        avatarColor: null,
        createdAt: expect.any(Number),
      });
    });

    it("rejects an unknown avatar color and an over-long name with 400", async () => {
      await server()
        .patch("/api/v1/users/me")
        .set(auth(profileToken))
        .send({ avatarColor: "rainbow" })
        .expect(400);
      await server()
        .patch("/api/v1/users/me")
        .set(auth(profileToken))
        .send({ displayName: "x".repeat(51) })
        .expect(400);
    });

    it("requires authentication", async () => {
      await server()
        .patch("/api/v1/users/me")
        .send({ displayName: "No" })
        .expect(401);
    });
  });

  describe("POST /users/me/password", () => {
    it("rejects a wrong current password with 401", async () => {
      const res = await server()
        .post("/api/v1/auth/password")
        .set(auth(profileToken))
        .set(cookie(profileCookie))
        .send({
          currentPassword: "definitely wrong",
          newPassword: NEW_PASSWORD,
        })
        .expect(401);
      expect(res.body.message).toBe("Current password is incorrect");
    });

    it("rotates the password, keeps the caller's session and kills others", async () => {
      // A second tab's session, and a PAT that must survive the rotation.
      const secondSession = await login(PROFILE_EMAIL, PASSWORD);
      const created = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(profileToken))
        .send({ name: "survives rotation" })
        .expect(201);
      const pat = created.body.token as string;

      const res = await server()
        .post("/api/v1/auth/password")
        .set(auth(profileToken))
        .set(cookie(profileCookie))
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);
      expect(res.body).toEqual({ status: "ok" });

      // The caller's own cookie still rotates…
      await server()
        .post("/api/v1/auth/refresh")
        .set(cookie(profileCookie))
        .expect(200);
      // …while the other session's token is dead. Presenting a revoked
      // refresh token is the anti-reuse theft signal and revokes everything,
      // so this check must come after the caller's.
      await server()
        .post("/api/v1/auth/refresh")
        .set(cookie(secondSession.cookie))
        .expect(401);

      // The old password no longer logs in, the new one does.
      await server()
        .post("/api/v1/auth/login")
        .send({ email: PROFILE_EMAIL, password: PASSWORD })
        .expect(401);
      await server()
        .post("/api/v1/auth/login")
        .send({ email: PROFILE_EMAIL, password: NEW_PASSWORD })
        .expect(200);

      // API tokens are not sessions: the PAT still authenticates.
      await server().get("/api/v1/auth/me").set(auth(pat)).expect(200);
    });
  });

  describe("personal API tokens", () => {
    let pat: string;
    let tokenId: string;

    it("returns the plaintext exactly once at creation", async () => {
      const res = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(profileToken))
        .send({ name: "CI", expiresAt: null })
        .expect(201);

      const body = res.body as CreateUserTokenResponse;
      expect(body.token.startsWith("jnk_")).toBe(true);
      expect(body.apiToken).toEqual({
        id: expect.any(String),
        name: "CI",
        createdAt: expect.any(Number),
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      });
      pat = body.token;
      tokenId = body.apiToken.id;
    });

    it("lists the token without the plaintext", async () => {
      const res = await server()
        .get("/api/v1/users/me/tokens")
        .set(auth(profileToken))
        .expect(200);
      const tokens = res.body as UserTokenDto[];
      expect(tokens).toHaveLength(2); // "CI" + "survives rotation"
      expect(tokens[0].id).toBe(tokenId);
      expect(JSON.stringify(res.body)).not.toContain("jnk_");
      expect(res.body[0].tokenHash).toBeUndefined();
    });

    it("authenticates /auth/me and a board route as its owner", async () => {
      const me = await server()
        .get("/api/v1/auth/me")
        .set(auth(pat))
        .expect(200);
      expect(me.body.id).toBe(profileId);

      await server().get("/api/v1/boards").set(auth(pat)).expect(200);

      // A PAT opens board-scoped routes (MembershipGuard), not just plain
      // JWT-verified ones: create a board and read its aggregate with it.
      const board = await server()
        .post("/api/v1/boards")
        .set(auth(profileToken))
        .send({ title: "PAT board" })
        .expect(201);
      await server()
        .get(`/api/v1/boards/${board.body.id as string}`)
        .set(auth(pat))
        .expect(200);

      const tokens = await server()
        .get("/api/v1/users/me/tokens")
        .set(auth(profileToken))
        .expect(200);
      const used = (tokens.body as UserTokenDto[]).find(
        (token) => token.id === tokenId,
      );
      expect(used?.lastUsedAt).toEqual(expect.any(Number));
    });

    it("refuses a PAT on admin routes", async () => {
      await server().get("/api/v1/admin/metrics").set(auth(pat)).expect(401);
    });

    it("answers 401 once revoked", async () => {
      await server()
        .delete(`/api/v1/users/me/tokens/${tokenId}`)
        .set(auth(profileToken))
        .expect(200);
      await server().get("/api/v1/auth/me").set(auth(pat)).expect(401);

      const tokens = await server()
        .get("/api/v1/users/me/tokens")
        .set(auth(profileToken))
        .expect(200);
      const revoked = (tokens.body as UserTokenDto[]).find(
        (token) => token.id === tokenId,
      );
      expect(revoked?.revokedAt).toEqual(expect.any(Number));
    });

    it("answers 401 once expired", async () => {
      const res = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(profileToken))
        .send({
          name: "Short lived",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
        .expect(201);
      // Expiry is validated at creation; simulate the clock passing it.
      await prisma.apiToken.update({
        where: { id: res.body.apiToken.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await server()
        .get("/api/v1/auth/me")
        .set(auth(res.body.token as string))
        .expect(401);
    });

    it("rejects a past expiry with 400", async () => {
      await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(profileToken))
        .send({
          name: "Too late",
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        })
        .expect(400);
    });

    it("404s revoking someone else's token id", async () => {
      await server()
        .delete(`/api/v1/users/me/tokens/${tokenId}`)
        .set(auth(otherToken))
        .expect(404);
    });

    it("requires authentication on the whole token surface", async () => {
      await server().get("/api/v1/users/me/tokens").expect(401);
      await server()
        .post("/api/v1/users/me/tokens")
        .send({ name: "No auth" })
        .expect(401);
      await server().delete(`/api/v1/users/me/tokens/${tokenId}`).expect(401);
    });
  });

  async function wipe(db: PrismaService): Promise<void> {
    await db.cardLabel.deleteMany();
    await db.checklistItem.deleteMany();
    await db.checklist.deleteMany();
    await db.comment.deleteMany();
    await db.activity.deleteMany();
    await db.command.deleteMany();
    await db.card.deleteMany();
    await db.column.deleteMany();
    await db.label.deleteMany();
    await db.boardMember.deleteMany();
    await db.apiToken.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
