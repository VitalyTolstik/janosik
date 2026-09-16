import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, User } from "@prisma/client";
import { argon2id, hash as argonHash, verify as argonVerify } from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";
import { USER_JWT_AUDIENCE } from "./auth.types";
import type { AuthResult, AuthUser } from "./auth.types";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Credentials and sessions (§7.0):
 * - passwords — argon2id;
 * - access token — 15 min JWT `{sub: userId}`;
 * - refresh token — opaque random string, DB stores only its sha256 hash;
 * - refresh rotates on every use; presenting an already-revoked token is a
 *   theft signal → every session of that user is revoked.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const passwordHash = await argonHash(dto.password, { type: argon2id });
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          displayName: dto.displayName ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Email is already registered");
      }
      throw error;
    }
    return this.startSession(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      await this.burnPasswordTime(dto.password);
      throw new UnauthorizedException("Invalid credentials");
    }
    const valid = await argonVerify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException("Invalid credentials");
    }
    // Moderation block (TASK-36): the master can disable an account; the
    // password stays correct but no session may be started.
    if (user.disabledAt !== null) {
      throw new ForbiddenException("Account is disabled");
    }
    return this.startSession(user);
  }

  async refresh(rawToken: string | undefined): Promise<AuthResult> {
    if (!rawToken) {
      throw new UnauthorizedException("Missing refresh token");
    }
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    // Reuse of an already-rotated/revoked token is a theft signal (§7.0):
    // revoke every session of the user, then reject the request.
    if (stored.revokedAt) {
      await this.revokeAllSessions(stored.userId);
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}: all sessions revoked`,
      );
      throw new UnauthorizedException("Refresh token reuse detected");
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Refresh token expired");
    }
    // A disabled account cannot keep a session alive either (TASK-36).
    if (stored.user.disabledAt !== null) {
      await this.revokeAllSessions(stored.userId);
      throw new ForbiddenException("Account is disabled");
    }
    // Rotate atomically: if a concurrent request revoked this token first,
    // it is the same theft signal as presenting a revoked token.
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count === 0) {
      await this.revokeAllSessions(stored.userId);
      this.logger.warn(
        `Concurrent refresh reuse detected for user ${stored.userId}: all sessions revoked`,
      );
      throw new UnauthorizedException("Refresh token reuse detected");
    }
    return this.startSession(stored.user);
  }

  /** Idempotent by design: absent/stale/unknown cookies still end in 200. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async startSession(user: User): Promise<AuthResult> {
    // The audience separates the two auth contours (TASK-36): a user token
    // fails the admin strategy and an admin token fails this one, so a
    // leaked session can never be replayed against the other surface.
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id },
      { audience: USER_JWT_AUDIENCE },
    );
    const refreshToken = await this.issueRefreshToken(user.id);
    return {
      accessToken,
      refreshToken,
      user: this.toAuthUser(user),
    };
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const token = randomBytes(48).toString("base64url");
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
      },
    });
    return token;
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Only the sha256 of the raw token is ever persisted. */
  private hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  private toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
  }

  /**
   * Verifies a throwaway hash when the email is unknown so the response
   * costs the same argon2 work as a wrong password — latency must not
   * reveal whether an email is registered.
   */
  private async burnPasswordTime(password: string): Promise<void> {
    const dummyHash = await argonHash("janosik-dummy-password", {
      type: argon2id,
    });
    await argonVerify(dummyHash, password);
  }
}
