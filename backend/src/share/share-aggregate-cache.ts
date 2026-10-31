import type { BoardAggregate, PublicBoardMemberDto } from "@janosik/shared";

/** A cached live board aggregate with its roster and the command seq it is at. */
export interface CachedBoardAggregate {
  seq: number;
  board: BoardAggregate;
  members: PublicBoardMemberDto[];
}

/**
 * Short-TTL cache for the live public-share aggregate (TASK-141).
 *
 * A popular share link used to rebuild the whole board aggregate on every
 * request (~95 rps). Here it is served from memory until either the board's
 * command `seq` moves (a command committed — exact invalidation) or the window
 * elapses (the roster can change without bumping `seq`, so the TTL bounds how
 * stale the members may be). Concurrent misses share one rebuild
 * (single-flight), so a burst on a cold link runs the expensive read once.
 *
 * `ttlMs <= 0` disables the cache: every `get` misses, and `load` still
 * single-flights within a tick but never stores.
 */
export class ShareAggregateCache {
  private readonly entries = new Map<
    string,
    CachedBoardAggregate & { at: number }
  >();
  private readonly inFlight = new Map<string, Promise<CachedBoardAggregate>>();

  constructor(private readonly ttlMs: number) {}

  /** Whether the cache is active (a positive window). */
  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  /**
   * The cached aggregate for `boardId` when it is still fresh — the `seq`
   * matches and the window has not elapsed — else `undefined`.
   */
  get(boardId: string, currentSeq: number): CachedBoardAggregate | undefined {
    if (this.ttlMs <= 0) return undefined;
    const entry = this.entries.get(boardId);
    if (entry === undefined) return undefined;
    if (entry.seq !== currentSeq || Date.now() - entry.at >= this.ttlMs) {
      this.entries.delete(boardId);
      return undefined;
    }
    return { seq: entry.seq, board: entry.board, members: entry.members };
  }

  /** Rebuild through `build`, deduplicating concurrent callers per board. */
  load(
    boardId: string,
    build: () => Promise<CachedBoardAggregate>,
  ): Promise<CachedBoardAggregate> {
    const running = this.inFlight.get(boardId);
    if (running !== undefined) return running;
    const promise = build()
      .then((value) => {
        if (this.ttlMs > 0) {
          this.entries.set(boardId, { ...value, at: Date.now() });
        }
        return value;
      })
      .finally(() => this.inFlight.delete(boardId));
    this.inFlight.set(boardId, promise);
    return promise;
  }

  invalidate(boardId: string): void {
    this.entries.delete(boardId);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Cached entry count — for tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}
