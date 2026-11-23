/**
 * A tiny time-to-live cache (TASK-141, bounded since TASK-200.5).
 *
 * For read paths that are expensive but tolerate a little staleness: a value
 * is served until its window elapses, then recomputed. `ttlMs <= 0` disables
 * the cache entirely (every `get` misses and every `set` is a no-op) — which
 * is how the test environment keeps specs deterministic.
 *
 * `maxEntries > 0` turns the map into an LRU: a hit refreshes the entry's
 * recency and an insert past the bound evicts the least recently used entry.
 * That keeps a hostile or simply huge tenant from growing the process heap
 * without bound (TASK-200.5: 500 agents, five caches each).
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 0,
  ) {}

  /** Whether the cache is active (a positive window). */
  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  /** The configured bound; `0` means unbounded. */
  get limit(): number {
    return this.maxEntries;
  }

  get(key: K): V | undefined {
    if (this.ttlMs <= 0) return undefined;
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (Date.now() - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency without resetting the TTL clock: a hot key still
    // expires on schedule, but a cold one is the first to be evicted.
    if (this.maxEntries > 0) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, at: Date.now() });
    if (this.maxEntries > 0) {
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next();
        if (oldest.done === true) break;
        this.entries.delete(oldest.value);
      }
    }
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Delete every entry whose key matches; returns the removed count. */
  deleteWhere(predicate: (key: K) => boolean): number {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (predicate(key)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Entry count — for tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}
