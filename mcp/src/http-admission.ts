/**
 * Small, bounded admission helpers for the Streamable HTTP gateway.
 *
 * Initialize is the only unauthenticated state-changing path: without local
 * limits a flood of fabricated keys would reach `/auth/me` for every request.
 * These helpers keep that check local and bounded before any API call.
 */

export interface TokenBucketDecision {
  ok: boolean;
  retryAfterSeconds: number;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

/**
 * A continuous-refill token bucket per key. `capacity` is the burst size and
 * `refillPerMinute` controls how fast it recovers. The map is LRU-bounded so
 * a flood of distinct IPs/tokens cannot grow memory without limit.
 */
export class KeyedTokenBucket {
  private readonly buckets = new Map<string, BucketState>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: {
    capacity: number;
    refillPerMinute: number;
    maxKeys?: number;
    now?: () => number;
  }) {
    if (options.capacity <= 0 || options.refillPerMinute <= 0) {
      throw new RangeError("capacity and refillPerMinute must be positive");
    }
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerMinute / 60_000;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Consume one token for `key`, or report when one will be available. */
  take(key: string): TokenBucketDecision {
    const now = this.now();
    let state = this.buckets.get(key);
    if (state === undefined) {
      while (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest === undefined) break;
        this.buckets.delete(oldest);
      }
      state = { tokens: this.capacity, updatedAt: now };
      this.buckets.set(key, state);
    } else {
      // Keep insertion order as a cheap LRU: refresh on every use.
      this.buckets.delete(key);
      this.buckets.set(key, state);
    }

    const elapsed = Math.max(0, now - state.updatedAt);
    state.tokens = Math.min(
      this.capacity,
      state.tokens + elapsed * this.refillPerMs,
    );
    state.updatedAt = now;
    if (state.tokens >= 1) {
      state.tokens -= 1;
      return { ok: true, retryAfterSeconds: 0 };
    }
    const missing = 1 - state.tokens;
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(missing / this.refillPerMs / 1000),
      ),
    };
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * Bounded negative cache: invalid token fingerprints are remembered briefly so
 * a repeated bad key cannot force another `/auth/me` call.
 */
export class NegativeTokenCache {
  private readonly entries = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: {
    ttlMs: number;
    maxEntries: number;
    now?: () => number;
  }) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = Math.max(1, options.maxEntries);
    this.now = options.now ?? Date.now;
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }

  has(key: string): boolean {
    if (this.ttlMs <= 0) return false;
    const now = this.now();
    this.prune(now);
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) return false;
    // Refresh LRU order.
    this.entries.delete(key);
    this.entries.set(key, expiresAt);
    return true;
  }

  set(key: string): void {
    if (this.ttlMs <= 0) return;
    const now = this.now();
    this.prune(now);
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, now + this.ttlMs);
  }

  get size(): number {
    return this.entries.size;
  }
}

/** A simple bounded concurrency gate (try-acquire, no queue). */
export class ConcurrencyGate {
  private readonly maxConcurrent: number;
  private active = 0;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  tryAcquire(): boolean {
    if (this.active >= this.maxConcurrent) return false;
    this.active += 1;
    return true;
  }

  release(): void {
    if (this.active > 0) this.active -= 1;
  }

  get inUse(): number {
    return this.active;
  }
}

export class SingleFlightCapacityError extends Error {
  constructor() {
    super("Too many distinct validation calls are already in flight.");
    this.name = "SingleFlightCapacityError";
  }
}

/** Deduplicate concurrent validation calls with a bounded in-flight map. */
export class SingleFlight<T> {
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly maxKeys: number;

  constructor(options: { maxKeys?: number } = {}) {
    this.maxKeys = Math.max(1, options.maxKeys ?? 256);
  }

  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;
    if (this.inFlight.size >= this.maxKeys) {
      throw new SingleFlightCapacityError();
    }
    const promise: Promise<T> = task().finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.inFlight.size;
  }
}
