import { ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { lockBoardWrites, lockUserMemberships } from "@/common/board-locks";

/** What a revocation pass changed. */
export interface ApiTokenRevocationResult {
  /** Tokens matched by the selector, active and already revoked. */
  tokenIds: string[];
  /** Tokens whose `revokedAt` was stamped by this call. */
  revokedCount: number;
}

export interface RevokeApiTokensOptions {
  /**
   * Kill-only mode: stamp `revokedAt` and cancel sessions/approvals in the
   * caller's transaction, without taking any user/board lock and without
   * touching claims. Revocation is committed before a separate
   * `releaseRevokedTokenClaims` pass, so a board-lock holder cannot delay
   * the irreversible kill. Used by the interactive token DELETE; password
   * reset/change, OAuth takeover and account erasure keep the full path.
   */
  killOnly?: boolean;
  /**
   * Also clear claims held by the token owners as browser/legacy
   * `Card.claimedBy` rows. Account scheduling uses this so an account with
   * only already-revoked tokens still loses its claims.
   */
  releaseUserClaims?: boolean;
  /**
   * User ids for the lock/cleanup set when the token selector matches no
   * rows (e.g. an account whose tokens were all revoked/deleted). Required
   * together with `releaseUserClaims` for that case.
   */
  userIds?: readonly string[];
}

export interface RevokedTokenClaimCleanup {
  /** Boards this pass locked and cleared claims on. */
  lockedBoardIds: string[];
  /** Cards whose claim columns were cleared. */
  cleared: number;
}

/**
 * TASK-200.10: release the claims of already-revoked tokens in a separate
 * transaction, after the kill has committed. The first query avoids taking
 * any board lock when the token holds no claim (a token DELETE must return
 * even while a board writer holds that board). Once claims exist, the claimed
 * boards are locked sorted and only cards on those boards are cleared: a
 * claim that appeared on a new board after the query is left for its lease to
 * expire rather than written unlocked.
 */
export async function releaseRevokedTokenClaims(
  tx: Prisma.TransactionClient,
  tokenIds: readonly string[],
): Promise<RevokedTokenClaimCleanup> {
  if (tokenIds.length === 0) {
    return { lockedBoardIds: [], cleared: 0 };
  }
  const initial = await tx.card.findMany({
    where: { claimedByTokenId: { in: [...tokenIds] } },
    select: { column: { select: { boardId: true } } },
  });
  const lockedBoardIds = [
    ...new Set(initial.map((card) => card.column.boardId)),
  ].sort();
  if (lockedBoardIds.length === 0) {
    return { lockedBoardIds: [], cleared: 0 };
  }

  await lockBoardWrites(tx, lockedBoardIds);
  // Re-read: a command that committed before the lock may have moved a
  // claim. Only the locked boards are cleared; a late board is left alone.
  await tx.card.findMany({
    where: { claimedByTokenId: { in: [...tokenIds] } },
    select: { column: { select: { boardId: true } } },
  });
  const cleared = await tx.card.updateMany({
    where: {
      claimedByTokenId: { in: [...tokenIds] },
      column: { boardId: { in: lockedBoardIds } },
    },
    data: {
      claimedBy: null,
      claimedByTokenId: null,
      claimedBySessionId: null,
      leaseUntil: null,
    },
  });
  return { lockedBoardIds, cleared: cleared.count };
}

/**
 * Revoke personal API tokens and close everything they own (TASK-166.3):
 * stamp `revokedAt`, cancel open sessions, and release claims held by the
 * token. Legacy claims without `claimedByTokenId` wait for their lease
 * unless the caller asks to release user claims too.
 *
 * TASK-200.10 final coherence: every lock is acquired before the first read
 * of memberships/claims. The global order is user-membership lock(s) → one
 * sorted board-lock set. Accepted memberships are fenced by the user lock,
 * so a command cannot create a new claim on an unlocked board while this
 * transaction runs; the claim re-read after the locks is a guard, not a
 * late-lock pass.
 *
 * The caller supplies its own transaction so password reset/change and OAuth
 * takeover can revoke keys atomically with the credential change.
 */
export async function revokeApiTokens(
  tx: Prisma.TransactionClient,
  where: Prisma.ApiTokenWhereInput,
  at: Date = new Date(),
  options: RevokeApiTokensOptions = {},
): Promise<ApiTokenRevocationResult> {
  const tokens = await tx.apiToken.findMany({
    where,
    select: { id: true, userId: true, boardId: true },
  });
  const matchedTokenIds = tokens.map((token) => token.id);
  if (options.killOnly === true) {
    // Kill first, lock later: no user/board reads or locks and no claim
    // write. The caller runs `releaseRevokedTokenClaims` after this commits.
    if (matchedTokenIds.length === 0) {
      return { tokenIds: [], revokedCount: 0 };
    }
    const revoked = await tx.apiToken.updateMany({
      where: { id: { in: matchedTokenIds }, revokedAt: null },
      data: { revokedAt: at },
    });
    await tx.agentSession.updateMany({
      where: { apiTokenId: { in: matchedTokenIds }, endedAt: null },
      data: { status: "cancelled", endedAt: at, endReason: "cancelled" },
    });
    await tx.approvalRequest.updateMany({
      where: {
        requestedByTokenId: { in: matchedTokenIds },
        status: { in: ["pending", "approved"] },
        expiresAt: { gt: at },
      },
      data: { status: "cancelled", decidedAt: at },
    });
    return { tokenIds: matchedTokenIds, revokedCount: revoked.count };
  }
  const userIds = [
    ...new Set([
      ...tokens.map((token) => token.userId),
      ...(options.userIds ?? []),
    ]),
  ];
  if (tokens.length === 0 && !options.releaseUserClaims) {
    return { tokenIds: [], revokedCount: 0 };
  }
  if (userIds.length === 0) {
    return { tokenIds: tokens.map((token) => token.id), revokedCount: 0 };
  }

  // User keys first, before any BoardMember/Card read. Every membership
  // acceptance path takes the same key, so the set read below is complete
  // until this transaction ends.
  await lockUserMemberships(tx, userIds);

  // Re-select after the user locks: a token created while we were locking
  // must not escape the static board set. Same `where`; owners can only be
  // the same users (or `userIds` supplied by the account path).
  const activeTokens =
    tokens.length === 0
      ? tokens
      : await tx.apiToken.findMany({
          where,
          select: { id: true, userId: true, boardId: true },
        });
  const effectiveUserIds = [
    ...new Set([...userIds, ...activeTokens.map((token) => token.userId)]),
  ].sort();
  const newUserIds = effectiveUserIds.filter((id) => !userIds.includes(id));
  if (newUserIds.length > 0) {
    await lockUserMemberships(tx, newUserIds);
  }

  const tokenIds = activeTokens.map((token) => token.id);
  const memberships = await tx.boardMember.findMany({
    where: { userId: { in: effectiveUserIds }, acceptedAt: { not: null } },
    select: { boardId: true },
  });
  const claimBoardIds = async (): Promise<string[]> => {
    if (tokenIds.length === 0) return [];
    const claims = await tx.card.findMany({
      where: { claimedByTokenId: { in: tokenIds } },
      select: { column: { select: { boardId: true } } },
    });
    return claims.map((card) => card.column.boardId);
  };
  const userClaimBoardIds = options.releaseUserClaims
    ? (
        await tx.card.findMany({
          where: { claimedBy: { in: effectiveUserIds } },
          select: { column: { select: { boardId: true } } },
        })
      ).map((card) => card.column.boardId)
    : [];
  const boardIds = new Set<string>([
    ...activeTokens
      .map((token) => token.boardId)
      .filter((boardId): boardId is string => boardId !== null),
    ...memberships.map((membership) => membership.boardId),
    ...(await claimBoardIds()),
    ...userClaimBoardIds,
  ]);

  // One static sorted set. No late lock loop: membership acceptance is
  // fenced by the user lock, and a scoped token cannot claim outside its
  // board.
  await lockBoardWrites(tx, boardIds);

  // Post-lock guard. Under the locks every current claim board must already
  // be in the set; a foreign writer that bypassed every lock is the only way
  // this can trip.
  const lateClaimBoards = (await claimBoardIds()).filter(
    (boardId) => !boardIds.has(boardId),
  );
  const lateUserClaimBoards = options.releaseUserClaims
    ? (
        await tx.card.findMany({
          where: { claimedBy: { in: effectiveUserIds } },
          select: { column: { select: { boardId: true } } },
        })
      )
        .map((card) => card.column.boardId)
        .filter((boardId) => !boardIds.has(boardId))
    : [];
  if (lateClaimBoards.length > 0 || lateUserClaimBoards.length > 0) {
    // Fail closed: a Card write on a board outside the static set would be
    // exactly the unlocked writer this task removes. The caller may retry.
    throw new ServiceUnavailableException({
      message: "Board lock set changed during token revocation; retry",
      code: "board_lock_set_incomplete",
      retryable: true,
    });
  }

  const revoked =
    tokenIds.length === 0
      ? { count: 0 }
      : await tx.apiToken.updateMany({
          where: { id: { in: tokenIds }, revokedAt: null },
          data: { revokedAt: at },
        });
  if (tokenIds.length > 0) {
    await tx.agentSession.updateMany({
      where: { apiTokenId: { in: tokenIds }, endedAt: null },
      data: { status: "cancelled", endedAt: at, endReason: "cancelled" },
    });
    await tx.approvalRequest.updateMany({
      where: {
        requestedByTokenId: { in: tokenIds },
        status: { in: ["pending", "approved"] },
        expiresAt: { gt: at },
      },
      data: { status: "cancelled", decidedAt: at },
    });
  }
  const claimOwners: Prisma.CardWhereInput[] = [];
  if (tokenIds.length > 0) {
    claimOwners.push({ claimedByTokenId: { in: tokenIds } });
  }
  if (options.releaseUserClaims) {
    claimOwners.push({ claimedBy: { in: effectiveUserIds } });
  }
  if (claimOwners.length > 0) {
    await tx.card.updateMany({
      where: { OR: claimOwners },
      data: {
        claimedBy: null,
        claimedByTokenId: null,
        claimedBySessionId: null,
        leaseUntil: null,
      },
    });
  }
  return { tokenIds, revokedCount: revoked.count };
}
