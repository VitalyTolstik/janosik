import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * How many times a transaction that lost a race is replayed from scratch.
 * Deadlocks and serialization failures are transient by nature — PostgreSQL's
 * advice is to keep a single lock order, and, when a conflict slips through,
 * "handle them on-the-fly by retrying transactions that abort due to
 * deadlocks" (§13.3.4, Explicit Locking). Attempts are cheap and rare because
 * the per-board lock below already removes almost every conflict.
 */
export const BOARD_WRITE_MAX_ATTEMPTS = 5;

/**
 * Explicit interactive-transaction bounds (B-7). Prisma's defaults (2 s to
 * get a connection, 5 s for the whole transaction) are implicit and the
 * timeout surfaced as an opaque 500. A board write holds the board lock, so
 * it must stay bounded, but a large legitimate command (restoring a column
 * of a few hundred cards) needs more than 5 s on a loaded database.
 */
export const BOARD_WRITE_MAX_WAIT_MS = 5_000;
export const BOARD_WRITE_TIMEOUT_MS = 15_000;

/**
 * Prisma `P2028` = "Transaction API error": no pooled connection within
 * `maxWait`, or the transaction outlived `timeout` (it was rolled back).
 * Neither is a client error nor a bug — the database is overloaded — so it
 * is answered as `503` (retryable) instead of a 500.
 */
export function isTransactionTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2028"
  );
}

/** SQLSTATEs that mean "the transaction can be safely replayed": serialization
 *  failure (40001) and deadlock (40P01). */
const TRANSIENT_SQLSTATES = new Set(["40001", "40P01"]);

/**
 * Prisma surfaces a lost race either as `P2034` ("write conflict or deadlock")
 * or as a raw-query failure (`P2010`) carrying the SQLSTATE in `meta.code`.
 * Both are safe to retry — the transaction was rolled back, nothing landed.
 */
export function isTransientConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "P2034") return true;
  if (code === "P2010") {
    const sqlState = (error as { meta?: { code?: unknown } }).meta?.code;
    if (typeof sqlState === "string" && TRANSIENT_SQLSTATES.has(sqlState)) {
      return true;
    }
  }
  if (typeof code === "string" && TRANSIENT_SQLSTATES.has(code)) return true;
  // Fallback for drivers that only surface the message.
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("deadlock detected") ||
    message.includes("could not serialize access")
  );
}

/** Exponential backoff with jitter, capped so a burst never stalls long. */
function backoffDelay(attempt: number): number {
  const base = Math.min(250, 10 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * base);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The single writer of a board (§7.4, TASK-56).
 *
 * Every mutation of a board's rows — reducer commands, comments, attachments,
 * membership changes — runs through here, so all writers take the same lock in
 * the same order and deadlocks become impossible. Trello-style systems
 * serialize a board like a tiny actor; this is the same idea expressed with
 * the two tools PostgreSQL gives us:
 *
 *  - an **in-process per-board queue** — concurrent callers wait in memory, not
 *    on a database connection. Without it, 100 editors each opening a
 *    transaction to wait for the lock would exhaust the Prisma pool.
 *  - a **transaction-scoped advisory lock** (`pg_advisory_xact_lock`) keyed by
 *    the board id — the invariant also holds across several backend instances
 *    sharing one database, and the lock is released the instant the
 *    transaction ends (commit or rollback).
 *
 * A transaction that still loses a rare race (a writer this service does not
 * own, an admin statement, an operator running SQL by hand) is replayed from
 * scratch. Callers must therefore supply an idempotent body: command writes
 * are keyed by `commandId`, and comment/attachment bodies append a single row.
 */
@Injectable()
export class BoardWriteService {
  private readonly logger = new Logger(BoardWriteService.name);
  /** Tail of the per-board in-process queue (resolves even on failure). */
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run `fn` as the sole writer of `boardId`. `fn` receives a transaction
   * client already holding the board's advisory lock; it must not open its
   * own transaction or call `run` for the same board again.
   */
  run<T>(
    boardId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(boardId, () => this.attempt(boardId, fn));
  }

  /** Serialize tasks per board without holding a database connection. */
  private enqueue<T>(boardId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(boardId) ?? Promise.resolve();
    // `then(task, task)` runs the task whether the previous one settled
    // successfully or threw — one failed writer must not wedge the queue.
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(boardId, tail);
    void tail.then(() => {
      // Drop the queue entry once this is provably the last waiter, so the
      // map does not grow with the number of boards ever touched.
      if (this.tails.get(boardId) === tail) this.tails.delete(boardId);
    });
    return result;
  }

  private async attempt<T>(
    boardId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // Take the per-board lock first, before any row lock, so every
            // writer acquires locks in the same order (board → children).
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${boardId}, 0))`;
            return fn(tx);
          },
          { maxWait: BOARD_WRITE_MAX_WAIT_MS, timeout: BOARD_WRITE_TIMEOUT_MS },
        );
      } catch (error) {
        if (isTransactionTimeout(error)) {
          this.logger.warn(
            `board ${boardId}: transaction timed out (${error instanceof Error ? error.message : String(error)})`,
          );
          throw new ServiceUnavailableException({
            message: "The board is busy — retry the request",
            code: "board_write_timeout",
          });
        }
        if (
          attempt >= BOARD_WRITE_MAX_ATTEMPTS ||
          !isTransientConflict(error)
        ) {
          throw error;
        }
        const delay = backoffDelay(attempt);
        this.logger.warn(
          `board ${boardId}: transient conflict (attempt ${attempt}/${BOARD_WRITE_MAX_ATTEMPTS}), retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
  }
}
