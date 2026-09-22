import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { env } from "@/config/env";
import { pickLocale } from "@/mailer/mail.types";
import { REFRESH_COOKIE } from "./auth.types";
import type { AuthResult, AuthResponse, AuthUser } from "./auth.types";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { ConfirmEmailChangeDto } from "./dto/confirm-email-change.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { RequestEmailChangeDto } from "./dto/request-email-change.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RefreshToken } from "./refresh-token.decorator";

/**
 * §7.0 auth endpoints. The refresh cookie is scoped to /api/v1/auth and is
 * only marked Secure in production so plain-http self-hosting, dev and e2e
 * keep working (the §7.8 hardening task covers the http warning).
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("register")
  async register(
    @Body() dto: RegisterDto,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.register(dto, pickLocale(acceptLanguage));
    return this.withRefreshCookie(res, result);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(dto);
    return this.withRefreshCookie(res, result);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @RefreshToken() refreshToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.refresh(refreshToken);
    return this.withRefreshCookie(res, result);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @RefreshToken() refreshToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: "ok" }> {
    await this.auth.logout(refreshToken);
    // Path must match the set cookie or the browser keeps the old one.
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { status: "ok" };
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  // Lives under `/auth` on purpose: the refresh cookie is scoped to this
  // path, so the endpoint can tell the caller's session from the others.
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @RefreshToken() refreshToken: string | undefined,
  ): Promise<{ status: "ok" }> {
    await this.auth.changePassword(user.id, dto, refreshToken);
    return { status: "ok" };
  }

  /**
   * Email change (TASK-51), step 1 — a code goes to the new address. The
   * request itself sends an email, so it is the most expensive authenticated
   * endpoint: 3 per hour per IP, with the per-user single-code policy
   * server-side on top.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post("email/change/request")
  @HttpCode(HttpStatus.OK)
  async requestEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: RequestEmailChangeDto,
    @Headers("accept-language") acceptLanguage: string | undefined,
  ): Promise<{ expiresAt: number }> {
    return this.auth.requestEmailChange(
      user.id,
      dto,
      pickLocale(acceptLanguage),
    );
  }

  /**
   * Email change (TASK-51), step 2 — code in, address swapped, every other
   * session revoked, fresh token pair handed back (same contract as login).
   * Lives under `/auth` so the refresh cookie identifies the caller's
   * session — like `POST /password`.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("email/change/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmEmailChangeDto,
    @RefreshToken() refreshToken: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.confirmEmailChange(
      user.id,
      dto,
      refreshToken,
      pickLocale(acceptLanguage),
    );
    return this.withRefreshCookie(res, result);
  }

  /**
   * Registration confirmation (TASK-53): the 6-digit code from the signup
   * email activates the account. The verify endpoint allows 10/min — the
   * per-user single-code policy plus the 5-wrong-guess burn do the real
   * brute-force work; the headroom keeps one session (a few typos and a
   * success) clear of the limiter.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyEmailDto,
  ): Promise<{ user: AuthUser }> {
    return this.auth.verifyEmail(user.id, dto);
  }

  /**
   * Registration confirmation (TASK-53), resend — like the email-change
   * request, the call itself sends an email: 3 per hour per IP.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post("verify-email/resend")
  @HttpCode(HttpStatus.OK)
  async resendEmailVerification(
    @CurrentUser() user: AuthUser,
    @Headers("accept-language") acceptLanguage: string | undefined,
  ): Promise<{ expiresAt: number }> {
    return this.auth.resendEmailVerification(
      user.id,
      pickLocale(acceptLanguage),
    );
  }

  private withRefreshCookie(res: Response, result: AuthResult): AuthResponse {
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...this.cookieOptions(),
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
    return { accessToken: result.accessToken, user: result.user };
  }

  private cookieOptions(): {
    httpOnly: true;
    sameSite: "strict";
    path: string;
    secure: boolean;
  } {
    return {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/v1/auth",
      secure: env.NODE_ENV === "production",
    };
  }
}
