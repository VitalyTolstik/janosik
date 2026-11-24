import type { Prisma } from "@prisma/client";

type LockTx = Pick<Prisma.TransactionClient, "$executeRaw">;

/**
 * TASK-200.10: the advisory locks that order board writes and membership
 * changes. The global order is **user membership → sorted board ids**.
 *
 * Board ids alone cannot fence a membership change: a command on a board the
 * user has just joined would not have locked anything for that user yet. The
 * user key is taken by every path that makes someone an accepted member and
 * by token revocation/account erasure before they read memberships.
 */
export async function lockUserMemberships(
  tx: LockTx,
  userIds: Iterable<string>,
): Promise<void> {
  const ids = [...new Set(userIds)].sort();
  for (const userId of ids) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`user-memberships:${userId}`}, 0))`;
  }
}

/** Sorted per-board advisory locks, the same key `BoardWriteService` uses. */
export async function lockBoardWrites(
  tx: LockTx,
  boardIds: Iterable<string>,
): Promise<void> {
  const ids = [...new Set(boardIds)].sort();
  for (const boardId of ids) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${boardId}, 0))`;
  }
}
