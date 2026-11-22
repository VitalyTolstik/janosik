import { NotFoundException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Comment } from "@prisma/client";
import type { RequestAttribution } from "@/auth/request-attribution";

/**
 * TASK-185.1 — the single writer for comment text edits.
 *
 * `Comment.text` stays the source of truth; every real text change appends one
 * immutable `CommentRevision`, moves `Comment.editedAt` and the verified pair
 * and writes one `comment_updated` Activity in the caller's board-write
 * transaction. Both `PATCH /comments/:id` and the attachment scrub use this
 * module so the fence and reconciliation rules cannot drift apart.
 */

/** How many revisions per comment are kept (§3.5). */
export const COMMENT_REVISION_LIMIT = 50;

export const COMMENT_ACTIVITY_TYPES = [
  "comment_added",
  "comment_updated",
  "comment_deleted",
] as const;

export type CommentHistoryIncompleteReason =
  "legacy_cutover" | "revision_limit" | "gdpr_erase" | "writer_gap";

export type CommentRevisionCause =
  "author_edit" | "attachment_deleted" | "system";

/**
 * Most severe reason wins. A writer gap is an integrity incident, so it is
 * never hidden by trimming or erase; a later low-priority marker cannot
 * downgrade an existing one.
 */
export const HISTORY_REASON_PRIORITY: Record<
  CommentHistoryIncompleteReason,
  number
> = {
  legacy_cutover: 1,
  revision_limit: 2,
  gdpr_erase: 3,
  writer_gap: 4,
};

export function mergeHistoryIncompleteReason(
  current: CommentHistoryIncompleteReason | null,
  next: CommentHistoryIncompleteReason,
): CommentHistoryIncompleteReason {
  if (current === null) return next;
  return HISTORY_REASON_PRIORITY[next] > HISTORY_REASON_PRIORITY[current]
    ? next
    : current;
}

/** The 409 a caller sends after committing the `writer_gap` mark. */
export function commentHistoryGapException(): ConflictException {
  return new ConflictException({
    message:
      "Comment history is inconsistent; the edit was not applied. An operator must reconcile the comment history before editing it again.",
    code: "comment_history_gap",
  });
}

/**
 * One timestamp for `editedAt`, the verified pair and `CommentRevision`:
 * strictly after the cutover fence and the previous edit, at millisecond
 * precision (the database stores TIMESTAMP(3)).
 */
export function nextHistoryTimestamp(
  nowMs: number,
  cutoverAt: Date,
  previousEditedAt: Date | null,
): Date {
  return new Date(
    Math.max(
      nowMs,
      cutoverAt.getTime() + 1,
      previousEditedAt === null ? 0 : previousEditedAt.getTime() + 1,
    ),
  );
}

/** The history columns every writer path re-reads under the board lock. */
export type CommentHistoryState = Pick<
  Comment,
  | "id"
  | "cardId"
  | "text"
  | "kind"
  | "editedAt"
  | "lastRevisionNumber"
  | "historyCutoverAt"
  | "historyVerifiedEditedAt"
  | "historyVerifiedRevisionNumber"
  | "historyIncompleteReason"
>;

export type CommentHistoryTx = Pick<
  Prisma.TransactionClient,
  "comment" | "commentRevision" | "activity" | "$executeRaw"
>;

/**
 * Take the same transaction-scoped board locks as `BoardWriteService`, in a
 * stable order so multi-board jobs (GDPR erase, purge chunks) cannot deadlock
 * against a single-board writer.
 */
export async function lockBoardWrites(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  boardIds: Iterable<string>,
): Promise<void> {
  const ids = [...new Set(boardIds)].sort();
  for (const boardId of ids) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${boardId}, 0))`;
  }
}

const AUTHOR_INCLUDE = {
  author: { select: { displayName: true, email: true } },
} as const;

export type CommentWithAuthor = Comment & {
  author: { displayName: string | null; email: string };
};

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  a === null ? b === null : b !== null && a.getTime() === b.getTime();

/**
 * §3.5 reconciliation. The current row must match the verified pair, and a
 * non-null verified revision number must still point at the last stored
 * revision with the same timestamp and text. A null number is the confirmed
 * state after legacy cutover, erase or a sweep, so it only needs the
 * `editedAt` pair to match.
 */
export async function verifyCommentHistory(
  tx: CommentHistoryTx,
  comment: CommentHistoryState,
): Promise<boolean> {
  if (!sameInstant(comment.editedAt, comment.historyVerifiedEditedAt)) {
    return false;
  }
  const verifiedNumber = comment.historyVerifiedRevisionNumber;
  if (verifiedNumber === null) return true;
  if (
    verifiedNumber <= 0 ||
    comment.lastRevisionNumber !== verifiedNumber ||
    comment.editedAt === null
  ) {
    return false;
  }
  const revision = await tx.commentRevision.findUnique({
    where: {
      commentId_revisionNumber: {
        commentId: comment.id,
        revisionNumber: verifiedNumber,
      },
    },
    select: { createdAt: true, afterText: true },
  });
  if (revision === null) return false;
  return (
    revision.createdAt.getTime() > comment.historyCutoverAt.getTime() &&
    revision.createdAt.getTime() === comment.editedAt.getTime() &&
    revision.afterText === comment.text
  );
}

/** Persist a reason using the §3.1 priority merge. */
export async function markHistoryIncomplete(
  tx: CommentHistoryTx,
  commentId: string,
  reason: CommentHistoryIncompleteReason,
): Promise<void> {
  const row = await tx.comment.findUnique({
    where: { id: commentId },
    select: { historyIncompleteReason: true },
  });
  if (row === null) return;
  const merged = mergeHistoryIncompleteReason(
    row.historyIncompleteReason,
    reason,
  );
  if (merged === row.historyIncompleteReason) return;
  await tx.comment.updateMany({
    where: { id: commentId },
    data: { historyIncompleteReason: merged },
  });
}

/** Delete the Activity snapshots of the given comment ids (purge/erase). */
export async function deleteCommentActivitySnapshots(
  tx: CommentHistoryTx,
  commentIds: readonly string[],
  options: { onlyUpdates?: boolean } = {},
): Promise<void> {
  if (commentIds.length === 0) return;
  const types = options.onlyUpdates
    ? Prisma.sql`"type" = 'comment_updated'`
    : Prisma.sql`"type" IN ('comment_added', 'comment_updated', 'comment_deleted')`;
  await tx.$executeRaw(
    Prisma.sql`
      DELETE FROM "Activity"
      WHERE ${types}
        AND "commentId" IN (${Prisma.join([...commentIds])})
    `,
  );
}

/** Delete the Activity snapshots that belong to trimmed revision ids. */
async function deleteRevisionActivitySnapshots(
  tx: CommentHistoryTx,
  revisionIds: readonly string[],
): Promise<void> {
  if (revisionIds.length === 0) return;
  await tx.$executeRaw(
    Prisma.sql`
      DELETE FROM "Activity"
      WHERE "type" = 'comment_updated'
        AND "details"->>'revisionId' IN (${Prisma.join([...revisionIds])})
    `,
  );
}

export interface WriteCommentUpdateParams {
  commentId: string;
  /** Board resolved by the caller; the re-read is scoped to it. */
  boardId: string;
  /** Normalized text, or undefined when the PATCH omitted text. */
  text?: string;
  /** Requested kind, or undefined when the PATCH omitted it. */
  kind?: string;
  editorId: string | null;
  attribution: RequestAttribution;
  cause: CommentRevisionCause;
  /** Re-check author/role on the locked row; may throw. */
  authorize?: (comment: CommentWithAuthor) => void;
  /** Inline-media reconcile, applied only on a real text change. */
  reconcileMedia?: (beforeText: string, afterText: string) => Promise<void>;
}

export type WriteCommentUpdateResult =
  | { status: "gap" }
  | { status: "unchanged"; comment: CommentWithAuthor }
  | {
      status: "written";
      comment: CommentWithAuthor;
      activityId: string;
      revisionId: string | null;
      at: number;
      textChanged: boolean;
      kindChanged: boolean;
    };

/**
 * Apply one PATCH at the text level. Returns `gap` when reconciliation fails:
 * the caller must commit this transaction (the `writer_gap` mark is already
 * written) and then answer 409. Text no-ops and kind-only edits never create a
 * revision or move `editedAt`.
 */
export async function writeCommentUpdate(
  tx: CommentHistoryTx,
  params: WriteCommentUpdateParams,
): Promise<WriteCommentUpdateResult> {
  // Re-read under the board lock, including the live parent chain.
  const comment = await tx.comment.findFirst({
    where: {
      id: params.commentId,
      deletedAt: null,
      card: {
        deletedAt: null,
        column: { boardId: params.boardId, deletedAt: null },
      },
    },
    include: AUTHOR_INCLUDE,
  });
  if (comment === null) {
    throw new NotFoundException("Comment not found");
  }
  params.authorize?.(comment);

  // Reconciliation precedes the text no-op comparison: an old writer that
  // changed only the text is caught even by a PATCH that changes nothing.
  if (!(await verifyCommentHistory(tx, comment))) {
    await markHistoryIncomplete(tx, comment.id, "writer_gap");
    return { status: "gap" };
  }

  const textChanged = params.text !== undefined && params.text !== comment.text;
  const kindChanged = params.kind !== undefined && params.kind !== comment.kind;
  if (!textChanged && !kindChanged) {
    return { status: "unchanged", comment };
  }
  const nextText = params.text ?? comment.text;

  let revisionId: string | null = null;
  let revisionAt: Date | null = null;
  let revisionNumber: number | null = null;
  let nextReason = comment.historyIncompleteReason;
  let trimmedRevisionIds: string[] = [];

  if (textChanged) {
    const afterText = params.text as string;
    const beforeText = comment.text;
    revisionAt = nextHistoryTimestamp(
      Date.now(),
      comment.historyCutoverAt,
      comment.editedAt,
    );
    revisionNumber = comment.lastRevisionNumber + 1;

    // The oldest rows past the 50-row window (numbers are monotonic).
    const expired = await tx.commentRevision.findMany({
      where: {
        commentId: comment.id,
        revisionNumber: { lte: revisionNumber - COMMENT_REVISION_LIMIT },
      },
      select: { id: true },
    });
    trimmedRevisionIds = expired.map((row) => row.id);
    if (trimmedRevisionIds.length > 0) {
      nextReason = mergeHistoryIncompleteReason(nextReason, "revision_limit");
    }

    const updated = await tx.comment.updateMany({
      where: { id: comment.id, deletedAt: null },
      data: {
        text: afterText,
        ...(kindChanged && params.kind !== undefined
          ? { kind: params.kind }
          : {}),
        editedAt: revisionAt,
        historyVerifiedEditedAt: revisionAt,
        historyVerifiedRevisionNumber: revisionNumber,
        lastRevisionNumber: revisionNumber,
        ...(nextReason !== comment.historyIncompleteReason
          ? { historyIncompleteReason: nextReason }
          : {}),
      },
    });
    if (updated.count === 0) {
      throw new NotFoundException("Comment not found");
    }

    const revision = await tx.commentRevision.create({
      data: {
        commentId: comment.id,
        revisionNumber,
        beforeText,
        afterText,
        createdAt: revisionAt,
        editorId: params.editorId,
        actorType: params.attribution.actorType,
        apiTokenId: params.attribution.apiTokenId,
        agentSessionId: params.attribution.agentSessionId,
        agentName: params.attribution.agentName,
        cause: params.cause,
      },
    });
    revisionId = revision.id;

    await params.reconcileMedia?.(beforeText, afterText);

    // Insert happened first so the trim cannot remove the new row.
    if (trimmedRevisionIds.length > 0) {
      await tx.commentRevision.deleteMany({
        where: { id: { in: trimmedRevisionIds } },
      });
      await deleteRevisionActivitySnapshots(tx, trimmedRevisionIds);
    }
  } else if (params.kind !== undefined) {
    const updated = await tx.comment.updateMany({
      where: { id: comment.id, deletedAt: null },
      data: { kind: params.kind },
    });
    if (updated.count === 0) {
      throw new NotFoundException("Comment not found");
    }
  }

  const activity = await tx.activity.create({
    data: {
      boardId: params.boardId,
      cardId: comment.cardId,
      type: "comment_updated",
      // TASK-185.2: the typed link drives the live-comment filter and the
      // HTTP revision check without parsing free JSON.
      commentId: comment.id,
      actorId: params.editorId ?? comment.authorId,
      actorType: params.attribution.actorType,
      apiTokenId: params.attribution.apiTokenId,
      agentSessionId: params.attribution.agentSessionId,
      agentName: params.attribution.agentName,
      details: textChanged
        ? {
            commentId: comment.id,
            revisionId,
            beforeText: comment.text,
            afterText: nextText,
            cause: params.cause,
            // TASK-176.2 compatibility: consumers read the new text here.
            text: nextText,
            ...(kindChanged
              ? { beforeKind: comment.kind, afterKind: params.kind }
              : {}),
          }
        : {
            commentId: comment.id,
            beforeKind: comment.kind,
            afterKind: params.kind,
          },
    },
  });

  const row = await tx.comment.findUniqueOrThrow({
    where: { id: comment.id },
    include: AUTHOR_INCLUDE,
  });
  return {
    status: "written",
    comment: row,
    activityId: activity.id,
    revisionId,
    at: activity.createdAt.getTime(),
    textChanged,
    kindChanged,
  };
}

/**
 * Attachment scrub pre-flight: check every affected live comment before the
 * attachment row or any text moves. A gap is persisted as `writer_gap` and
 * the caller aborts the whole deletion.
 */
export async function findCommentHistoryGaps(
  tx: CommentHistoryTx,
  comments: readonly CommentHistoryState[],
): Promise<string[]> {
  const gaps: string[] = [];
  for (const comment of comments) {
    if (!(await verifyCommentHistory(tx, comment))) gaps.push(comment.id);
  }
  return gaps;
}
