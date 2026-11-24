import {
  BadRequestException,
  ConflictException,
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
  type AgentStopAllPauseDto,
  type ApiTokenIdentityDto,
  type CreateUserTokenRequest,
  type CreateUserTokenResponse,
  type ScopePreset,
  type UpdateUserTokenRequest,
  type UserTokenDto,
} from "@janosik/shared";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { HotPathCacheService } from "@/common/hot-path-cache.service";
import { SecurityAuditService } from "@/common/security-audit/security-audit.service";
import { AttentionService } from "@/notifications/attention.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { forgetPat, rememberValidPat } from "@/common/throttle-tracker";
import { AUTH_USER_SELECT, toAuthUser } from "./auth-user.mapper";
import type { AuthUser } from "./auth.types";
import { securityStamp } from "./security-stamp";
import { revokeApiTokens, releaseRevokedTokenClaims } from "./token-revocation";

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
 * Do not cache a token that expires sooner than this plus the cache window:
 * otherwise a valid cache entry could outlive the credential it represents
 * (revocation is invalidated explicitly; expiry is not an event).
 */
const TOKEN_EXPIRY_CACHE_MARGIN_MS = 5_000;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityAudit: SecurityAuditService,
    private readonly attention: AttentionService,
    private readonly realtime: RealtimeService,
    private readonly hotPathCache: HotPathCacheService,
  ) {}

  /** Only the sha256 hash is persisted; also reused by the password change. */
  hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  /** Fresh plaintext: `jnk_` + 32 random bytes base64url (43 chars). */
  generate(): string {
    return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  }

  /**
   * Resolve a raw PAT to its owner; unknown/stale tokens answer 401.
   *
   * TASK-200.5: a successful lookup is cached by hash for `AUTH_CACHE_TTL_MS`.
   * `fresh` bypasses the cache on writes and SSE connects, where a pause or a
   * scope change must be visible immediately; regular reads tolerate the
   * bounded window. Revoke/resume/pause invalidates the entry through the
   * realtime bus, so the window is only a backstop, not the consistency
   * mechanism.
   */
  async authenticate(
    raw: string,
    options: { fresh?: boolean } = {},
  ): Promise<AuthenticatedToken> {
    const tokenHash = this.hashToken(raw);
    if (options.fresh) return this.loadAuthenticated(tokenHash);
    const cached = this.hotPathCache.getPat(tokenHash);
    if (cached !== undefined) return cached;
    const epoch = this.hotPathCache.epochs.pat;
    // 500 agents presenting the same cold key issue one lookup, not 500.
    // An invalidation during the load changes the epoch, so the loader does
    // not write the older answer back into the cache.
    return this.hotPathCache.singleFlight(
      `pat:${tokenHash}`,
      epoch,
      async () => {
        const again = this.hotPathCache.getPat(tokenHash);
        if (again !== undefined) return again;
        return this.loadAuthenticated(tokenHash, epoch);
      },
    );
  }

  /**
   * The database half of `authenticate`. `cacheEpoch` is set only for a
   * cacheable read: the result is remembered when no invalidation happened
   * while the query was in flight.
   */
  private async loadAuthenticated(
    tokenHash: string,
    cacheEpoch?: number,
  ): Promise<AuthenticatedToken> {
    const stored = await this.prisma.apiToken.findUnique({
      where: { tokenHash },
      include: { user: { select: AUTH_USER_SELECT } },
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
    const resolved: AuthenticatedToken = {
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
    // A token that expires inside this entry's lifetime is not cached: there
    // is no expiry event on the bus, and a cached credential must never
    // outlive its `expiresAt`.
    if (
      cacheEpoch !== undefined &&
      this.hotPathCache.epochs.pat === cacheEpoch &&
      this.hotPathCache.patTtlMs > 0 &&
      (stored.expiresAt === null ||
        stored.expiresAt.getTime() >
          now + this.hotPathCache.patTtlMs + TOKEN_EXPIRY_CACHE_MARGIN_MS)
    ) {
      this.hotPathCache.rememberPat(tokenHash, resolved);
    }
    return resolved;
  }

  /**
   * Is the token still usable right now (B-6/M6)? Long-lived SSE streams
   * opened with a PAT re-check this on their keep-alive tick, so revoking,
   * expiring or re-scoping a key ends the agent's open streams too, not only
   * new requests. `boardId` is the stream's board: a token narrowed to a
   * different board must stop reading this one.
   */
  async isActive(tokenId: string, boardId?: string): Promise<boolean> {
    const token = await this.prisma.apiToken.findUnique({
      where: { id: tokenId },
      select: {
        revokedAt: true,
        expiresAt: true,
        boardId: true,
        user: { select: { disabledAt: true } },
      },
    });
    return (
      token !== null &&
      token.revokedAt === null &&
      token.user.disabledAt === null &&
      (token.expiresAt === null || token.expiresAt.getTime() > Date.now()) &&
      (boardId === undefined ||
        token.boardId === null ||
        token.boardId === boardId)
    );
  }

  /**
   * Revoke every live token of the user (B-1/B-2): a password change and an
   * OAuth takeover-cleanup must not leave agent keys minted by whoever held
   * the old credential.
   */
  async revokeAll(userId: string): Promise<number> {
    const candidates = await this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, name: true },
    });
    const result = await this.prisma.$transaction((tx) =>
      revokeApiTokens(tx, { userId, revokedAt: null }),
    );
    // Invalidate even when the transaction found no live rows: another
    // replica may still hold a positive entry from before its own frame.
    this.hotPathCache.invalidatePat();
    if (result.revokedCount > 0) {
      for (const token of candidates) {
        await this.attention.notifyTokenRevoked({
          userId,
          tokenId: token.id,
          tokenName: token.name,
          reason: "revoke_all",
        });
      }
      await this.publishTokenState(
        candidates.map((token) => token.id),
        "ended",
      );
    }
    return result.revokedCount;
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
      /** `securityStamp` of the caller's verified access token. */
      stamp?: string;
    } = {},
  ): Promise<CreateUserTokenResponse> {
    if (dto.trustedCi === true && options.allowTrustedCi !== true) {
      throw new ForbiddenException({
        message: "trustedCi can only be enabled from a browser session",
        code: "pat_forbidden",
      });
    }
    // L25: create enforces the same combination PATCH does. A trusted-CI bit
    // on an Observer or read-only token would never be usable (and could
    // surface later when the scope is widened), so refuse it up front.
    if (
      dto.trustedCi === true &&
      (dto.readOnly === true ||
        readScopePreset(dto.scopePreset ?? "worker") === "observer")
    ) {
      throw new BadRequestException({
        message:
          "trustedCi cannot be enabled for an Observer or read-only token",
        field: "trustedCi",
      });
    }
    if (!options.stamp) {
      throw new UnauthorizedException("Credentials changed; sign in again");
    }
    const token = this.generate();
    const scope = await this.resolveScope(userId, dto);
    const created = await this.prisma.$transaction(async (tx) => {
      // A request that passed the guard before a password reset or OAuth
      // claim must not mint a long-lived key after the credentials changed.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: userId } });
      if (
        !current ||
        current.disabledAt !== null ||
        securityStamp(current) !== options.stamp
      ) {
        throw new UnauthorizedException("Credentials changed; sign in again");
      }
      return tx.apiToken.create({
        data: {
          userId,
          name: dto.name,
          tokenHash: this.hashToken(token),
          expiresAt: this.resolveExpiresAt(dto.expiresAt),
          scopePreset: dto.scopePreset ?? "worker",
          trustedCi: dto.trustedCi === true,
          ...scope,
        },
      });
    });
    // The plaintext leaves the server exactly here, exactly once.
    await this.securityAudit.record({
      userId,
      actorId: userId,
      action: "token.created",
      targetType: "api_token",
      targetId: created.id,
      details: {
        name: created.name,
        scopePreset: created.scopePreset,
        trustedCi: created.trustedCi,
        boardId: created.boardId,
        readOnly: created.readOnly,
      },
    });
    return { token, apiToken: toUserTokenDto(created) };
  }

  /**
   * `PATCH /users/me/tokens/:id` (TASK-166.15). The owner may adjust the
   * human-facing limits and scope from a browser session; omitted fields keep
   * their value. Every edit is audited with before/after values (never a
   * secret), and the effective `trustedCi` is rejected when it could never be
   * used (Observer / read-only), so the UI cannot persist a misleading flag.
   */
  async update(
    userId: string,
    tokenId: string,
    dto: UpdateUserTokenRequest,
  ): Promise<UserTokenDto> {
    let name: string | undefined;
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (trimmed === "") {
        throw new BadRequestException({
          message: "name must not be blank",
          field: "name",
        });
      }
      name = trimmed;
    }

    const boardId =
      dto.boardId === undefined
        ? undefined
        : await this.resolveBoardScope(userId, dto.boardId);
    const rateLimitPerMinute =
      dto.rateLimitPerMinute === undefined
        ? undefined
        : this.resolveRateLimit(dto.rateLimitPerMinute);

    const { token, updated } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ApiToken" WHERE id = ${tokenId} AND "userId" = ${userId} FOR UPDATE`;
      const token = await tx.apiToken.findFirst({
        where: { id: tokenId, userId },
      });
      if (!token) throw new NotFoundException("API token not found");
      if (token.revokedAt !== null) {
        throw new ConflictException({
          message: "Revoked tokens cannot be edited",
          code: "token_revoked",
        });
      }
      const readOnly = dto.readOnly ?? token.readOnly;
      const scopePreset =
        dto.scopePreset !== undefined
          ? readScopePreset(dto.scopePreset)
          : readScopePreset(token.scopePreset);
      const trustedCi = dto.trustedCi ?? token.trustedCi;
      if (trustedCi && (readOnly || scopePreset === "observer")) {
        throw new BadRequestException({
          message:
            "trustedCi cannot be enabled for an Observer or read-only token",
          field: "trustedCi",
        });
      }
      const updated = await tx.apiToken.update({
        where: { id: tokenId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(boardId !== undefined ? { boardId } : {}),
          ...(dto.readOnly !== undefined ? { readOnly } : {}),
          ...(dto.scopePreset !== undefined ? { scopePreset } : {}),
          ...(dto.trustedCi !== undefined ? { trustedCi } : {}),
          ...(rateLimitPerMinute !== undefined ? { rateLimitPerMinute } : {}),
        },
      });
      return { token, updated };
    });
    // Scope/preset/board/rate-limit edits change what the key may do; drop
    // the cached resolution before the next agent request can use it.
    this.hotPathCache.invalidatePat(tokenId);
    await this.securityAudit.record({
      userId,
      actorId: userId,
      action: "token.updated",
      targetType: "api_token",
      targetId: tokenId,
      details: {
        before: {
          name: token.name,
          boardId: token.boardId,
          readOnly: token.readOnly,
          scopePreset: readScopePreset(token.scopePreset),
          trustedCi: token.trustedCi,
          rateLimitPerMinute: token.rateLimitPerMinute,
        },
        after: {
          name: updated.name,
          boardId: updated.boardId,
          readOnly: updated.readOnly,
          scopePreset: readScopePreset(updated.scopePreset),
          trustedCi: updated.trustedCi,
          rateLimitPerMinute: updated.rateLimitPerMinute,
        },
      },
    });
    return toUserTokenDto(updated);
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
    return {
      boardId: await this.resolveBoardScope(userId, dto.boardId ?? null),
      readOnly: dto.readOnly === true,
      rateLimitPerMinute: this.resolveRateLimit(dto.rateLimitPerMinute ?? null),
    };
  }

  private async resolveBoardScope(
    userId: string,
    requested: string | null,
  ): Promise<string | null> {
    if (requested === null) return null;
    const boardId = requested.trim();
    if (boardId === "") {
      throw new BadRequestException({
        message: "boardId must not be blank",
        field: "boardId",
      });
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
      throw new BadRequestException({
        message: "boardId must be a board you are a member of",
        field: "boardId",
      });
    }
    return boardId;
  }

  private resolveRateLimit(requested: number | null): number | null {
    if (requested === null) return null;
    if (
      !Number.isInteger(requested) ||
      requested < API_TOKEN_RATE_MIN ||
      requested > API_TOKEN_RATE_MAX
    ) {
      throw new BadRequestException({
        message: `rateLimitPerMinute must be an integer ${API_TOKEN_RATE_MIN}…${API_TOKEN_RATE_MAX}`,
        field: "rateLimitPerMinute",
      });
    }
    return requested;
  }

  /** Idempotent: revoking an already-revoked token keeps the first stamp. */
  async revoke(userId: string, tokenId: string): Promise<void> {
    const token = await this.prisma.apiToken.findFirst({
      where: { id: tokenId, userId },
    });
    if (!token) {
      throw new NotFoundException("API token not found");
    }
    // TASK-166.3 kill semantics: revoke is the irreversible stop. Commit
    // `revokedAt`, session/approval cancellation in one lock-free
    // transaction first; only then run the separate claim-cleanup pass. A
    // board writer holding the board lock therefore cannot delay the kill,
    // and a queued PAT command sees the revocation on release. Open PAT SSE
    // closes on its next keep-alive because `isActive` sees the revocation;
    // there is no separate kill endpoint.
    const result = await this.prisma.$transaction((tx) =>
      revokeApiTokens(tx, { id: tokenId, userId }, undefined, {
        killOnly: true,
      }),
    );
    // Invalidate even when the row was already revoked: another replica may
    // still hold a positive entry from before its own invalidation.
    this.hotPathCache.invalidatePat(tokenId);
    // Claims are released after the kill committed. The first query returns
    // without board locks when the token holds none, so DELETE never waits
    // on a board lock it does not need.
    await this.prisma.$transaction((tx) =>
      releaseRevokedTokenClaims(tx, result.tokenIds),
    );
    if (result.revokedCount > 0) {
      await this.securityAudit.record({
        userId,
        actorId: userId,
        action: "token.revoked",
        targetType: "api_token",
        targetId: tokenId,
        details: {
          name: token.name,
          scopePreset: token.scopePreset,
          trustedCi: token.trustedCi,
        },
      });
      // TASK-166.9: the human owner hears about the kill, the revoked key
      // never does. The in-app/e-mail fan-out is best-effort and post-commit.
      await this.attention.notifyTokenRevoked({
        userId,
        tokenId,
        tokenName: token.name,
        reason: "revoked",
      });
      await this.publishTokenState([tokenId], "ended");
    }
  }

  /**
   * `POST /users/me/tokens/:id/pause` — the token's own pause source.
   * `resume-all` deliberately does not clear it (ADR §9.1).
   */
  async pause(
    userId: string,
    tokenId: string,
    reason: string | undefined,
  ): Promise<UserTokenDto> {
    const token = await this.requireOwnedToken(userId, tokenId);
    // A revoked token is already terminal; pausing it is an idempotent no-op
    // rather than a misleading success that rewrites an inert row.
    if (token.revokedAt !== null) return toUserTokenDto(token);
    const pausedAt = new Date();
    const result = await this.prisma.apiToken.updateMany({
      where: { id: tokenId, userId, individualPausedAt: null },
      data: {
        individualPausedAt: pausedAt,
        individualPausedBy: userId,
        individualPausedReason: clean(reason),
      },
    });
    // Pause/resume invalidates even on an idempotent no-op: a replica may
    // still hold an older identity from before the first transition.
    this.hotPathCache.invalidatePat(tokenId);
    if (result.count > 0) {
      await this.securityAudit.record({
        userId,
        actorId: userId,
        action: "token.paused",
        targetType: "api_token",
        targetId: tokenId,
        details: {
          name: token.name,
          scopePreset: token.scopePreset,
          trustedCi: token.trustedCi,
          reason: clean(reason),
        },
      });
      await this.publishTokenState([tokenId], "paused", pausedAt.getTime());
    }
    return toUserTokenDto(
      await this.prisma.apiToken.findUniqueOrThrow({ where: { id: tokenId } }),
    );
  }

  /** `POST /users/me/tokens/:id/resume` — clears only the individual pause. */
  async resume(
    userId: string,
    tokenId: string,
    reason: string | undefined,
  ): Promise<UserTokenDto> {
    const token = await this.requireOwnedToken(userId, tokenId);
    // Revoked is terminal: resume cannot make the key usable again.
    if (token.revokedAt !== null) return toUserTokenDto(token);
    const result = await this.prisma.apiToken.updateMany({
      where: { id: tokenId, userId, individualPausedAt: { not: null } },
      data: {
        individualPausedAt: null,
        individualPausedBy: null,
        individualPausedReason: null,
      },
    });
    this.hotPathCache.invalidatePat(tokenId);
    if (result.count > 0) {
      await this.securityAudit.record({
        userId,
        actorId: userId,
        action: "token.resumed",
        targetType: "api_token",
        targetId: tokenId,
        details: {
          name: token.name,
          scopePreset: token.scopePreset,
          trustedCi: token.trustedCi,
          reason: clean(reason),
        },
      });
      await this.publishTokenState([tokenId], "resumed");
    }
    return toUserTokenDto(
      await this.prisma.apiToken.findUniqueOrThrow({ where: { id: tokenId } }),
    );
  }

  /**
   * `POST /agents/pause-all` — the bulk `stopAllPausedAt` stamp. It never
   * touches `individualPausedAt`, so a token paused on its own stays paused
   * after `resume-all`.
   */
  async pauseAll(
    userId: string,
    reason: string | undefined,
  ): Promise<AgentStopAllPauseDto> {
    const now = new Date();
    const result = await this.prisma.apiToken.updateMany({
      where: { userId, revokedAt: null, stopAllPausedAt: null },
      data: { stopAllPausedAt: now, stopAllPausedBy: userId },
    });
    const latest = await this.prisma.apiToken.findFirst({
      where: { userId, revokedAt: null, stopAllPausedAt: { not: null } },
      orderBy: { stopAllPausedAt: "desc" },
      select: { stopAllPausedAt: true, stopAllPausedBy: true },
    });
    // The bulk switch may be an idempotent no-op on this node while another
    // replica still serves a cached token identity.
    this.hotPathCache.invalidatePat();
    if (result.count > 0) {
      await this.securityAudit.record({
        userId,
        actorId: userId,
        action: "agents.paused_all",
        targetType: "api_token",
        details: { reason: clean(reason), tokens: result.count },
      });
      await this.publishAllUserTokenState(userId, "paused", now.getTime());
    }
    return {
      paused: latest !== null,
      pausedAt: latest?.stopAllPausedAt?.getTime() ?? null,
      pausedBy: latest?.stopAllPausedBy ?? null,
      affected: result.count,
    };
  }

  /** `POST /agents/resume-all` — clears only the bulk stamp. */
  async resumeAll(
    userId: string,
    reason: string | undefined,
  ): Promise<AgentStopAllPauseDto> {
    const result = await this.prisma.apiToken.updateMany({
      where: { userId, revokedAt: null, stopAllPausedAt: { not: null } },
      data: { stopAllPausedAt: null, stopAllPausedBy: null },
    });
    this.hotPathCache.invalidatePat();
    if (result.count > 0) {
      await this.securityAudit.record({
        userId,
        actorId: userId,
        action: "agents.resumed_all",
        targetType: "api_token",
        details: { reason: clean(reason), tokens: result.count },
      });
      await this.publishAllUserTokenState(userId, "resumed");
    }
    return {
      paused: false,
      pausedAt: null,
      pausedBy: null,
      affected: result.count,
    };
  }

  /**
   * Board Live is viewed by a human JWT, not by the paused token, so the
   * token's own keep-alive frame cannot refresh it. Publish one control-plane
   * frame per board where the token has a live session; the UI refetches the
   * session row and mirrors the server-computed `paused`/`pauseScope`.
   */
  private async publishTokenState(
    tokenIds: string[],
    op: "paused" | "resumed" | "ended",
    at: number = Date.now(),
  ): Promise<void> {
    const ids = [...new Set(tokenIds)];
    if (ids.length === 0) return;
    const sessions = await this.prisma.agentSession.findMany({
      where: {
        apiTokenId: { in: ids },
        // A revoke ends the sessions before this publish. The boards that
        // were live at revoke time still need the frame, so include sessions
        // that just ended; pause/resume only concerns live rows.
        ...(op === "ended"
          ? {
              OR: [
                { endedAt: null },
                { endedAt: { gte: new Date(Date.now() - 60_000) } },
              ],
            }
          : { endedAt: null }),
      },
      distinct: ["boardId"],
      select: { boardId: true },
    });
    for (const session of sessions) {
      this.realtime.publish(session.boardId, {
        type: "agent",
        op,
        scope: "token",
        at,
      });
    }
  }

  private async publishAllUserTokenState(
    userId: string,
    op: "paused" | "resumed",
    at: number = Date.now(),
  ): Promise<void> {
    const tokens = await this.prisma.apiToken.findMany({
      where: { userId },
      select: { id: true },
    });
    await this.publishTokenState(
      tokens.map((token) => token.id),
      op,
      at,
    );
  }

  private async requireOwnedToken(
    userId: string,
    tokenId: string,
  ): Promise<ApiToken> {
    const token = await this.prisma.apiToken.findFirst({
      where: { id: tokenId, userId },
    });
    if (!token) throw new NotFoundException("API token not found");
    return token;
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

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
