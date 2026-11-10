import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { verify as argonVerify } from "argon2";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type {
  AdminExportRowDto,
  DeleteAccountRequest,
  DeleteAccountResponse,
  UserDataExportDto,
} from "@janosik/shared";
import { env } from "@/config/env";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecurityAuditService } from "@/common/security-audit/security-audit.service";
import { ExportsService } from "@/admin/exports.service";
import { MailQueueService } from "@/mailer/mail-queue.service";
import { accountDeletionCodeEmail } from "@/mailer/templates";
import type { MailLocale } from "@/mailer/mail.types";
import { USER_JWT_AUDIENCE } from "@/auth/auth.types";
import { AccountDeletionService } from "./account-deletion.service";

/** ADR §12.5: the deletion email code lives 10 minutes, one-time. */
const DELETE_CODE_TTL_MS = 10 * 60 * 1000;
const DELETE_CODE_MAX_ATTEMPTS = 5;
/** The OAuth proof must be a fresh OAuth-issued access token. */
const OAUTH_PROOF_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * TASK-166 self-service data rights (ADR §12.5), browser-JWT only:
 * export, deletion code and scheduled account deletion. Kept separate from
 * `UsersService` so profile/avatar code does not grow credential-proofing.
 */
@Injectable()
export class AccountDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exports: ExportsService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly securityAudit: SecurityAuditService,
    private readonly jwt: JwtService,
    private readonly mailQueue: MailQueueService,
  ) {}

  async requestExport(
    userId: string,
    email: string,
  ): Promise<UserDataExportDto> {
    const row = await this.exports.request(userId, email);
    await this.securityAudit.record({
      userId,
      actorId: userId,
      action: "account.exported",
      targetType: "user",
      targetId: userId,
      details: { format: "json" },
    });
    return toExportDto(row);
  }

  async exportStatus(
    userId: string,
    exportId: string,
  ): Promise<UserDataExportDto> {
    const row = await this.ownExport(userId, exportId);
    return toExportDto(row);
  }

  /** Absolute path + filename of a ready export belonging to `userId`. */
  async exportDownload(
    userId: string,
    exportId: string,
  ): Promise<{ absPath: string; filename: string }> {
    await this.ownExport(userId, exportId);
    return this.exports.download(exportId);
  }

  /**
   * ADR §12.5: only an OAuth-only account needs an email code. The proof is
   * an access token issued by OAuth login, at most ten minutes old.
   */
  async requestDeletionCode(
    userId: string,
    oauthProof: string | undefined,
    locale: MailLocale,
  ): Promise<{ expiresAt: number; queued: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.passwordHash !== null) {
      throw new BadRequestException(
        "This account has a password; confirm deletion with the password instead",
      );
    }
    if (user.emailVerifiedAt === null) {
      throw new ForbiddenException(
        "Confirm your email address before deleting the account",
      );
    }
    await this.verifyOauthProof(oauthProof, userId);

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + DELETE_CODE_TTL_MS);
    // The frozen schema has no dedicated account-deletion table. The
    // verification-code table already provides the exact discipline we need
    // (one live hashed code per user, attempts, TTL, single use), and the
    // account must be verified before this path is reachable.
    await this.prisma.emailVerificationCode.deleteMany({ where: { userId } });
    await this.prisma.emailVerificationCode.create({
      data: {
        userId,
        codeHash: this.codeHash(userId, code),
        expiresAt,
      },
    });
    const message = accountDeletionCodeEmail(
      code,
      DELETE_CODE_TTL_MS / 60_000,
      locale,
    );
    await this.mailQueue.enqueue({ to: user.email, ...message });
    return { expiresAt: expiresAt.getTime(), queued: true };
  }

  /**
   * Schedule the erasure: disable immediately, revoke every session/token,
   * cancel agent sessions and hand the seven-day hard delete to maintenance.
   */
  async deleteAccount(
    userId: string,
    dto: DeleteAccountRequest,
  ): Promise<DeleteAccountResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (
      dto.confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()
    ) {
      throw new BadRequestException({
        message: "Type the account email to confirm",
        field: "confirmEmail",
      });
    }

    if (user.passwordHash !== null) {
      if (!dto.password) {
        throw new BadRequestException({
          message: "Current password is required",
          field: "password",
        });
      }
      const valid = await argonVerify(user.passwordHash, dto.password);
      if (!valid) {
        throw new UnauthorizedException("Current password is incorrect");
      }
    } else {
      await this.verifyOauthProof(dto.oauthProof, userId);
      await this.consumeDeletionCode(userId, dto.emailCode);
    }

    const { deleteAfter } = await this.accountDeletion.schedule(
      userId,
      userId,
      { actorType: "human" },
    );
    return { status: "scheduled", deleteAfter: deleteAfter.getTime() };
  }

  /**
   * Checks signature, audience, `sub`, the OAuth claim and a ten-minute
   * freshness window. A password JWT or a PAT can never substitute for it.
   */
  private async verifyOauthProof(
    proof: string | undefined,
    userId: string,
  ): Promise<void> {
    if (!proof) {
      throw new UnauthorizedException({
        message: "OAuth re-authentication is required",
        code: "oauth_proof_required",
      });
    }
    let payload: {
      sub?: unknown;
      authMethod?: unknown;
      iat?: unknown;
    };
    try {
      payload = await this.jwt.verifyAsync(proof, {
        secret: env.JWT_SECRET,
        audience: USER_JWT_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException({
        message: "OAuth proof is invalid or expired",
        code: "oauth_proof_invalid",
      });
    }
    const issuedAt =
      typeof payload.iat === "number" ? payload.iat * 1000 : Number.NaN;
    if (
      payload.sub !== userId ||
      payload.authMethod !== "oauth" ||
      !Number.isFinite(issuedAt) ||
      Date.now() - issuedAt > OAUTH_PROOF_MAX_AGE_MS
    ) {
      throw new UnauthorizedException({
        message: "OAuth proof is invalid or expired",
        code: "oauth_proof_invalid",
      });
    }
  }

  private async consumeDeletionCode(
    userId: string,
    code: string | undefined,
  ): Promise<void> {
    if (!code) {
      throw new BadRequestException({
        message: "Email confirmation code is required",
        field: "emailCode",
      });
    }
    const stored = await this.prisma.emailVerificationCode.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!stored || stored.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("No pending account-deletion code");
    }
    const presented = this.codeHash(userId, code);
    const matches =
      presented.length === stored.codeHash.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(stored.codeHash));
    if (!matches) {
      const attempts = stored.attempts + 1;
      if (attempts >= DELETE_CODE_MAX_ATTEMPTS) {
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
    await this.prisma.emailVerificationCode.update({
      where: { id: stored.id },
      data: { consumedAt: new Date() },
    });
  }

  private async ownExport(
    userId: string,
    exportId: string,
  ): Promise<AdminExportRowDto> {
    const row = await this.exports.row(exportId);
    if (row.userId !== userId) {
      // Do not reveal another account's export id.
      throw new NotFoundException("Export not found");
    }
    return row;
  }

  private codeHash(userId: string, value: string): string {
    // Purpose + owner namespacing prevents a 6-digit collision with the
    // registration verification code (same table, globally unique hash).
    return createHash("sha256")
      .update(`account-delete:${userId}:${value}`)
      .digest("hex");
  }
}

function toExportDto(row: AdminExportRowDto): UserDataExportDto {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    sizeBytes: row.sizeBytes,
    error: row.error,
  };
}
