import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { CreateUserTokenResponse, UserTokenDto } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const EMAIL = "api-tokens@example.com";
const PASSWORD = "correct horse battery";

/**
 * Personal API tokens as the only programmatic credential (TASK-48 hardening):
 *
 * - the API rejects every request that carries no bearer credential at all;
 * - a freshly registered account owns zero API keys — nothing is seeded and
 *   no well-formed but unknown `jnk_…` value authenticates;
 * - the moment a key is created it authenticates its owner, until revoked.
 */
describe("API tokens gate (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;
  let sessionToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipe(prisma);

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD, displayName: "Vera" })
      .expect(201);
    userId = res.body.user.id as string;
    sessionToken = res.body.accessToken as string;
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Representative protected surface: session-routes, member-routes, admin. */
  const protectedRoutes: Array<[string, string]> = [
    ["get", "/api/v1/auth/me"],
    ["patch", "/api/v1/users/me"],
    ["get", "/api/v1/boards"],
    ["post", "/api/v1/boards"],
    ["get", "/api/v1/users/me/tokens"],
    ["get", "/api/v1/admin/metrics"],
  ];

  describe("without credentials the API is closed", () => {
    it("answers 401 on every protected route with no Authorization header", async () => {
      for (const [method, url] of protectedRoutes) {
        await server()[method](url).expect(401);
      }
    });

    it("answers 401 for empty and malformed bearer values", async () => {
      for (const header of ["Bearer", "Bearer ", "Bearer garbage"]) {
        await server()
          .get("/api/v1/auth/me")
          .set("Authorization", header)
          .expect(401);
      }
    });

    it("answers 401 for a syntactically valid but unknown jnk_ key", async () => {
      const unknown = `jnk_${"A".repeat(43)}`;
      await server().get("/api/v1/auth/me").set(auth(unknown)).expect(401);
    });
  });

  describe("no default API key exists", () => {
    it("gives a fresh account zero tokens", async () => {
      const res = await server()
        .get("/api/v1/users/me/tokens")
        .set(auth(sessionToken))
        .expect(200);
      expect(res.body).toEqual([]);

      const stored = await prisma.apiToken.findMany({
        where: { userId },
      });
      expect(stored).toEqual([]);
    });
  });

  describe("a created key works immediately", () => {
    let pat: string;
    let tokenId: string;

    it("issues the plaintext exactly once", async () => {
      const res = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(sessionToken))
        .send({ name: "integration", expiresAt: null })
        .expect(201);

      const body = res.body as CreateUserTokenResponse;
      expect(body.token.startsWith("jnk_")).toBe(true);
      pat = body.token;
      tokenId = body.apiToken.id;
    });

    it("authenticates reads and writes as its owner", async () => {
      const me = await server()
        .get("/api/v1/auth/me")
        .set(auth(pat))
        .expect(200);
      expect(me.body.id).toBe(userId);

      await server().get("/api/v1/boards").set(auth(pat)).expect(200);

      const board = await server()
        .post("/api/v1/boards")
        .set(auth(pat))
        .send({ title: "PAT board" })
        .expect(201);
      // Membership rides on the owner actor: the PAT caller reads the board
      // it just created and sees it in its own list.
      await server()
        .get(`/api/v1/boards/${board.body.id as string}`)
        .set(auth(pat))
        .expect(200);
      const list = await server()
        .get("/api/v1/boards")
        .set(auth(pat))
        .expect(200);
      expect(
        (list.body as Array<{ id: string }>).some(
          (entry) => entry.id === board.body.id,
        ),
      ).toBe(true);

      const tokens = await server()
        .get("/api/v1/users/me/tokens")
        .set(auth(sessionToken))
        .expect(200);
      const used = (tokens.body as UserTokenDto[]).find(
        (token) => token.id === tokenId,
      );
      expect(used?.lastUsedAt).toEqual(expect.any(Number));
    });

    it("stops working once revoked", async () => {
      await server()
        .delete(`/api/v1/users/me/tokens/${tokenId}`)
        .set(auth(sessionToken))
        .expect(200);
      await server().get("/api/v1/auth/me").set(auth(pat)).expect(401);
    });
  });

  async function wipe(db: PrismaService): Promise<void> {
    await db.attachment.deleteMany();
    await db.cardLink.deleteMany();
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
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
