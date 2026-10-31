/**
 * A tiny time-to-live cache (TASK-141).
 *
 * For read paths that are expensive but tolerate a little staleness: a value
 * is served until its window elapses, then recomputed. `ttlMs <= 0` disables
 * the cache entirely (every `get` misses and every `set` is a no-op) — which
 * is how the test environment keeps specs deterministic.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; at: number }>();

  constructor(private readonly ttlMs: number) {}

  /** Whether the cache is active (a positive window). */
  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get(key: K): V | undefined {
    if (this.ttlMs <= 0) return undefined;
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (Date.now() - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.ttlMs <= 0) return;
    this.entries.set(key, { value, at: Date.now() });
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Entry count — for tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}
