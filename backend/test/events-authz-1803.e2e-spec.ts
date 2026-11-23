import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import type { AddressInfo } from "node:net";
import type {
  ReadableStreamDefaultReader,
  ReadableStreamReadResult,
} from "node:stream/web";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { securityStamp } from "@/auth/security-stamp";
import { USER_JWT_AUDIENCE } from "@/auth/auth.types";
import { sseTiming } from "@/realtime/sse-timing";
import { refreshCookieValue } from "./support/cookies";
import { wipeAll } from "./support/wipe";

const PASSWORD = "correct horse battery";

/**
 * M5/M6 (TASK-180.3): SSE is a long-lived read capability.
 *
 * - the `realtime_sse` flag is a kill switch for new and open streams;
 * - an open member stream closes when its access token expires, its security
 *   stamp changes, its refresh family is logged out, or its PAT is narrowed
 *   away from the stream's board.
 */
describe("SSE authz (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let server: () => ReturnType<typeof request>;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    server = () => request(app.getHttpServer());
    sseTiming.keepAliveMs = 150;
    await wipeAll(prisma);
  });

  afterAll(async () => {
    sseTiming.keepAliveMs = 25_000;
    await wipeAll(prisma);
    await app.close();
  });

  async function account(label: string): Promise<{
    token: string;
    userId: string;
    refresh: string;
    boardId: string;
  }> {
    const email = `${label}-1803@example.com`;
    const registration = await server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName: label })
      .expect(201);
    const board = await server()
      .post("/api/v1/boards")
      .set(auth(registration.body.accessToken as string))
      .send({ title: `${label} board` })
      .expect(201);
    return {
      token: registration.body.accessToken as string,
      userId: registration.body.user.id as string,
      refresh: refreshCookieValue(registration),
      boardId: board.body.id as string,
    };
  }

  /**
   * One account covers the flag/expiry/refresh/PAT tests: registration is
   * throttled to 5/minute per IP, and separate throwaway accounts would hit
   * that limiter before the subject under test (M6) does.
   */
  let sharedAccountPromise: Promise<{
    token: string;
    userId: string;
    refresh: string;
    boardId: string;
  }> | null = null;
  const sharedAccount = () =>
    (sharedAccountPromise ??= account("shared-events-owner"));

  function openStream(
    boardId: string,
    token: string,
    since = 0,
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/boards/${boardId}/events?since=${since}`, {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async function closesWithin(
    response: Response,
    timeoutMs = 5_000,
  ): Promise<boolean> {
    if (response.body === null) return true;
    const reader = response.body.getReader();
    const deadline = Date.now() + timeoutMs;
    try {
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        const chunk = await readWithTimeout(reader, remaining);
        if (chunk === null) return false;
        if (chunk.done) return true;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  /**
   * One read or `null` on timeout, with the timer always cleared. The old
   * `Promise.race` left an armed timeout behind on every successful read,
   * which Jest reported as an open handle after the suite.
   */
  function readWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    ms: number,
  ): Promise<ReadableStreamReadResult<Uint8Array> | null> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), ms);
      reader.read().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  it("M5: the realtime flag disables new streams and closes open ones", async () => {
    const owner = await sharedAccount();
    await prisma.featureFlag.upsert({
      where: { key: "realtime_sse" },
      create: { key: "realtime_sse", enabled: false },
      update: { enabled: false },
    });
    await server()
      .get(`/api/v1/boards/${owner.boardId}/events`)
      .set(auth(owner.token))
      .expect(404);

    await prisma.featureFlag.update({
      where: { key: "realtime_sse" },
      data: { enabled: true },
    });
    const open = await openStream(owner.boardId, owner.token);
    expect(open.status).toBe(200);

    await prisma.featureFlag.update({
      where: { key: "realtime_sse" },
      data: { enabled: false },
    });
    expect(await closesWithin(open)).toBe(true);

    // Leave the default for the rest of the suite.
    await prisma.featureFlag.update({
      where: { key: "realtime_sse" },
      data: { enabled: true },
    });
  });

  it("M6: closes a stream when the access token expires", async () => {
    const owner = await sharedAccount();
    const jwt = app.get(JwtService);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: owner.userId },
    });
    const expiring = await jwt.signAsync(
      {
        sub: owner.userId,
        authMethod: "password",
        stamp: securityStamp(user),
      },
      { audience: USER_JWT_AUDIENCE, expiresIn: "2s" },
    );
    const open = await openStream(owner.boardId, expiring);
    expect(open.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(await closesWithin(open)).toBe(true);
  });

  it("M6: closes a stream when the security stamp changes", async () => {
    const owner = await account("stamp-owner");
    const open = await openStream(owner.boardId, owner.token);
    expect(open.status).toBe(200);

    await prisma.user.update({
      where: { id: owner.userId },
      data: {
        passwordHash: await argonHash("new password 123", { type: argon2id }),
      },
    });
    expect(await closesWithin(open)).toBe(true);
  });

  it("M6: closes a stream when its refresh family is logged out", async () => {
    const owner = await account("logout-owner");
    const open = await openStream(owner.boardId, owner.token);
    expect(open.status).toBe(200);

    await server()
      .post("/api/v1/auth/logout")
      .set("Cookie", `refresh_token=${owner.refresh}`)
      .expect(200);
    expect(await closesWithin(open)).toBe(true);
  });

  it("M6: keeps a stream open through normal refresh rotation", async () => {
    const owner = await sharedAccount();
    const open = await openStream(owner.boardId, owner.token);
    expect(open.status).toBe(200);

    const rotated = await server()
      .post("/api/v1/auth/refresh")
      .set("Cookie", `refresh_token=${owner.refresh}`)
      .expect(200);
    expect(rotated.body.accessToken).toEqual(expect.any(String));
    // Same rotation family: the old access token's stream is still entitled.
    expect(await closesWithin(open, 700)).toBe(false);
  });

  it("M6: closes a PAT stream when the token is revoked", async () => {
    const owner = await sharedAccount();
    const created = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(owner.token))
      .send({ name: "revoke-agent", scopePreset: "observer", expiresAt: null })
      .expect(201);
    const pat = created.body.token as string;
    const open = await openStream(owner.boardId, pat);
    expect(open.status).toBe(200);

    await server()
      .delete(`/api/v1/users/me/tokens/${created.body.apiToken.id as string}`)
      .set(auth(owner.token))
      .expect(200);
    expect(await closesWithin(open)).toBe(true);
  });

  it("M6: closes a PAT stream when the token expires", async () => {
    const owner = await sharedAccount();
    const created = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(owner.token))
      .send({
        name: "expiring-agent",
        scopePreset: "observer",
        expiresAt: new Date(Date.now() + 2_000).toISOString(),
      })
      .expect(201);
    const open = await openStream(owner.boardId, created.body.token as string);
    expect(open.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(await closesWithin(open)).toBe(true);
  });

  it("M6: closes a PAT stream when the token is narrowed to another board", async () => {
    const owner = await sharedAccount();
    const other = await server()
      .post("/api/v1/boards")
      .set(auth(owner.token))
      .send({ title: "Other board" })
      .expect(201);
    const created = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(owner.token))
      .send({
        name: "scope-agent",
        boardId: owner.boardId,
        scopePreset: "observer",
        expiresAt: null,
      })
      .expect(201);
    const pat = created.body.token as string;
    const patId = created.body.apiToken.id as string;

    const open = await openStream(owner.boardId, pat);
    expect(open.status).toBe(200);
    await server()
      .patch(`/api/v1/users/me/tokens/${patId}`)
      .set(auth(owner.token))
      .send({ boardId: other.body.id })
      .expect(200);
    expect(await closesWithin(open)).toBe(true);
  });
});
