import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { env } from "@/config/env";
import { REFRESH_COOKIE } from "./auth.types";
import type { AuthResult, AuthResponse, AuthUser } from "./auth.types";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
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
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.register(dto);
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
