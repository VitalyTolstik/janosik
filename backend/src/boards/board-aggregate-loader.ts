import { Injectable } from "@nestjs/common";
import type { Board as BoardRow, Prisma } from "@prisma/client";
import type { BoardAggregate } from "@janosik/shared";
import { loadBoardAggregateWithRevision } from "./board-aggregate";
import { BoardAggregateCacheService } from "./board-aggregate-cache";

export interface BoardAggregateLoadOptions {
  /**
   * The board row already read in the same transaction/snapshot. Using it
   * avoids a second `Board` SELECT and gives the cache the revision to
   * validate against (TASK-200.4/TASK-200.10).
   */
  board?: BoardRow;
  /**
   * The revision of a board row that was read for another purpose (policy,
   * limits) without selecting every column. A cache hit needs nothing else;
   * a miss loads the full row itself.
   */
  revision?: bigint;
  /**
   * Store a miss. Only the command path sets this to false: a load that
   * happens inside a write transaction, after commands could have run, may
   * observe an uncommitted revision. That revision is safe to *read* under
   * the board lock but must only be cached after `BoardWriteService.run`
   * resolves, which the command service does explicitly.
   */
  cacheOnMiss?: boolean;
}

export interface LoadedBoardAggregate {
  board: BoardAggregate;
  revision: bigint;
}

/**
 * TASK-200.10: the cached front door for full board aggregates.
 *
 * `loadBoardAggregate`/`loadBoardAggregateWithRevision` stay the uncached
 * primitives; this service checks the revision-keyed cache first and fills it
 * on a miss. Callers that already hold a `Board` row pass it in, so a cache
 * hit costs no query at all; callers with only the revision from a narrow
 * policy read can skip the aggregate queries on a hit too.
 *
 * Nothing here is required for correctness: a miss falls through to the same
 * queries as before. The cache is an optimization and must never fail a
 * request, which is why `set` swallows an unserializable value.
 */
@Injectable()
export class BoardAggregateLoader {
  constructor(private readonly cache: BoardAggregateCacheService) {}

  /** `false` when the configured bounds disable storage (0 entries/bytes). */
  get enabled(): boolean {
    return this.cache.enabled;
  }

  /** The full aggregate, or null when the board is missing/deleted. */
  async load(
    db: Prisma.TransactionClient,
    boardId: string,
    options: BoardAggregateLoadOptions = {},
  ): Promise<BoardAggregate | null> {
    const loaded = await this.loadWithRevision(db, boardId, options);
    return loaded === null ? null : loaded.board;
  }

  /**
   * The aggregate plus the revision it was built from. On a cache hit both
   * come from the entry; on a miss the revision is whatever the board row in
   * this transaction says (never the caller's hint).
   */
  async loadWithRevision(
    db: Prisma.TransactionClient,
    boardId: string,
    options: BoardAggregateLoadOptions = {},
  ): Promise<LoadedBoardAggregate | null> {
    const hint = options.board?.aggregateRevision ?? options.revision;
    if (hint !== undefined) {
      const cached = this.cache.get(boardId, hint);
      if (cached !== null) return { board: cached, revision: hint };
    }

    if (options.board !== undefined) {
      const loaded = await loadBoardAggregateWithRevision(db, boardId, {
        board: options.board,
      });
      if (loaded !== null && options.cacheOnMiss !== false) {
        await this.fillCache(db, boardId, loaded);
      }
      return loaded;
    }

    if (hint !== undefined) {
      // A narrow policy read gave us the revision but not the row. A miss
      // re-reads the full row exactly like the uncached primitive did.
      const loaded = await loadBoardAggregateWithRevision(db, boardId);
      if (loaded !== null && options.cacheOnMiss !== false) {
        await this.fillCache(db, boardId, loaded);
      }
      return loaded;
    }

    // No hint: read the row once, then either answer from the cache or hand
    // that same row to the primitive. A hit costs this one SELECT; a miss is
    // board SELECT + the four aggregate queries, plus `fillCache`'s revision
    // check below before anything is stored.
    const board = await db.board.findFirst({
      where: { id: boardId, deletedAt: null },
    });
    if (board === null) return null;
    const cached = this.cache.get(boardId, board.aggregateRevision);
    if (cached !== null) {
      return { board: cached, revision: board.aggregateRevision };
    }
    const loaded = await loadBoardAggregateWithRevision(db, boardId, {
      board,
    });
    if (loaded !== null && options.cacheOnMiss !== false) {
      await this.fillCache(db, boardId, loaded);
    }
    return loaded;
  }

  /**
   * Store a miss, but only when the revision did not move while the
   * aggregate was loading. Outside a REPEATABLE READ transaction the board
   * row and the four aggregate queries are separate READ COMMITTED
   * snapshots: a command committing in between would make the content newer
   * than `loaded.revision`, and serving it later under that key could skip a
   * delta. One cheap revision check on the miss path keeps the cache honest;
   * a cache hit returns before this method runs.
   */
  private async fillCache(
    db: Prisma.TransactionClient,
    boardId: string,
    loaded: LoadedBoardAggregate,
  ): Promise<void> {
    if (!this.cache.enabled) return;
    try {
      const current = await db.board.findUnique({
        where: { id: boardId },
        select: { aggregateRevision: true },
      });
      if (current?.aggregateRevision === loaded.revision) {
        this.cache.set(boardId, loaded.revision, loaded.board);
      }
    } catch {
      // The cache is advisory: a failed consistency check must never turn a
      // successful read into an error. The next load simply retries.
    }
  }

  /**
   * Cache an aggregate that is already known to be committed. The command
   * path calls this after `BoardWriteService.run` resolves, with the final
   * in-memory aggregate and the revision read in that same transaction.
   */
  remember(boardId: string, revision: bigint, aggregate: BoardAggregate): void {
    this.cache.set(boardId, revision, aggregate);
  }
}
