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
import { MAX_IMPORT_BYTES } from "@janosik/shared";
import { argon2id, hash as argonHash, verify as argonVerify } from "argon2";
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecurityAuditService } from "@/common/security-audit/security-audit.service";
import { env } from "@/config/env";
import { maxBoardsPerUser } from "@/config/limits";
import { EmailTemplateService } from "@/ops/email-template.service";
import { FeatureFlagsService } from "@/ops/feature-flags.service";
import type { MailLocale } from "@/mailer/mail.types";
import { passwordResetEmail } from "@/mailer/templates";
import type { ConfirmPasswordResetDto } from "./dto/password-reset.dto";
import { MailerService } from "@/mailer/mailer.service";
import { MailQueueService } from "@/mailer/mail-queue.service";
import { toAuthUser } from "./auth-user.mapper";
import { USER_JWT_AUDIENCE } from "./auth.types";
import type { AuthResponse, AuthResult, AuthUser } from "./auth.types";
import { LoginDto } from "./dto/login.dto";
import { LoginBackoffService } from "./login-backoff.service";
import { RegisterDto } from "./dto/register.dto";
import { revokeApiTokens } from "./token-revocation";
import { securityStamp } from "./security-stamp";
import {
  assertOAuthProofMatchesUser,
  verifyOAuthProofToken,
} from "./oauth-proof";
import type { VerifyEmailDto } from "./dto/verify-email.dto";
import type { ChangePasswordDto } from "./dto/change-password.dto";
import type { ConfirmEmailChangeDto } from "./dto/confirm-email-change.dto";
import type { RequestEmailChangeDto } from "./dto/request-email-change.dto";

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A random, never-revealed password hashed once when the process starts.
 * Unknown-email logins verify against it so timing does not depend on a
 * published hash of a known password.
 */
const DUMMY_PASSWORD_HASH: Promise<string> = argonHash(
  randomBytes(32).toString("base64url"),
  { type: argon2id },
);
/** TASK-166: marks a refresh token minted by an OAuth login. */
const OAUTH_REFRESH_PREFIX = "jnko_";
function oauthAuthenticationTime(token: string): number {
  const match = /^jnko_(\d{13})_/.exec(token);
  return match ? Number(match[1]) : 0;
}
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
    private readonly mailQueue: MailQueueService,
    private readonly emailTemplates: EmailTemplateService,
    private readonly flags: FeatureFlagsService,
    private readonly loginBackoff: LoginBackoffService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  /**
   * Public runtime config for the sign-in screen (TASK-38a): whether sign-up
   * is open and whether public share links are enabled. Unauthenticated —
   * the UI needs it before a session exists to decide which controls to
   * render. Reads the same feature flags the server enforces, so the UI and
   * the backend never disagree.
   */
  async publicConfig(): Promise<{
    allowRegistration: boolean;
    allowPublicShares: boolean;
    limits: { boards: number | null; importBytes: number };
  }> {
    return {
      allowRegistration:
        this.mailer.enabled &&
        (await this.flags.isEnabled("registration_open")),
      allowPublicShares: await this.flags.isEnabled("public_shares"),
      // TASK-166: the UI shows a board cap only when the operator set one.
      limits: {
        boards: maxBoardsPerUser() > 0 ? maxBoardsPerUser() : null,
        importBytes: MAX_IMPORT_BYTES,
      },
    };
  }

  async assertRegistrationOpen(): Promise<void> {
    await this.flags.assertEnabled("registration_open");
  }

  async issueOAuthLinkProof(
    userId: string,
    password: string,
    state: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      user.disabledAt !== null ||
      user.passwordHash === null ||
      !(await argonVerify(user.passwordHash, password))
    ) {
      throw new UnauthorizedException({
        message: "Current password is incorrect",
        code: "current_password_invalid",
      });
    }
    return this.jwtService.signAsync(
      { sub: user.id, state, stamp: securityStamp(user) },
      { audience: "janosik-oauth-link", expiresIn: "10m" },
    );
  }

  async verifyOAuthLinkProof(proof: string, state: string): Promise<User> {
    let payload: { sub?: unknown; state?: unknown; stamp?: unknown };
    try {
      payload = await this.jwtService.verifyAsync(proof, {
        audience: "janosik-oauth-link",
      });
    } catch {
      throw new UnauthorizedException("OAuth linking proof is invalid");
    }
    if (typeof payload.sub !== "string" || payload.state !== state)
      throw new UnauthorizedException("OAuth linking proof is invalid");
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (
      !user ||
      user.disabledAt !== null ||
      payload.stamp !== securityStamp(user)
    )
      throw new UnauthorizedException("OAuth linking proof is invalid");
    return user;
  }

  async register(
    dto: RegisterDto,
    locale: MailLocale = "en",
  ): Promise<AuthResult> {
    // Registration can be switched off from the panel (TASK-61 flag); with
    // it off, sign-up is refused for everyone.
    await this.flags.assertEnabled("registration_open");
    if (!this.mailer.enabled) {
      throw new ServiceUnavailableException(
        "Email delivery must be configured before registration",
      );
    }
    const passwordHash = await argonHash(dto.password, { type: argon2id });
    // A mailbox is not verified until its owner proves access to it. The
    // e2e harness opts out of the gate by default (`E2E_AUTO_VERIFY`), so
    // unrelated suites can create verified members; the verification suite
    // clears the flag to exercise the real flow.
    const autoVerify =
      process.env.NODE_ENV === "test" && process.env.E2E_AUTO_VERIFY === "1";
    const user = await this.prisma.user
      .create({
        data: {
          email: dto.email,
          passwordHash,
          displayName: dto.displayName ?? null,
          emailVerifiedAt: autoVerify ? new Date() : null,
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
    // B-8: per-account backoff on top of the per-IP throttler.
    await this.loginBackoff.assertNotLocked(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      await this.burnPasswordTime(dto.password);
      await this.loginBackoff.recordFailure(dto.email);
      throw new UnauthorizedException("Invalid credentials");
    }
    // OAuth-only account (TASK-54): no local password was ever set.
    if (user.passwordHash === null) {
      await this.burnPasswordTime(dto.password);
      await this.loginBackoff.recordFailure(dto.email);
      throw new UnauthorizedException("Invalid credentials");
    }
    const valid = await argonVerify(user.passwordHash, dto.password);
    if (!valid) {
      await this.loginBackoff.recordFailure(dto.email);
      throw new UnauthorizedException("Invalid credentials");
    }
    await this.loginBackoff.assertNotLocked(dto.email);
    await this.loginBackoff.reset(dto.email);
    // Moderation block (TASK-36): the master can disable an account; the
    // password stays correct but no session may be started.
    if (user.disabledAt !== null) {
      throw new ForbiddenException("Account is disabled");
    }
    return this.startSession(user);
  }

  async requestPasswordReset(
    email: string,
    locale: MailLocale,
  ): Promise<boolean> {
    if (!this.mailer.enabled) {
      throw new ServiceUnavailableException("Password recovery is unavailable");
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (
      !user ||
      user.disabledAt !== null ||
      user.emailVerifiedAt === null ||
      user.passwordHash === null
    )
      return false;
    const code = randomBytes(16).toString("hex");
    const tokenHash = this.hashToken(code);
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    // Keep one live code and cap mail per account across all application nodes.
    const created = await this.prisma.passwordResetToken.createMany({
      data: [{ userId: user.id, tokenHash, expiresAt }],
      skipDuplicates: true,
    });
    if (created.count === 0) {
      const replaced = await this.prisma.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          expiresAt: { lte: new Date(Date.now() + 14 * 60_000) },
        },
        data: { tokenHash, expiresAt },
      });
      if (replaced.count === 0) return true;
    }
    void this.mailQueue
      .enqueue({
        to: user.email,
        ...passwordResetEmail(code, locale),
      })
      .catch((error: unknown) =>
        this.logger.warn(`Password recovery delivery failed: ${String(error)}`),
      );
    return false;
  }

  async confirmPasswordReset(dto: ConfirmPasswordResetDto): Promise<void> {
    const tokenHash = this.hashToken(dto.code);
    const candidate = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !candidate ||
      candidate.expiresAt <= new Date() ||
      candidate.user.email !== dto.email ||
      candidate.user.disabledAt !== null ||
      candidate.user.emailVerifiedAt === null
    ) {
      throw new BadRequestException("Invalid or expired recovery code");
    }
    const passwordHash = await argonHash(dto.newPassword, { type: argon2id });
    const revokedTokenIds = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      if (
        !token ||
        token.expiresAt <= new Date() ||
        token.user.email !== dto.email ||
        token.user.disabledAt !== null ||
        token.user.emailVerifiedAt === null
      ) {
        throw new BadRequestException("Invalid or expired recovery code");
      }
      const consumed = await tx.passwordResetToken.deleteMany({
        where: {
          userId: token.userId,
          tokenHash,
          expiresAt: { gt: new Date() },
        },
      });
      if (consumed.count !== 1)
        throw new BadRequestException("Invalid or expired recovery code");
      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      });
      await tx.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const tokens = await revokeApiTokens(tx, {
        userId: token.userId,
        revokedAt: null,
      });
      return tokens.tokenIds;
    });
    await this.securityAudit.record({
      userId: candidate.userId,
      actorId: candidate.userId,
      action: "token.revoked",
      targetType: "user",
      targetId: candidate.userId,
      details: {
        reason: "password_reset",
        scope: "all",
        tokenIds: revokedTokenIds,
      },
    });
    await this.loginBackoff.reset(dto.email);
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${stored.userId} FOR UPDATE`;
      const current = await tx.user.findUnique({
        where: { id: stored.userId },
      });
      if (
        !current ||
        current.disabledAt !== null ||
        securityStamp(current) !== securityStamp(stored.user)
      ) {
        throw new UnauthorizedException("Session is no longer valid");
      }
      // Rotation stays inside the login's family; a legacy token starts one,
      // and the old row is stamped too so a later logout presenting it can
      // still revoke the successor it never knew about.
      const familyId = stored.familyId ?? this.newRefreshFamilyId();
      const rotated = await tx.refreshToken.updateMany({
        where: {
          id: stored.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          revokedAt: new Date(),
          ...(stored.familyId === null ? { familyId } : {}),
        },
      });
      if (rotated.count === 0)
        throw new UnauthorizedException("Refresh token race detected");
      // Legacy OAuth-only refresh tokens predate the `jnko_` prefix; the
      // account row is the only remaining proof that they came from OAuth.
      const method =
        rawToken.startsWith(OAUTH_REFRESH_PREFIX) ||
        stored.user.passwordHash === null
          ? "oauth"
          : "password";
      const authTime =
        method === "oauth" ? oauthAuthenticationTime(rawToken) : undefined;
      return this.createSession(tx, current, method, authTime, familyId);
    });
  }

  /**
   * Idempotent by design: absent/stale/unknown cookies still end in 200.
   *
   * Rotation and logout serialize on the `User` row. Logout revokes the
   * whole rotation family, not only the presented hash: a refresh that won
   * the race just before this call may already have minted its successor,
   * and that successor must not survive the logout.
   */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, familyId: true },
    });
    if (!stored) {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${stored.userId} FOR UPDATE`;
      await tx.refreshToken.updateMany({
        where: stored.familyId
          ? {
              userId: stored.userId,
              familyId: stored.familyId,
              revokedAt: null,
            }
          : { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  /**
   * Change the password after verifying the current one, then revoke every
   * refresh session except the caller's (identified by the cookie hash —
   * this route lives under `/auth`, so the cookie is actually sent; TASK-36.1).
   *
   * B-2: every personal API token is revoked too. A password rotation is the
   * user's "I think something leaked" button — a key minted by whoever held
   * the old password (or by a prompt-injected agent) must die with it. The
   * route itself refuses PATs (`SessionOnlyGuard`).
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    refreshToken: string | undefined,
    stamp: string | undefined,
  ): Promise<void> {
    if (!stamp) {
      throw new UnauthorizedException("Credentials changed; sign in again");
    }
    // Verify the OAuth proof's signature/freshness before taking the lock;
    // its stamp is compared with the locked row below.
    const proof = dto.oauthProof
      ? await verifyOAuthProofToken(this.jwtService, dto.oauthProof)
      : undefined;
    const passwordHash = await argonHash(dto.newPassword, { type: argon2id });
    const revokedTokenIds = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: userId } });
      if (
        !current ||
        current.disabledAt !== null ||
        securityStamp(current) !== stamp
      ) {
        throw new UnauthorizedException("Credentials changed; sign in again");
      }
      if (current.passwordHash === null) {
        // TASK-54: an OAuth-only account sets its first password only with
        // a fresh provider proof — a surviving session alone is not enough.
        if (!proof) {
          throw new UnauthorizedException({
            message: "OAuth re-authentication is required",
            code: "oauth_proof_required",
          });
        }
        assertOAuthProofMatchesUser(proof, current);
      } else {
        const valid = await argonVerify(
          current.passwordHash,
          dto.currentPassword ?? "",
        );
        if (!valid) {
          throw new UnauthorizedException({
            message: "Current password is incorrect",
            code: "current_password_invalid",
          });
        }
      }
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      const revoked = await revokeApiTokens(tx, {
        userId,
        revokedAt: null,
      });
      await tx.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(refreshToken
            ? { tokenHash: { not: this.hashToken(refreshToken) } }
            : {}),
        },
        data: { revokedAt: new Date() },
      });
      return revoked.tokenIds;
    });
    await this.securityAudit.record({
      userId,
      actorId: userId,
      action: "token.revoked",
      targetType: "user",
      targetId: userId,
      details: {
        reason: "password_changed",
        scope: "all",
        tokenIds: revokedTokenIds,
      },
    });
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
    stamp: string | undefined,
  ): Promise<{ expiresAt: number; queued: boolean }> {
    if (!this.mailer.enabled) {
      throw new ServiceUnavailableException(
        "Email delivery must be configured before changing the address",
      );
    }
    if (!stamp) {
      throw new UnauthorizedException("Credentials changed; sign in again");
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: userId } });
      if (
        !current ||
        current.disabledAt !== null ||
        securityStamp(current) !== stamp
      ) {
        throw new UnauthorizedException("Credentials changed; sign in again");
      }
      // For an OAuth-only account (TASK-54) the provider already proves
      // mailbox ownership on every login, so no current password is checked —
      // the change itself still requires the code sent to the NEW address.
      if (current.passwordHash !== null) {
        const valid = await argonVerify(
          current.passwordHash,
          dto.currentPassword ?? "",
        );
        if (!valid) {
          throw new UnauthorizedException({
            message: "Current password is incorrect",
            code: "current_password_invalid",
          });
        }
      }
      if (dto.newEmail === current.email) {
        throw new BadRequestException(
          "New email must differ from the current one",
        );
      }
      const taken = await tx.user.findUnique({
        where: { email: dto.newEmail },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException("Email is already registered");
      }
      await tx.emailChangeCode.deleteMany({ where: { userId } });
      await tx.emailChangeCode.create({
        data: {
          userId,
          newEmail: dto.newEmail,
          codeHash: this.hashToken(`email-change:${userId}:${code}`),
          expiresAt,
        },
      });
    });
    const message = await this.emailTemplates.emailChangeEmail(
      code,
      EMAIL_CHANGE_TTL_MS / 60_000,
      locale,
    );
    // TASK-67: queued, not sent inline — a slow/failing transport no longer
    // fails the request. The code is live either way; the caller can retry.
    await this.mailQueue.enqueue({ to: dto.newEmail, ...message });
    return { expiresAt: expiresAt.getTime(), queued: true };
  }

  /**
   * Email change, step 2 (TASK-51): swap the address once the code from the
   * new inbox is presented, revoke other refresh sessions, and notify the old
   * address. The caller's existing cookie is kept, avoiding a late Set-Cookie
   * response overwriting a later sign-in in the same browser.
   */
  async confirmEmailChange(
    userId: string,
    dto: ConfirmEmailChangeDto,
    locale: MailLocale,
    refreshToken?: string,
  ): Promise<AuthResponse> {
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
    const reserved = await this.prisma.emailChangeCode.updateMany({
      where: {
        id: stored.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: EMAIL_CHANGE_MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (reserved.count !== 1)
      throw new BadRequestException("No pending email change");
    const presented = this.hashToken(`email-change:${userId}:${dto.code}`);
    const matches =
      presented.length === stored.codeHash.length &&
      (timingSafeEqual(Buffer.from(presented), Buffer.from(stored.codeHash)) ||
        this.hashToken(dto.code) === stored.codeHash);
    if (!matches) {
      // 6 digits over a 15-minute window stay safe because wrong guesses
      // burn the code after a handful of tries.
      await this.prisma.emailChangeCode.deleteMany({
        where: { id: stored.id, attempts: { gte: EMAIL_CHANGE_MAX_ATTEMPTS } },
      });
      throw new BadRequestException("Invalid verification code");
    }
    let updated: User;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        if (!refreshToken)
          throw new UnauthorizedException(
            "Sign in again before changing email",
          );
        const tokenHash = this.hashToken(refreshToken);
        const session = await tx.refreshToken.findFirst({
          where: {
            userId,
            tokenHash,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!session)
          throw new UnauthorizedException(
            "Sign in again before changing email",
          );
        const consumed = await tx.emailChangeCode.updateMany({
          where: {
            id: stored.id,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1)
          throw new BadRequestException("No pending email change");
        const next = await tx.user.update({
          where: { id: userId },
          data: { email: stored.newEmail, emailVerifiedAt: new Date() },
        });
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.emailVerificationCode.deleteMany({ where: { userId } });
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null, tokenHash: { not: tokenHash } },
          data: { revokedAt: new Date() },
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
    const notice = await this.emailTemplates.emailChangedNotice(
      updated.email,
      locale,
    );
    await this.mailQueue
      .enqueue({ to: user.email, ...notice })
      .catch(() => undefined);
    const authMethod = updated.passwordHash === null ? "oauth" : "password";
    const accessToken = await this.jwtService.signAsync(
      {
        sub: updated.id,
        authMethod,
        stamp: securityStamp(updated),
        ...(authMethod === "oauth" ? { authTime: 0 } : {}),
      },
      { audience: USER_JWT_AUDIENCE },
    );
    return { accessToken, user: { ...toAuthUser(updated), authMethod } };
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
  ): Promise<{ expiresAt: number; queued: boolean }> {
    if (!this.mailer.enabled) {
      throw new ServiceUnavailableException(
        "Email delivery must be configured before verification",
      );
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.emailVerifiedAt !== null) {
      throw new BadRequestException("Email is already verified");
    }
    const { expiresAt } = await this.issueEmailVerificationCode(user, locale);
    return { expiresAt: expiresAt.getTime(), queued: true };
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
    const reserved = await this.prisma.emailVerificationCode.updateMany({
      where: {
        id: stored.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: EMAIL_VERIFY_MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (reserved.count !== 1)
      throw new BadRequestException("No pending email verification");
    const presented = this.hashToken(`email-verify:${userId}:${dto.code}`);
    const matches =
      presented.length === stored.codeHash.length &&
      (timingSafeEqual(Buffer.from(presented), Buffer.from(stored.codeHash)) ||
        this.hashToken(dto.code) === stored.codeHash);
    if (!matches) {
      await this.prisma.emailVerificationCode.deleteMany({
        where: { id: stored.id, attempts: { gte: EMAIL_VERIFY_MAX_ATTEMPTS } },
      });
      throw new BadRequestException("Invalid verification code");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: userId } });
      if (
        !current ||
        current.email !== user.email ||
        current.emailVerifiedAt !== null
      )
        throw new BadRequestException("No pending email verification");
      const consumed = await tx.emailVerificationCode.updateMany({
        where: {
          id: stored.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new BadRequestException("No pending email verification");
      const next = await tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
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
        codeHash: this.hashToken(`email-verify:${user.id}:${code}`),
        expiresAt,
      },
    });
    const message = await this.emailTemplates.verificationEmail(
      code,
      EMAIL_VERIFY_TTL_MS / 60_000,
      locale,
    );
    // TASK-67: queued, not sent inline (best-effort from the caller's view).
    await this.mailQueue.enqueue({ to: user.email, ...message });
    return { code, expiresAt };
  }

  /**
   * Issues the session pair for an already-authenticated principal. Public
   * so the OAuth login (TASK-54) converges on the exact same machinery —
   * audience, refresh rotation and TTLs stay in one place.
   */
  async startSession(
    user: User,
    authMethod: "password" | "oauth" = "password",
    authenticatedAt?: number,
  ): Promise<AuthResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (
        !current ||
        current.disabledAt !== null ||
        securityStamp(current) !== securityStamp(user)
      ) {
        throw new UnauthorizedException("Credentials changed; sign in again");
      }
      return this.createSession(
        tx,
        current,
        authMethod,
        authMethod === "oauth" ? (authenticatedAt ?? Date.now()) : undefined,
        this.newRefreshFamilyId(),
      );
    });
  }

  private newRefreshFamilyId(): string {
    return randomBytes(16).toString("base64url");
  }

  private async createSession(
    tx: Prisma.TransactionClient,
    user: User,
    authMethod: "password" | "oauth",
    authTime: number | undefined,
    familyId: string,
  ): Promise<AuthResult> {
    // The audience separates the two auth contours (TASK-36): a user token
    // fails the admin strategy and an admin token fails this one, so a
    // leaked session can never be replayed against the other surface.
    // TASK-166: `authMethod` lets an OAuth-only account prove a fresh OAuth
    // login on `DELETE /users/me` (ADR §12.5); it is not an authorization
    // grant by itself.
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        authMethod,
        stamp: securityStamp(user),
        ...(authMethod === "oauth" ? { authTime: authTime ?? 0 } : {}),
      },
      { audience: USER_JWT_AUDIENCE },
    );
    const refreshToken = await this.issueRefreshToken(
      tx,
      user.id,
      authMethod,
      authTime,
      familyId,
    );
    return {
      accessToken,
      refreshToken,
      user: { ...toAuthUser(user), authMethod },
    };
  }

  private async issueRefreshToken(
    tx: Prisma.TransactionClient,
    userId: string,
    authMethod: "password" | "oauth",
    authTime: number | undefined,
    familyId: string,
  ): Promise<string> {
    // The opaque refresh token carries the origin as a non-secret prefix:
    // rotation would otherwise lose the OAuth marker (there is no column for
    // it in the frozen schema). The hash covers the whole string.
    const token =
      (authMethod === "oauth"
        ? `${OAUTH_REFRESH_PREFIX}${authTime ?? 0}_`
        : "") + randomBytes(48).toString("base64url");
    await tx.refreshToken.create({
      data: {
        tokenHash: this.hashToken(token),
        userId,
        familyId,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
      },
    });
    return token;
  }

  /**
   * Records where a freshly-minted session came from (TASK-65): the controller
   * hands over the source IP and User-Agent right after `startSession`, so the
   * sessions view can show them. Best-effort — a missing row is not an error.
   */
  async tagSession(
    refreshToken: string | undefined,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshToken
      .update({
        where: { tokenHash: this.hashToken(refreshToken) },
        data: {
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        },
      })
      .catch(() => undefined);
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
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
    await argonVerify(await DUMMY_PASSWORD_HASH, password);
  }
}
