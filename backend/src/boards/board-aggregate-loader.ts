import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Board as BoardRow } from "@prisma/client";
import type { BoardAggregate } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
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
   * TASK-200.10: the caller is already inside a REPEATABLE READ snapshot
   * that contains both the board row and every aggregate query. A miss may
   * be stored under `loaded.revision` directly — no second connection or
   * post-load revision check is needed. Only snapshot-scoped readers
   * (`BoardsService.getAggregateWithSeq`'s own transaction and
   * `loadFresh`) set this; the command path stores explicitly after commit.
   */
  snapshot?: boolean;
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
 * loads without storing unless the caller declares a REPEATABLE READ snapshot
 * (`snapshot: true`) or uses `loadFresh`. The command path stores explicitly
 * after `BoardWriteService.run` commits. There is no second connection and no
 * post-load revision check: snapshot callers already read the board row and
 * every aggregate query in one snapshot.
 *
 * Callers that already hold a `Board` row pass it in, so a cache hit costs no
 * query at all; callers with only the revision from a narrow policy read can
 * skip the aggregate queries on a hit too.
 */
@Injectable()
export class BoardAggregateLoader {
  constructor(
    private readonly cache: BoardAggregateCacheService,
    // Optional only for direct-construction unit tests. In Nest the global
    // `PrismaModule` supplies it for the snapshot `loadFresh` transaction.
    @Optional() private readonly prisma?: PrismaService,
  ) {}

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
   * this transaction says (never the caller's hint). A miss is stored only
   * when the caller proved a REPEATABLE READ snapshot (`snapshot: true`).
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
      return this.cacheSnapshot(boardId, loaded, options.snapshot === true);
    }

    if (hint !== undefined) {
      // A narrow policy read gave us the revision but not the row. A miss
      // re-reads the full row exactly like the uncached primitive did.
      return this.cacheSnapshot(
        boardId,
        await loadBoardAggregateWithRevision(db, boardId),
        options.snapshot === true,
      );
    }

    // No hint: read the row once, then either answer from the cache or hand
    // that same row to the primitive. A hit costs one SELECT; a miss is board
    // SELECT + the four aggregate queries and is stored only for a snapshot.
    const board = await db.board.findFirst({
      where: { id: boardId, deletedAt: null },
    });
    if (board === null) return null;
    const cached = this.cache.get(boardId, board.aggregateRevision);
    if (cached !== null) {
      return { board: cached, revision: board.aggregateRevision };
    }
    return this.cacheSnapshot(
      boardId,
      await loadBoardAggregateWithRevision(db, boardId, { board }),
      options.snapshot === true,
    );
  }

  /**
   * TASK-200.10: read through a dedicated REPEATABLE READ transaction. The
   * board row and all aggregate queries share one snapshot, so a miss can be
   * cached without any post-load revision query or a second pooled
   * connection. Plans, approvals and the legacy read path use this; a cache
   * hit returns before the transaction body would need the queries.
   */
  async loadFresh(boardId: string): Promise<BoardAggregate | null> {
    if (this.prisma === undefined) {
      throw new Error("BoardAggregateLoader.loadFresh needs PrismaService");
    }
    return this.prisma.$transaction(
      async (tx) => {
        const loaded = await this.loadWithRevision(tx, boardId, {
          snapshot: true,
        });
        return loaded === null ? null : loaded.board;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private cacheSnapshot(
    boardId: string,
    loaded: LoadedBoardAggregate | null,
    snapshot: boolean,
  ): LoadedBoardAggregate | null {
    if (loaded !== null && snapshot) {
      this.cache.set(boardId, loaded.revision, loaded.board);
    }
    return loaded;
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
