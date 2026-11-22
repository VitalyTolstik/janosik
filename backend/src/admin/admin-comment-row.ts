import { Prisma } from "@prisma/client";
import type { AdminCommentRowDto } from "@janosik/shared";

/**
 * TASK-185.5 (§3.4): every admin comment row carries the saved revision count
 * and the incomplete-history flag. Both are `null` when the comment itself or
 * any parent in the live chain is deleted, matching the revisions route's
 * `404` boundary and letting the panel hide the history link.
 *
 * `_count` is selected with the row (one query, no per-comment follow-up).
 */
export const ADMIN_COMMENT_ROW_SELECT = {
  id: true,
  text: true,
  kind: true,
  createdAt: true,
  updatedAt: true,
  editedAt: true,
  deletedAt: true,
  historyIncompleteReason: true,
  cardId: true,
  authorId: true,
  card: {
    select: {
      title: true,
      deletedAt: true,
      column: {
        select: {
          deletedAt: true,
          board: { select: { deletedAt: true } },
        },
      },
    },
  },
  author: { select: { email: true } },
  _count: { select: { revisions: true } },
} satisfies Prisma.CommentSelect;

export type AdminCommentRowJoin = Prisma.CommentGetPayload<{
  select: typeof ADMIN_COMMENT_ROW_SELECT;
}>;

/** One wire row; `revisionCount`/`historyIncomplete` stay coupled. */
export function toAdminCommentRow(
  comment: AdminCommentRowJoin,
): AdminCommentRowDto {
  const live =
    comment.deletedAt === null &&
    comment.card.deletedAt === null &&
    comment.card.column.deletedAt === null &&
    comment.card.column.board.deletedAt === null;

  return {
    id: comment.id,
    cardId: comment.cardId,
    cardTitle: comment.card.title,
    authorId: comment.authorId,
    authorEmail: comment.author.email,
    text: comment.text,
    kind: comment.kind as AdminCommentRowDto["kind"],
    createdAt: comment.createdAt.getTime(),
    updatedAt: comment.updatedAt.getTime(),
    editedAt: comment.editedAt?.getTime() ?? null,
    deletedAt: comment.deletedAt?.getTime() ?? null,
    revisionCount: live ? comment._count.revisions : null,
    historyIncomplete: live ? comment.historyIncompleteReason !== null : null,
  };
}
