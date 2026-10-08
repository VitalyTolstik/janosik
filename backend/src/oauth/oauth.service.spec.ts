import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import type { PrismaService } from "@/common/prisma/prisma.service";
import type { AuthService } from "@/auth/auth.service";
import { OAuthService } from "./oauth.service";
import type { OAuthSettingsService } from "./oauth-settings.service";

/**
 * Unit coverage of the OAuth login logic (TASK-54): authorize URL and state
 * minting, the code exchange + profile fetch against stubbed `fetch`, and
 * the email-based provisioning. The redirect plumbing itself is e2e-covered.
 */

const prismaMock = {
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
} as unknown as PrismaService & {
  user: Record<"create" | "findUnique" | "update", jest.Mock>;
};

const authMock = {
  startSession: jest.fn(),
} as unknown as AuthService & { startSession: jest.Mock };

const settingsMock = {
  credentials: jest.fn(),
  listEnabled: jest.fn(),
} as unknown as OAuthSettingsService & {
  credentials: jest.Mock;
  listEnabled: jest.Mock;
};

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "user@example.com",
  passwordHash: null,
  displayName: null,
  avatarColor: null,
  avatarPath: null,
  disabledAt: null,
  emailVerifiedAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  ...overrides,
});

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

const CREDENTIALS = { clientId: "client-id", clientSecret: "client-secret" };

describe("OAuthService", () => {
  let service: OAuthService;
  const fetchMock = jest.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new OAuthService(prismaMock, authMock, settingsMock);
    settingsMock.credentials.mockResolvedValue(CREDENTIALS);
    authMock.startSession.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {},
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe("startAuthorize", () => {
    it("builds the Google authorize URL with state, scope and callback", async () => {
      const { redirectUrl, state } = await service.startAuthorize("google");
      const url = new URL(redirectUrl);

      expect(url.origin + url.pathname).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      expect(url.searchParams.get("client_id")).toBe("client-id");
      expect(url.searchParams.get("scope")).toBe("openid email profile");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://localhost:5173/api/v1/auth/oauth/google/callback",
      );
      expect(url.searchParams.get("state")).toBe(state);
      expect(state.split("|")[1]).toHaveLength(43); // 32 bytes base64url
    });

    it("omits scope for Yandex and uses its endpoints", async () => {
      const { redirectUrl, state } = await service.startAuthorize("yandex");
      const url = new URL(redirectUrl);

      expect(url.origin + url.pathname).toBe(
        "https://oauth.yandex.ru/authorize",
      );
      expect(url.searchParams.get("scope")).toBeNull();
      expect(state.startsWith("yandex|")).toBe(true);
    });

    it("404s an unknown provider and a provider without credentials", async () => {
      await expect(service.startAuthorize("github")).rejects.toThrow(
        NotFoundException,
      );
      settingsMock.credentials.mockResolvedValue(null);
      await expect(service.startAuthorize("google")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("handleCallback", () => {
    const start = async () => service.startAuthorize("google");
    const callback = (
      state: string | undefined,
      cookie: string | undefined,
      code = "auth-code",
    ) => service.handleCallback("google", code, state, cookie);

    const stubGoogleRoundtrip = (profile: Record<string, unknown>) => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { access_token: "at" }))
        .mockResolvedValueOnce(jsonResponse(200, profile));
    };

    it("exchanges the code, reads the verified profile and provisions a new account", async () => {
      const { state } = await start();
      stubGoogleRoundtrip({
        email: "New.User@example.com",
        email_verified: true,
        name: "  Vera  ",
      });
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockImplementation(async ({ data }) =>
        makeUser({ ...data, id: "user-2" }),
      );

      await service.handleCallback("google", "auth-code", state, state);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://oauth2.googleapis.com/token",
        expect.objectContaining({ method: "POST" }),
      );
      const tokenBody = String(
        fetchMock.mock.calls[0][1].body as URLSearchParams,
      );
      expect(tokenBody).toContain("grant_type=authorization_code");
      expect(tokenBody).toContain("client_id=client-id");
      expect(tokenBody).toContain("redirect_uri=");
      const [, userinfoInit] = fetchMock.mock.calls[1];
      expect(userinfoInit.headers.Authorization).toBe("Bearer at");
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: {
          email: "New.User@example.com",
          passwordHash: null,
          displayName: "Vera",
          emailVerifiedAt: expect.any(Date),
        },
      });
      expect(authMock.startSession).toHaveBeenCalledTimes(1);
    });

    it("links into the existing account by email and stamps the verification", async () => {
      const { state } = await start();
      stubGoogleRoundtrip({ email: "user@example.com", email_verified: true });
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ emailVerifiedAt: null }),
      );
      prismaMock.user.update.mockResolvedValue(
        makeUser({ emailVerifiedAt: new Date() }),
      );

      await service.handleCallback("google", "auth-code", state, state);

      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { emailVerifiedAt: expect.any(Date) },
      });
      expect(authMock.startSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: "user-1" }),
      );
    });

    it("refuses a disabled account", async () => {
      const { state } = await start();
      stubGoogleRoundtrip({ email: "user@example.com", email_verified: true });
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ disabledAt: new Date() }),
      );

      await expect(
        service.handleCallback("google", "auth-code", state, state),
      ).rejects.toThrow(ForbiddenException);
      expect(authMock.startSession).not.toHaveBeenCalled();
    });

    it("rejects a forged, replayed or provider-mismatched state", async () => {
      const { state } = await start();

      await expect(callback(undefined, state)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(callback(state, undefined)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(callback(`${state}x`, state)).rejects.toThrow(
        UnauthorizedException,
      );
      // State minted for Google replayed on the Yandex contour.
      const yandex = await service.startAuthorize("yandex");
      await expect(
        service.handleCallback("yandex", "code", state, yandex.state),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("rejects an unverified Google email", async () => {
      const { state } = await start();
      stubGoogleRoundtrip({ email: "user@example.com", email_verified: false });

      await expect(
        service.handleCallback("google", "auth-code", state, state),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("maps the Yandex profile (default_email, real_name)", async () => {
      const { state } = await service.startAuthorize("yandex");
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { access_token: "at" }))
        .mockResolvedValueOnce(
          jsonResponse(200, { default_email: "y@ya.ru", real_name: "Вера" }),
        );
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ emailVerifiedAt: null }),
      );
      prismaMock.user.update.mockResolvedValue(
        makeUser({ emailVerifiedAt: new Date() }),
      );

      await service.handleCallback("yandex", "code", state, state);

      expect(fetchMock.mock.calls[0][0]).toBe("https://oauth.yandex.ru/token");
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { emailVerifiedAt: expect.any(Date) },
      });
    });

    it("fails loudly when the provider answers with an error", async () => {
      const { state } = await start();
      fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "bad" }));

      await expect(
        service.handleCallback("google", "auth-code", state, state),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
