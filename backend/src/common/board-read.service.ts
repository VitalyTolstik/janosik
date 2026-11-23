/**
 * TASK-200.6: the cooperating read path for `GET /boards/:id`.
 *
 * Ordering (the security order is fixed by `MembershipGuard`, which runs
 * before this service is reached):
 *   1. auth → board existence → membership → role/pause checks (guard);
 *   2. cheap read stamp (`Board.aggregateRevision` + `MAX(seq)`) and
 *      `If-None-Match`;
 *   3. a matching validator answers `304` before any aggregate load;
 *   4. otherwise one single-flight build per board + role + projection +
 *      content coding, admitted through a bounded semaphore;
 *   5. JSON serialization and compression happen inside that one build, so a
 *      burst shares the buffers as well as the query work.
 *
 * The single-flight entry disappears when its task settles. Nothing is cached
 * between requests. Its linearization point is the leader's database snapshot
 * (the transaction start), not each joiner's arrival time: a caller that
 * arrives after a write may still join a build that started before it, and
 * must not treat coalescing as read-your-writes. Command responses already
 * carry the versions and new seq of the write; a client that needs a fresh
 * snapshot can issue one more read after the coalesced one completes. Only
 * in-flight work is shared, so a later read never reuses a settled snapshot.
 *
 * `BOARD_READ_TIMEOUT_MS` is one deadline for the whole response: the
 * conditional stamp, semaphore/single-flight wait, Prisma transaction and
 * encoding each receive only the remaining budget, never a fresh full one.
 * The transaction gets a `timeout` slightly below that remaining budget (the
 * encode margin) and `maxWait` capped by `BOARD_READ_WAIT_MS` while reserving a
 * transaction slice, so the pair never exceeds the deadline. With WAIT_MS=0
 * there is no pool wait and the transaction gets the usable remaining budget.
 * P2010/57014 (statement_timeout), P2028 and P2024 therefore surface as
 * `503 board_read_timeout`/`board_read_busy`, not `500`. Prisma still has no cancellation token for a
 * query already sent: the transaction expires by its own budget and then
 * releases the semaphore slot. A timed-out caller never blocks a later one.
 * `BOARD_READ_TIMEOUT_MS` below 300 ms is refused at construction.
 */
import {
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { BoardAggregate } from "@janosik/shared";
import { classifyBoardReadDbError } from "@/common/board-read-db-errors";
import { boardReadEtag, ifNoneMatchMatches } from "@/common/board-read-etag";
import {
  compressBody,
  type ContentEncoding,
  DEFAULT_COMPRESS_MIN_BYTES,
  negotiateContentEncoding,
} from "@/common/http-compression";
import { ReadCapacityError, ReadSemaphore } from "@/common/read-semaphore";
import { SingleFlight, SingleFlightTimeoutError } from "@/common/single-flight";

/** The only projection on this route today; part of every ETag and key. */
export const BOARD_FULL_PROJECTION = "board-full:v1";

/** Route string used in the ETag material (not user input). */
export const BOARD_READ_ROUTE = "GET /boards/:id";

/**
 * Below this a single Prisma round-trip plus compression cannot fit; the
 * service refuses to start instead of silently letting `timeout - margin`
 * become negative.
 */
export const MIN_BOARD_READ_TIMEOUT_MS = 300;

export const BOARD_READ_LIMITS = Symbol("BOARD_READ_LIMITS");

export interface BoardReadLimits {
  /** Full aggregates built at once per process. */
  maxConcurrent: number;
  /** Callers allowed to wait for a slot; the rest get an immediate 503. */
  queueMax: number;
  /** Maximum time one caller waits for a slot. */
  waitMs: number;
  /** Maximum total wait for one response (slot + build + encode). */
  timeoutMs: number;
  /** `Retry-After` seconds on a backpressure refusal. */
  retryAfterSeconds: number;
  /** Bodies below this size stay uncompressed. */
  compressMinBytes: number;
}

/**
 * Conservative defaults for a 4-vCPU self-host: enough parallel DB work to
 * keep the pool busy, but a small enough transient-heap ceiling that a 500-
 * reader burst queues instead of allocating 500 aggregates. Operators can
 * raise the cap on a dedicated host; the TASK-200.6 DoD numbers are measured
 * there, not inferred from these constants.
 */
export const DEFAULT_BOARD_READ_LIMITS: BoardReadLimits = Object.freeze({
  maxConcurrent: 16,
  queueMax: 256,
  waitMs: 10_000,
  timeoutMs: 20_000,
  retryAfterSeconds: 2,
  compressMinBytes: DEFAULT_COMPRESS_MIN_BYTES,
});

export interface BoardReadStamp {
  /** `Board.aggregateRevision`, the monotonic content revision. */
  revision: bigint;
  /** Current `MAX(Command.seq)` for the SSE `X-Board-Seq` baseline. */
  seq: number;
}

export interface BoardReadSnapshot {
  /**
   * Legacy body name for the full aggregate. New projections (TASK-200.9)
   * put their JSON body in `body`; exactly one of the two is serialized.
   */
  board?: BoardAggregate;
  body?: unknown;
  seq: number;
  /** Revision read in the same snapshot as the body. */
  revision: bigint;
}

export interface BoardReadRequest {
  boardId: string;
  role: string;
  projection: string;
  route: string;
  acceptEncoding: string | undefined;
  ifNoneMatch: string | undefined;
  /**
   * Optional subresource existence check for conditional requests. A
   * wildcard `If-None-Match: *` is a validator like any other; the cheap
   * board stamp alone must not answer 304 for a missing/foreign card or
   * column (TASK-200.9 review).
   */
  precheck?: () => Promise<void>;
}

/** Prisma budget handed to the full-read transaction (TASK-200.6). */
export interface BoardReadBuildBudget {
  /** Connection-pool wait (`maxWait`) in ms. */
  maxWaitMs: number;
  /** Whole transaction (`timeout`) in ms. */
  timeoutMs: number;
}

export interface BoardReadDeps {
  /**
   * Cheap metadata read, used only for a conditional request. Never the full
   * aggregate: an unconditional 200 does not pay for it at all. It receives
   * the remaining shared budget; the implementation must also bound its SQL
   * (transaction/statement timeout) so a hung query cannot outlive the
   * response.
   */
  stamp: (budget: BoardReadBuildBudget) => Promise<BoardReadStamp | null>;
  /** Full aggregate build; called at most once per coalesced group. */
  build: (budget: BoardReadBuildBudget) => Promise<BoardReadSnapshot>;
}

export interface BoardReadResponse {
  status: 200 | 304;
  body: Buffer;
  encoding: ContentEncoding;
  etag: string;
  seq: number;
}

export interface BoardReadMetricsSnapshot {
  fullReads: number;
  coalesced: number;
  notModified: number;
  compressed: number;
  identity: number;
  rejected: number;
  timeouts: number;
  inFlight: number;
  active: number;
  waiting: number;
}

/**
 * In-memory cache key: board + role + projection + coding. It deliberately
 * contains no user id, token, email or request header. It lives only in the
 * process and only while a build is in flight.
 */
export function boardReadKey(input: {
  boardId: string;
  role: string;
  projection: string;
  encoding: ContentEncoding;
}): string {
  return [input.boardId, input.role, input.projection, input.encoding].join(
    "\u0000",
  );
}

@Injectable()
export class BoardReadService implements OnModuleDestroy {
  private readonly singleFlight = new SingleFlight<BoardReadResponse>();
  private readonly semaphore: ReadSemaphore;
  private fullReads = 0;
  private coalesced = 0;
  private notModified = 0;
  private compressed = 0;
  private identity = 0;
  private rejected = 0;
  private timeouts = 0;

  constructor(
    @Inject(BOARD_READ_LIMITS) private readonly limits: BoardReadLimits,
  ) {
    if (limits.timeoutMs <= limits.waitMs) {
      throw new Error(
        "BOARD_READ_TIMEOUT_MS must be greater than BOARD_READ_WAIT_MS",
      );
    }
    if (limits.timeoutMs < MIN_BOARD_READ_TIMEOUT_MS) {
      throw new Error(
        `BOARD_READ_TIMEOUT_MS must be at least ${MIN_BOARD_READ_TIMEOUT_MS}`,
      );
    }
    this.semaphore = new ReadSemaphore({
      limit: limits.maxConcurrent,
      maxQueue: limits.queueMax,
      waitMs: limits.waitMs,
      retryAfterSeconds: limits.retryAfterSeconds,
    });
  }

  get metrics(): BoardReadMetricsSnapshot {
    const gate = this.semaphore.snapshot;
    return {
      fullReads: this.fullReads,
      coalesced: this.coalesced,
      notModified: this.notModified,
      compressed: this.compressed,
      identity: this.identity,
      rejected: this.rejected,
      timeouts: this.timeouts,
      inFlight: this.singleFlight.size,
      active: gate.active,
      waiting: gate.waiting,
    };
  }

  /**
   * Answer one board read. The caller owns the HTTP response and must set
   * `ETag`, `Vary: Accept-Encoding`, `Cache-Control` and `X-Board-Seq` on both
   * the 200 and 304 paths.
   */
  async read(
    request: BoardReadRequest,
    deps: BoardReadDeps,
  ): Promise<BoardReadResponse> {
    // One deadline for the whole response. Stamp, queue, transaction and
    // encoding all consume the same budget, so a conditional miss can no
    // longer take WAIT_MS + TIMEOUT_MS sequentially.
    const deadline = Date.now() + this.limits.timeoutMs;
    try {
      // The stamp is only a conditional-request optimisation. An
      // unconditional read goes straight to the build, so the common path
      // keeps exactly the queries it had before TASK-200.6. It still gets the
      // shared deadline: a saturated pool must not hang the response before
      // the semaphore is even involved. Deliberately NOT coalesced: a shared
      // stamp task that never settles would poison every later conditional
      // read, and a joiner could otherwise receive a pre-write 304.
      if (request.ifNoneMatch !== undefined) {
        // Resolve the exact subresource before comparing validators. The
        // board-level stamp cannot prove a card/column exists or belongs to
        // this board, so `If-None-Match: *` must not bypass its 404.
        await request.precheck?.();
        const stampBudget = this.remainingMs(deadline);
        if (stampBudget <= 0) {
          throw new SingleFlightTimeoutError(this.limits.timeoutMs);
        }
        const stamp = await this.stampWithDeadline(
          deps.stamp,
          this.budgets(stampBudget),
          stampBudget,
        );
        if (stamp === null) throw new NotFoundException("Board not found");
        const current = boardReadEtag({
          boardId: request.boardId,
          revision: stamp.revision,
          route: request.route,
          role: request.role,
          projection: request.projection,
        });
        if (ifNoneMatchMatches(request.ifNoneMatch, current)) {
          this.notModified += 1;
          // A 304 still needs the current SSE baseline; it is a separate
          // value from the validator but comes from the same stamp.
          return {
            status: 304,
            body: Buffer.alloc(0),
            encoding: "identity",
            etag: current,
            seq: stamp.seq,
          };
        }
      }

      const buildBudget = this.remainingMs(deadline);
      if (buildBudget <= 0) {
        throw new SingleFlightTimeoutError(this.limits.timeoutMs);
      }
      const negotiated = negotiateContentEncoding(request.acceptEncoding);
      const key = boardReadKey({
        boardId: request.boardId,
        role: request.role,
        projection: request.projection,
        encoding: negotiated,
      });
      return await this.singleFlight.run(
        key,
        () => this.build(request, negotiated, deps, deadline),
        {
          timeoutMs: buildBudget,
          onJoin: () => {
            this.coalesced += 1;
          },
        },
      );
    } catch (error) {
      return this.fail(error);
    }
  }

  private remainingMs(deadline: number): number {
    return Math.max(0, deadline - Date.now());
  }

  /**
   * Split one remaining budget into the Prisma transaction timeout and pool
   * wait. The two are additive in Prisma, so a transaction slice is reserved
   * before granting `maxWait`. WAIT_MS=0 means "no queue and no pool wait";
   * the transaction gets the usable remaining budget.
   */
  private budgets(remaining: number): BoardReadBuildBudget {
    const margin = Math.min(250, Math.max(1, Math.floor(remaining / 2)));
    const usable = Math.max(1, remaining - margin);
    // Prisma's maxWait (pool acquisition) and timeout (transaction body) are
    // additive. Reserve a transaction slice before granting pool wait, so the
    // pair can never exceed the shared budget. WAIT_MS=0 means no pool wait;
    // the transaction gets the whole usable slice.
    const transactionReserve = Math.min(
      250,
      Math.max(1, Math.floor(usable / 2)),
    );
    const maxWaitMs =
      this.limits.waitMs > 0
        ? Math.min(this.limits.waitMs, Math.max(0, usable - transactionReserve))
        : 0;
    return {
      maxWaitMs,
      timeoutMs: Math.max(1, usable - maxWaitMs),
    };
  }

  /**
   * Per-call stamp deadline. No shared task: an unresolved promise is
   * abandoned, so the next conditional read starts a fresh query. The SQL
   * itself is separately bounded by the BoardsService transaction/statement
   * timeout.
   */
  private stampWithDeadline(
    stamp: (budget: BoardReadBuildBudget) => Promise<BoardReadStamp | null>,
    budget: BoardReadBuildBudget,
    deadlineMs: number,
  ): Promise<BoardReadStamp | null> {
    return new Promise<BoardReadStamp | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new SingleFlightTimeoutError(deadlineMs));
      }, deadlineMs);
      timer.unref?.();
      stamp(budget).then(
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

  /** Translate backpressure/P2010/P2028/P2024 into the public 503 contract. */
  private fail(error: unknown): never {
    if (error instanceof ReadCapacityError) {
      this.rejected += 1;
      throw this.busy(error.retryAfterSeconds);
    }
    if (error instanceof SingleFlightTimeoutError) {
      this.timeouts += 1;
      throw this.timeout();
    }
    const dbFailure = classifyBoardReadDbError(error);
    if (dbFailure === "pool_wait") {
      this.rejected += 1;
      throw this.busy(this.limits.retryAfterSeconds);
    }
    if (dbFailure === "timeout") {
      this.timeouts += 1;
      throw this.timeout();
    }
    throw error;
  }

  private busy(retryAfterSeconds: number): ServiceUnavailableException {
    return new ServiceUnavailableException({
      message: "The board is under heavy read load; retry after a short pause",
      code: "board_read_busy",
      retryable: true,
      retryAfter: Math.max(1, retryAfterSeconds),
    });
  }

  private timeout(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      message: "The board read timed out; retry after a short pause",
      code: "board_read_timeout",
      retryable: true,
      retryAfter: Math.max(1, this.limits.retryAfterSeconds),
    });
  }

  /** Stop admitting reads and let active builds finish, bounded. */
  async drain(waitMs = 5_000): Promise<void> {
    await this.semaphore.drain(waitMs);
  }

  async onModuleDestroy(): Promise<void> {
    await this.drain();
  }

  private async build(
    request: BoardReadRequest,
    encoding: ContentEncoding,
    deps: BoardReadDeps,
    deadline: number,
  ): Promise<BoardReadResponse> {
    // The semaphore wait is also charged to the shared deadline. WAIT_MS=0
    // keeps its meaning (no queueing) without starving the conditional stamp;
    // the pool budget below falls back to the remaining response budget.
    const queueWaitMs =
      this.limits.waitMs > 0
        ? Math.min(this.limits.waitMs, this.remainingMs(deadline))
        : 0;
    const release = await this.semaphore.acquire(queueWaitMs);
    try {
      this.fullReads += 1;
      const remaining = this.remainingMs(deadline);
      if (remaining <= 1) {
        throw new SingleFlightTimeoutError(this.limits.timeoutMs);
      }
      const snapshot = await deps.build(this.budgets(remaining));
      const body = snapshot.body ?? snapshot.board;
      const json = Buffer.from(JSON.stringify(body), "utf8");
      const encoded = await compressBody(json, encoding, {
        minBytes: this.limits.compressMinBytes,
        contentType: "application/json; charset=utf-8",
        cacheControl: "private, no-store",
      });
      if (encoded.compressed) this.compressed += 1;
      else this.identity += 1;
      return {
        status: 200,
        body: encoded.body,
        encoding: encoded.encoding,
        etag: boardReadEtag({
          boardId: request.boardId,
          revision: snapshot.revision,
          route: request.route,
          role: request.role,
          projection: request.projection,
        }),
        seq: snapshot.seq,
      };
    } finally {
      release();
    }
  }
}
