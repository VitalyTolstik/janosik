import type { Prisma } from "@prisma/client";

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
    select: { id: true },
  });
  if (tokens.length === 0) return { tokenIds: [], revokedCount: 0 };
  const tokenIds = tokens.map((token) => token.id);

  // Lock every board that currently holds one of these tokens' claims, in a
  // stable order. The same lock key BoardWriteService uses.
  const claims = await tx.card.findMany({
    where: { claimedByTokenId: { in: tokenIds } },
    select: { column: { select: { boardId: true } } },
  });
  const boardIds = [
    ...new Set(claims.map((card) => card.column.boardId)),
  ].sort();
  for (const boardId of boardIds) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${boardId}, 0))`;
  }

  const revoked = await tx.apiToken.updateMany({
    where: { id: { in: tokenIds }, revokedAt: null },
    data: { revokedAt: at },
  });
  await tx.agentSession.updateMany({
    where: { apiTokenId: { in: tokenIds }, endedAt: null },
    data: { status: "cancelled", endedAt: at, endReason: "cancelled" },
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
