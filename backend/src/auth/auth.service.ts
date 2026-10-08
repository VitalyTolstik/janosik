import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, User } from "@prisma/client";
import { argon2id, hash as argonHash, verify as argonVerify } from "argon2";
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";
import {
  emailChangeCodeEmail,
  emailChangedNoticeEmail,
  verificationCodeEmail,
} from "@/mailer/templates";
import type { MailLocale } from "@/mailer/mail.types";
import { MailerService } from "@/mailer/mailer.service";
import { toAuthUser } from "./auth-user.mapper";
import { USER_JWT_AUDIENCE } from "./auth.types";
import type { AuthResult, AuthUser } from "./auth.types";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import type { VerifyEmailDto } from "./dto/verify-email.dto";
import type { ChangePasswordDto } from "./dto/change-password.dto";
import type { ConfirmEmailChangeDto } from "./dto/confirm-email-change.dto";
import type { RequestEmailChangeDto } from "./dto/request-email-change.dto";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Verification code lifetime (TASK-51). */
const EMAIL_CHANGE_TTL_MS = 15 * 60 * 1000;
/** Wrong confirmations allowed before the code is destroyed. */
const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
/** Registration confirmation code lifetime (TASK-53). */
const EMAIL_VERIFY_TTL_MS = 15 * 60 * 1000;
/** Wrong confirmations allowed before the code is destroyed. */
const EMAIL_VERIFY_MAX_ATTEMPTS = 5;
/**
 * How recent a refresh-token revocation may be and still count as a lost
 * race (tab frozen mid-refresh, response lost) instead of token theft.
 * Beyond it, reuse is answered with the §7.0 all-sessions revocation.
 */
const REFRESH_REUSE_GRACE_MS = 60_000;
export { REFRESH_REUSE_GRACE_MS };

/**
 * Credentials and sessions (§7.0):
 * - passwords — argon2id;
 * - access token — 15 min JWT `{sub: userId}`;
 * - refresh token — opaque random string, DB stores only its sha256 hash;
 * - refresh rotates on every use; presenting an already-revoked token is a
 *   theft signal → every session of that user is revoked, unless the
 *   revocation is within `REFRESH_REUSE_GRACE_MS` (a lost rotation race,
 *   see `refresh`).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailer: MailerService,
  ) {}

  async register(
    dto: RegisterDto,
    locale: MailLocale = "en",
  ): Promise<AuthResult> {
    const passwordHash = await argonHash(dto.password, { type: argon2id });
    // When no mail transport is live (TASK-52 log mode) there is no channel
    // the code could travel through — a fresh self-hosted instance must not
    // dead-end behind a confirmation gate, so such accounts start verified.
    const user = await this.prisma.user
      .create({
        data: {
          email: dto.email,
          passwordHash,
          displayName: dto.displayName ?? null,
          emailVerifiedAt: this.mailer.enabled ? null : new Date(),
        },
      })
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new ConflictException("Email is already registered");
        }
        throw error;
      });
    if (user.emailVerifiedAt === null) {
      // Best-effort: the account exists either way, and the verification
      // gate offers a resend — a transient SMTP hiccup must not fail the
      // registration itself.
      await this.issueEmailVerificationCode(user, locale).catch((error) => {
        this.logger.warn(
          `Verification email for ${user.email} failed: ${String(error)}`,
        );
      });
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
    // OAuth-only account (TASK-54): no local password was ever set.
    if (user.passwordHash === null) {
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
    // revoke every session of the user, then reject the request — unless
    // the revocation is brand new. A rotation whose response never reached
    // the browser (tab frozen by the OS mid-refresh, network drop) leaves
    // the client on the stale cookie; its retry then presents a token that
    // was revoked moments ago. Killing every session for that lost race
    // locked the owner out of ALL their tabs (live incident 2026-09-23),
    // so a revocation younger than the grace window is answered with a
    // plain 401: the affected tab re-authenticates, the rest survive.
    if (stored.revokedAt) {
      const revokedAgo = Date.now() - stored.revokedAt.getTime();
      if (revokedAgo <= REFRESH_REUSE_GRACE_MS) {
        this.logger.log(
          `Refresh token race for user ${stored.userId} (revoked ${Math.round(revokedAgo / 1000)}s ago) — rejecting without session revocation`,
        );
        throw new UnauthorizedException("Refresh token race detected");
      }
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
    // that is the same sub-second race as above — reject without the
    // theft response, the racing tab recovers through the winner's cookie.
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count === 0) {
      this.logger.log(
        `Concurrent refresh race for user ${stored.userId} — rejecting without session revocation`,
      );
      throw new UnauthorizedException("Refresh token race detected");
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

  /**
   * Change the password after verifying the current one, then revoke every
   * refresh session except the caller's (identified by the cookie hash —
   * this route lives under `/auth`, so the cookie is actually sent; TASK-36.1).
   * API tokens survive on purpose: integrations must not break on a password
   * rotation.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    refreshToken: string | undefined,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    // An OAuth-only account (TASK-54) adopts its first password without the
    // current-password proof — there is no local secret to verify against.
    if (user.passwordHash !== null) {
      const valid = await argonVerify(user.passwordHash, dto.currentPassword);
      if (!valid) {
        throw new UnauthorizedException("Current password is incorrect");
      }
    }
    const passwordHash = await argonHash(dto.newPassword, { type: argon2id });
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    if (refreshToken !== undefined) {
      await this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          tokenHash: { not: this.hashToken(refreshToken) },
        },
        data: { revokedAt: new Date() },
      });
    }
  }

  /**
   * Email change, step 1 (TASK-51): verify the current password, park a
   * 6-digit code against the NEW address and email it there. A new request
   * replaces any pending code, so only the newest code ever works.
   */
  async requestEmailChange(
    userId: string,
    dto: RequestEmailChangeDto,
    locale: MailLocale,
  ): Promise<{ expiresAt: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    // For an OAuth-only account (TASK-54) the provider already proves
    // mailbox ownership on every login, so no current password is checked —
    // the change itself still requires the code sent to the NEW address.
    if (user.passwordHash !== null) {
      const valid = await argonVerify(user.passwordHash, dto.currentPassword);
      if (!valid) {
        throw new UnauthorizedException("Current password is incorrect");
      }
    }
    if (dto.newEmail === user.email) {
      throw new BadRequestException(
        "New email must differ from the current one",
      );
    }
    const taken = await this.prisma.user.findUnique({
      where: { email: dto.newEmail },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException("Email is already registered");
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);
    await this.prisma.emailChangeCode.deleteMany({ where: { userId } });
    await this.prisma.emailChangeCode.create({
      data: {
        userId,
        newEmail: dto.newEmail,
        codeHash: this.hashToken(code),
        expiresAt,
      },
    });
    const message = emailChangeCodeEmail(
      code,
      EMAIL_CHANGE_TTL_MS / 60_000,
      locale,
    );
    try {
      await this.mailer.send({ to: dto.newEmail, ...message });
    } catch {
      throw new ServiceUnavailableException(
        "Failed to send the verification email",
      );
    }
    return { expiresAt: expiresAt.getTime() };
  }

  /**
   * Email change, step 2 (TASK-51): swap the address once the code from the
   * new inbox is presented, revoke every other refresh session, and notify
   * the old address (best-effort). The caller keeps their session via a
   * fresh token pair; the route lives under `/auth` so the cookie that
   * identifies it is actually sent.
   */
  async confirmEmailChange(
    userId: string,
    dto: ConfirmEmailChangeDto,
    refreshToken: string | undefined,
    locale: MailLocale,
  ): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    const stored = await this.prisma.emailChangeCode.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    if (
      !stored ||
      stored.consumedAt !== null ||
      stored.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException("No pending email change");
    }
    const presented = this.hashToken(dto.code);
    const matches =
      presented.length === stored.codeHash.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(stored.codeHash));
    if (!matches) {
      // 6 digits over a 15-minute window stay safe because wrong guesses
      // burn the code after a handful of tries.
      const attempts = stored.attempts + 1;
      if (attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
        await this.prisma.emailChangeCode.deleteMany({ where: { userId } });
      } else {
        await this.prisma.emailChangeCode.update({
          where: { id: stored.id },
          data: { attempts },
        });
      }
      throw new BadRequestException("Invalid verification code");
    }
    let updated: User;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const next = await tx.user.update({
          where: { id: userId },
          data: { email: stored.newEmail },
        });
        await tx.emailChangeCode.update({
          where: { id: stored.id },
          data: { consumedAt: new Date() },
        });
        return next;
      });
    } catch (error) {
      // Someone registered the address between request and confirm.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Email is already registered");
      }
      throw error;
    }
    if (refreshToken !== undefined) {
      await this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          tokenHash: { not: this.hashToken(refreshToken) },
        },
        data: { revokedAt: new Date() },
      });
    }
    const notice = emailChangedNoticeEmail(updated.email, locale);
    await this.mailer
      .send({ to: user.email, ...notice })
      .catch(() => undefined);
    return this.startSession(updated);
  }

  /**
   * Registration confirmation (TASK-53), resend — a fresh code goes to the
   * address the account was registered with. Like the email-change request,
   * the call itself sends an email: 3 per hour per IP, one live code per
   * user on top.
   */
  async resendEmailVerification(
    userId: string,
    locale: MailLocale,
  ): Promise<{ expiresAt: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.emailVerifiedAt !== null) {
      throw new BadRequestException("Email is already verified");
    }
    const { expiresAt } = await this.issueEmailVerificationCode(user, locale);
    return { expiresAt: expiresAt.getTime() };
  }

  /**
   * Registration confirmation (TASK-53) — code in, the account activates.
   * The caller keeps their session; wrong guesses burn the code after a
   * handful of tries, exactly like the email-change confirmation.
   */
  async verifyEmail(
    userId: string,
    dto: VerifyEmailDto,
  ): Promise<{ user: AuthUser }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.emailVerifiedAt !== null) {
      throw new BadRequestException("Email is already verified");
    }
    const stored = await this.prisma.emailVerificationCode.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    if (
      !stored ||
      stored.consumedAt !== null ||
      stored.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException("No pending email verification");
    }
    const presented = this.hashToken(dto.code);
    const matches =
      presented.length === stored.codeHash.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(stored.codeHash));
    if (!matches) {
      const attempts = stored.attempts + 1;
      if (attempts >= EMAIL_VERIFY_MAX_ATTEMPTS) {
        await this.prisma.emailVerificationCode.deleteMany({
          where: { userId },
        });
      } else {
        await this.prisma.emailVerificationCode.update({
          where: { id: stored.id },
          data: { attempts },
        });
      }
      throw new BadRequestException("Invalid verification code");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      });
      await tx.emailVerificationCode.update({
        where: { id: stored.id },
        data: { consumedAt: new Date() },
      });
      return next;
    });
    return { user: toAuthUser(updated) };
  }

  /**
   * Generates the 6-digit confirmation code, stores only its sha256 (one
   * live row per user) and emails it. Throws on transport failure — the
   * callers decide whether that fails the request (resend) or not
   * (registration).
   */
  private async issueEmailVerificationCode(
    user: User,
    locale: MailLocale,
  ): Promise<{ code: string; expiresAt: Date }> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
    await this.prisma.emailVerificationCode.deleteMany({
      where: { userId: user.id },
    });
    await this.prisma.emailVerificationCode.create({
      data: {
        userId: user.id,
        codeHash: this.hashToken(code),
        expiresAt,
      },
    });
    const message = verificationCodeEmail(
      code,
      EMAIL_VERIFY_TTL_MS / 60_000,
      locale,
    );
    await this.mailer.send({ to: user.email, ...message });
    return { code, expiresAt };
  }

  /**
   * Issues the session pair for an already-authenticated principal. Public
   * so the OAuth login (TASK-54) converges on the exact same machinery —
   * audience, refresh rotation and TTLs stay in one place.
   */
  async startSession(user: User): Promise<AuthResult> {
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
      user: toAuthUser(user),
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
