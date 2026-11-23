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

export class BoardCommandQueueFullError extends Error {
  constructor(readonly boardId: string) {
    super(`The command queue for board ${boardId} is full`);
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
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** Sleep override for deterministic tests. */
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
  while (!decision.allowed) {
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
  if (options.signal?.aborted) throw abortError();
  return { decision, waitedMs: Math.max(0, now() - startedAt) };
}

interface BoardCommandQueue {
  tail: Promise<void>;
  /** Commands in this queue: the running one plus everyone behind it. */
  depth: number;
}

const queues = new Map<string, BoardCommandQueue>();

/**
 * Run `task` after every earlier queued command for the same board settles.
 * A failed waiter never wedges the queue, and the board entry disappears once
 * its last waiter has settled. An over-full queue rejects immediately; an
 * aborted waiter rejects without ever invoking its task.
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
  let queue = queues.get(boardId);
  if (queue === undefined) {
    queue = { tail: Promise.resolve(), depth: 0 };
    queues.set(boardId, queue);
  }
  if (queue.depth >= maxDepth) {
    return Promise.reject(new BoardCommandQueueFullError(boardId));
  }
  queue.depth += 1;

  const run = async (): Promise<T> => {
    if (signal?.aborted) throw abortError();
    return task();
  };
  const chained = queue.tail.then(run, run);
  queue.tail = chained.then(
    () => undefined,
    () => undefined,
  );
  const release = (): void => {
    queue.depth -= 1;
    if (queue.depth <= 0 && queues.get(boardId) === queue) {
      queues.delete(boardId);
    }
  };
  void queue.tail.then(release, release);

  if (signal === undefined) return chained;
  // Reject as soon as the client goes away instead of holding its slot until
  // the earlier waiter (or its own token wait) finishes. The chained task
  // still observes the signal and never runs the command.
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    void chained.then(
      () => signal.removeEventListener("abort", onAbort),
      () => signal.removeEventListener("abort", onAbort),
    );
  });
  return Promise.race([chained, aborted]);
}

/** Boards with a command waiter right now (observability/tests). */
export function trackedBoardCommandQueues(): number {
  return queues.size;
}

/** Test hook: forget settled queues (pending promises keep running). */
export function resetBoardCommandQueues(): void {
  queues.clear();
}
