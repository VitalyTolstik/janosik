import { Injectable } from "@nestjs/common";
import { ApiTokenService } from "@/auth/api-token.service";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * Re-validation of an *open* member SSE stream (B-6). `MembershipGuard`
 * only runs when the stream is opened; an SSE connection then lives for
 * hours. On every keep-alive tick the stream asks this service whether its
 * caller would still be let in — and closes itself when not:
 *
 * - the account was disabled or deleted;
 * - the board was deleted;
 * - the membership is gone (removed, possibly on another node), no longer
 *   accepted, or a time-limited VIEWER passed its `expiresAt`;
 * - the stream was opened with a personal API token that has since been
 *   revoked or has expired.
 */
@Injectable()
export class StreamAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiTokens: ApiTokenService,
  ) {}

  async memberStreamAllowed(
    boardId: string,
    userId: string,
    principal: AuthPrincipal | undefined,
  ): Promise<boolean> {
    const membership = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId } },
      select: {
        acceptedAt: true,
        expiresAt: true,
        user: { select: { disabledAt: true } },
        board: { select: { deletedAt: true } },
      },
    });
    if (
      membership === null ||
      membership.acceptedAt === null ||
      membership.user.disabledAt !== null ||
      membership.board.deletedAt !== null ||
      (membership.expiresAt !== null &&
        membership.expiresAt.getTime() <= Date.now())
    ) {
      return false;
    }
    if (principal?.via === "pat") {
      return (
        principal.apiTokenId !== undefined &&
        (await this.apiTokens.isActive(principal.apiTokenId))
      );
    }
    return true;
  }
}
