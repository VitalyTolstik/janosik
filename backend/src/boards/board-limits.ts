import { ConflictException, PayloadTooLargeException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { MAX_BOARD_EXPORT_BYTES } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { maxBoardsPerUser } from "@/config/limits";

/**
 * TASK-166 D19: the server-mode board cap is an operator safety limit, not a
 * product tier. `MAX_BOARDS_PER_USER = 0` (default) means unlimited.
 */
export function boardLimit(): number | null {
  const cap = maxBoardsPerUser();
  return cap > 0 ? cap : null;
}

/**
 * Serialize creates/imports for one account inside a transaction. Counting
 * alone would let two concurrent requests both see "one slot left" and create
 * two boards; the advisory lock makes the count-and-create atomic across
 * application nodes without a schema-level counter.
 */
export async function lockBoardQuota(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  if (boardLimit() === null) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`board-quota:${userId}`}, 0))`;
}

/**
 * The number of live boards a person currently has access to. Archived boards
 * count (they are still in the workspace), soft-deleted boards do not.
 */
export function countBoardsForUser(
  db: PrismaService | Prisma.TransactionClient,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  return db.boardMember.count({
    where: {
      userId,
      acceptedAt: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      board: { deletedAt: null },
    },
  });
}

/**
 * Enforce the cap for `incoming` new boards. Throws `409 limit_exceeded`
 * before the caller writes anything, so an import stays atomic.
 */
export async function assertBoardQuota(
  db: PrismaService | Prisma.TransactionClient,
  userId: string,
  incoming: number,
): Promise<void> {
  const limit = boardLimit();
  if (limit === null) return;
  const current = await countBoardsForUser(db, userId);
  if (current + incoming > limit) {
    throw new ConflictException({
      message: `Board limit exceeded (${limit})`,
      code: "limit_exceeded",
      limit,
      current,
    });
  }
}

/**
 * D20: never truncate an export silently. The service measures the exact
 * UTF-8 envelope it is about to send and answers 413 with an operator hint.
 */
export function assertBoardExportSize(size: number): void {
  if (size <= MAX_BOARD_EXPORT_BYTES) return;
  throw new PayloadTooLargeException({
    message: `This board export is ${Math.ceil(
      size / (1024 * 1024),
    )} MB, above the ${Math.round(
      MAX_BOARD_EXPORT_BYTES / (1024 * 1024),
    )} MB limit. Use pg_dump for a full-instance copy.`,
    code: "payload_too_large",
    limit: MAX_BOARD_EXPORT_BYTES,
  });
}
