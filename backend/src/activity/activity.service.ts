import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  ActivityChange,
  ActivityFeedEntry,
  ActivityFeedPage,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";

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
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** `GET /boards/:id/activity` — the whole board feed. */
  boardFeed(
    boardId: string,
    cursor?: string,
    limit?: string,
  ): Promise<ActivityFeedPage> {
    return this.feed(boardId, cursor, limit);
  }

  /** `GET /cards/:id/activity` — the card feed (full history, no 50 cap). */
  async cardFeed(
    cardId: string,
    cursor?: string,
    limit?: string,
  ): Promise<ActivityFeedPage> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { column: { select: { boardId: true } } },
    });
    if (!card) {
      return { items: [], nextCursor: null };
    }
    return this.feed(card.column.boardId, cursor, limit, cardId);
  }

  private async feed(
    boardId: string,
    cursorRaw: string | undefined,
    limitRaw: string | undefined,
    cardId?: string,
  ): Promise<ActivityFeedPage> {
    const limit = parseLimit(limitRaw);
    const cursor = cursorRaw ? parseCursor(cursorRaw) : null;
    const cardTouch = cardId ? `card:${cardId}` : undefined;

    const commandWhere: Prisma.CommandWhereInput = {
      boardId,
      ...(cardTouch ? { touches: { has: cardTouch } } : {}),
      ...commandOlderThan(cursor),
    };
    const activityWhere: Prisma.ActivityWhereInput = {
      boardId,
      ...(cardId ? { cardId } : {}),
      ...activityOlderThan(cursor),
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
          details: true,
        },
      }),
      this.prisma.activity.findMany({
        where: activityWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      }),
    ]);

    const merged = [
      ...commands.map(toCommandEntry),
      ...activities.map(toActivityEntry),
    ].sort(compareNewerFirst);

    const items = merged.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map((ranked) => ranked.entry),
      nextCursor: merged.length > limit && last ? encodeCursor(last) : null,
    };
  }
}

/** A feed entry plus the raw sort fields the cursor uses. */
interface RankedEntry {
  entry: ActivityFeedEntry;
  at: number;
  source: "c" | "a";
  key: string;
  seq?: bigint;
}

function toCommandEntry(row: {
  id: string;
  seq: bigint;
  type: string;
  touches: string[];
  createdAt: Date;
  actorId: string;
  details: Prisma.JsonValue | null;
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

function toActivityEntry(row: {
  id: string;
  type: string;
  cardId: string | null;
  actorId: string;
  details: Prisma.JsonValue | null;
  createdAt: Date;
}): RankedEntry {
  const snapshot = readCommentSnapshot(row.type, row.details);
  const entry: ActivityFeedEntry = {
    source: "activity",
    id: row.id,
    at: row.createdAt.getTime(),
    type: row.type,
    actorId: row.actorId,
    ...(row.cardId ? { cardId: row.cardId } : {}),
    details: (row.details as Record<string, unknown> | null) ?? null,
    ...(snapshot.detail !== undefined ? { detail: snapshot.detail } : {}),
    ...(snapshot.changes !== undefined ? { changes: snapshot.changes } : {}),
  };
  return { entry, at: entry.at, source: "a", key: row.id };
}

/**
 * Comment rows carry their text in `Activity.details`, frozen at write
 * time (TASK-37) — the feed turns it into the same Jira-style diff the
 * command log renders: added is `null → text`, deleted is `text → null`,
 * and `detail` keeps the comment id the SSE frames reference. The column
 * is free JSON (legacy rows may lack the text), so the shape is validated
 * here — a malformed row degrades to a sentence-only entry, never a 500.
 */
function readCommentSnapshot(
  type: string,
  value: Prisma.JsonValue | null,
): { detail?: string; changes?: ActivityChange[] } {
  if (type !== "comment_added" && type !== "comment_deleted") return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const commentId =
    typeof record.commentId === "string" ? record.commentId : undefined;
  const text = typeof record.text === "string" ? record.text : undefined;
  const changes =
    text === undefined
      ? undefined
      : [
          type === "comment_added"
            ? { field: "comment", from: null, to: text }
            : { field: "comment", from: text, to: null },
        ];
  return {
    ...(commentId !== undefined ? { detail: commentId } : {}),
    ...(changes !== undefined ? { changes } : {}),
  };
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

/** Rows strictly older than the cursor: activities half of the tie-break. */
function activityOlderThan(cursor: Cursor | null): Prisma.ActivityWhereInput {
  if (!cursor) return {};
  if (cursor.source === "a") {
    return {
      OR: [
        { createdAt: { lt: new Date(cursor.at) } },
        { createdAt: new Date(cursor.at), id: { lt: cursor.key } },
      ],
    };
  }
  return { createdAt: { lte: new Date(cursor.at) } };
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
