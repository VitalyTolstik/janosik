import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { REFRESH_REUSE_GRACE_MS } from "@/auth/auth.service";
import { refreshCookieValue } from "./support/cookies";

const PASSWORD = "correct horse battery";

/**
 * Reuse of an already-rotated refresh token is a theft signal (§7.0) — but
 * only once the revocation is old enough. A rotation whose response never
 * reached the browser (frozen tab, dropped network) leaves the client on
 * the stale cookie; its retry must not lock the owner out of every session.
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

  it("keeps the sessions alive when a just-rotated token is presented", async () => {
    const server = request(app.getHttpServer());
    const registered = await server
      .post("/api/v1/auth/register")
      .send({ email: "reuse-grace@example.com", password: PASSWORD })
      .expect(201);
    const secondLogin = await server
      .post("/api/v1/auth/login")
      .send({ email: "reuse-grace@example.com", password: PASSWORD })
      .expect(200);

    const sessionAOld = refreshCookieValue(registered);
    const sessionB = refreshCookieValue(secondLogin);

    // Legal rotation of session A: old token becomes revoked, new one issued.
    const rotated = await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionAOld}`)
      .expect(200);
    const sessionANew = refreshCookieValue(rotated);

    // A retry with the rotated-away token within the grace window — a lost
    // race (frozen tab, lost response), not theft: plain 401, nothing dies.
    await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionAOld}`)
      .expect(401);

    // The other sessions survive — including the token issued moments ago.
    await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionB}`)
      .expect(200);
    await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionANew}`)
      .expect(200);

    const userTokens = await prisma.refreshToken.findMany({
      where: { userId: registered.body.user.id },
    });
    // Every rotation revokes its predecessor: A-old, B-old and A-new are
    // revoked by their own legal rotations; the two tokens issued by the
    // last refresh of each session stay alive. A §7.0 revocation would
    // have killed those two as well.
    expect(userTokens.filter((token) => token.revokedAt !== null)).toHaveLength(
      3,
    );
    expect(userTokens.filter((token) => token.revokedAt === null)).toHaveLength(
      2,
    );
  });

  it("revokes every session of the user when a revoked token is presented after the grace window", async () => {
    const server = request(app.getHttpServer());
    const registered = await server
      .post("/api/v1/auth/register")
      .send({ email: "reuse-theft@example.com", password: PASSWORD })
      .expect(201);
    const secondLogin = await server
      .post("/api/v1/auth/login")
      .send({ email: "reuse-theft@example.com", password: PASSWORD })
      .expect(200);

    const sessionAOld = refreshCookieValue(registered);
    const sessionB = refreshCookieValue(secondLogin);

    const rotated = await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionAOld}`)
      .expect(200);
    const sessionANew = refreshCookieValue(rotated);

    // Age the rotated-away token past the grace window: now its reuse is
    // indistinguishable from a stolen token replay.
    await prisma.refreshToken.updateMany({
      where: { userId: registered.body.user.id, revokedAt: { not: null } },
      data: {
        revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 60_000),
      },
    });
    await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionAOld}`)
      .expect(401);

    // Every session of the user is dead now — including the second one and
    // the token issued moments ago.
    await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionB}`)
      .expect(401);
    await server
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${sessionANew}`)
      .expect(401);

    const userTokens = await prisma.refreshToken.findMany({
      where: { userId: registered.body.user.id },
    });
    expect(userTokens.length).toBeGreaterThan(0);
    expect(userTokens.every((token) => token.revokedAt !== null)).toBe(true);
  });
});
