/**
 * TASK-200.6: a small counting semaphore with a bounded waiting room for
 * full board reads. Its job is backpressure, not throughput: when the queue
 * is full or a caller has waited too long, it answers a polite `503` instead
 * of letting every burst allocate another aggregate.
 *
 * The semaphore is process-local on purpose (like `BoardWriteService`): it
 * protects this process's heap, not a global database budget. A multi-node
 * deployment gives each node its own cap.
 */

export type ReadCapacityReason = "queue_full" | "wait_timeout" | "draining";

/** Raised instead of waiting forever; translated to `503` by the caller. */
export class ReadCapacityError extends Error {
  constructor(
    readonly reason: ReadCapacityReason,
    readonly retryAfterSeconds: number,
  ) {
    super(
      reason === "queue_full"
        ? "Board read queue is full"
        : reason === "draining"
          ? "Server is shutting down"
          : "Timed out waiting for a board read slot",
    );
    this.name = "ReadCapacityError";
  }
}

export interface ReadSemaphoreOptions {
  /** Maximum reads running at once. Must be a positive integer. */
  limit: number;
  /** Maximum callers waiting behind them; `0` refuses immediately. */
  maxQueue: number;
  /** Maximum time one caller may wait for a slot. */
  waitMs: number;
  /** `Retry-After` advertised in the refusal (seconds). */
  retryAfterSeconds?: number;
}

export interface ReadSemaphoreSnapshot {
  limit: number;
  maxQueue: number;
  active: number;
  waiting: number;
  draining: boolean;
  /** Reads admitted since construction. */
  admitted: number;
  /** Waiters refused for a full queue, a timeout or shutdown. */
  refused: number;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: ReadCapacityError) => void;
  timer: NodeJS.Timeout;
}

export class ReadSemaphore {
  private active = 0;
  private readonly waiters: Waiter[] = [];
  private draining = false;
  private readonly drainWaiters: Array<() => void> = [];
  private admitted = 0;
  private refused = 0;

  constructor(private readonly options: ReadSemaphoreOptions) {
    if (!Number.isInteger(options.limit) || options.limit <= 0) {
      throw new Error("ReadSemaphore limit must be a positive integer");
    }
    if (!Number.isInteger(options.maxQueue) || options.maxQueue < 0) {
      throw new Error("ReadSemaphore maxQueue must be a non-negative integer");
    }
    if (!Number.isInteger(options.waitMs) || options.waitMs < 0) {
      throw new Error("ReadSemaphore waitMs must be a non-negative integer");
    }
  }

  get snapshot(): ReadSemaphoreSnapshot {
    return {
      limit: this.options.limit,
      maxQueue: this.options.maxQueue,
      active: this.active,
      waiting: this.waiters.length,
      draining: this.draining,
      admitted: this.admitted,
      refused: this.refused,
    };
  }

  /**
   * Take a slot. The returned release function is idempotent: `finally` can
   * call it even after an error without double-releasing a slot.
   */
  acquire(): Promise<() => void> {
    if (this.draining) {
      return Promise.reject(this.refuse("draining"));
    }
    if (this.active < this.options.limit) {
      this.active += 1;
      this.admitted += 1;
      return Promise.resolve(this.releaser());
    }
    if (this.waiters.length >= this.options.maxQueue) {
      return Promise.reject(this.refuse("queue_full"));
    }
    if (this.options.waitMs <= 0) {
      return Promise.reject(this.refuse("wait_timeout"));
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index === -1) return;
          this.waiters.splice(index, 1);
          reject(this.refuse("wait_timeout"));
        }, this.options.waitMs),
      };
      waiter.timer.unref?.();
      this.waiters.push(waiter);
    });
  }

  /**
   * Stop admitting work, refuse everything queued and wait (bounded) for the
   * active reads to finish. A shutdown must not wait forever on a hung query
   * — the process is going away either way.
   */
  async drain(waitMs = 5_000): Promise<void> {
    if (!this.draining) {
      this.draining = true;
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(this.refuse("draining"));
      }
    }
    if (this.active === 0) {
      this.flushDrainWaiters();
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(finish, Math.max(0, waitMs));
      timer.unref?.();
      this.drainWaiters.push(() => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.releaseOne();
    };
  }

  private releaseOne(): void {
    this.active -= 1;
    while (this.waiters.length > 0 && !this.draining) {
      const waiter = this.waiters.shift() as Waiter;
      clearTimeout(waiter.timer);
      this.active += 1;
      this.admitted += 1;
      waiter.resolve(this.releaser());
      return;
    }
    if (this.active === 0) this.flushDrainWaiters();
  }

  private flushDrainWaiters(): void {
    for (const resolve of this.drainWaiters.splice(0)) resolve();
  }

  private refuse(reason: ReadCapacityReason): ReadCapacityError {
    this.refused += 1;
    return new ReadCapacityError(
      reason,
      Math.max(1, this.options.retryAfterSeconds ?? 1),
    );
  }
}
