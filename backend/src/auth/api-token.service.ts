import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ApiToken } from "@prisma/client";
import {
  API_TOKEN_MAX_TTL_DAYS,
  API_TOKEN_PREFIX,
  type CreateUserTokenRequest,
  type CreateUserTokenResponse,
  type UserTokenDto,
} from "@janosik/shared";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { toAuthUser } from "./auth-user.mapper";
import type { AuthUser } from "./auth.types";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  async authenticate(raw: string): Promise<AuthUser> {
    const stored = await this.prisma.apiToken.findUnique({
      where: { tokenHash: this.hashToken(raw) },
      include: { user: true },
    });
    if (
      !stored ||
      stored.revokedAt !== null ||
      stored.user.disabledAt !== null
    ) {
      throw new UnauthorizedException("Invalid API token");
    }
    if (stored.expiresAt !== null && stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("API token expired");
    }
    await this.prisma.apiToken.update({
      where: { id: stored.id },
      data: { lastUsedAt: new Date() },
    });
    return toAuthUser(stored.user);
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
  ): Promise<CreateUserTokenResponse> {
    const token = this.generate();
    const created = await this.prisma.apiToken.create({
      data: {
        userId,
        name: dto.name,
        tokenHash: this.hashToken(token),
        expiresAt: this.resolveExpiresAt(dto.expiresAt),
      },
    });
    // The plaintext leaves the server exactly here, exactly once.
    return { token, apiToken: toUserTokenDto(created) };
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

  /** `null`/omitted = never expires; otherwise in the future and bounded. */
  private resolveExpiresAt(requested: string | null | undefined): Date | null {
    if (requested === undefined || requested === null) {
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
  return {
    id: token.id,
    name: token.name,
    createdAt: token.createdAt.getTime(),
    lastUsedAt: token.lastUsedAt?.getTime() ?? null,
    expiresAt: token.expiresAt?.getTime() ?? null,
    revokedAt: token.revokedAt?.getTime() ?? null,
  };
}
