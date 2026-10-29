import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AdminUser } from "@prisma/client";
import { argon2id, hash as argonHash, verify as argonVerify } from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";
import { AdminLoginDto } from "@/auth/dto/login.dto";
import { isIpAllowed, SecurityService } from "./security.service";
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_LOCKOUT_MS,
  ADMIN_MAX_FAILED_LOGINS,
  ADMIN_TOKEN_TYPE,
} from "./admin.types";
import type { AdminPrincipal, AdminSessionResult } from "./admin.types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Master-account sessions (§7.4, TASK-36) — the same rotation/anti-reuse
 * discipline as user auth, with three extra hardenings:
 *
 * - lockout: `ADMIN_MAX_FAILED_LOGINS` wrong passwords freeze the account
 *   for `ADMIN_LOCKOUT_MS` (a leaked password cannot be brute-forced);
 * - an unknown email costs the same argon2 work as a wrong password, so
 *   response latency never reveals whether a master exists;
 * - every attempt — success, failure, lockout — lands in the audit log.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly security: SecurityService,
  ) {}

  async login(
    dto: AdminLoginDto,
    context: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<AdminSessionResult> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: dto.email },
    });
    if (!admin) {
      await this.burnPasswordTime(dto.password);
      await this.auditLoginFailed(dto.email, null, "unknown email");
      throw new UnauthorizedException("Invalid credentials");
    }

    if (
      admin.lockedUntil !== null &&
      admin.lockedUntil.getTime() > Date.now()
    ) {
      await this.prisma.adminAuditLog.create({
        data: {
          adminId: admin.id,
          adminEmail: admin.email,
          action: "admin.login_locked",
          details: { until: admin.lockedUntil.toISOString() },
        },
      });
      throw new HttpException(
        "Account is temporarily locked",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const valid = await argonVerify(admin.passwordHash, dto.password);
    if (!valid) {
      await this.registerFailedLogin(admin, "wrong password");
      throw new UnauthorizedException("Invalid credentials");
    }

    if (admin.disabledAt !== null) {
      await this.auditLoginFailed(dto.email, admin.id, "disabled");
      throw new ForbiddenException("Account is disabled");
    }

    // IP allowlist (TASK-65): a source outside the master's list is refused
    // after the password check, so an attacker never learns the list without
    // a valid password.
    if (!(await this.security.isIpAllowed(admin.id, context.ip ?? null))) {
      await this.auditLoginFailed(dto.email, admin.id, "ip not allowed", {
        ip: context.ip ?? null,
      });
      throw new ForbiddenException("Sign-in from this IP is not allowed");
    }

    // Two-factor (TASK-65): when enabled, the password alone is not enough.
    // `code: "totp_required"` lets the login screen know it must reveal the
    // one-time-code field (as opposed to a plain wrong-password 401).
    // TASK-147 (B18): a wrong code feeds the same lockout as a wrong password
    // — otherwise a valid password plus unlimited 6-digit guesses is open —
    // and a code is single-use (SecurityService replays reject it).
    const totpSecret = await this.security.requiredSecret(admin.id);
    if (totpSecret) {
      const codeValid = dto.totpCode
        ? this.security.verifyCode(totpSecret, dto.totpCode, admin.id)
        : false;
      if (!codeValid) {
        await this.registerFailedLogin(admin, "2fa required");
        throw new UnauthorizedException({
          message: "A valid two-factor code is required",
          code: "totp_required",
        });
      }
    }

    const updated = await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: admin.id,
        adminEmail: admin.email,
        action: "admin.login",
        details: { ip: context.ip ?? null },
      },
    });
    return this.startSession(updated, context);
  }

  async refresh(
    rawToken: string | undefined,
    context: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<AdminSessionResult> {
    if (!rawToken) {
      throw new UnauthorizedException("Missing refresh token");
    }
    const stored = await this.prisma.adminRefreshToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: { admin: true },
    });
    if (!stored) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    if (stored.revokedAt) {
      await this.revokeAllSessions(stored.adminId);
      await this.prisma.adminAuditLog.create({
        data: {
          adminId: stored.adminId,
          adminEmail: stored.admin.email,
          action: "admin.sessions_revoked",
          details: { reason: "refresh token reuse" },
        },
      });
      this.logger.warn(
        `Admin refresh token reuse detected for ${stored.adminId}: all sessions revoked`,
      );
      throw new UnauthorizedException("Refresh token reuse detected");
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Refresh token expired");
    }
    if (stored.admin.disabledAt !== null) {
      await this.revokeAllSessions(stored.adminId);
      throw new ForbiddenException("Account is disabled");
    }
    // The allowlist gates session renewal too (not only the password login):
    // a refresh cookie carried off an allowed network cannot mint tokens.
    if (!isIpAllowed(stored.admin.ipAllowlist, context.ip ?? null)) {
      await this.auditLoginFailed(
        stored.admin.email,
        stored.adminId,
        "ip not allowed",
        {
          ip: context.ip ?? null,
          stage: "refresh",
        },
      );
      throw new ForbiddenException("Sign-in from this IP is not allowed");
    }
    const rotated = await this.prisma.adminRefreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count === 0) {
      await this.revokeAllSessions(stored.adminId);
      throw new UnauthorizedException("Refresh token reuse detected");
    }
    return this.startSession(stored.admin, context);
  }

  /** Idempotent: absent/stale/unknown cookies still end in 200. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }
    const stored = await this.prisma.adminRefreshToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: { admin: true },
    });
    if (!stored || stored.revokedAt !== null) {
      return;
    }
    await this.prisma.adminRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: stored.adminId,
        adminEmail: stored.admin.email,
        action: "admin.logout",
      },
    });
  }

  private async startSession(
    admin: AdminUser,
    context: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<AdminSessionResult> {
    const accessToken = await this.jwtService.signAsync(
      { sub: admin.id, typ: ADMIN_TOKEN_TYPE },
      { audience: ADMIN_JWT_AUDIENCE },
    );
    const refreshToken = await this.issueRefreshToken(admin.id, context);
    return { accessToken, refreshToken, admin: this.toPrincipal(admin) };
  }

  private async issueRefreshToken(
    adminId: string,
    context: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<string> {
    const token = randomBytes(48).toString("base64url");
    await this.prisma.adminRefreshToken.create({
      data: {
        tokenHash: this.hashToken(token),
        adminId,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      },
    });
    return token;
  }

  private async revokeAllSessions(adminId: string): Promise<void> {
    await this.prisma.adminRefreshToken.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  toPrincipal(admin: AdminUser): AdminPrincipal {
    return {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role,
      createdAt: admin.createdAt.getTime(),
      lastLoginAt: admin.lastLoginAt?.getTime() ?? null,
    };
  }

  private async auditLoginFailed(
    email: string,
    adminId: string | null,
    reason: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        adminEmail: email,
        action: "admin.login_failed",
        details: { reason, ...details },
      },
    });
  }

  /**
   * Counts a failed password *or* two-factor attempt and arms the lockout
   * (TASK-147, B18). Both gates share one counter, so a correct password plus
   * guessed TOTP codes cannot outlast the brute-force budget.
   */
  private async registerFailedLogin(
    admin: AdminUser,
    reason: string,
  ): Promise<void> {
    const failedLogins = admin.failedLogins + 1;
    const lockedUntil =
      failedLogins >= ADMIN_MAX_FAILED_LOGINS
        ? new Date(Date.now() + ADMIN_LOCKOUT_MS)
        : null;
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLogins, lockedUntil },
    });
    await this.auditLoginFailed(admin.email, admin.id, reason, {
      failedLogins,
    });
  }

  /** Equal-cost path for unknown emails (see class docs). */
  private async burnPasswordTime(password: string): Promise<void> {
    const dummyHash = await argonHash("janosik-admin-dummy", {
      type: argon2id,
    });
    await argonVerify(dummyHash, password);
  }
}
