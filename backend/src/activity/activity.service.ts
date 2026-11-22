import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ActivityChange,
  ActivityFeedEntry,
  ActivityFeedPage,
  ActorType,
} from "@janosik/shared";
import { attributionFields } from "@/auth/request-attribution";
import { PrismaService } from "@/common/prisma/prisma.service";

/** A stored actor type, defaulting to "human" for legacy/garbage rows. */
function toActorType(value: string): ActorType {
  return value === "agent" || value === "admin" ? value : "human";
}

/** Default page size of an activity feed (`?limit=`). */
const DEFAULT_LIMIT = 50;
/** Upper bound for `?limit=` — a page is a page, not an export. */
const MAX_LIMIT = 100;

/** ECMAScript's Date range (ms). */
const MAX_DATE_MS = 8.64e15;
/** PostgreSQL `bigint` upper bound (the `Command.seq` column). */
const MAX_SEQ = "9223372036854775807";

/**
 * Activity feeds (§7.4, TASK-28).
 *
 * A feed merges two sources by time: the `Command` log (everything that is a
 * `BoardAction`, filtered by `touches` for card feeds) and `Activity` rows
 * (membership changes and comments — what an action cannot express). Pages
 * are newest-first with an opaque composite cursor; the tie-break orders a
 * command before an activity at the same millisecond and then by `seq` /
 * `id` descending, so pagination never repeats or skips an entry.
 */
/** Optional TASK-166 audit filters shared by both feeds. */
export interface ActivityFilters {
  actorType?: string;
  apiTokenId?: string;
  agentSessionId?: string;
  runId?: string;
  type?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** `GET /boards/:id/activity` — the whole board feed. */
  boardFeed(
    boardId: string,
    cursor?: string,
    limit?: string,
    filters: ActivityFilters = {},
  ): Promise<ActivityFeedPage> {
    return this.feed(boardId, cursor, limit, undefined, filters);
  }

  /** `GET /cards/:id/activity` — the card feed (full history, no 50 cap). */
  async cardFeed(
    cardId: string,
    cursor?: string,
    limit?: string,
    filters: ActivityFilters = {},
  ): Promise<ActivityFeedPage> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { column: { select: { boardId: true } } },
    });
    if (!card) {
      return { items: [], nextCursor: null };
    }
    return this.feed(card.column.boardId, cursor, limit, cardId, filters);
  }

  private async feed(
    boardId: string,
    cursorRaw: string | undefined,
    limitRaw: string | undefined,
    cardId?: string,
    filters: ActivityFilters = {},
  ): Promise<ActivityFeedPage> {
    const limit = parseLimit(limitRaw);
    const cursor = cursorRaw ? parseCursor(cursorRaw) : null;
    const cardTouch = cardId ? `card:${cardId}` : undefined;
    const createdAt =
      filters.from !== undefined || filters.to !== undefined
        ? {
            ...(filters.from !== undefined ? { gte: filters.from } : {}),
            ...(filters.to !== undefined ? { lte: filters.to } : {}),
          }
        : undefined;

    const commandWhere: Prisma.CommandWhereInput = {
      boardId,
      // A no-op command changed nothing (it wrote no `touches`), so it is not
      // something that "happened" and never enters a feed. The card feed
      // already excludes it through the `has` filter; the board feed filters
      // it here, so the Watch view never shows a diff-less line.
      ...(cardTouch
        ? { touches: { has: cardTouch } }
        : { touches: { isEmpty: false } }),
      ...(createdAt ? { createdAt } : {}),
      ...(filters.actorType !== undefined
        ? { actorType: filters.actorType }
        : {}),
      ...(filters.apiTokenId !== undefined
        ? { apiTokenId: filters.apiTokenId }
        : {}),
      ...(filters.agentSessionId !== undefined
        ? { agentSessionId: filters.agentSessionId }
        : {}),
      ...(filters.runId !== undefined ? { runId: filters.runId } : {}),
      ...(filters.type !== undefined ? { type: filters.type } : {}),
      ...commandOlderThan(cursor),
    };
    const [commands, activities] = await Promise.all([
      this.prisma.command.findMany({
        where: commandWhere,
        orderBy: [{ createdAt: "desc" }, { seq: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          seq: true,
          type: true,
          touches: true,
          createdAt: true,
          actorId: true,
          actorType: true,
          apiTokenId: true,
          agentSessionId: true,
          runId: true,
          agentName: true,
          details: true,
          actor: { select: { displayName: true, email: true } },
        },
      }),
      // TASK-185.2: a `comment_updated` row is visible only while its comment
      // and the whole parent chain are live. The EXISTS runs in the database
      // before LIMIT/cursor, so a tombstone/restored edit cannot shift a page
      // or leave a hole. `comment_added`/`comment_deleted` stay as tombstones
      // with metadata even after a hard purge.
      this.findActivityRows(boardId, cardId, filters, createdAt, cursor, limit),
    ]);

    const commentContext = await this.readCommentContext(activities);
    const merged = [
      ...commands.map(toCommandEntry),
      ...activities.map((row) => toActivityEntry(row, commentContext)),
    ].sort(compareNewerFirst);

    const items = merged.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map((ranked) => ranked.entry),
      nextCursor: merged.length > limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * The Activity half of a feed, read through raw SQL because the
   * `comment_updated` liveness predicate has no Prisma relation: `Activity`
   * deliberately carries no FK to a comment (a tombstone must outlive a hard
   * purge). Every other filter mirrors the old `ActivityWhereInput`.
   */
  private findActivityRows(
    boardId: string,
    cardId: string | undefined,
    filters: ActivityFilters,
    createdAt: { gte?: Date; lte?: Date } | undefined,
    cursor: Cursor | null,
    limit: number,
  ): Promise<ActivityRow[]> {
    const conditions: Prisma.Sql[] = [Prisma.sql`a."boardId" = ${boardId}`];
    if (cardId) conditions.push(Prisma.sql`a."cardId" = ${cardId}`);
    if (createdAt?.gte) {
      conditions.push(Prisma.sql`a."createdAt" >= ${createdAt.gte}`);
    }
    if (createdAt?.lte) {
      conditions.push(Prisma.sql`a."createdAt" <= ${createdAt.lte}`);
    }
    if (filters.actorType !== undefined) {
      conditions.push(Prisma.sql`a."actorType" = ${filters.actorType}`);
    }
    if (filters.apiTokenId !== undefined) {
      conditions.push(Prisma.sql`a."apiTokenId" = ${filters.apiTokenId}`);
    }
    if (filters.agentSessionId !== undefined) {
      conditions.push(
        Prisma.sql`a."agentSessionId" = ${filters.agentSessionId}`,
      );
    }
    if (filters.runId !== undefined) {
      conditions.push(Prisma.sql`a."runId" = ${filters.runId}`);
    }
    if (filters.type !== undefined) {
      conditions.push(Prisma.sql`a."type" = ${filters.type}`);
    }
    if (cursor !== null) {
      const at = new Date(cursor.at);
      conditions.push(
        cursor.source === "a"
          ? Prisma.sql`(a."createdAt" < ${at} OR (a."createdAt" = ${at} AND a."id" < ${cursor.key}))`
          : Prisma.sql`a."createdAt" <= ${at}`,
      );
    }
    conditions.push(Prisma.sql`(
      a."type" <> 'comment_updated'
      OR EXISTS (
        SELECT 1
          FROM "Comment" c
          JOIN "Card" card ON card."id" = c."cardId"
          JOIN "Column" col ON col."id" = card."columnId"
          JOIN "Board" board ON board."id" = col."boardId"
        WHERE c."id" = COALESCE(a."commentId", a."details"->>'commentId')
          AND c."deletedAt" IS NULL
          AND card."deletedAt" IS NULL
          AND col."deletedAt" IS NULL
          AND board."deletedAt" IS NULL
          AND col."boardId" = a."boardId"
          AND (a."cardId" IS NULL OR c."cardId" = a."cardId")
      )
    )`);

    return this.prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
      SELECT a."id", a."boardId", a."cardId", a."type", a."commentId",
             a."actorId", a."actorType", a."apiTokenId", a."agentSessionId",
             a."runId", a."agentName", a."details", a."createdAt",
             u."displayName" AS "actorDisplayName",
             u."email" AS "actorEmail"
        FROM "Activity" a
        LEFT JOIN "User" u ON u."id" = a."actorId"
       WHERE ${Prisma.join(conditions, " AND ")}
       ORDER BY a."createdAt" DESC, a."id" DESC
       LIMIT ${limit + 1}
    `);
  }

  /**
   * Per-page comment facts used by the read projection: which comments are
   * live (and their cutover fence) plus the revisions referenced by
   * `comment_updated` rows. A revision is trusted only when it exists and
   * belongs to the same comment; otherwise the row keeps the sentence-only
   * shape and never leaks the text stored in `details`.
   */
  private async readCommentContext(
    rows: ActivityRow[],
  ): Promise<CommentFeedContext> {
    const commentIds = new Set<string>();
    const revisionIds = new Set<string>();
    for (const row of rows) {
      if (!COMMENT_ACTIVITY_TYPES.has(row.type)) continue;
      const details = asRecord(row.details);
      const commentId = row.commentId ?? stringField(details, "commentId");
      if (commentId !== undefined) commentIds.add(commentId);
      const revisionId = stringField(details, "revisionId");
      if (revisionId !== undefined) revisionIds.add(revisionId);
    }
    const [live, revisions] = await Promise.all([
      commentIds.size === 0
        ? Promise.resolve([])
        : this.prisma.comment.findMany({
            where: {
              id: { in: [...commentIds] },
              deletedAt: null,
              card: {
                deletedAt: null,
                column: { deletedAt: null, board: { deletedAt: null } },
              },
            },
            select: { id: true, historyCutoverAt: true },
          }),
      revisionIds.size === 0
        ? Promise.resolve([])
        : this.prisma.commentRevision.findMany({
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
      live: new Map(live.map((row) => [row.id, row.historyCutoverAt])),
      revisions: new Map(revisions.map((row) => [row.id, row])),
    };
  }
}

/** One raw Activity row plus the actor join. */
interface ActivityRow {
  id: string;
  boardId: string;
  cardId: string | null;
  type: string;
  commentId: string | null;
  actorId: string;
  actorType: string;
  apiTokenId: string | null;
  agentSessionId: string | null;
  runId: string | null;
  agentName: string | null;
  details: Prisma.JsonValue | null;
  createdAt: Date;
  actorDisplayName: string | null;
  actorEmail: string | null;
}

interface CommentFeedContext {
  /** Live comment id → its cutover fence. */
  live: Map<string, Date>;
  revisions: Map<
    string,
    { id: string; commentId: string; beforeText: string; afterText: string }
  >;
}

const COMMENT_ACTIVITY_TYPES = new Set([
  "comment_added",
  "comment_updated",
  "comment_deleted",
]);

/** A feed entry plus the raw sort fields the cursor uses. */
interface RankedEntry {
  entry: ActivityFeedEntry;
  at: number;
  source: "c" | "a";
  key: string;
  seq?: bigint;
}

interface ActorIdentity {
  displayName: string | null;
  email: string;
}

/**
 * Display identity for an actor (TASK-177.2). The join normally answers, but
 * a membership change also froze the email in `details`, so a `member_left`
 * row still renders after the roster no longer contains that person.
 */
function actorFields(
  actor: ActorIdentity | null | undefined,
  details: Prisma.JsonValue | null,
  includeDetailsEmail: boolean,
): { actorName?: string; actorEmail?: string } {
  const detailsRecord =
    includeDetailsEmail &&
    details !== null &&
    typeof details === "object" &&
    !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : null;
  const detailEmail =
    detailsRecord !== null && typeof detailsRecord.email === "string"
      ? detailsRecord.email
      : undefined;
  const email = actor?.email ?? detailEmail;
  return {
    ...(actor?.displayName ? { actorName: actor.displayName } : {}),
    ...(email !== undefined ? { actorEmail: email } : {}),
  };
}

function toCommandEntry(row: {
  id: string;
  seq: bigint;
  type: string;
  touches: string[];
  createdAt: Date;
  actorId: string;
  actorType: string;
  apiTokenId: string | null;
  agentSessionId: string | null;
  runId: string | null;
  agentName: string | null;
  details: Prisma.JsonValue | null;
  actor: ActorIdentity | null;
}): RankedEntry {
  const cardTouches = row.touches.filter((label) => label.startsWith("card:"));
  const snapshot = readCommandSnapshot(row.details);
  const entry: ActivityFeedEntry = {
    source: "command",
    id: row.id,
    seq: Number(row.seq),
    at: row.createdAt.getTime(),
    type: row.type,
    actorId: row.actorId,
    ...actorFields(row.actor, null, false),
    actorType: toActorType(row.actorType),
    ...attributionFields(row),
    // Only a command that touched a single card is card-attributed: a
    // DELETE_COLUMN touches many cards and belongs to the board.
    ...(cardTouches.length === 1 ? { cardId: cardTouches[0].slice(5) } : {}),
    ...(snapshot.detail !== undefined ? { detail: snapshot.detail } : {}),
    ...(snapshot.changes !== undefined ? { changes: snapshot.changes } : {}),
  };
  return {
    entry,
    at: entry.at,
    source: "c",
    key: String(row.seq),
    seq: row.seq,
  };
}

/**
 * Read the TASK-37 display snapshot off a command row. The column is free
 * JSON (older rows are null, hand-written rows may be anything), so the
 * shape is validated here instead of trusted — a malformed row degrades to
 * a plain type-only history entry, never to a 500.
 */
function readCommandSnapshot(value: Prisma.JsonValue | null): {
  detail?: string;
  changes?: ActivityChange[];
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const detail = typeof record.detail === "string" ? record.detail : undefined;
  const changes = Array.isArray(record.changes)
    ? record.changes.flatMap((change): ActivityChange[] => {
        if (change === null || typeof change !== "object") return [];
        const c = change as Record<string, unknown>;
        if (typeof c.field !== "string") return [];
        const from =
          c.from === null || typeof c.from === "string" ? c.from : null;
        const to = c.to === null || typeof c.to === "string" ? c.to : null;
        return [{ field: c.field, from, to }];
      })
    : undefined;
  return {
    ...(detail !== undefined ? { detail } : {}),
    ...(changes !== undefined && changes.length > 0 ? { changes } : {}),
  };
}

function toActivityEntry(
  row: ActivityRow,
  context: CommentFeedContext,
): RankedEntry {
  const isComment = COMMENT_ACTIVITY_TYPES.has(row.type);
  const commentId = isComment
    ? (row.commentId ?? stringField(asRecord(row.details), "commentId"))
    : undefined;
  const snapshot = isComment
    ? readCommentChanges(row, context)
    : readActivitySnapshot(row.type, row.details);
  const entry: ActivityFeedEntry = {
    source: "activity",
    id: row.id,
    at: row.createdAt.getTime(),
    type: row.type,
    actorId: row.actorId,
    // Only `member_left` freezes the *actor's* email in `details`; other
    // membership rows store the target's email, which must not be mistaken
    // for the admin who performed the change.
    ...actorFields(
      {
        displayName: row.actorDisplayName,
        email: row.actorEmail ?? "",
      },
      row.type === "member_left" ? row.details : null,
      true,
    ),
    actorType: toActorType(row.actorType),
    ...attributionFields(row),
    ...(row.cardId ? { cardId: row.cardId } : {}),
    ...(commentId !== undefined ? { commentId } : {}),
    // TASK-185.2: comment rows never expose the raw JSON snapshot (deleted
    // text, legacy ids, revision internals). `changes` below is the only
    // text-bearing projection, and only under its read rules.
    ...(isComment
      ? {}
      : {
          details: (row.details as Record<string, unknown> | null) ?? null,
        }),
    ...(snapshot.detail !== undefined ? { detail: snapshot.detail } : {}),
    ...(snapshot.changes !== undefined ? { changes: snapshot.changes } : {}),
  };
  return { entry, at: entry.at, source: "a", key: row.id };
}

/**
 * TASK-185.2 — the only place a comment body may reach the feed.
 *
 * - `comment_added`: show the frozen snapshot (`null → text`) only while the
 *   comment and its parent chain are live. After deletion it is a tombstone
 *   with metadata.
 * - `comment_deleted`: never text — deletion is a tombstone.
 * - `comment_updated`: a `before → after` diff only when `details.revisionId`
 *   resolves to an existing revision of the same comment. A pre-cutover
 *   legacy row may instead show its `details.text` as a one-sided snapshot.
 *   A post-cutover row without that confirmed link (a gap, a foreign revision
 *   or a malformed snapshot) degrades to the localized sentence; `detail`
 *   (the raw comment id) is never emitted for a comment row, so Watch cannot
 *   fall back to it.
 */
function readCommentChanges(
  row: ActivityRow,
  context: CommentFeedContext,
): { detail?: string; changes?: ActivityChange[] } {
  const details = asRecord(row.details);
  const commentId = row.commentId ?? stringField(details, "commentId");
  if (commentId === undefined) return {};
  const liveCutover = context.live.get(commentId);
  const text = stringField(details, "text");

  if (row.type === "comment_added") {
    return liveCutover !== undefined && text !== undefined
      ? { changes: [{ field: "comment", from: null, to: text }] }
      : {};
  }
  if (row.type === "comment_deleted") {
    return {};
  }

  const revisionId = stringField(details, "revisionId");
  if (
    revisionId !== undefined &&
    commentId !== undefined &&
    liveCutover !== undefined
  ) {
    const revision = context.revisions.get(revisionId);
    if (revision !== undefined && revision.commentId === commentId) {
      return {
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
    liveCutover !== undefined &&
    text !== undefined &&
    row.createdAt.getTime() < liveCutover.getTime()
  ) {
    return { changes: [{ field: "comment", from: null, to: text }] };
  }
  return {};
}

/** A JSON object guard for free-form `Activity.details`. */
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

/**
 * Comment or membership: whichever the row's type matches. Comment text is
 * handled separately by `readCommentChanges` (TASK-185.2) so the raw snapshot
 * can never leak through this generic path.
 */
function readActivitySnapshot(
  type: string,
  value: Prisma.JsonValue | null,
): { detail?: string; changes?: ActivityChange[] } {
  const attachment =
    (type === "attachment_added" || type === "attachment_deleted") &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.fileName === "string"
      ? value.fileName
      : undefined;
  return {
    ...readMembershipSnapshot(type, value),
    ...(attachment !== undefined ? { detail: attachment } : {}),
  };
}

/**
 * Membership rows (invite / role / expiry / removal) carry a `details`
 * snapshot (email + role + from/to). Turn it into the same `detail`/`changes`
 * shape the comment rows use, so a membership change renders as a real diff in
 * the Watch feed instead of a bare, diff-less "Changed" line (TASK-157 watch
 * check). A malformed row degrades to a sentence-only entry, never a 500.
 */
function readMembershipSnapshot(
  type: string,
  value: Prisma.JsonValue | null,
): { detail?: string; changes?: ActivityChange[] } {
  if (
    type !== "member_invited" &&
    type !== "member_role_changed" &&
    type !== "member_expiry_changed" &&
    type !== "member_removed" &&
    type !== "member_left"
  ) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email : undefined;
  const detail = email !== undefined ? { detail: email } : {};
  if (type === "member_role_changed" || type === "member_expiry_changed") {
    const from = typeof record.from === "string" ? record.from : null;
    const to = typeof record.to === "string" ? record.to : null;
    return {
      ...detail,
      changes: [
        {
          field: type === "member_role_changed" ? "role" : "expiresAt",
          from,
          to,
        },
      ],
    };
  }
  return detail;
}

/** Newest first: time desc, then commands before activities, then key desc. */
function compareNewerFirst(a: RankedEntry, b: RankedEntry): number {
  if (a.at !== b.at) return b.at - a.at;
  if (a.source !== b.source) return a.source === "c" ? -1 : 1;
  if (a.seq !== undefined && b.seq !== undefined) {
    return a.seq > b.seq ? -1 : a.seq < b.seq ? 1 : 0;
  }
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

/** Rows strictly older than the cursor: commands half of the tie-break. */
function commandOlderThan(cursor: Cursor | null): Prisma.CommandWhereInput {
  if (!cursor) return {};
  if (cursor.source === "c") {
    return {
      OR: [
        { createdAt: { lt: new Date(cursor.at) } },
        { createdAt: new Date(cursor.at), seq: { lt: BigInt(cursor.key) } },
      ],
    };
  }
  return { createdAt: { lt: new Date(cursor.at) } };
}

/** `at:source:key` — opaque to clients, never parsed by them. */
interface Cursor {
  at: number;
  source: "c" | "a";
  key: string;
}

function encodeCursor(ranked: RankedEntry): string {
  return `${ranked.at}:${ranked.source}:${ranked.key}`;
}

function parseCursor(raw: string): Cursor {
  const match = /^(\d+):([ca]):(.+)$/.exec(raw);
  if (!match) {
    throw new BadRequestException("cursor is malformed");
  }
  const at = Number(match[1]);
  if (!Number.isSafeInteger(at) || at < 0 || at > MAX_DATE_MS) {
    throw new BadRequestException("cursor is malformed");
  }
  const source = match[2] as "c" | "a";
  const key = match[3];
  // A command cursor's key is a `BigInt` seq — a non-numeric key must be a
  // 400 here, not a `BigInt()` SyntaxError (500) inside the query (TASK-153),
  // and a value past `bigint` range would be a database error (TASK-156).
  if (
    source === "c" &&
    (!/^\d+$/.test(key) ||
      key.length > MAX_SEQ.length ||
      (key.length === MAX_SEQ.length && key > MAX_SEQ))
  ) {
    throw new BadRequestException("cursor is malformed");
  }
  return { at, source, key };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException(`limit must be an integer 1…${MAX_LIMIT}`);
  }
  return limit;
}
