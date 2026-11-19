import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import type { AuthOAuthProvidersResponse } from "@janosik/shared";
import { env } from "@/config/env";
import { cookieSecure } from "@/config/security";
import { appBasePrefix } from "@/common/ui-base";
import { REFRESH_COOKIE } from "@/auth/auth.types";
import { OAUTH_STATE_COOKIE } from "./oauth.types";
import { RequestCookie } from "./request-cookie.decorator";
import { OAuthService } from "./oauth.service";
import { AuthService } from "@/auth/auth.service";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { SessionOnlyGuard } from "@/auth/auth-principal";
import { CurrentUser } from "@/auth/current-user.decorator";
import type { AuthUser } from "@/auth/auth.types";

const OAUTH_LINK_COOKIE = "oauth_link_proof";
const OAUTH_RETURN_COOKIE = "oauth_return_to";
const OAUTH_COOKIE_PATH = "/api/v1/auth/oauth";
// Leave room for the cookie name and attributes within the browser's 4 KiB limit.
const MAX_ENCODED_RETURN_BYTES = 3800;

/** The provider may only return the browser to a route in the user app. */
function oauthReturnUrl(path: unknown): URL {
  const prefix = appBasePrefix();
  const fallback = new URL(prefix, env.PUBLIC_ORIGIN);
  if (
    typeof path !== "string" ||
    path.length > MAX_ENCODED_RETURN_BYTES ||
    !path.startsWith(prefix) ||
    path.startsWith("//") ||
    /[\\\r\n\t]/.test(path)
  ) {
    return fallback;
  }

  const url = new URL(path, fallback);
  const route = url.pathname.slice(prefix.length);
  if (
    url.origin !== fallback.origin ||
    !url.pathname.startsWith(prefix) ||
    encodeURIComponent(url.pathname + url.search + url.hash).length >
      MAX_ENCODED_RETURN_BYTES ||
    !/^(?:|board\/[^/]+\/?|agents(?:\/[^/]+)?\/?)$/.test(route)
  ) {
    return fallback;
  }
  return url;
}
class OAuthLinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password!: string;
}

/**
 * Browser-redirect endpoints of the OAuth login (TASK-54). Both are full
 * page navigations, not XHR: the answer is always a 302 — to the provider,
 * or back to the UI where the auth gate boots the fresh session from
 * the refresh cookie. Any callback failure lands on `?authError=oauth_failed`
 * and the sign-in screen explains it.
 */
@Controller("auth/oauth")
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly oauth: OAuthService,
    private readonly auth: AuthService,
  ) {}

  /** Which login buttons the sign-in screen should render. */
  @Get("providers")
  async listProviders(): Promise<AuthOAuthProvidersResponse> {
    return { providers: await this.oauth.listEnabled() };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(":provider/start")
  async start(
    @Param("provider") provider: string,
    @Query("returnTo") returnTo: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const { redirectUrl, state, maxAgeMs } =
      await this.oauth.startAuthorize(provider);
    res.clearCookie(OAUTH_LINK_COOKIE, { path: OAUTH_COOKIE_PATH });
    const options = {
      httpOnly: true,
      // The provider's top-level GET redirect must carry the cookie back —
      // `strict` would drop it, `lax` is the correct CSRF posture here.
      sameSite: "lax" as const,
      path: OAUTH_COOKIE_PATH,
      secure: cookieSecure(),
      maxAge: maxAgeMs,
    };
    const target = oauthReturnUrl(returnTo);
    res.cookie(OAUTH_STATE_COOKIE, state, options);
    res.cookie(
      OAUTH_RETURN_COOKIE,
      target.pathname + target.search + target.hash,
      options,
    );
    res.redirect(302, redirectUrl);
  }

  @UseGuards(JwtAuthGuard, SessionOnlyGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(":provider/link")
  async startLink(
    @Param("provider") provider: string,
    @CurrentUser() user: AuthUser,
    @Body() body: OAuthLinkDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectUrl: string }> {
    const { redirectUrl, state, maxAgeMs } =
      await this.oauth.startAuthorize(provider);
    const proof = await this.auth.issueOAuthLinkProof(
      user.id,
      body.password,
      state,
    );
    const options = {
      httpOnly: true as const,
      sameSite: "lax" as const,
      path: OAUTH_COOKIE_PATH,
      secure: cookieSecure(),
      maxAge: maxAgeMs,
    };
    res.cookie(OAUTH_STATE_COOKIE, state, options);
    res.cookie(OAUTH_LINK_COOKIE, proof, options);
    res.clearCookie(OAUTH_RETURN_COOKIE, { path: OAUTH_COOKIE_PATH });
    return { redirectUrl };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(":provider/callback")
  async callback(
    @Param("provider") provider: string,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @RequestCookie(OAUTH_STATE_COOKIE) stateCookie: string | undefined,
    @RequestCookie(OAUTH_LINK_COOKIE) linkProof: string | undefined,
    @RequestCookie(OAUTH_RETURN_COOKIE) returnTo: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    res.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_COOKIE_PATH });
    res.clearCookie(OAUTH_LINK_COOKIE, { path: OAUTH_COOKIE_PATH });
    res.clearCookie(OAUTH_RETURN_COOKIE, { path: OAUTH_COOKIE_PATH });
    const target = oauthReturnUrl(
      state !== undefined &&
        state === stateCookie &&
        state.startsWith(`${provider}|`)
        ? returnTo
        : undefined,
    );
    try {
      const result = await this.oauth.handleCallback(
        provider,
        code,
        state,
        stateCookie,
        linkProof,
      );
      res.cookie(REFRESH_COOKIE, result.refreshToken, {
        ...this.refreshCookieOptions(),
        maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      });
      if (target.searchParams.has("authError"))
        target.searchParams.delete("authError");
      res.redirect(302, target.href);
    } catch (cause) {
      this.logger.warn(
        `OAuth callback (${provider}) failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      target.searchParams.set("authError", "oauth_failed");
      res.redirect(302, target.href);
    }
  }

  /** Same posture as the auth contour's refresh cookie (§7.0). */
  private refreshCookieOptions(): {
    httpOnly: true;
    sameSite: "strict";
    path: string;
    secure: boolean;
  } {
    return {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/v1/auth",
      secure: cookieSecure(),
    };
  }
}
