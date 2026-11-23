import type { Prisma } from "@prisma/client";
import { lockBoardWrites } from "@/comments/comment-history";

/** What a revocation pass changed. */
export interface ApiTokenRevocationResult {
  /** Tokens matched by the selector, active and already revoked. */
  tokenIds: string[];
  /** Tokens whose `revokedAt` was stamped by this call. */
  revokedCount: number;
}

/**
 * Revoke personal API tokens and close everything they own (TASK-166.3):
 * stamp `revokedAt`, cancel open sessions, and release claims held by the
 * token. Legacy claims without `claimedByTokenId` wait for their lease.
 *
 * Claims are released under the same per-board advisory locks as board
 * writers. A command queued before the revoke therefore either commits and
 * is then cleaned up, or acquires the lock after the revoke and is rejected
 * by its in-transaction token/session check. Without the locks, a claim
 * released here could be recreated by a writer already waiting on the board.
 *
 * The lock set is broader than the current claim boards: every board the
 * token is scoped to, every accepted membership of an unscoped token's user
 * (the boards it can claim on), and any existing claim board. The claim set
 * is re-read after locking and any late board is added in a bounded loop, so
 * a concurrent claim cannot slip in before `Card` is updated.
 *
 * The caller supplies its own transaction so password reset/change and OAuth
 * takeover can revoke keys atomically with the credential change.
 */
export async function revokeApiTokens(
  tx: Prisma.TransactionClient,
  where: Prisma.ApiTokenWhereInput,
  at: Date = new Date(),
): Promise<ApiTokenRevocationResult> {
  const tokens = await tx.apiToken.findMany({
    where,
    select: { id: true, userId: true, boardId: true },
  });
  if (tokens.length === 0) return { tokenIds: [], revokedCount: 0 };
  const tokenIds = tokens.map((token) => token.id);

  /** Boards whose cards currently name one of these tokens. */
  const claimBoardIds = async (): Promise<string[]> => {
    const claims = await tx.card.findMany({
      where: { claimedByTokenId: { in: tokenIds } },
      select: { column: { select: { boardId: true } } },
    });
    return claims.map((card) => card.column.boardId);
  };

  const boardIds = new Set<string>(
    tokens
      .map((token) => token.boardId)
      .filter((boardId): boardId is string => boardId !== null),
  );
  // An unscoped token can claim on any board its user belongs to. Scoped
  // tokens cannot leave their board, so only unscoped tokens' users need
  // their accepted membership boards in the lock set.
  const unscopedUserIds = [
    ...new Set(
      tokens
        .filter((token) => token.boardId === null)
        .map((token) => token.userId),
    ),
  ];
  if (unscopedUserIds.length > 0) {
    const memberships = await tx.boardMember.findMany({
      where: { userId: { in: unscopedUserIds }, acceptedAt: { not: null } },
      select: { boardId: true },
    });
    for (const membership of memberships) boardIds.add(membership.boardId);
  }
  for (const boardId of await claimBoardIds()) boardIds.add(boardId);

  // Acquire in sorted order (lockBoardWrites sorts internally) before the
  // first Card write. Re-check claims after the lock: a command that was
  // already in flight can have moved a claim to another board. The bound
  // keeps a pathological mover from looping forever; scoped/membership
  // boards above already cover every board the token could newly claim on.
  await lockBoardWrites(tx, boardIds);
  for (let pass = 0; pass < 5; pass += 1) {
    const discovered = (await claimBoardIds()).filter(
      (boardId) => !boardIds.has(boardId),
    );
    if (discovered.length === 0) break;
    await lockBoardWrites(tx, discovered);
    for (const boardId of discovered) boardIds.add(boardId);
  }

  const revoked = await tx.apiToken.updateMany({
    where: { id: { in: tokenIds }, revokedAt: null },
    data: { revokedAt: at },
  });
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
  await tx.card.updateMany({
    where: { claimedByTokenId: { in: tokenIds } },
    data: {
      claimedBy: null,
      claimedByTokenId: null,
      claimedBySessionId: null,
      leaseUntil: null,
    },
  });
  return { tokenIds, revokedCount: revoked.count };
}
