import type { Prisma } from "@prisma/client";

/**
 * TASK-177.12 — comment-scoped attention cleanup.
 *
 * The `commentId` column is authoritative, so a client-sponsored comment id
 * (`_`/`%` are legal in `commandId`) can never act as a LIKE wildcard. These
 * helpers run inside the caller's transaction where one exists: a deleted
 * comment/board and its notifications commit or roll back together.
 */

export type MentionAttentionDb = Pick<
  Prisma.TransactionClient,
  "attentionNotification" | "notificationMail"
>;

/** Escape `LIKE` metacharacters for the legacy dedup-prefix fallback. */
export function escapeLikePrefix(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function deleteRows(
  db: MentionAttentionDb,
  where: Prisma.AttentionNotificationWhereInput,
): Promise<number> {
  const rows = await db.attentionNotification.findMany({
    where,
    select: { id: true, attentionMailId: true },
  });
  if (rows.length === 0) return 0;
  await db.attentionNotification.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  const mailIds = rows.flatMap((row) =>
    row.attentionMailId === null ? [] : [row.attentionMailId],
  );
  if (mailIds.length > 0) {
    // Delete the ledger row even when it was already delivered: the
    // deterministic mail id is derived from the dedup key, and a later
    // re-add of the same mention must be able to stage a fresh letter.
    await db.notificationMail.deleteMany({
      where: { id: { in: mailIds } },
    });
  }
  return rows.length;
}

/** All mention rows for one comment (author delete / admin tombstone). */
export function deleteCommentMentionAttention(
  db: MentionAttentionDb,
  commentId: string,
): Promise<number> {
  return deleteRows(db, { type: "comment.mention", commentId });
}

/** The subset of recipients whose mention was removed by an edit. */
export async function deleteCommentMentionAttentionForUsers(
  db: MentionAttentionDb,
  commentId: string,
  userIds: readonly string[],
): Promise<number> {
  if (userIds.length === 0) return 0;
  return deleteRows(db, {
    type: "comment.mention",
    commentId,
    userId: { in: [...new Set(userIds)] },
  });
}

/**
 * GDPR erase: every mention row produced by the erased author's comments is
 * owned by another recipient, so it is not covered by the recipient purge.
 */
export function deleteMentionAttentionForComments(
  db: MentionAttentionDb,
  commentIds: readonly string[],
): Promise<number> {
  if (commentIds.length === 0) return Promise.resolve(0);
  return deleteRows(db, {
    type: "comment.mention",
    commentId: { in: [...new Set(commentIds)] },
  });
}

/** Board soft delete: drop every mention row the board produced. */
export function deleteBoardMentionAttention(
  db: MentionAttentionDb,
  boardId: string,
): Promise<number> {
  return deleteRows(db, { type: "comment.mention", boardId });
}
