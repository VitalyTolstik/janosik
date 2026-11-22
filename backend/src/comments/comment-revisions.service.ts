import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ActorType,
  CommentHistoryIncompleteReason,
  CommentRevisionCause,
  CommentRevisionPage,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { verifyCommentHistory } from "./comment-history";

/** Default page size of `GET …/comments/:commentId/revisions?limit=` (§3.3). */
export const DEFAULT_REVISION_LIMIT = 20;
/** Upper bound for the revisions `?limit=` (§3.3). */
export const MAX_REVISION_LIMIT = 100;

/** Live parent chain and the §3.5 fields the consistency check reads. */
const HISTORY_SELECT = {
  id: true,
  cardId: true,
  text: true,
  kind: true,
  editedAt: true,
  lastRevisionNumber: true,
  historyCutoverAt: true,
  historyVerifiedEditedAt: true,
  historyVerifiedRevisionNumber: true,
  historyIncompleteReason: true,
} as const;

interface RevisionCursor {
  commentId: string;
  revisionNumber: number;
}

/**
 * Read-only comment edit history (TASK-185.3, §3.3).
 *
 * The route guards decide who may read the discussion. This service only
 * serves a live comment whose card, column and board are all live, refuses a
 * comment the writer chain cannot vouch for, and returns an empty page with
 * `writer_gap` instead of unverified snapshots — even before the sweep stores
 * the reason.
 */
@Injectable()
export class CommentRevisionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest revision first. The cursor is bound to this comment. */
  async list(
    commentId: string,
    cursorRaw?: string,
    limitRaw?: string,
  ): Promise<CommentRevisionPage> {
    // One repeatable-read snapshot keeps the live row, the §3.5 pair and the
    // returned page consistent while an edit may be committing alongside.
    return this.prisma.$transaction(
      async (tx) => {
        const comment = await tx.comment.findFirst({
          where: {
            id: commentId,
            deletedAt: null,
            card: {
              deletedAt: null,
              column: { deletedAt: null, board: { deletedAt: null } },
            },
          },
          select: HISTORY_SELECT,
        });
        if (comment === null) {
          throw new NotFoundException("Comment not found");
        }

        // Cursor validation happens after the live/access checks so a foreign
        // or malformed cursor never turns a 403/404 into a 400.
        const { cursor, limit } = parseCommentRevisionPage(
          commentId,
          cursorRaw,
          limitRaw,
        );

        if (!(await verifyCommentHistory(tx, comment))) {
          return historyGapPage();
        }

        const rows = await tx.commentRevision.findMany({
          where: {
            commentId,
            ...(cursor
              ? { revisionNumber: { lt: cursor.revisionNumber } }
              : {}),
          },
          orderBy: { revisionNumber: "desc" },
          take: limit + 1,
          include: { editor: { select: { displayName: true } } },
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1];
        const reason =
          comment.historyIncompleteReason as CommentHistoryIncompleteReason | null;

        return {
          items: page.map((row) => ({
            id: row.id,
            revisionNumber: row.revisionNumber,
            createdAt: row.createdAt.getTime(),
            editorId: row.editorId,
            // The current public display name, never a snapshot: a renamed
            // editor is shown under the name they use today. A blank name is
            // indistinguishable from an unavailable editor on the wire.
            editorName: row.editor?.displayName?.trim() || null,
            actorType: toActorType(row.actorType),
            agentName: row.agentName,
            cause: row.cause as CommentRevisionCause,
            beforeText: row.beforeText,
            afterText: row.afterText,
          })),
          nextCursor:
            hasMore && last
              ? encodeCommentRevisionCursor(commentId, last.revisionNumber)
              : null,
          historyIncomplete: reason !== null,
          historyIncompleteReason: reason,
        } satisfies CommentRevisionPage;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

/** Opaque cursor: the comment id plus the last served revision number. */
export function encodeCommentRevisionCursor(
  commentId: string,
  revisionNumber: number,
): string {
  return Buffer.from(
    JSON.stringify({ c: commentId, r: revisionNumber }),
    "utf8",
  ).toString("base64url");
}

export function parseCommentRevisionPage(
  commentId: string,
  cursorRaw?: string,
  limitRaw?: string,
): { cursor: RevisionCursor | null; limit: number } {
  return {
    cursor: cursorRaw ? parseRevisionCursor(cursorRaw, commentId) : null,
    limit: parseRevisionLimit(limitRaw),
  };
}

function parseRevisionCursor(raw: string, commentId: string): RevisionCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestException("cursor is malformed");
  }
  if (
    decoded === null ||
    typeof decoded !== "object" ||
    Array.isArray(decoded)
  ) {
    throw new BadRequestException("cursor is malformed");
  }
  const { c, r } = decoded as { c?: unknown; r?: unknown };
  if (
    typeof c !== "string" ||
    c.length === 0 ||
    typeof r !== "number" ||
    !Number.isSafeInteger(r) ||
    r <= 0
  ) {
    throw new BadRequestException("cursor is malformed");
  }
  if (c !== commentId) {
    throw new BadRequestException(
      "cursor was issued for another comment's revisions",
    );
  }
  return { commentId: c, revisionNumber: r };
}

function parseRevisionLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_REVISION_LIMIT;
  // Digits only: `Number()` alone would accept `1e2`, `+20`, ` 20` and
  // `0x14`, none of which are the documented integer spelling.
  if (!/^[0-9]+$/.test(raw)) {
    throw new BadRequestException(
      `limit must be an integer 1…${MAX_REVISION_LIMIT}`,
    );
  }
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_REVISION_LIMIT) {
    throw new BadRequestException(
      `limit must be an integer 1…${MAX_REVISION_LIMIT}`,
    );
  }
  return limit;
}

function toActorType(value: string): ActorType {
  return value === "agent" || value === "admin" ? value : "human";
}

/**
 * The page a failed §3.5 reconciliation serves: no snapshot is trustworthy,
 * so nothing is returned even when rows already exist. The persisted reason
 * is intentionally not required — the sweep may not have run yet.
 */
function historyGapPage(): CommentRevisionPage {
  return {
    items: [],
    nextCursor: null,
    historyIncomplete: true,
    historyIncompleteReason: "writer_gap",
  };
}
