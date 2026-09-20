import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { refreshCookieValue } from "./support/cookies";

const EMAIL = "reuse@example.com";
const PASSWORD = "correct horse battery";

/**
 * Reuse of an already-rotated refresh token is a theft signal (§7.0):
 * presenting it revokes every session of that user, not just the stolen one.
 */
describe("Refresh token reuse detection (e2e)", () => {
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
    // Refresh tokens first: the FK restricts deleting a user with sessions.
    await prisma.apiToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it("revokes every session of the user when a revoked token is presented", async () => {
    const server = request(app.getHttpServer());
    const registered = await server
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);
    const secondLogin = await server
      .post("/api/v1/auth/login")
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);

    const sessionAOld = refreshCookieValue(registered);
    const sessionB = refreshCookieValue(secondLogin);

    // Legal rotation of session A: old token becomes revoked, new one issued.
    const rotated = await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionAOld}`)
      .expect(200);
    const sessionANew = refreshCookieValue(rotated);

    // Theft signal: the rotated-away token shows up again.
    await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionAOld}`)
      .expect(401);

    // Every session of the user is dead now — including the second one and
    // the token issued seconds ago.
    await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionB}`)
      .expect(401);
    await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionANew}`)
      .expect(401);

    const tokens = await prisma.refreshToken.findMany();
    expect(tokens).toHaveLength(3);
    expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
  });
});
