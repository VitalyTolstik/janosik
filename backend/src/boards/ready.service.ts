import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
  /** Caller id for the held-poll admission cap. */
  userId: string;
  limit?: number;
  /** Server-side hold in ms; 0 answers the snapshot immediately. */
  wait?: number;
  /** The board `seq` the caller last observed. */
  since?: number;
  signal?: AbortSignal;
}

/** Outcome of one ready request; a timed hold is not an empty `200`. */
export type BoardReadyPollResult =
  | { status: "ready"; body: BoardReadyDto }
  | { status: "timeout"; seq: number }
  | { status: "aborted" };

/** Held long-polls admitted per user before a `503` (per process). */
export const READY_POLL_MAX_PER_USER = 1_000;
/** Held long-polls admitted per board before a `503` (per process). */
export const READY_POLL_MAX_PER_BOARD = 2_000;

/** How long one shared post-wake snapshot is reused by co-waiters. */
const SHARED_SNAPSHOT_TTL_MS = 1_000;
/** Bound the per-instance shared snapshot map even under command churn. */
const SHARED_SNAPSHOT_MAX = 1_024;

/**
 * In-process admission for held ready/work requests (TASK-200.2 review).
 * The server may hold a request for up to a minute, so an unbounded number of
 * hold sockets is a resource of its own. Counts are per instance and released
 * in a `finally`, including aborted clients.
 */
@Injectable()
export class ReadyPollAdmission {
  private readonly perUser = new Map<string, number>();
  private readonly perBoard = new Map<string, number>();

  constructor(
    private readonly maxPerUser = READY_POLL_MAX_PER_USER,
    private readonly maxPerBoard = READY_POLL_MAX_PER_BOARD,
  ) {}

  /** Reserve one held poll, or `null` when a cap is reached. */
  acquire(userId: string, boardId: string): (() => void) | null {
    const user = this.perUser.get(userId) ?? 0;
    const board = this.perBoard.get(boardId) ?? 0;
    if (user >= this.maxPerUser || board >= this.maxPerBoard) return null;
    this.perUser.set(userId, user + 1);
    this.perBoard.set(boardId, board + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      decrement(this.perUser, userId);
      decrement(this.perBoard, boardId);
    };
  }

  /** Live held polls on this instance. */
  active(): number {
    let total = 0;
    for (const count of this.perBoard.values()) total += count;
    return total;
  }

  activeForUser(userId: string): number {
    return this.perUser.get(userId) ?? 0;
  }

  activeForBoard(boardId: string): number {
    return this.perBoard.get(boardId) ?? 0;
  }
}

function decrement(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 1) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
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
 *
 * A hold wakes only on an action that can change readiness (not every command
 * — every command carries `board:<id>` in `touches`). After a wake it
 * re-reads; an empty result keeps holding until the deadline, and co-waiters
 * for the same board/event share one snapshot read.
 */
@Injectable()
export class ReadyService {
  private readonly sharedSnapshots = new Map<
    string,
    { promise: Promise<BoardReadyDto | null>; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly polls: ReadyPollAdmission,
  ) {}

  /**
   * One board's ready snapshot, optionally held until work appears or the
   * caller's deadline passes. `timeout` carries the latest board seq for the
   * `204` headers; `aborted` means the client went away and no response is
   * written.
   */
  async getBoardReady(
    boardId: string,
    options: ReadyOptions,
  ): Promise<BoardReadyPollResult> {
    const limit = normalizeLimit(options.limit);
    const wait = normalizeWait(options.wait);
    const since = normalizeSince(options.since);

    // Subscribe before the first read: a command that commits between the
    // snapshot and the wait would otherwise be missed and the agent would
    // sleep through available work.
    let subscription: Subscription | undefined;
    let queuedWake: string | undefined;
    let wakeWaiter: (() => void) | undefined;
    if (wait > 0) {
      subscription = this.realtime.watch(boardId).subscribe((frame) => {
        if (!isReadyFrame(frame)) return;
        queuedWake = wakeKeyOf(frame);
        const notify = wakeWaiter;
        wakeWaiter = undefined;
        notify?.();
      });
    }

    try {
      let snapshot = await this.readSnapshot(boardId, limit);
      if (snapshot === null) throw new NotFoundException("Board not found");
      if (snapshot.archived || snapshot.cards.length > 0) {
        return { status: "ready", body: snapshot };
      }
      // `since` is a change cursor: a caller whose last snapshot predates the
      // current seq gets an immediate (possibly empty) answer instead of
      // holding a request for a board that already changed.
      if (since !== undefined && since !== snapshot.seq) {
        return { status: "ready", body: snapshot };
      }
      if (wait === 0) return { status: "ready", body: snapshot };

      const release = this.polls.acquire(options.userId, boardId);
      if (release === null) {
        throw new ServiceUnavailableException({
          message: "Too many held ready polls; retry shortly",
          code: "ready_poll_capacity",
          retryable: true,
        });
      }
      try {
        const deadline = Date.now() + wait;
        let latestSeq = snapshot.seq;
        for (;;) {
          let wakeKey = queuedWake;
          queuedWake = undefined;
          if (wakeKey === undefined) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
              return await this.timeoutResult(boardId, latestSeq);
            }
            const event = new Promise<void>((resolve) => {
              wakeWaiter = resolve;
            });
            const outcome = await this.holdForEvent(
              remaining,
              event,
              options.signal,
            );
            wakeWaiter = undefined;
            if (outcome === "aborted") return { status: "aborted" };
            if (outcome === "timeout") {
              return await this.timeoutResult(boardId, latestSeq);
            }
            wakeKey = queuedWake;
            queuedWake = undefined;
            if (wakeKey === undefined) continue;
          }

          snapshot = await this.readSnapshotShared(boardId, limit, wakeKey);
          if (snapshot === null) throw new NotFoundException("Board not found");
          latestSeq = snapshot.seq;
          if (snapshot.archived || snapshot.cards.length > 0) {
            return { status: "ready", body: snapshot };
          }
          // The relevant change did not make work available: keep holding
          // instead of returning an empty snapshot and causing a re-poll.
        }
      } finally {
        release();
      }
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

  /**
   * Post-wake read shared by every waiter that woke on the same event. The
   * key is the command seq (or a per-frame resync id), so a burst of 500
   * waiters performs one snapshot query for the board instead of 500.
   */
  private readSnapshotShared(
    boardId: string,
    limit: number,
    wakeKey: string,
  ): Promise<BoardReadyDto | null> {
    const key = `${boardId}|${wakeKey}`;
    const now = Date.now();
    this.pruneSharedSnapshots(now);
    let entry = this.sharedSnapshots.get(key);
    if (entry === undefined) {
      const promise = this.readSnapshot(boardId, READY_WORK_LIMIT_MAX);
      entry = { promise, expiresAt: now + SHARED_SNAPSHOT_TTL_MS };
      this.sharedSnapshots.set(key, entry);
      void promise.catch(() => {
        if (this.sharedSnapshots.get(key) === entry) {
          this.sharedSnapshots.delete(key);
        }
      });
    }
    return entry.promise.then((snapshot) =>
      snapshot === null ? null : withLimit(snapshot, limit),
    );
  }

  private pruneSharedSnapshots(now: number): void {
    for (const [key, entry] of this.sharedSnapshots) {
      if (entry.expiresAt <= now) this.sharedSnapshots.delete(key);
    }
    if (this.sharedSnapshots.size <= SHARED_SNAPSHOT_MAX) return;
    const overflow = this.sharedSnapshots.size - SHARED_SNAPSHOT_MAX;
    let removed = 0;
    for (const key of this.sharedSnapshots.keys()) {
      this.sharedSnapshots.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }

  /**
   * A hold that expires still reports the latest seq for `X-Board-Seq`, but a
   * board deleted during the hold answers `404`, never `204`.
   */
  private async timeoutResult(
    boardId: string,
    knownSeq: number,
  ): Promise<BoardReadyPollResult> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true },
    });
    if (board === null) throw new NotFoundException("Board not found");
    const seq = (await this.boardSeqs([boardId])).get(boardId) ?? knownSeq;
    return { status: "timeout", seq };
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

  /** Live held polls for tests and an optional ops surface. */
  activePolls(): number {
    return this.polls.active();
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
 * Actions that can change the ready set. `touches` is deliberately ignored:
 * every command prepends `board:<id>`, and label/checklist/rename commands
 * also touch a card or the board without changing readiness.
 */
const READY_WAKE_ACTIONS: ReadonlySet<string> = new Set([
  // Cards: presence, column/position, priority, assignee, claim and links.
  "ADD_CARD",
  "UPDATE_CARD",
  "MOVE_CARD",
  "DELETE_CARD",
  "ARCHIVE_CARD",
  "UNARCHIVE_CARD",
  "DUPLICATE_CARD",
  "RESTORE_CARD",
  "ARCHIVE_COLUMN_CARDS",
  "RESTORE_COLUMN_CARDS",
  "SET_CARD_PRIORITY",
  "SET_CARD_ASSIGN",
  "CLAIM_CARD",
  "ADD_CARD_LINK",
  "REMOVE_CARD_LINK",
  // Column structure, order and workflow selection.
  "ADD_COLUMN",
  "RENAME_COLUMN",
  "DELETE_COLUMN",
  "MOVE_COLUMN",
  "SORT_COLUMN",
  "SET_COLUMN_CARD_ORDER",
  "RESTORE_COLUMN",
  "SET_BOARD_WORKFLOW",
  // Board availability.
  "ARCHIVE_BOARD",
  "UNARCHIVE_BOARD",
]);

/**
 * A realtime frame can change the ready set only for an allowed action or a
 * "your view is stale" resync. Presence, comments, labels, checklists, board
 * renames and heartbeats must not wake a long-poll.
 */
export function isReadyFrame(frame: BoardSseEvent): boolean {
  if (frame.type === "resync") return true;
  if (frame.type !== "command") return false;
  return READY_WAKE_ACTIONS.has(frame.action.type);
}

/**
 * Co-waiters must share one post-wake snapshot. Commands carry a unique seq;
 * a resync frame has none, so every subscriber that sees the same frame object
 * gets the same synthetic key.
 */
const resyncWakeKeys = new WeakMap<BoardSseEvent, string>();
let resyncWakeSerial = 0;

export function wakeKeyOf(frame: BoardSseEvent): string {
  if (frame.type === "command") return `cmd:${frame.seq}`;
  const known = resyncWakeKeys.get(frame);
  if (known !== undefined) return known;
  const key = `resync:${++resyncWakeSerial}`;
  resyncWakeKeys.set(frame, key);
  return key;
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
      c."version"
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
  };
}

/** One shared snapshot, sliced to the waiter's requested limit. */
function withLimit(snapshot: BoardReadyDto, limit: number): BoardReadyDto {
  return { ...snapshot, limit, cards: snapshot.cards.slice(0, limit) };
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
