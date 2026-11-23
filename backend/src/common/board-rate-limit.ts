import {
  RATE_LIMIT_WINDOW_MS,
  consumeBoardRateLimit,
  type RateLimitDecision,
} from "./rate-limit";

/**
 * TASK-200.3: bounded queueing for agent commands over the board budget.
 *
 * The board bucket refills continuously (see `consumeBoardRateLimit`), so a
 * short burst only needs to wait for the next free slot, not for a whole
 * minute window. Two pieces make that safe:
 *
 * - {@link waitForBoardRateLimit} waits until a token is available or the
 *   per-request deadline passes, then the caller answers `503 Retry-After`;
 * - {@link enqueueBoardCommand} serializes waiters **per board**, so a burst
 *   is admitted in arrival order instead of a thundering herd that all wake at
 *   the same millisecond.
 *
 * The deadline is computed when the request arrives, not when its turn in the
 * queue comes, so a long line cannot make a request wait multiple times its
 * configured budget. Everything is in-process and bounded: a queued request
 * holds no database connection, and the map drops a board as soon as its last
 * waiter settles.
 */

/** Safety stop for a clock that does not advance (tests/embedders). */
const MAX_WAIT_STEPS = 64;

export interface BoardRateLimitWaitOptions {
  /** Board budget in requests per minute. */
  limit: number;
  /** Absolute `Date.now()` deadline for this request. */
  deadline: number;
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** Sleep override for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface BoardRateLimitWait {
  decision: RateLimitDecision;
  waitedMs: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Count a request against the board budget, waiting briefly for a refill when
 * the bucket is empty. Returns the final decision; `allowed: false` means the
 * caller must answer `503` with the decision's `Retry-After`.
 */
export async function waitForBoardRateLimit(
  boardId: string,
  options: BoardRateLimitWaitOptions,
): Promise<BoardRateLimitWait> {
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  const startedAt = now();
  let decision = consumeBoardRateLimit(
    boardId,
    options.limit,
    RATE_LIMIT_WINDOW_MS,
    startedAt,
  );
  for (let step = 0; !decision.allowed && step < MAX_WAIT_STEPS; step += 1) {
    const current = now();
    const remaining = options.deadline - current;
    if (remaining <= 0) break;
    const nextAt = decision.nextTokenAt ?? decision.resetAt;
    const delay = Math.max(1, Math.min(nextAt - current, remaining));
    await wait(delay);
    decision = consumeBoardRateLimit(
      boardId,
      options.limit,
      RATE_LIMIT_WINDOW_MS,
      now(),
    );
  }
  return { decision, waitedMs: Math.max(0, now() - startedAt) };
}

const tails = new Map<string, Promise<void>>();

/**
 * Run `task` after every earlier queued command for the same board settles.
 * A failed waiter never wedges the queue, and the board entry disappears once
 * its last waiter has settled.
 */
export function enqueueBoardCommand<T>(
  boardId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(boardId) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(boardId, tail);
  void tail.then(() => {
    if (tails.get(boardId) === tail) tails.delete(boardId);
  });
  return result;
}

/** Boards with a command waiter right now (observability/tests). */
export function trackedBoardCommandQueues(): number {
  return tails.size;
}

/** Test hook: forget settled queues (pending promises keep running). */
export function resetBoardCommandQueues(): void {
  tails.clear();
}
