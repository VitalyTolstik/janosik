/**
 * TASK-200.6: the cooperating read path for `GET /boards/:id`.
 *
 * Ordering (the security order is fixed by `MembershipGuard`, which runs
 * before this service is reached):
 *   1. auth → board existence → membership → role/pause checks (guard);
 *   2. cheap read stamp (`seq` + `Board.updatedAt`) and `If-None-Match`;
 *   3. a matching validator answers `304` before any aggregate load;
 *   4. otherwise one single-flight build per board + role + projection +
 *      content coding, admitted through a bounded semaphore;
 *   5. JSON serialization and compression happen inside that one build, so a
 *      burst shares the buffers as well as the query work.
 *
 * The single-flight entry disappears when its task settles. Nothing is cached
 * between requests, so a successful CAS write (or a retry after a conflict)
 * always sees the database, never a pre-write snapshot.
 */
import {
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { BoardAggregate } from "@janosik/shared";
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
  seq: number;
  /** `Board.updatedAt` in Unix ms. */
  updatedAt: number;
}

export interface BoardReadSnapshot {
  board: BoardAggregate;
  seq: number;
}

export interface BoardReadRequest {
  boardId: string;
  role: string;
  projection: string;
  route: string;
  acceptEncoding: string | undefined;
  ifNoneMatch: string | undefined;
}

export interface BoardReadDeps {
  /**
   * Cheap metadata read, used only for a conditional request. Never the full
   * aggregate: an unconditional 200 does not pay for it at all.
   */
  stamp: () => Promise<BoardReadStamp | null>;
  /** Full aggregate build; called at most once per coalesced group. */
  build: () => Promise<BoardReadSnapshot>;
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
    // The stamp is only a conditional-request optimisation. An unconditional
    // read goes straight to the build, so the common path keeps exactly the
    // queries it had before TASK-200.6.
    if (request.ifNoneMatch !== undefined) {
      const stamp = await deps.stamp();
      if (stamp === null) throw new NotFoundException("Board not found");
      const current = boardReadEtag({
        boardId: request.boardId,
        seq: stamp.seq,
        updatedAt: stamp.updatedAt,
        route: request.route,
        role: request.role,
        projection: request.projection,
      });
      if (ifNoneMatchMatches(request.ifNoneMatch, current)) {
        this.notModified += 1;
        return {
          status: 304,
          body: Buffer.alloc(0),
          encoding: "identity",
          etag: current,
          seq: stamp.seq,
        };
      }
    }

    const negotiated = negotiateContentEncoding(request.acceptEncoding);
    const key = boardReadKey({
      boardId: request.boardId,
      role: request.role,
      projection: request.projection,
      encoding: negotiated,
    });
    try {
      return await this.singleFlight.run(
        key,
        () => this.build(request, negotiated, deps),
        {
          timeoutMs: this.limits.timeoutMs,
          onJoin: () => {
            this.coalesced += 1;
          },
        },
      );
    } catch (error) {
      if (error instanceof ReadCapacityError) {
        this.rejected += 1;
        throw new ServiceUnavailableException({
          message:
            "The board is under heavy read load; retry after a short pause",
          code: "board_read_busy",
          retryable: true,
          retryAfter: Math.max(1, error.retryAfterSeconds),
        });
      }
      if (error instanceof SingleFlightTimeoutError) {
        this.timeouts += 1;
        throw new ServiceUnavailableException({
          message: "The board read timed out; retry after a short pause",
          code: "board_read_timeout",
          retryable: true,
          retryAfter: Math.max(1, this.limits.retryAfterSeconds),
        });
      }
      throw error;
    }
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
  ): Promise<BoardReadResponse> {
    const release = await this.semaphore.acquire();
    try {
      this.fullReads += 1;
      const snapshot = await deps.build();
      const json = Buffer.from(JSON.stringify(snapshot.board), "utf8");
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
          seq: snapshot.seq,
          updatedAt: snapshot.board.updatedAt,
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
