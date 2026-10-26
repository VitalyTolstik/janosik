import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const OWNER_EMAIL = "oauth-owner@example.com";
const OWNER_PASSWORD = "owner correct horse battery";
const OPERATOR_EMAIL = "oauth-operator@example.com";
const OPERATOR_PASSWORD = "operator correct horse battery";

/**
 * OAuth login (TASK-54) over real HTTP: the master-panel settings API, the
 * provider round trip (outbound token/profile calls are stubbed — only the
 * redirects, cookies and session issuance are real) and the email-based
 * account provisioning. PUBLIC_ORIGIN defaults to http://localhost:5173 in
 * the test env, so the redirects and callback URLs are deterministic.
 */
describe("OAuth (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let operatorToken: string;

  const server = () => request(app.getHttpServer());
  const realFetch = globalThis.fetch;

  /** Two-hop stub: token exchange, then userinfo. */
  const stubProvider = (userinfo: Record<string, unknown>) => {
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/token")) {
        return json(200, { access_token: "provider-access-token" });
      }
      if (url.includes("userinfo") || url.includes("login.yandex.ru")) {
        return json(200, userinfo);
      }
      throw new Error(`unexpected outbound fetch: ${url}`);
    }) as unknown as typeof fetch;
  };

  const json = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response;

  const setStateCookie = (res: request.Response): string => {
    const raw = res.headers["set-cookie"] as unknown as string[];
    const row = raw.find((cookie) => cookie.startsWith("oauth_state="));
    if (!row) throw new Error("no oauth_state cookie set");
    return row.split(";")[0];
  };

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
    await prisma.oAuthProviderSettings.deleteMany();
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
          passwordHash: await argonHash(OPERATOR_PASSWORD, {
            type: argon2id,
          }),
        },
      ],
    });
    const login = (email: string, password: string) =>
      server()
        .post("/api/v1/admin/auth/login")
        .send({ email, password })
        .expect(200);
    ownerToken = (await login(OWNER_EMAIL, OWNER_PASSWORD)).body.accessToken;
    operatorToken = (await login(OPERATOR_EMAIL, OPERATOR_PASSWORD)).body
      .accessToken;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await app.close();
  });

  // ------------------------------------------------- admin settings API

  it("rejects anonymous and user tokens", async () => {
    await server().get("/api/v1/admin/oauth-providers").expect(401);
    const user = await server()
      .post("/api/v1/auth/register")
      .send({
        email: "oauth-plain@example.com",
        password: "correct horse battery",
      })
      .expect(201);
    await server()
      .get("/api/v1/admin/oauth-providers")
      .set("Authorization", `Bearer ${user.body.accessToken}`)
      .expect(401);
  });

  it("lists both providers with masked secrets", async () => {
    const res = await server()
      .get("/api/v1/admin/oauth-providers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body).toEqual([
      {
        provider: "google",
        clientId: "",
        enabled: false,
        hasSecret: false,
        callbackUrl: "http://localhost:5173/api/v1/auth/oauth/google/callback",
        updatedBy: null,
        updatedAt: null,
      },
      {
        provider: "yandex",
        clientId: "",
        enabled: false,
        hasSecret: false,
        callbackUrl: "http://localhost:5173/api/v1/auth/oauth/yandex/callback",
        updatedBy: null,
        updatedAt: null,
      },
    ]);
  });

  it("lets only owners edit; unknown providers are rejected", async () => {
    await server()
      .put("/api/v1/admin/oauth-providers/google")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ clientId: "op-id", clientSecret: "op-secret", enabled: true })
      .expect(403);
    await server()
      .put("/api/v1/admin/oauth-providers/github")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ clientId: "x", enabled: false })
      .expect(400);
    await server()
      .put("/api/v1/admin/oauth-providers/google")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ clientId: "", enabled: false })
      .expect(400);
  });

  it("saves settings; enabling without a secret is refused", async () => {
    await server()
      .put("/api/v1/admin/oauth-providers/google")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ clientId: "google-app-id", enabled: true })
      .expect(400); // no secret yet
    await server()
      .put("/api/v1/admin/oauth-providers/google")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        clientId: "google-app-id",
        clientSecret: "google-app-secret",
        enabled: true,
      })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          provider: "google",
          clientId: "google-app-id",
          enabled: true,
          hasSecret: true,
          updatedBy: OWNER_EMAIL,
        });
        expect(JSON.stringify(res.body)).not.toContain("google-app-secret");
      });
  });

  // --------------------------------------------------- the login round trip

  it("exposes only enabled providers to the sign-in screen", async () => {
    const res = await server().get("/api/v1/auth/oauth/providers").expect(200);
    expect(res.body).toEqual({
      providers: [{ id: "google", label: "Google" }],
    });
  });

  it("runs the Google round trip into a working session", async () => {
    stubProvider({
      email: "vera@gmail.com",
      email_verified: true,
      name: "Vera",
    });

    const start = await server()
      .get("/api/v1/auth/oauth/google/start")
      .redirects(0)
      .expect(302);
    const authorize = new URL(start.headers.location as string);
    expect(authorize.origin + authorize.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );

    const callback = await server()
      .get(
        `/api/v1/auth/oauth/google/callback?code=the-code&state=${encodeURIComponent(
          authorize.searchParams.get("state") as string,
        )}`,
      )
      .set("Cookie", setStateCookie(start))
      .redirects(0)
      .expect(302);
    expect(callback.headers.location).toBe("http://localhost:5173/");
    const refreshRow = (callback.headers["set-cookie"] as unknown as string[])
      .find((cookie) => cookie.startsWith("refresh_token="))
      ?.split(";")[0];
    expect(refreshRow).toBeDefined();

    // The session the OAuth login minted is a normal one: refresh works.
    const session = await server()
      .post("/api/v1/auth/refresh")
      .set("Cookie", refreshRow as string)
      .expect(200);
    expect(session.body.user).toMatchObject({
      email: "vera@gmail.com",
      displayName: "Vera",
      // Provider-verified mailbox — no confirmation gate.
      emailVerifiedAt: expect.any(Number),
    });
    const me = await server()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${session.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe("vera@gmail.com");

    const created = await prisma.user.findUniqueOrThrow({
      where: { email: "vera@gmail.com" },
    });
    expect(created.passwordHash).toBeNull();
  });

  it("links an existing password account by email", async () => {
    await prisma.user.create({
      data: {
        email: "linked@gmail.com",
        passwordHash: await argonHash("correct horse battery", {
          type: argon2id,
        }),
        emailVerifiedAt: null,
      },
    });
    stubProvider({ email: "linked@gmail.com", email_verified: true });

    const start = await server()
      .get("/api/v1/auth/oauth/google/start")
      .redirects(0)
      .expect(302);
    await server()
      .get(
        `/api/v1/auth/oauth/google/callback?code=c&state=${encodeURIComponent(
          new URL(start.headers.location as string).searchParams.get(
            "state",
          ) as string,
        )}`,
      )
      .set("Cookie", setStateCookie(start))
      .redirects(0)
      .expect(302);

    const users = await prisma.user.findMany({
      where: { email: "linked@gmail.com" },
    });
    expect(users).toHaveLength(1);
    expect(users[0].emailVerifiedAt).not.toBeNull();
  });

  it("bounces a forged callback to the UI error param", async () => {
    const start = await server()
      .get("/api/v1/auth/oauth/google/start")
      .redirects(0)
      .expect(302);
    const other = await server()
      .get("/api/v1/auth/oauth/google/start")
      .redirects(0)
      .expect(302);
    // State minted in the first session, cookie of the second → mismatch.
    const res = await server()
      .get(
        `/api/v1/auth/oauth/google/callback?code=c&state=${encodeURIComponent(
          new URL(start.headers.location as string).searchParams.get(
            "state",
          ) as string,
        )}`,
      )
      .set("Cookie", setStateCookie(other))
      .redirects(0)
      .expect(302);
    expect(res.headers.location).toBe(
      "http://localhost:5173/?authError=oauth_failed",
    );
    await expect(
      prisma.user.findUnique({ where: { email: "vera2@gmail.com" } }),
    ).resolves.toBeNull();
  });

  it("runs the Yandex round trip (default_email, real_name)", async () => {
    await server()
      .put("/api/v1/admin/oauth-providers/yandex")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        clientId: "yandex-app-id",
        clientSecret: "yandex-app-secret",
        enabled: true,
      })
      .expect(200);
    stubProvider({ default_email: "vera@yandex.ru", real_name: "Вера" });

    const start = await server()
      .get("/api/v1/auth/oauth/yandex/start")
      .redirects(0)
      .expect(302);
    expect(new URL(start.headers.location as string).origin).toBe(
      "https://oauth.yandex.ru",
    );
    const callback = await server()
      .get(
        `/api/v1/auth/oauth/yandex/callback?code=c&state=${encodeURIComponent(
          new URL(start.headers.location as string).searchParams.get(
            "state",
          ) as string,
        )}`,
      )
      .set("Cookie", setStateCookie(start))
      .redirects(0)
      .expect(302);
    expect(callback.headers.location).toBe("http://localhost:5173/");
    const created = await prisma.user.findUniqueOrThrow({
      where: { email: "vera@yandex.ru" },
    });
    expect(created.displayName).toBe("Вера");
  });

  it("404s a provider that is not configured", async () => {
    await prisma.oAuthProviderSettings.delete({ where: { id: "yandex" } });
    await server()
      .get("/api/v1/auth/oauth/yandex/start")
      .redirects(0)
      .expect(404);
    await server()
      .get("/api/v1/auth/oauth/github/start")
      .redirects(0)
      .expect(404);
  });
});
