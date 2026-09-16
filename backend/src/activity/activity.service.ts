import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ActivityFeedEntry, ActivityFeedPage } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";

/** Default page size of an activity feed (`?limit=`). */
const DEFAULT_LIMIT = 50;
/** Upper bound for `?limit=` — a page is a page, not an export. */
const MAX_LIMIT = 100;

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
}): RankedEntry {
  const cardTouches = row.touches.filter((label) => label.startsWith("card:"));
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
  };
  return {
    entry,
    at: entry.at,
    source: "c",
    key: String(row.seq),
    seq: row.seq,
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
  const entry: ActivityFeedEntry = {
    source: "activity",
    id: row.id,
    at: row.createdAt.getTime(),
    type: row.type,
    actorId: row.actorId,
    ...(row.cardId ? { cardId: row.cardId } : {}),
    details: (row.details as Record<string, unknown> | null) ?? null,
  };
  return { entry, at: entry.at, source: "a", key: row.id };
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
  if (!Number.isSafeInteger(at)) {
    throw new BadRequestException("cursor is malformed");
  }
  return { at, source: match[2] as "c" | "a", key: match[3] };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException(`limit must be an integer 1…${MAX_LIMIT}`);
  }
  return limit;
}
