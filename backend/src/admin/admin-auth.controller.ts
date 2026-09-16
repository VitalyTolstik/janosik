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
import type { AdminAuthResponseDto } from "@janosik/shared";
import { env } from "@/config/env";
import { LoginDto } from "@/auth/dto/login.dto";
import { RefreshToken } from "@/auth/refresh-token.decorator";
import { AdminAuthService } from "./admin-auth.service";
import { AdminJwtAuthGuard } from "./admin-jwt-auth.guard";
import { CurrentAdmin } from "./current-admin.decorator";
import { ADMIN_REFRESH_COOKIE, ADMIN_REFRESH_COOKIE_PATH } from "./admin.types";
import type { AdminPrincipal, AdminSessionResult } from "./admin.types";

/**
 * Master-account auth (§7.4, TASK-36): `/api/v1/admin/auth/*`.
 *
 * The refresh cookie is scoped to `/api/v1/admin/auth` — it is not sent to
 * user routes, not sent to `/admin/users`, and a user cookie is not sent
 * here.
 */
@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  // 10/min on top of the 5-attempt account lockout: an attacker cannot
  // grind passwords, while a legitimate master never hits the ceiling.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponseDto> {
    const result = await this.adminAuth.login(dto);
    return this.withRefreshCookie(res, result);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @RefreshToken(ADMIN_REFRESH_COOKIE) refreshToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponseDto> {
    const result = await this.adminAuth.refresh(refreshToken);
    return this.withRefreshCookie(res, result);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @RefreshToken(ADMIN_REFRESH_COOKIE) refreshToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: "ok" }> {
    await this.adminAuth.logout(refreshToken);
    res.clearCookie(ADMIN_REFRESH_COOKIE, this.cookieOptions());
    return { status: "ok" };
  }

  @UseGuards(AdminJwtAuthGuard)
  @Get("me")
  me(@CurrentAdmin() admin: AdminPrincipal): AdminPrincipal {
    return admin;
  }

  private withRefreshCookie(
    res: Response,
    result: AdminSessionResult,
  ): AdminAuthResponseDto {
    res.cookie(ADMIN_REFRESH_COOKIE, result.refreshToken, {
      ...this.cookieOptions(),
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
    return { accessToken: result.accessToken, admin: result.admin };
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
      path: ADMIN_REFRESH_COOKIE_PATH,
      secure: env.NODE_ENV === "production",
    };
  }
}
