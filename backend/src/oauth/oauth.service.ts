import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, type User } from "@prisma/client";
import { env } from "@/config/env";
import type { OAuthProviderDto, OAuthProviderId } from "@janosik/shared";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { AuthResult } from "@/auth/auth.types";
import { AuthService } from "@/auth/auth.service";
import {
  OAUTH_PROVIDERS,
  OAUTH_STATE_TTL_MS,
  type OAuthProfile,
} from "./oauth.types";
import { OAuthSettingsService } from "./oauth-settings.service";

/**
 * The OAuth login itself (TASK-54): authorization-code flow per provider,
 * account provisioning by verified email, session issuance through the one
 * and only `AuthService.startSession` — an OAuth session is indistinguishable
 * from a password session (same rotation, same cookies, same audit surface).
 *
 * Accounts are matched by email: the provider proves mailbox ownership, so
 * the first OAuth login of an existing address links into it (and stamps
 * `emailVerifiedAt` — the address is now provider-verified). Linking into an
 * *unverified* account first wipes its credentials (B-1, see
 * `claimUnverifiedAccount`). A new address creates an OAuth-only account
 * with `passwordHash: null`.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly settings: OAuthSettingsService,
  ) {}

  /** Login buttons for the sign-in screen — only configured providers. */
  async listEnabled(): Promise<OAuthProviderDto[]> {
    return this.settings.listEnabled();
  }

  /**
   * Step 1: build the provider's authorize URL and a single-use state
   * value. Returns the redirect target and the state to park in the cookie.
   */
  async startAuthorize(
    provider: string,
  ): Promise<{ redirectUrl: string; state: string; maxAgeMs: number }> {
    const config = this.config(provider);
    const credentials = await this.settings.credentials(config.id);
    if (credentials === null) {
      throw new NotFoundException("OAuth provider is not configured");
    }
    const state = `${config.id}|${randomBytes(32).toString("base64url")}`;
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", credentials.clientId);
    url.searchParams.set("redirect_uri", this.callbackUrl(config.id));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    if (config.scope !== null) {
      url.searchParams.set("scope", config.scope);
    }
    // Force the account chooser so a previously picked account can never
    // silently log someone else's browser session in.
    if (config.id === "google") {
      url.searchParams.set("prompt", "select_account");
    }
    return { redirectUrl: url.toString(), state, maxAgeMs: OAUTH_STATE_TTL_MS };
  }

  /**
   * Step 2: validate the state round trip, exchange the code, provision the
   * account and start the session. Any failure is answered by the caller
   * with a redirect to the UI's `?authError=oauth_failed`.
   */
  async handleCallback(
    provider: string,
    code: string | undefined,
    state: string | undefined,
    stateCookie: string | undefined,
  ): Promise<AuthResult> {
    const config = this.config(provider);
    this.assertState(config.id, state, stateCookie);
    if (code === undefined || code === "") {
      throw new UnauthorizedException("Missing OAuth code");
    }
    const credentials = await this.settings.credentials(config.id);
    if (credentials === null) {
      throw new NotFoundException("OAuth provider is not configured");
    }
    const accessToken = await this.exchangeCode(config, credentials, code);
    const profile = await this.fetchProfile(config, accessToken);
    return this.provision(config.id, profile);
  }

  // ------------------------------------------------------------------ steps

  private config(provider: string) {
    const config = OAUTH_PROVIDERS[provider as OAuthProviderId];
    if (config === undefined) {
      throw new NotFoundException("Unknown OAuth provider");
    }
    return config;
  }

  private callbackUrl(provider: OAuthProviderId): string {
    return `${env.PUBLIC_ORIGIN.replace(/\/+$/, "")}/api/v1/auth/oauth/${provider}/callback`;
  }

  /**
   * The state cookie and the query state must be the exact `provider|random`
   * pair minted by `startAuthorize` — the callback is a top-level GET
   * navigation from the provider, so the `lax` cookie does arrive. Compared
   * in constant time; a mismatch means a forged or replayed callback.
   */
  private assertState(
    provider: OAuthProviderId,
    state: string | undefined,
    stateCookie: string | undefined,
  ): void {
    if (
      state === undefined ||
      stateCookie === undefined ||
      !state.startsWith(`${provider}|`)
    ) {
      throw new UnauthorizedException("OAuth state mismatch");
    }
    const a = Buffer.from(state);
    const b = Buffer.from(stateCookie);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("OAuth state mismatch");
    }
  }

  private async exchangeCode(
    config: { id: OAuthProviderId; tokenUrl: string },
    credentials: { clientId: string; clientSecret: string },
    code: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "authorization_code",
    });
    if (config.id === "google") {
      // Only Google validates the redirect_uri at token time.
      body.set("redirect_uri", this.callbackUrl(config.id));
    }
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    }).catch((cause: unknown) => {
      throw new UnauthorizedException(
        `OAuth token exchange failed: ${String(cause)}`,
      );
    });
    if (!response.ok) {
      throw new UnauthorizedException(
        `OAuth token exchange failed (HTTP ${response.status})`,
      );
    }
    const data = (await response.json()) as { access_token?: string };
    if (typeof data.access_token !== "string" || data.access_token === "") {
      throw new UnauthorizedException("OAuth provider returned no token");
    }
    return data.access_token;
  }

  private async fetchProfile(
    config: { id: OAuthProviderId; userinfoUrl: string },
    accessToken: string,
  ): Promise<OAuthProfile> {
    const response = await fetch(config.userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    }).catch((cause: unknown) => {
      throw new UnauthorizedException(
        `OAuth profile request failed: ${String(cause)}`,
      );
    });
    if (!response.ok) {
      throw new UnauthorizedException(
        `OAuth profile request failed (HTTP ${response.status})`,
      );
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (config.id === "google") {
      const email = typeof data.email === "string" ? data.email : "";
      if (email === "" || data.email_verified !== true) {
        throw new UnauthorizedException("Google account email is not verified");
      }
      return { email, displayName: nameOf(data.name) };
    }
    // Yandex: `default_email` is the primary address of the account.
    const email =
      typeof data.default_email === "string" ? data.default_email : "";
    if (email === "") {
      throw new UnauthorizedException("Yandex account has no email");
    }
    const name =
      nameOf(data.real_name) ?? nameOf(data.display_name) ?? nameOf(data.login);
    return { email, displayName: name };
  }

  /**
   * Email is the join key: an existing account is linked into (its address
   * is now provider-proven, so the verification gate may lift), a new one
   * starts as an OAuth-only account without a local password.
   */
  private async provision(
    provider: OAuthProviderId,
    rawProfile: OAuthProfile,
  ): Promise<AuthResult> {
    // Same normalization as register/login: emails are stored lowercased.
    const profile = { ...rawProfile, email: normalizeEmail(rawProfile.email) };
    // Case-insensitive lookup so a legacy mixed-case row is still the match
    // instead of a second account on the same mailbox.
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: profile.email, mode: "insensitive" } },
    });
    if (existing !== null) {
      if (existing.disabledAt !== null) {
        throw new ForbiddenException("Account is disabled");
      }
      const user =
        existing.emailVerifiedAt === null
          ? await this.claimUnverifiedAccount(existing.id)
          : existing;
      this.logger.log(
        `OAuth login (${provider}) linked into account ${user.id}`,
      );
      return this.authService.startSession(user);
    }
    try {
      const created = await this.prisma.user.create({
        data: {
          email: profile.email,
          passwordHash: null,
          displayName: profile.displayName,
          emailVerifiedAt: new Date(),
        },
      });
      this.logger.log(
        `OAuth login (${provider}) created account ${created.id}`,
      );
      return this.authService.startSession(created);
    } catch (error) {
      // Two first logins racing for the same address.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const user = await this.prisma.user.findUniqueOrThrow({
          where: { email: profile.email },
        });
        return this.authService.startSession(user);
      }
      throw error;
    }
  }

  /**
   * B-1 — pre-account takeover. An *unverified* account on this address was
   * created by someone who never proved they own the mailbox; the provider
   * just proved that the person signing in now does. Linking must therefore
   * hand the account over clean: the squatter's password is dropped (the
   * account becomes OAuth-only until the owner sets one), every refresh
   * session and every personal API token is revoked, and any pending
   * verification / email-change code is destroyed. Only then is the address
   * stamped verified. One transaction — a crash can never leave a verified
   * account that still carries the squatter's credentials.
   */
  private async claimUnverifiedAccount(userId: string): Promise<User> {
    const now = new Date();
    const [, , , , user] = await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.apiToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.emailVerificationCode.deleteMany({ where: { userId } }),
      this.prisma.emailChangeCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: null, emailVerifiedAt: now },
      }),
    ]);
    this.logger.warn(
      `OAuth claimed unverified account ${userId}: password cleared, sessions and API tokens revoked`,
    );
    return user;
  }
}

/** Emails are stored trimmed + lowercased (register/login/invite agree). */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nameOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  // displayName has a column-level friendliness limit — keep the head.
  return trimmed.slice(0, 50);
}
