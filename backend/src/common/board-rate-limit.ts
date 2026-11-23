import {
  RATE_LIMIT_WINDOW_MS,
  consumeBoardRateLimit,
  inspectBoardRateLimit,
  type RateLimitDecision,
} from "./rate-limit";

/**
 * TASK-200.3: bounded queueing for agent commands over the board budget.
 *
 * The board bucket refills continuously (see `consumeBoardRateLimit`), so a
 * short burst only needs to wait for the next free slot, not for a whole
 * minute window. Three pieces make that safe:
 *
 * - {@link waitForBoardRateLimit} waits until enough tokens are available or
 *   the per-request deadline passes, then the caller answers `503
 *   Retry-After`. The deadline is checked **before** the first consume, so a
 *   request whose queue wait already exhausted its budget can never spend a
 *   token;
 * - {@link enqueueBoardCommand} serializes waiters **per board**, so a burst
 *   is admitted in arrival order instead of a thundering herd that all wake at
 *   the same millisecond. The queue is bounded; an over-full board gets the
 *   same immediate `503` rather than unbounded memory growth;
 * - an aborted client leaves the queue without ever running its command.
 *
 * The deadline is computed when the request arrives, not when its turn in the
 * queue comes, so a long line cannot make a request wait multiple times its
 * configured budget. Everything is in-process and bounded: a queued request
 * holds no database connection.
 */

/** Maximum commands waiting (running or queued) per board. */
export const BOARD_COMMAND_QUEUE_MAX = 64;
/**
 * Maximum bytes held by one board's command queue (running + waiting). The
 * command body limit is 10 MB, so this admits a few large batches while
 * keeping a burst of 64 × 10 MB bodies from becoming 640 MB of retained JSON.
 */
export const BOARD_COMMAND_QUEUE_MAX_BYTES = 32 * 1024 * 1024;
/** Safety stop for a frozen injected clock; the real clock advances itself. */
export const BOARD_RATE_WAIT_MAX_STEPS = 10_000;

export type BoardCommandQueueFullReason = "depth" | "bytes";

export class BoardCommandQueueFullError extends Error {
  constructor(
    readonly boardId: string,
    readonly reason: BoardCommandQueueFullReason = "depth",
    readonly depth = 0,
    readonly bytes = 0,
  ) {
    super(
      `The command queue for board ${boardId} is full (${reason}: depth ${depth}, bytes ${bytes})`,
    );
    this.name = "BoardCommandQueueFullError";
  }
}

export class BoardCommandQueueAbortedError extends Error {
  constructor() {
    super("The request was aborted before its command was queued");
    this.name = "BoardCommandQueueAbortedError";
  }
}

export interface BoardRateLimitWaitOptions {
  /** Board budget in requests per minute. */
  limit: number;
  /** Absolute `Date.now()` deadline for this request. */
  deadline: number;
  /** Units to spend: a batch is charged by its command count. */
  cost?: number;
  /** Cancels the wait when the client goes away. */
  signal?: AbortSignal;
  /** Clock override for deterministic tests; it must advance across sleeps. */
  now?: () => number;
  /**
   * Sleep override for deterministic tests. It must eventually advance the
   * injected clock; a frozen clock is stopped by
   * {@link BOARD_RATE_WAIT_MAX_STEPS} and answered as an expired deadline.
   */
  sleep?: (ms: number) => Promise<void>;
}

export interface BoardRateLimitWait {
  decision: RateLimitDecision;
  waitedMs: number;
}

export interface BoardCommandQueueOptions {
  /** Cancels a waiter before its task runs. */
  signal?: AbortSignal;
  /** Test/embedder override for {@link BOARD_COMMAND_QUEUE_MAX}. */
  maxDepth?: number;
  /** Approximate size of the request body this waiter retains. */
  bytes?: number;
  /** Test/embedder override for {@link BOARD_COMMAND_QUEUE_MAX_BYTES}. */
  maxBytes?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function abortError(): BoardCommandQueueAbortedError {
  return new BoardCommandQueueAbortedError();
}

/**
 * Sleep until `ms` or the signal aborts, whichever comes first. With the real
 * timer the abort also clears the pending timeout, so a departed client does
 * not leave a multi-second handle behind.
 */
function sleepUntil(
  ms: number,
  signal: AbortSignal | undefined,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  if (signal === undefined) return wait(ms);
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (settle: () => void): void => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    if (wait === sleep) {
      timer = setTimeout(() => finish(resolve), ms);
      return;
    }
    wait(ms).then(
      () => finish(resolve),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

/**
 * A decision for a request whose deadline passed while it was waiting. It is
 * never `allowed`, even when a token is now free: the caller's queue budget
 * is spent and the command must not be applied. `Retry-After` stays a usable
 * whole second so the client can retry cleanly.
 */
function expiredDecision(
  boardId: string,
  limit: number,
  now: number,
  cost: number,
): RateLimitDecision {
  const inspection = inspectBoardRateLimit(
    boardId,
    limit,
    RATE_LIMIT_WINDOW_MS,
    now,
    cost,
  );
  const nextTokenAt = Math.max(now + 1, inspection.nextTokenAt ?? now + 1);
  return {
    ...inspection,
    allowed: false,
    // The caller's queue budget is spent; even if a token is free now, this
    // request gets no allowance and the 503 names zero remaining.
    remaining: 0,
    nextTokenAt,
    retryAfter: Math.max(1, Math.ceil((nextTokenAt - now) / 1000)),
  };
}

/**
 * Count a request against the board budget, waiting briefly for a refill when
 * the bucket is short. Returns the final decision; `allowed: false` means the
 * caller must answer `503` with the decision's `Retry-After`.
 */
export async function waitForBoardRateLimit(
  boardId: string,
  options: BoardRateLimitWaitOptions,
): Promise<BoardRateLimitWait> {
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  const cost = Math.max(1, Math.floor(options.cost ?? 1));
  const startedAt = now();
  const wallStartedAt = Date.now();
  // A frozen injected clock would never reach `deadline` in fake time; five
  // real seconds of grace keep that developer bug from hanging a process.
  const wallDeadline =
    wallStartedAt + Math.max(0, options.deadline - startedAt) + 5_000;
  if (startedAt >= options.deadline) {
    return {
      decision: expiredDecision(boardId, options.limit, startedAt, cost),
      waitedMs: 0,
    };
  }
  if (options.signal?.aborted) throw abortError();
  let decision = consumeBoardRateLimit(
    boardId,
    options.limit,
    RATE_LIMIT_WINDOW_MS,
    startedAt,
    cost,
  );
  let steps = 0;
  while (!decision.allowed && steps < BOARD_RATE_WAIT_MAX_STEPS) {
    steps += 1;
    if (Date.now() > wallDeadline) {
      decision = expiredDecision(boardId, options.limit, now(), cost);
      break;
    }
    const current = now();
    const remaining = options.deadline - current;
    if (remaining <= 0 || options.signal?.aborted) break;
    const nextAt = decision.nextTokenAt ?? decision.resetAt;
    const delay = Math.max(1, Math.min(nextAt - current, remaining));
    await sleepUntil(delay, options.signal, wait);
    if (options.signal?.aborted) throw abortError();
    const after = now();
    if (after >= options.deadline) {
      decision = expiredDecision(boardId, options.limit, after, cost);
      break;
    }
    decision = consumeBoardRateLimit(
      boardId,
      options.limit,
      RATE_LIMIT_WINDOW_MS,
      after,
      cost,
    );
  }
  if (!decision.allowed && steps >= BOARD_RATE_WAIT_MAX_STEPS) {
    // An injected clock that never advances must not spin forever. This is a
    // test/embedder bug, not a reason to apply the command: answer like an
    // expired deadline and leave the next token for an honest retry.
    decision = expiredDecision(boardId, options.limit, now(), cost);
  }
  if (options.signal?.aborted) throw abortError();
  return { decision, waitedMs: Math.max(0, now() - startedAt) };
}

interface BoardCommandQueue {
  tail: Promise<void>;
  /** Commands in this queue: the running one plus everyone behind it. */
  depth: number;
  /** Approximate request-body bytes retained by the running/queued commands. */
  bytes: number;
}

const queues = new Map<string, BoardCommandQueue>();

/**
 * Run `task` after every earlier queued command for the same board settles.
 * A failed waiter never wedges the queue, and the board entry disappears once
 * its last waiter has settled. An over-full queue (by depth or retained bytes)
 * rejects immediately; an aborted waiter releases its slot at once and the
 * chained task skips it.
 */
export function enqueueBoardCommand<T>(
  boardId: string,
  task: () => Promise<T>,
  options: BoardCommandQueueOptions = {},
): Promise<T> {
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(abortError());
  const maxDepth = Math.max(
    1,
    Math.floor(options.maxDepth ?? BOARD_COMMAND_QUEUE_MAX),
  );
  const bytes = Math.max(0, Math.ceil(options.bytes ?? 0));
  const maxBytes = Math.max(
    0,
    Math.floor(options.maxBytes ?? BOARD_COMMAND_QUEUE_MAX_BYTES),
  );
  let queue = queues.get(boardId);
  if (queue === undefined) {
    queue = { tail: Promise.resolve(), depth: 0, bytes: 0 };
    queues.set(boardId, queue);
  }
  if (queue.depth >= maxDepth) {
    return Promise.reject(
      new BoardCommandQueueFullError(
        boardId,
        "depth",
        queue.depth,
        queue.bytes,
      ),
    );
  }
  if (maxBytes > 0 && queue.bytes + bytes > maxBytes) {
    return Promise.reject(
      new BoardCommandQueueFullError(
        boardId,
        "bytes",
        queue.depth,
        queue.bytes,
      ),
    );
  }
  queue.depth += 1;
  queue.bytes += bytes;

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    queue.depth -= 1;
    queue.bytes = Math.max(0, queue.bytes - bytes);
    if (queue.depth <= 0) {
      queue.bytes = 0;
      if (queues.get(boardId) === queue) queues.delete(boardId);
    }
  };

  const run = async (): Promise<T> => {
    // An abort race releases the slot; when this waiter's turn finally comes
    // behind the earlier tasks it must not run or release a second time.
    if (released || signal?.aborted) throw abortError();
    return task();
  };
  const chained = queue.tail.then(run, run);
  queue.tail = chained.then(
    () => undefined,
    () => undefined,
  );
  void queue.tail.then(release, release);

  if (signal === undefined) return chained;
  // Reject as soon as the client goes away instead of holding its slot until
  // the earlier waiter (or its own token wait) finishes. The guarded release
  // frees depth/bytes immediately; the chained task then skips this waiter.
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = (): void => {
      release();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void chained.then(
      () => signal.removeEventListener("abort", onAbort),
      () => signal.removeEventListener("abort", onAbort),
    );
  });
  return Promise.race([chained, aborted]);
}

/** Current depth and retained bytes for one board's command queue. */
export function boardCommandQueueStats(boardId: string): {
  depth: number;
  bytes: number;
} {
  const queue = queues.get(boardId);
  return queue === undefined
    ? { depth: 0, bytes: 0 }
    : { depth: queue.depth, bytes: queue.bytes };
}

/** Boards with a command waiter right now (observability/tests). */
export function trackedBoardCommandQueues(): number {
  return queues.size;
}

/** Test hook: forget settled queues (pending promises keep running). */
export function resetBoardCommandQueues(): void {
  queues.clear();
}
