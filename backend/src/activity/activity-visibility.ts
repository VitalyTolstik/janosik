import { Prisma } from "@prisma/client";
import type { ActivityChange } from "@janosik/shared";
import type { PrismaService } from "@/common/prisma/prisma.service";

/**
 * TASK-185.2 — the one comment-activity visibility projection.
 *
 * `Activity` has no FK to `Comment` (a tombstone must survive a hard purge),
 * so the live-comment check is SQL. The same predicate serves the member feed
 * and the admin raw-activity/timeline queries, and every consumer projects
 * comment rows through the same allowlist: no raw `details`, no deleted text,
 * and no `commentId` unless a live comment on the row's own board/card backs
 * the link.
 */
export const COMMENT_ACTIVITY_TYPES = new Set([
  "comment_added",
  "comment_updated",
  "comment_deleted",
]);

export function isCommentActivity(type: string): boolean {
  return COMMENT_ACTIVITY_TYPES.has(type);
}

/** The minimum Activity fields the comment projection reads. */
export interface CommentActivityRow {
  id: string;
  type: string;
  boardId: string;
  cardId: string | null;
  commentId: string | null;
  details: Prisma.JsonValue | null;
  createdAt: Date;
}

interface LiveComment {
  cardId: string;
  boardId: string;
  cutoverAt: Date;
}

export interface CommentActivityContext {
  /** Live comment id → its own board/card and cutover fence. */
  live: Map<string, LiveComment>;
  revisions: Map<
    string,
    { id: string; commentId: string; beforeText: string; afterText: string }
  >;
}

/**
 * `comment_updated` is visible only while the comment and its whole parent
 * chain are live. The comment must also sit on the row's own card/board — a
 * legacy `details.commentId` that points elsewhere is not a valid link.
 */
export function commentActivityLiveSql(alias = "a"): Prisma.Sql {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error("commentActivityLiveSql: invalid table alias");
  }
  const a = Prisma.raw(alias);
  return Prisma.sql`(
    ${a}."type" <> 'comment_updated'
    OR EXISTS (
      SELECT 1
        FROM "Comment" c
        JOIN "Card" card ON card."id" = c."cardId"
        JOIN "Column" col ON col."id" = card."columnId"
        JOIN "Board" board ON board."id" = col."boardId"
      WHERE c."id" = COALESCE(${a}."commentId", ${a}."details"->>'commentId')
        AND c."deletedAt" IS NULL
        AND card."deletedAt" IS NULL
        AND col."deletedAt" IS NULL
        AND board."deletedAt" IS NULL
        AND c."cardId" = ${a}."cardId"
        AND col."boardId" = ${a}."boardId"
    )
  )`;
}

/** Load live comments and referenced revisions for one Activity page. */
export async function readCommentActivityContext(
  prisma: PrismaService,
  rows: readonly CommentActivityRow[],
): Promise<CommentActivityContext> {
  const commentIds = new Set<string>();
  const revisionIds = new Set<string>();
  for (const row of rows) {
    if (!isCommentActivity(row.type)) continue;
    const details = asRecord(row.details);
    const commentId = row.commentId ?? stringField(details, "commentId");
    if (commentId !== undefined) commentIds.add(commentId);
    const revisionId = stringField(details, "revisionId");
    if (revisionId !== undefined) revisionIds.add(revisionId);
  }
  const [live, revisions] = await Promise.all([
    commentIds.size === 0
      ? Promise.resolve([])
      : prisma.comment.findMany({
          where: {
            id: { in: [...commentIds] },
            deletedAt: null,
            card: {
              deletedAt: null,
              column: { deletedAt: null, board: { deletedAt: null } },
            },
          },
          select: {
            id: true,
            cardId: true,
            historyCutoverAt: true,
            card: { select: { column: { select: { boardId: true } } } },
          },
        }),
    revisionIds.size === 0
      ? Promise.resolve([])
      : prisma.commentRevision.findMany({
          where: { id: { in: [...revisionIds] } },
          select: {
            id: true,
            commentId: true,
            beforeText: true,
            afterText: true,
          },
        }),
  ]);
  return {
    live: new Map(
      live.map((row) => [
        row.id,
        {
          cardId: row.cardId,
          boardId: row.card.column.boardId,
          cutoverAt: row.historyCutoverAt,
        },
      ]),
    ),
    revisions: new Map(revisions.map((row) => [row.id, row])),
  };
}

/**
 * The only text-bearing projection for comment rows. A live comment must
 * match the activity row's board/card before its id or text is exposed;
 * otherwise the row degrades to localized metadata.
 */
export function readCommentActivityProjection(
  row: CommentActivityRow,
  context: CommentActivityContext,
): { commentId?: string; changes?: ActivityChange[] } {
  const details = asRecord(row.details);
  const commentId = row.commentId ?? stringField(details, "commentId");
  if (commentId === undefined) return {};
  const live = context.live.get(commentId);
  const scoped =
    live !== undefined &&
    row.cardId !== null &&
    live.cardId === row.cardId &&
    live.boardId === row.boardId;
  if (!scoped) return {};

  const text = stringField(details, "text");
  if (row.type === "comment_added") {
    return {
      commentId,
      ...(text !== undefined
        ? { changes: [{ field: "comment", from: null, to: text }] }
        : {}),
    };
  }
  if (row.type === "comment_deleted") {
    // Deleted comments have no live row, but keep the guard explicit.
    return { commentId };
  }

  const revisionId = stringField(details, "revisionId");
  if (revisionId !== undefined) {
    const revision = context.revisions.get(revisionId);
    if (revision !== undefined && revision.commentId === commentId) {
      return {
        commentId,
        changes: [
          {
            field: "comment",
            from: revision.beforeText,
            to: revision.afterText,
          },
        ],
      };
    }
  }
  // Legacy writer: the text was frozen before the cutover fence and no
  // revision exists. Expose it as a snapshot, never as a fabricated diff.
  if (
    text !== undefined &&
    row.createdAt.getTime() < live.cutoverAt.getTime()
  ) {
    return {
      commentId,
      changes: [{ field: "comment", from: null, to: text }],
    };
  }
  return { commentId };
}

/** Admin activity filters that can be expressed without Prisma relations. */
export interface ActivityVisibilityFilter {
  boardId?: string;
  cardId?: string;
  actorIds?: readonly string[];
  types?: readonly string[];
  columnId?: string;
  labelId?: string;
  search?: string;
  from?: Date;
  to?: Date;
}

/**
 * One ID page plus its exact total, with the liveness predicate applied
 * inside SQL before LIMIT/OFFSET and before COUNT. Admin callers then hydrate
 * only this page through Prisma.
 */
export async function visibleActivityIdPage(
  prisma: PrismaService,
  filter: ActivityVisibilityFilter,
  limit: number,
  offset: number,
): Promise<{ ids: string[]; total: number }> {
  const conditions: Prisma.Sql[] = [commentActivityLiveSql("a")];
  if (filter.boardId !== undefined) {
    conditions.push(Prisma.sql`a."boardId" = ${filter.boardId}`);
  }
  if (filter.cardId !== undefined) {
    conditions.push(Prisma.sql`a."cardId" = ${filter.cardId}`);
  }
  if (filter.actorIds !== undefined && filter.actorIds.length > 0) {
    conditions.push(
      Prisma.sql`a."actorId" IN (${Prisma.join([...filter.actorIds])})`,
    );
  }
  if (filter.types !== undefined && filter.types.length > 0) {
    conditions.push(
      Prisma.sql`a."type" IN (${Prisma.join([...filter.types])})`,
    );
  }
  if (filter.from !== undefined) {
    conditions.push(Prisma.sql`a."createdAt" >= ${filter.from}`);
  }
  if (filter.to !== undefined) {
    conditions.push(Prisma.sql`a."createdAt" <= ${filter.to}`);
  }
  if (filter.columnId !== undefined) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "Card" card
       WHERE card."id" = a."cardId" AND card."columnId" = ${filter.columnId}
    )`);
  }
  if (filter.labelId !== undefined) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "CardLabel" cl
       WHERE cl."cardId" = a."cardId" AND cl."labelId" = ${filter.labelId}
    )`);
  }
  if (filter.search !== undefined && filter.search !== "") {
    const matches = (value: Prisma.Sql): Prisma.Sql =>
      Prisma.sql`POSITION(LOWER(${filter.search}) IN LOWER(${value})) > 0`;
    conditions.push(Prisma.sql`(
      ${matches(Prisma.sql`a."id"`)}
      OR ${matches(Prisma.sql`a."type"`)}
      OR ${matches(Prisma.sql`a."boardId"`)}
      OR ${matches(Prisma.sql`a."cardId"`)}
      OR ${matches(Prisma.sql`a."actorId"`)}
      OR EXISTS (
        SELECT 1 FROM "User" u
         WHERE u."id" = a."actorId" AND ${matches(Prisma.sql`u."email"`)}
      )
      OR EXISTS (
        SELECT 1 FROM "Board" b
         WHERE b."id" = a."boardId" AND ${matches(Prisma.sql`b."title"`)}
      )
      OR EXISTS (
        SELECT 1 FROM "Card" c
         WHERE c."id" = a."cardId" AND ${matches(Prisma.sql`c."title"`)}
      )
    )`);
  }

  const where = Prisma.join(conditions, " AND ");
  const [rows, counted] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT a."id"
        FROM "Activity" a
       WHERE ${where}
       ORDER BY a."createdAt" DESC, a."id" DESC
       LIMIT ${limit} OFFSET ${offset}
    `),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS "count"
        FROM "Activity" a
       WHERE ${where}
    `),
  ]);
  return {
    ids: rows.map((row) => row.id),
    total: Number(counted[0]?.count ?? 0),
  };
}

function asRecord(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  record: Record<string, unknown> | null,
  field: string,
): string | undefined {
  const value = record?.[field];
  return typeof value === "string" ? value : undefined;
}
