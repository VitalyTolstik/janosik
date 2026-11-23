import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Subscription } from "rxjs";
import {
  CARD_PRIORITIES,
  DEFAULT_CARD_PRIORITY,
  READY_WORK_LIMIT_DEFAULT,
  READY_WORK_LIMIT_MAX,
  READY_WORK_WAIT_MAX_MS,
  readBoardWorkflow,
  type BoardReadyDto,
  type BoardsReadyDto,
  type BoardSseEvent,
  type CardPriority,
  type ReadyBoardSummary,
  type ReadyCardDto,
} from "@janosik/shared";
import { activeMembershipWhere } from "@/common/membership";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RealtimeService } from "@/realtime/realtime.service";

/** A raw row of the per-board ready query. */
interface ReadyCardRow {
  id: string;
  title: string;
  priority: string | null;
  claimedBy: string | null;
  leaseUntil: Date | null;
  version: number;
  descriptionChars: number;
}

/** A raw row of the cross-board ready query. */
interface CrossBoardReadyCardRow extends ReadyCardRow {
  boardId: string;
  columnId: string;
  columnTitle: string;
}

/** Board + its live columns, in the order the UI/MCP treat them. */
interface ReadyBoardRow {
  id: string;
  title: string;
  archivedAt: Date | null;
  workflow: Prisma.JsonValue | null;
  columns: Array<{ id: string; title: string }>;
}

interface ReadyOptions {
  limit?: number;
  /** Server-side hold in ms; 0 answers the snapshot immediately. */
  wait?: number;
  /** The board `seq` the caller last observed. */
  since?: number;
  signal?: AbortSignal;
}

/**
 * Server-side ready/work discovery (TASK-200.2).
 *
 * The old MCP `wait_for_work` re-read every accessible board every few
 * seconds. This service answers the same question from one indexed card query
 * scoped to the board's first/work column, plus the board row and its command
 * sequence. Long-polling subscribes to the existing realtime bus and never
 * loads a board aggregate, so an idle agent costs a few small SELECTs per
 * minute instead of a full aggregate.
 *
 * The readiness rules mirror MCP's pre-existing `readyCards`:
 * - the initial column (`workflow.initialColumnId`, else the first column);
 * - unassigned, not archived/deleted;
 * - no live claim (a null/lapsed lease is free);
 * - not the target of a live `blocks` link from a live, unarchived card.
 */
@Injectable()
export class ReadyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * One board's ready snapshot, optionally held until a relevant command
   * arrives. Returns `undefined` only for a long-poll timeout/abort; the
   * controller turns that into `204 No Content`.
   */
  async getBoardReady(
    boardId: string,
    options: ReadyOptions = {},
  ): Promise<BoardReadyDto | undefined> {
    const limit = normalizeLimit(options.limit);
    const wait = normalizeWait(options.wait);
    const since = normalizeSince(options.since);

    // Subscribe before the first read: a command that commits between the
    // snapshot and the wait would otherwise be missed and the agent would
    // sleep through available work.
    let subscription: Subscription | undefined;
    let woke = false;
    let notify: (() => void) | undefined;
    const event = new Promise<void>((resolve) => {
      notify = resolve;
    });
    if (wait > 0) {
      subscription = this.realtime.watch(boardId).subscribe((frame) => {
        if (!isReadyFrame(frame)) return;
        woke = true;
        notify?.();
      });
    }

    try {
      let snapshot = await this.readSnapshot(boardId, limit);
      if (snapshot === null) throw new NotFoundException("Board not found");
      if (snapshot.archived || snapshot.cards.length > 0) return snapshot;
      // `since` is a change cursor: a caller whose last snapshot predates the
      // current seq gets an immediate (possibly empty) answer instead of
      // holding a request for a board that already changed.
      if (since !== undefined && since !== snapshot.seq) return snapshot;
      if (wait === 0) return snapshot;
      // An event arrived while the snapshot was loading; re-read rather than
      // waiting for the next one.
      if (woke) {
        snapshot = await this.readSnapshot(boardId, limit);
        return snapshot ?? undefined;
      }

      const outcome = await this.holdForEvent(wait, event, options.signal);
      if (outcome !== "event") return undefined;
      snapshot = await this.readSnapshot(boardId, limit);
      return snapshot ?? undefined;
    } finally {
      subscription?.unsubscribe();
    }
  }

  /**
   * Cross-board snapshot in constant-size SQL: one board+column read, one
   * indexed card query over just the selected columns, and one grouped seq
   * read. It never calls the aggregate loader and never issues a query per
   * board.
   */
  async listReadyForUser(
    userId: string,
    scopedBoardId: string | undefined,
    requestedLimit?: number,
  ): Promise<BoardsReadyDto> {
    const limit = normalizeLimit(requestedLimit);
    const boards = await this.prisma.board.findMany({
      where: {
        deletedAt: null,
        ...(scopedBoardId !== undefined ? { id: scopedBoardId } : {}),
        members: { some: { userId, ...activeMembershipWhere() } },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        archivedAt: true,
        workflow: true,
        columns: {
          where: { deletedAt: null },
          orderBy: { position: "asc" },
          select: { id: true, title: true },
        },
      },
    });

    const seqs = await this.boardSeqs(boards.map((board) => board.id));
    const summaries: ReadyBoardSummary[] = boards.map((board) => ({
      id: board.id,
      title: board.title,
      archived: board.archivedAt !== null,
      seq: seqs.get(board.id) ?? 0,
    }));
    const boardById = new Map(boards.map((board) => [board.id, board]));
    const selected = boards
      .filter((board) => board.archivedAt === null)
      .flatMap((board) => {
        const column = firstWorkColumn(board);
        return column === undefined ? [] : [{ board, column }];
      });

    if (selected.length === 0) {
      return { boards: summaries, limit, cards: [] };
    }

    const rows = await this.prisma.$queryRaw<CrossBoardReadyCardRow[]>(
      crossBoardReadySql(
        selected.map((entry) => entry.column.id),
        limit,
      ),
    );
    const cards = rows.flatMap((row) => {
      const board = boardById.get(row.boardId);
      if (board === undefined) return [];
      return [toReadyCard(row, board)];
    });
    return { boards: summaries, limit, cards };
  }

  /** One board row + its first/work column and a bounded indexed card query. */
  private async readSnapshot(
    boardId: string,
    limit: number,
  ): Promise<BoardReadyDto | null> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: {
        id: true,
        title: true,
        archivedAt: true,
        workflow: true,
        columns: {
          where: { deletedAt: null },
          orderBy: { position: "asc" },
          select: { id: true, title: true },
        },
      },
    });
    if (board === null) return null;
    const seq = (await this.boardSeqs([board.id])).get(board.id) ?? 0;
    if (board.archivedAt !== null) {
      return {
        boardId: board.id,
        boardTitle: board.title,
        archived: true,
        seq,
        limit,
        cards: [],
      };
    }
    const column = firstWorkColumn(board);
    if (column === undefined) {
      return {
        boardId: board.id,
        boardTitle: board.title,
        archived: false,
        seq,
        limit,
        cards: [],
      };
    }
    const rows = await this.prisma.$queryRaw<ReadyCardRow[]>(
      boardReadySql(column.id, limit),
    );
    return {
      boardId: board.id,
      boardTitle: board.title,
      archived: false,
      seq,
      limit,
      cards: rows.map((row) => toReadyCard(row, board, column)),
    };
  }

  /** Highest committed command seq per board, folded into one grouped read. */
  private async boardSeqs(boardIds: string[]): Promise<Map<string, number>> {
    if (boardIds.length === 0) return new Map();
    const rows = await this.prisma.command.groupBy({
      by: ["boardId"],
      where: { boardId: { in: boardIds } },
      _max: { seq: true },
    });
    return new Map(
      rows.map((row) => [
        row.boardId,
        row._max.seq === null ? 0 : Number(row._max.seq),
      ]),
    );
  }

  /**
   * Wait for a relevant realtime frame, the timeout, or a client abort.
   * Every path clears its timer/listener so a disconnected agent leaves no
   * hold behind.
   */
  private async holdForEvent(
    waitMs: number,
    event: Promise<void>,
    signal: AbortSignal | undefined,
  ): Promise<"event" | "timeout" | "aborted"> {
    if (signal?.aborted) return "aborted";
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), waitMs);
    });
    const aborted = new Promise<"aborted">((resolve) => {
      if (signal === undefined) return;
      onAbort = () => resolve("aborted");
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([
        event.then(() => "event" as const),
        timeout,
        aborted,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (signal !== undefined && onAbort !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }
}

/** Clamp `limit` to the shared contract; invalid input is a `400`. */
export function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return READY_WORK_LIMIT_DEFAULT;
  if (!Number.isInteger(value) || value < 1 || value > READY_WORK_LIMIT_MAX) {
    throw new BadRequestException(
      `limit must be an integer from 1 to ${READY_WORK_LIMIT_MAX}`,
    );
  }
  return value;
}

/** Clamp `wait` to `[0, READY_WORK_WAIT_MAX_MS]`; invalid input is a `400`. */
export function normalizeWait(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > READY_WORK_WAIT_MAX_MS) {
    throw new BadRequestException(
      `wait must be an integer from 0 to ${READY_WORK_WAIT_MAX_MS}`,
    );
  }
  return value;
}

/** `since` is a non-negative board sequence. */
export function normalizeSince(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException("since must be a non-negative integer");
  }
  return value;
}

/** Configured start column that still exists, else the board's first column. */
export function firstWorkColumn(
  board: Pick<ReadyBoardRow, "workflow" | "columns">,
): { id: string; title: string } | undefined {
  const configured = readBoardWorkflow(board.workflow)?.initialColumnId;
  if (configured !== undefined) {
    const found = board.columns.find((column) => column.id === configured);
    if (found !== undefined) return found;
  }
  return board.columns[0];
}

/**
 * A realtime frame can change the ready set only when it touched a card, a
 * column or the board itself (workflow/initial-column changes travel as
 * `board:`). Presence, comments, approvals and heartbeats must not wake a
 * long-poll; a resync frame is a "your view is stale" signal and does.
 */
export function isReadyFrame(frame: BoardSseEvent): boolean {
  if (frame.type === "resync") return true;
  if (frame.type !== "command") return false;
  return frame.touches.some(
    (touch) =>
      touch.startsWith("card:") ||
      touch.startsWith("column:") ||
      touch.startsWith("board:"),
  );
}

/** Priority order used by the SQL `CASE`; shared with the client convention. */
const PRIORITY_SQL = Prisma.sql`CASE c."priority"
  WHEN 'blocker' THEN 0
  WHEN 'highest' THEN 1
  WHEN 'high' THEN 2
  WHEN 'medium' THEN 3
  WHEN 'low' THEN 4
  WHEN 'lowest' THEN 5
  ELSE 3
END`;

/** Source-card liveness guard used by the blocked-card NOT EXISTS. */
const BLOCKED_SQL = Prisma.sql`NOT EXISTS (
  SELECT 1
  FROM "CardLink" link
  JOIN "Card" source ON source."id" = link."fromCardId"
  WHERE link."toCardId" = c."id"
    AND link."type" = 'blocks'
    AND link."deletedAt" IS NULL
    AND source."deletedAt" IS NULL
    AND source."archivedAt" IS NULL
)`;

/** The indexed card query for one selected first/work column. */
function boardReadySql(columnId: string, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT
      c."id",
      c."title",
      c."priority",
      c."claimedBy",
      c."leaseUntil",
      c."version",
      COALESCE(length(c."description"), 0)::int AS "descriptionChars"
    FROM "Card" c
    WHERE c."columnId" = ${columnId}
      AND c."deletedAt" IS NULL
      AND c."archivedAt" IS NULL
      AND c."assigneeId" IS NULL
      AND (
        c."claimedBy" IS NULL
        OR c."leaseUntil" IS NULL
        OR c."leaseUntil" <= ${new Date()}
      )
      AND ${BLOCKED_SQL}
    ORDER BY ${PRIORITY_SQL}, c."position" ASC, c."id" ASC
    LIMIT ${limit}
  `;
}

/**
 * The cross-board variant. It selects only the prepared first/work columns of
 * accessible, non-archived boards and applies one bounded LIMIT, so the cost
 * is one indexed read rather than one read per board.
 */
function crossBoardReadySql(columnIds: string[], limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT
      c."id",
      c."title",
      c."priority",
      c."claimedBy",
      c."leaseUntil",
      c."version",
      COALESCE(length(c."description"), 0)::int AS "descriptionChars",
      col."id" AS "columnId",
      col."title" AS "columnTitle",
      col."boardId" AS "boardId"
    FROM "Card" c
    JOIN "Column" col ON col."id" = c."columnId"
    WHERE c."columnId" IN (${Prisma.join(columnIds)})
      AND c."deletedAt" IS NULL
      AND c."archivedAt" IS NULL
      AND c."assigneeId" IS NULL
      AND (
        c."claimedBy" IS NULL
        OR c."leaseUntil" IS NULL
        OR c."leaseUntil" <= ${new Date()}
      )
      AND ${BLOCKED_SQL}
    ORDER BY ${PRIORITY_SQL}, col."boardId" ASC, c."position" ASC, c."id" ASC
    LIMIT ${limit}
  `;
}

/** Map a raw row plus its board/column context into the wire DTO. */
function toReadyCard(
  row: ReadyCardRow,
  board: Pick<ReadyBoardRow, "id" | "title">,
  column?: { id: string; title: string },
): ReadyCardDto {
  const cardColumn = column ?? {
    id: (row as CrossBoardReadyCardRow).columnId,
    title: (row as CrossBoardReadyCardRow).columnTitle,
  };
  return {
    id: row.id,
    title: row.title,
    boardId: board.id,
    boardTitle: board.title,
    columnId: cardColumn.id,
    columnTitle: cardColumn.title,
    priority: normalizePriority(row.priority),
    claimedBy: row.claimedBy,
    leaseUntil: row.leaseUntil === null ? null : row.leaseUntil.getTime(),
    version: row.version,
    descriptionChars: row.descriptionChars,
  };
}

/** Stored priority values are untrusted; unknown values display as medium. */
function normalizePriority(value: string | null): CardPriority {
  if (
    value !== null &&
    (CARD_PRIORITIES as readonly string[]).includes(value)
  ) {
    return value as CardPriority;
  }
  return DEFAULT_CARD_PRIORITY;
}
