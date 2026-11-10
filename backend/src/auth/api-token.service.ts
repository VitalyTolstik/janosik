import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ApiToken } from "@prisma/client";
import {
  API_TOKEN_MAX_TTL_DAYS,
  API_TOKEN_PREFIX,
  API_TOKEN_RATE_MAX,
  API_TOKEN_RATE_MIN,
  SCOPE_PRESETS,
  type ApiTokenIdentityDto,
  type CreateUserTokenRequest,
  type CreateUserTokenResponse,
  type ScopePreset,
  type UserTokenDto,
} from "@janosik/shared";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { forgetPat, rememberValidPat } from "@/common/throttle-tracker";
import { toAuthUser } from "./auth-user.mapper";
import type { AuthUser } from "./auth.types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lifetime of a token created without an `expiresAt` at all (B-2). An
 * explicit `null` still means "never expires" — that is the UI's documented
 * "No expiry" preset — but an API client that simply forgets the field gets
 * a bounded key instead of an immortal one.
 */
export const API_TOKEN_DEFAULT_TTL_DAYS = 90;

/**
 * `lastUsedAt` is bookkeeping for the token list ("used 3 minutes ago"); a
 * swarm of agents hitting the API many times a second must not turn every
 * request into a row write. Stamped at most once per this window.
 */
export const API_TOKEN_LAST_USED_RESOLUTION_MS = 60_000;

/**
 * The restrictions a PAT carries (TASK-157). `boardId: null` = every board
 * the owner can access; `readOnly` = writes refused; `rateLimitPerMinute`
 * `null` = no per-token budget beyond the global limit.
 */
export interface TokenScope {
  boardId: string | null;
  readOnly: boolean;
  rateLimitPerMinute: number | null;
}

/** A PAT resolved to its owner (B-2: the token id rides along). */
export interface AuthenticatedToken {
  user: AuthUser;
  tokenId: string;
  /** `ApiToken.name` snapshot for attribution (TASK-166). */
  tokenName: string;
  /** Non-secret identity of this token (`scopePreset`, pause stamps, …). */
  identity: ApiTokenIdentityDto;
  scope: TokenScope;
}

/**
 * Personal API tokens (TASK-36.1): `jnk_`-prefixed opaque strings the user
 * creates in the account panel. Only the sha256 hash is stored, the plaintext
 * is shown exactly once at creation. A PAT authenticates as its owner through
 * `JwtAuthGuard`'s fallback; admin routes never accept one.
 */
@Injectable()
export class ApiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Only the sha256 hash is persisted; also reused by the password change. */
  hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  /** Fresh plaintext: `jnk_` + 32 random bytes base64url (43 chars). */
  generate(): string {
    return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  }

  /** Resolve a raw PAT to its owner; unknown/stale tokens answer 401. */
  async authenticate(raw: string): Promise<AuthenticatedToken> {
    const tokenHash = this.hashToken(raw);
    const stored = await this.prisma.apiToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !stored ||
      stored.revokedAt !== null ||
      stored.user.disabledAt !== null
    ) {
      forgetPat(tokenHash);
      throw new UnauthorizedException("Invalid API token");
    }
    if (stored.expiresAt !== null && stored.expiresAt.getTime() <= Date.now()) {
      forgetPat(tokenHash);
      throw new UnauthorizedException("API token expired");
    }
    // B-8: a proven key gets its own throttler bucket from now on.
    rememberValidPat(tokenHash);
    const now = Date.now();
    if (
      stored.lastUsedAt === null ||
      now - stored.lastUsedAt.getTime() >= API_TOKEN_LAST_USED_RESOLUTION_MS
    ) {
      await this.prisma.apiToken.update({
        where: { id: stored.id },
        data: { lastUsedAt: new Date(now) },
      });
    }
    return {
      user: toAuthUser(stored.user),
      tokenId: stored.id,
      tokenName: stored.name,
      identity: toTokenIdentity(stored),
      scope: {
        boardId: stored.boardId,
        readOnly: stored.readOnly,
        rateLimitPerMinute: stored.rateLimitPerMinute,
      },
    };
  }

  /**
   * Is the token still usable right now (B-6)? Long-lived SSE streams opened
   * with a PAT re-check this on their keep-alive tick, so revoking or
   * expiring a key ends the agent's open streams too, not only new requests.
   */
  async isActive(tokenId: string): Promise<boolean> {
    const token = await this.prisma.apiToken.findUnique({
      where: { id: tokenId },
      select: {
        revokedAt: true,
        expiresAt: true,
        user: { select: { disabledAt: true } },
      },
    });
    return (
      token !== null &&
      token.revokedAt === null &&
      token.user.disabledAt === null &&
      (token.expiresAt === null || token.expiresAt.getTime() > Date.now())
    );
  }

  /**
   * Revoke every live token of the user (B-1/B-2): a password change and an
   * OAuth takeover-cleanup must not leave agent keys minted by whoever held
   * the old credential.
   */
  async revokeAll(userId: string): Promise<number> {
    const result = await this.prisma.apiToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Every token of the user — active and revoked — newest first. */
  async list(userId: string): Promise<UserTokenDto[]> {
    const tokens = await this.prisma.apiToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return tokens.map(toUserTokenDto);
  }

  async create(
    userId: string,
    dto: CreateUserTokenRequest,
    options: {
      /**
       * Only the session-only token route sets this. `trustedCi` is a human
       * control: a PAT must never mint a trusted-CI sibling, even if a future
       * caller forgets to put the route behind `SessionOnlyGuard`.
       */
      allowTrustedCi?: boolean;
    } = {},
  ): Promise<CreateUserTokenResponse> {
    if (dto.trustedCi === true && options.allowTrustedCi !== true) {
      throw new ForbiddenException({
        message: "trustedCi can only be enabled from a browser session",
        code: "pat_forbidden",
      });
    }
    const token = this.generate();
    const scope = await this.resolveScope(userId, dto);
    const created = await this.prisma.apiToken.create({
      data: {
        userId,
        name: dto.name,
        tokenHash: this.hashToken(token),
        expiresAt: this.resolveExpiresAt(dto.expiresAt),
        // TASK-166: immutable after creation (D11). There is deliberately no
        // scope-editing endpoint; a different scope means a new token.
        scopePreset: dto.scopePreset ?? "worker",
        trustedCi: dto.trustedCi === true,
        ...scope,
      },
    });
    // The plaintext leaves the server exactly here, exactly once.
    return { token, apiToken: toUserTokenDto(created) };
  }

  /**
   * Validate the requested scope (TASK-157): a board scope must name a board
   * the owner is an active member of (otherwise the token would be useless),
   * and a rate limit must be a positive integer within bounds.
   */
  private async resolveScope(
    userId: string,
    dto: CreateUserTokenRequest,
  ): Promise<{
    boardId: string | null;
    readOnly: boolean;
    rateLimitPerMinute: number | null;
  }> {
    let boardId: string | null = null;
    if (dto.boardId !== undefined && dto.boardId !== null) {
      boardId = dto.boardId.trim();
      if (boardId === "") {
        throw new BadRequestException("boardId must not be blank");
      }
      const membership = await this.prisma.boardMember.findUnique({
        where: { boardId_userId: { boardId, userId } },
        select: { acceptedAt: true, expiresAt: true },
      });
      if (
        !membership ||
        membership.acceptedAt === null ||
        (membership.expiresAt !== null &&
          membership.expiresAt.getTime() <= Date.now())
      ) {
        throw new BadRequestException(
          "boardId must be a board you are a member of",
        );
      }
    }

    let rateLimitPerMinute: number | null = null;
    if (
      dto.rateLimitPerMinute !== undefined &&
      dto.rateLimitPerMinute !== null
    ) {
      const rate = dto.rateLimitPerMinute;
      if (
        !Number.isInteger(rate) ||
        rate < API_TOKEN_RATE_MIN ||
        rate > API_TOKEN_RATE_MAX
      ) {
        throw new BadRequestException(
          `rateLimitPerMinute must be an integer ${API_TOKEN_RATE_MIN}…${API_TOKEN_RATE_MAX}`,
        );
      }
      rateLimitPerMinute = rate;
    }

    return { boardId, readOnly: dto.readOnly === true, rateLimitPerMinute };
  }

  /** Idempotent: revoking an already-revoked token keeps the first stamp. */
  async revoke(userId: string, tokenId: string): Promise<void> {
    const token = await this.prisma.apiToken.findFirst({
      where: { id: tokenId, userId },
    });
    if (!token) {
      throw new NotFoundException("API token not found");
    }
    await this.prisma.apiToken.updateMany({
      where: { id: tokenId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * `null` = never expires (explicit opt-in, the UI's "No expiry" preset);
   * omitted = `API_TOKEN_DEFAULT_TTL_DAYS`; otherwise in the future and
   * bounded.
   */
  private resolveExpiresAt(requested: string | null | undefined): Date | null {
    if (requested === undefined) {
      return new Date(Date.now() + API_TOKEN_DEFAULT_TTL_DAYS * DAY_MS);
    }
    if (requested === null) {
      return null;
    }
    const parsed = new Date(requested);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw new BadRequestException("expiresAt must be in the future");
    }
    const max = Date.now() + API_TOKEN_MAX_TTL_DAYS * DAY_MS;
    if (parsed.getTime() > max) {
      throw new BadRequestException(
        `expiresAt must be within ${API_TOKEN_MAX_TTL_DAYS} days`,
      );
    }
    return parsed;
  }
}

function toUserTokenDto(token: ApiToken): UserTokenDto {
  const scopePreset = readScopePreset(token.scopePreset);
  const individualPausedAt = token.individualPausedAt?.getTime() ?? null;
  const stopAllPausedAt = token.stopAllPausedAt?.getTime() ?? null;
  return {
    id: token.id,
    name: token.name,
    createdAt: token.createdAt.getTime(),
    lastUsedAt: token.lastUsedAt?.getTime() ?? null,
    expiresAt: token.expiresAt?.getTime() ?? null,
    revokedAt: token.revokedAt?.getTime() ?? null,
    boardId: token.boardId,
    readOnly: token.readOnly,
    rateLimitPerMinute: token.rateLimitPerMinute,
    scopePreset,
    trustedCi: token.trustedCi,
    individualPausedAt,
    individualPausedBy: token.individualPausedBy,
    individualPausedReason: token.individualPausedReason,
    stopAllPausedAt,
    stopAllPausedBy: token.stopAllPausedBy,
    paused: individualPausedAt !== null || stopAllPausedAt !== null,
    effectiveTokenScope: token.readOnly ? "observer" : scopePreset,
  };
}

/** The non-secret token projection used by `/auth/me` (TASK-166). */
export function toTokenIdentity(token: ApiToken): ApiTokenIdentityDto {
  const scopePreset = readScopePreset(token.scopePreset);
  const individualPausedAt = token.individualPausedAt?.getTime() ?? null;
  const stopAllPausedAt = token.stopAllPausedAt?.getTime() ?? null;
  return {
    id: token.id,
    name: token.name,
    scopePreset,
    trustedCi: token.trustedCi,
    effectiveTokenScope: token.readOnly ? "observer" : scopePreset,
    boardId: token.boardId,
    readOnly: token.readOnly,
    rateLimitPerMinute: token.rateLimitPerMinute,
    individualPausedAt,
    stopAllPausedAt,
    paused: individualPausedAt !== null || stopAllPausedAt !== null,
  };
}

/** Unknown stored values (a future preset) degrade to the safe `worker`. */
function readScopePreset(value: string): ScopePreset {
  return (SCOPE_PRESETS as readonly string[]).includes(value)
    ? (value as ScopePreset)
    : "worker";
}
