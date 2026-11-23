import { Injectable } from "@nestjs/common";
import { type AgentPauseStamp, resolveAgentPause } from "@/auth/agent-pause";
import { ApiTokenService } from "@/auth/api-token.service";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { securityStamp } from "@/auth/security-stamp";
import { HotPathCacheService } from "@/common/hot-path-cache.service";
import type { StreamMembershipSnapshot } from "@/common/hot-path-cache.service";
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
 *   revoked, expired, or narrowed to another board;
 * - the browser access token itself has expired, its security stamp no longer
 *   matches (password/mailbox change), or its rotation family was logged out.
 *
 * M6 closes the gaps the original B-6 check left open; the stream is a
 * long-lived read capability and must not outlive the credential that opened
 * it.
 */
@Injectable()
export class StreamAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiTokens: ApiTokenService,
    private readonly hotPathCache: HotPathCacheService,
  ) {}

  async memberStreamAllowed(
    boardId: string,
    userId: string,
    principal: AuthPrincipal | undefined,
  ): Promise<boolean> {
    // TASK-200.5: only non-credential membership facts are cached. A removed
    // member expires with the 30 s window and the bus cuts it sooner; the
    // credential and disable fields below are read fresh on every tick.
    let membership: StreamMembershipSnapshot | null | undefined =
      this.hotPathCache.getStreamMembership(boardId, userId);
    if (membership === undefined) {
      const epoch = this.hotPathCache.epochs.membership;
      membership = await this.hotPathCache.singleFlight(
        `stream-membership:${boardId}\u0000${userId}`,
        epoch,
        async () => {
          const again = this.hotPathCache.getStreamMembership(boardId, userId);
          if (again !== undefined) return again;
          const row = await this.prisma.boardMember.findUnique({
            where: { boardId_userId: { boardId, userId } },
            select: {
              acceptedAt: true,
              expiresAt: true,
              board: { select: { deletedAt: true } },
            },
          });
          // Do not write back an answer that raced with an invalidation.
          if (row !== null && this.hotPathCache.epochs.membership === epoch) {
            this.hotPathCache.rememberStreamMembership(boardId, userId, row);
          }
          return row;
        },
      );
    }
    if (
      membership === null ||
      membership === undefined ||
      membership.acceptedAt === null ||
      membership.board.deletedAt !== null ||
      (membership.expiresAt !== null &&
        membership.expiresAt.getTime() <= Date.now())
    ) {
      return false;
    }
    if (principal?.via === "pat") {
      return (
        principal.apiTokenId !== undefined &&
        (await this.apiTokens.isActive(principal.apiTokenId, boardId))
      );
    }
    if (principal?.via === "jwt") {
      if (
        principal.accessTokenExpiresAt !== undefined &&
        principal.accessTokenExpiresAt <= Date.now()
      ) {
        return false;
      }
      // Credential/disable fields never ride in the snapshot: a password
      // change or block must close an open stream on the next tick.
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          emailVerifiedAt: true,
          disabledAt: true,
        },
      });
      if (user === null || user.disabledAt !== null) return false;
      // Impersonation tokens are signed without a stamp; their short TTL and
      // read-only policy are the control. A normal session must still match
      // the current credentials.
      if (
        principal.impersonatedBy == null &&
        principal.stamp !== undefined &&
        principal.stamp !== securityStamp(user)
      ) {
        return false;
      }
      // Logout/refresh revoke the family, not the already-minted access
      // token. Without this row the stream would remain readable for the
      // access token's full lifetime after sign-out.
      if (principal.sessionFamilyId !== undefined) {
        const live = await this.prisma.refreshToken.findFirst({
          where: {
            userId,
            familyId: principal.sessionFamilyId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (live === null) return false;
      }
    }
    return true;
  }

  /**
   * TASK-166.3: is this open stream paused now? Token pause wins over board,
   * board over session; a human stream never pauses. `sessionId` is the
   * optional `?session=` of the stream — without it a session pause does not
   * affect the token-level stream (ADR §9.3).
   */
  async streamPause(
    boardId: string,
    userId: string,
    principal: AuthPrincipal | undefined,
    sessionId: string | undefined,
  ): Promise<AgentPauseStamp | null> {
    if (principal?.via !== "pat") return null;
    const [token, board] = await Promise.all([
      principal.apiTokenId === undefined
        ? Promise.resolve(null)
        : this.prisma.apiToken.findUnique({
            where: { id: principal.apiTokenId },
            select: { individualPausedAt: true, stopAllPausedAt: true },
          }),
      this.prisma.board.findUnique({
        where: { id: boardId },
        select: { agentsPausedAt: true },
      }),
    ]);
    const tokenPause = resolveAgentPause({
      tokenIndividualPausedAt: token?.individualPausedAt ?? null,
      tokenStopAllPausedAt: token?.stopAllPausedAt ?? null,
    });
    if (tokenPause !== null) return tokenPause;
    const boardPause = resolveAgentPause({
      boardPausedAt: board?.agentsPausedAt ?? null,
    });
    if (boardPause !== null) return boardPause;
    if (sessionId === undefined || sessionId === "") return null;

    const session = await this.prisma.agentSession.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        apiTokenId: true,
        boardId: true,
        pausedAt: true,
      },
    });
    if (
      session === null ||
      session.userId !== userId ||
      session.boardId !== boardId ||
      session.apiTokenId !== principal.apiTokenId
    ) {
      return null;
    }
    return resolveAgentPause({ sessionPausedAt: session.pausedAt });
  }
}
