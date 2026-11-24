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
}

export interface LoadedBoardAggregate {
  board: BoardAggregate;
  revision: bigint;
}

/**
 * TASK-200.10: the cached front door for full board aggregates.
 *
 * `loadBoardAggregate`/`loadBoardAggregateWithRevision` stay the uncached
 * primitives; this service checks the revision-keyed cache and, on a miss,
 * loads without storing. The cache is filled **only** by the command path's
 * explicit `remember` after `BoardWriteService.run` commits. That removes the
 * separate-connection fill check and the READ COMMITTED/uncommitted-write
 * window it tried to police: reads, plans and approvals are pure consumers.
 *
 * Callers that already hold a `Board` row pass it in, so a cache hit costs no
 * query at all; callers with only the revision from a narrow policy read can
 * skip the aggregate queries on a hit too.
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
   * this transaction says (never the caller's hint). A miss is not stored.
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
      return loadBoardAggregateWithRevision(db, boardId, {
        board: options.board,
      });
    }

    if (hint !== undefined) {
      // A narrow policy read gave us the revision but not the row. A miss
      // re-reads the full row exactly like the uncached primitive did.
      return loadBoardAggregateWithRevision(db, boardId);
    }

    // No hint: read the row once, then either answer from the cache or hand
    // that same row to the primitive. A hit costs one SELECT; a miss is board
    // SELECT + the four aggregate queries and is not cached here.
    const board = await db.board.findFirst({
      where: { id: boardId, deletedAt: null },
    });
    if (board === null) return null;
    const cached = this.cache.get(boardId, board.aggregateRevision);
    if (cached !== null) {
      return { board: cached, revision: board.aggregateRevision };
    }
    return loadBoardAggregateWithRevision(db, boardId, { board });
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
