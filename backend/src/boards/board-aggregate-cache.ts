import { Injectable } from "@nestjs/common";
import type { BoardAggregate } from "@janosik/shared";
import { env } from "@/config/env";

/**
 * TASK-200.10: bounds for the per-process board aggregate cache. `0` on
 * either knob disables storage entirely, which keeps a test or a
 * memory-constrained deployment byte-identical to the uncached path.
 */
export interface BoardAggregateCacheConfig {
  /** Maximum cached boards; 0 disables. */
  entries: number;
  /** Approximate UTF-8 JSON bytes plus per-entry overhead; 0 disables. */
  bytes: number;
}

/** Injection token so a focused spec/e2e can override the bounds. */
export const BOARD_AGGREGATE_CACHE_CONFIG = Symbol(
  "BOARD_AGGREGATE_CACHE_CONFIG",
);

/** Production/test default from `env`. */
export function defaultBoardAggregateCacheConfig(): BoardAggregateCacheConfig {
  return {
    entries: env.BOARD_AGGREGATE_CACHE_ENTRIES,
    bytes: env.BOARD_AGGREGATE_CACHE_BYTES,
  };
}

/**
 * Approximate per-entry cost beyond the serialized board: the Map key, the
 * entry wrapper, the revision bigint and V8 object headers. It is deliberately
 * a flat constant — the cache exists to bound memory, not to account for it
 * exactly.
 */
export const BOARD_AGGREGATE_CACHE_ENTRY_OVERHEAD_BYTES = 256;

interface CacheEntry {
  revision: bigint;
  aggregate: BoardAggregate;
  bytes: number;
}

/** Test/diagnostic counters; nothing here is a metric contract yet. */
export interface BoardAggregateCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
  /** `set` calls rejected because a newer revision is already cached. */
  staleSets: number;
  /** `set` calls skipped because the entry alone exceeds the byte cap. */
  oversizeSkips: number;
}

/**
 * TASK-200.10: one process-wide cache of full `BoardAggregate` snapshots,
 * keyed by board id and validated against `Board.aggregateRevision`.
 *
 * Correctness is revision-based, not time- or bus-based: a caller may only
 * use an entry when the revision it read in the same transaction/snapshot
 * equals the cached revision. Every aggregate writer bumps that revision
 * through the TASK-200.6 triggers, so a stale entry simply never matches.
 * That also makes the cache safe across replicas without Redis: this process
 * only ever serves snapshots it loaded itself at a revision the database
 * confirmed.
 *
 * The value is cloned on both sides of the map: callers (the reducer in
 * particular) mutate their aggregate freely, and a cached object must never
 * leak into the next request.
 */
@Injectable()
export class BoardAggregateCacheService {
  private readonly config: BoardAggregateCacheConfig;
  /** Insertion order is LRU order: `get` re-inserts a hit at the end. */
  private readonly boards = new Map<string, CacheEntry>();
  private totalBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private staleSets = 0;
  private oversizeSkips = 0;

  constructor(
    config: BoardAggregateCacheConfig = defaultBoardAggregateCacheConfig(),
  ) {
    this.config = validateConfig(config);
  }

  get enabled(): boolean {
    return this.config.entries > 0 && this.config.bytes > 0;
  }

  /**
   * The aggregate cached for this exact revision, or null. A hit returns a
   * deep clone, so the caller owns every array/object in it.
   */
  get(boardId: string, revision: bigint): BoardAggregate | null {
    if (!this.enabled) {
      this.misses += 1;
      return null;
    }
    const entry = this.boards.get(boardId);
    if (entry === undefined || entry.revision !== revision) {
      this.misses += 1;
      return null;
    }
    // Refresh recency without recomputing the approximate size.
    this.boards.delete(boardId);
    this.boards.set(boardId, entry);
    this.hits += 1;
    return structuredClone(entry.aggregate);
  }

  /**
   * Cache a snapshot that was read at `revision`. Never overwrite a newer
   * entry: a slow loader that started at R must not replace the cached R+1.
   * Equal revisions are a no-op — the content is already the truth for that
   * revision and recomputing `JSON.stringify` would only burn CPU.
   */
  set(boardId: string, revision: bigint, aggregate: BoardAggregate): void {
    if (!this.enabled) return;
    const existing = this.boards.get(boardId);
    if (existing !== undefined) {
      if (existing.revision > revision) {
        this.staleSets += 1;
        return;
      }
      if (existing.revision === revision) return;
      this.remove(boardId);
    }

    let bytes: number;
    let snapshot: BoardAggregate;
    try {
      // Serialization happens on the miss/store path only, never on a hit.
      // The aggregate is plain JSON data; a hostile shape (should not exist)
      // must never fail a command. Cloning on store means a caller that keeps
      // mutating its aggregate cannot poison the cached snapshot.
      snapshot = structuredClone(aggregate);
      bytes =
        Buffer.byteLength(JSON.stringify(snapshot), "utf8") +
        BOARD_AGGREGATE_CACHE_ENTRY_OVERHEAD_BYTES;
    } catch {
      return;
    }
    if (bytes > this.config.bytes) {
      // One board larger than the whole budget would evict every other entry
      // and itself. Refuse it up front and leave the cache usable.
      this.oversizeSkips += 1;
      return;
    }

    this.boards.set(boardId, { revision, aggregate: snapshot, bytes });
    this.totalBytes += bytes;
    while (
      this.boards.size > this.config.entries ||
      this.totalBytes > this.config.bytes
    ) {
      const oldest = this.boards.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
      this.evictions += 1;
    }
  }

  /** The revision currently cached for a board, or null (tests/diagnostics). */
  revisionOf(boardId: string): bigint | null {
    return this.boards.get(boardId)?.revision ?? null;
  }

  /** Drop every entry but keep the counters (tests and admin diagnostics). */
  clear(): void {
    this.boards.clear();
    this.totalBytes = 0;
  }

  get stats(): BoardAggregateCacheStats {
    return {
      entries: this.boards.size,
      bytes: this.totalBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      staleSets: this.staleSets,
      oversizeSkips: this.oversizeSkips,
    };
  }

  private remove(boardId: string): void {
    const entry = this.boards.get(boardId);
    if (entry === undefined) return;
    this.boards.delete(boardId);
    this.totalBytes -= entry.bytes;
  }
}

function validateConfig(
  config: BoardAggregateCacheConfig,
): BoardAggregateCacheConfig {
  for (const [name, value] of [
    ["entries", config.entries],
    ["bytes", config.bytes],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `BoardAggregateCache: ${name} must be a non-negative integer (got ${String(value)})`,
      );
    }
  }
  return { entries: config.entries, bytes: config.bytes };
}
