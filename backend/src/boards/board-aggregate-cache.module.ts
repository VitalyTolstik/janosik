import { Global, Module } from "@nestjs/common";
import {
  BOARD_AGGREGATE_CACHE_CONFIG,
  type BoardAggregateCacheConfig,
  BoardAggregateCacheService,
  defaultBoardAggregateCacheConfig,
} from "./board-aggregate-cache";
import { BoardAggregateLoader } from "./board-aggregate-loader";

/**
 * TASK-200.10: one process-wide, revision-keyed board aggregate cache.
 *
 * Global because the command, plan, approval and board-read services all
 * live in sibling modules and must share exactly one map: a per-module cache
 * would multiply the memory bound and turn a hit into a coin flip. The cache
 * is an advisory read accelerator; correctness comes from comparing
 * `Board.aggregateRevision`, never from bus invalidation.
 */
@Global()
@Module({
  providers: [
    {
      provide: BOARD_AGGREGATE_CACHE_CONFIG,
      useFactory: defaultBoardAggregateCacheConfig,
    },
    {
      provide: BoardAggregateCacheService,
      useFactory: (config: BoardAggregateCacheConfig) =>
        new BoardAggregateCacheService(config),
      inject: [BOARD_AGGREGATE_CACHE_CONFIG],
    },
    BoardAggregateLoader,
  ],
  exports: [
    BoardAggregateCacheService,
    BoardAggregateLoader,
    BOARD_AGGREGATE_CACHE_CONFIG,
  ],
})
export class BoardAggregateCacheModule {}
