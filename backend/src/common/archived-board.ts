import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * Archived-board refusal shared by the command path and card-scoped REST
 * guards. Archived boards stay readable, but every content write (commands,
 * comments, attachments) has to restore the board first.
 */
export const ARCHIVED_BOARD_MESSAGE =
  "This board is archived and read-only. Restore it from the board switcher to make changes.";

/**
 * Authoritative write gate for transactions that already hold the board lock.
 * The guard-level check can race a concurrent ARCHIVE_BOARD; this read runs
 * after `pg_advisory_xact_lock`, so a comment/attachment write cannot land
 * between the two.
 */
export async function assertBoardAcceptsWrites(
  tx: Prisma.TransactionClient,
  boardId: string,
): Promise<void> {
  const board = await tx.board.findFirst({
    where: { id: boardId, deletedAt: null },
    select: { archivedAt: true },
  });
  if (!board) throw new NotFoundException("Board not found");
  if (board.archivedAt !== null) {
    throw new ConflictException(ARCHIVED_BOARD_MESSAGE);
  }
}
