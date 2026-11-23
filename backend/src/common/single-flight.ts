/**
 * TASK-200.6: coalesce identical concurrent work into one execution.
 *
 * The board read path used to rebuild the same aggregate for every caller in
 * a burst (500 readers → 500 identical query sets and 500 JSON trees). A
 * single-flight entry lives only while its task is in flight: once it settles
 * — successfully or not — the entry is removed, so a later request always
 * re-reads the database. That last property is what keeps this safe for
 * CAS-style clients: a failed or successful write is never hidden behind a
 * stale coalesced snapshot.
 *
 * A waiting caller may give up after `timeoutMs`; the shared task keeps
 * running for the remaining waiters and an eventual failure is still cleaned
 * up. Callers are never left with a permanently rejected entry.
 */

/** A caller gave up waiting for the shared task; the task itself continues. */
export class SingleFlightTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Single-flight task did not settle within ${timeoutMs} ms`);
    this.name = "SingleFlightTimeoutError";
  }
}

export interface SingleFlightRunOptions {
  /** Optional per-caller wait bound. `undefined` or `0` waits indefinitely. */
  timeoutMs?: number;
  /** Called when this call joined an already-running task (metrics). */
  onJoin?: () => void;
}

export class SingleFlight<T> {
  private readonly inflight = new Map<string, Promise<T>>();

  /**
   * Run `task` once per key while it is in flight. Concurrent callers with
   * the same key share the promise; a rejected task rejects every waiter and
   * clears the key, so the next call starts a fresh attempt.
   */
  run(
    key: string,
    task: () => Promise<T>,
    options: SingleFlightRunOptions = {},
  ): Promise<T> {
    let shared = this.inflight.get(key);
    if (shared === undefined) {
      const created = Promise.resolve().then(task);
      shared = created;
      this.inflight.set(key, created);
      // `then(cleanup, cleanup)` both clears the entry and consumes the
      // cleanup branch's rejection; the original promise still rejects for
      // the callers awaiting it.
      const cleanup = (): void => {
        if (this.inflight.get(key) === created) this.inflight.delete(key);
      };
      void created.then(cleanup, cleanup);
    } else {
      options.onJoin?.();
    }
    const timeoutMs = options.timeoutMs ?? 0;
    return timeoutMs > 0 ? withTimeout(shared, timeoutMs) : shared;
  }

  /** Tasks currently in flight (diagnostics/tests). */
  get size(): number {
    return this.inflight.size;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SingleFlightTimeoutError(timeoutMs));
    }, timeoutMs);
    // Do not keep a test process or an idle server alive just for this timer.
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
