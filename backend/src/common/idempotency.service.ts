import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { IdempotencyScope } from "@janosik/shared";
import { IDEMPOTENCY_TTL_HOURS } from "@janosik/shared";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * TASK-166.4 REST idempotency (ADR §6.11). A caller sends
 * `Idempotency-Key`; the first request records `in_progress`, then stores the
 * response body and resource id. A retry with the same key and the same
 * request hash replays that body without running the write again:
 *
 * - same key, different body → `409 idempotency_conflict` (stable code);
 * - same key while the first request is still running →
 *   `409 idempotency_in_progress` with `retryable: true`.
 *
 * The table already exists (`IdempotencyRecord`); this service is the first
 * writer, no schema change. Records expire after 24 hours; an expired row is
 * replaced by the next request with that key.
 */

/** Outcome of one idempotent call. */
export interface IdempotencyOutcome<T> {
  body: T;
  resourceId: string | null;
  /** True when the stored response was returned instead of running `run`. */
  replayed: boolean;
}

interface RunResult<T> {
  body: T;
  /** HTTP status stored for observability (the route keeps its own default). */
  status?: number;
  resourceId?: string | null;
}

interface RunOptions<T> {
  scope: IdempotencyScope;
  key: string | undefined;
  /** `user:<id>` for a browser session, `token:<id>` for a PAT. */
  actorKey: string;
  /** Stable hash of the whole request that must be identical on a replay. */
  requestHash: string;
  run: () => Promise<RunResult<T>>;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * An in-progress row only needs to outlive the request that wrote it; if a
 * process dies mid-write, the key must become usable again without waiting
 * the full 24 h. The slowest write path is bounded by a 15 s board-write
 * transaction and clients cap requests at 30 s, so 5 min leaves a wide margin.
 * Completed records get the ADR's full 24 h TTL.
 */
const IN_PROGRESS_TTL_MS = 5 * 60 * 1000;

/** Validate/trim an `Idempotency-Key` header. Empty means "not supplied". */
export function normalizeIdempotencyKey(
  raw: string | undefined,
): string | undefined {
  const key = raw?.trim();
  if (key === undefined || key === "") return undefined;
  if (!KEY_PATTERN.test(key)) {
    throw new BadRequestException({
      message:
        "Idempotency-Key must be 8-128 characters from A-Z, a-z, 0-9, '_' or '-'",
      code: "validation_failed",
      field: "Idempotency-Key",
    });
  }
  return key;
}

/** The actor portion of the record key: a PAT and its owner are distinct. */
export function idempotencyActorKey(
  userId: string,
  principal?: AuthPrincipal,
): string {
  const tokenId = principal?.apiTokenId;
  return tokenId !== undefined ? `token:${tokenId}` : `user:${userId}`;
}

/** Deterministic JSON (sorted object keys) for the request fingerprint. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

/** SHA-256 of a request body, with the route's own scope as the prefix. */
export function hashIdempotentRequest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** SHA-256 of a streamed upload plus the non-file fields that identify it. */
export async function hashUploadRequest(
  metadata: unknown,
  filePath: string,
): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return createHash("sha256")
    .update(canonicalJson(metadata))
    .update(digest.digest("hex"))
    .digest("hex");
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Execute `run` once per `(scope, actorKey, key)`. Without a key this is a
   * transparent pass-through, so existing callers need no changes.
   */
  async run<T>(
    options: RunOptions<T>,
    attempt = 0,
  ): Promise<IdempotencyOutcome<T>> {
    const { scope, key, actorKey, requestHash, run } = options;
    if (key === undefined) {
      const result = await run();
      return {
        body: result.body,
        resourceId: result.resourceId ?? null,
        replayed: false,
      };
    }

    const now = new Date();
    // A crashed request can leave an `in_progress` row behind for 24 h. The
    // row is expired exactly like a completed one, so the next retry after
    // the TTL is allowed instead of being locked out forever.
    await this.prisma.idempotencyRecord.deleteMany({
      where: { scope, actorKey, key, expiresAt: { lte: now } },
    });

    let record: { id: string } | null = null;
    try {
      record = await this.prisma.idempotencyRecord.create({
        data: {
          scope,
          actorKey,
          key,
          requestHash,
          status: "in_progress",
          expiresAt: new Date(now.getTime() + IN_PROGRESS_TTL_MS),
        },
        select: { id: true },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: { scope_actorKey_key: { scope, actorKey, key } },
      });
      if (existing === null) {
        // The row expired/deleted between the failed insert and the read.
        // One retry is safe because no write has run under this key; a second
        // loss is a storage anomaly, not a reason to recurse forever.
        if (attempt >= 1) {
          throw new ConflictException({
            message:
              "A request with this Idempotency-Key is still being recorded; retry shortly",
            code: "idempotency_in_progress",
            key,
            field: "Idempotency-Key",
            retryable: true,
            retryAfter: 1,
          });
        }
        return this.run(options, attempt + 1);
      }
      if (existing.requestHash !== requestHash) {
        throw new ConflictException({
          message:
            "Idempotency-Key was already used with a different request body",
          code: "idempotency_conflict",
          key,
          field: "Idempotency-Key",
          retryable: false,
        });
      }
      if (existing.status !== "completed") {
        throw new ConflictException({
          message:
            "A request with this Idempotency-Key is still running; retry shortly",
          code: "idempotency_in_progress",
          key,
          field: "Idempotency-Key",
          retryable: true,
          retryAfter: 1,
        });
      }
      return {
        body: existing.responseBody as T,
        resourceId: existing.resourceId,
        replayed: true,
      };
    }

    let result: RunResult<T>;
    try {
      result = await run();
    } catch (error) {
      // `run` itself threw, so nothing committed under this key: release it
      // and let an honest retry execute again.
      await this.prisma.idempotencyRecord
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      throw error;
    }

    // The write has committed. If storing the response fails, deleting the
    // record would let a retry duplicate the write; keep it `in_progress`
    // instead. The caller still gets its committed result, and a retry gets
    // `409 idempotency_in_progress` until the lease/sweep expires.
    await this.prisma.idempotencyRecord
      .update({
        where: { id: record.id },
        data: {
          status: "completed",
          responseStatus: result.status ?? 200,
          responseBody: result.body as unknown as Prisma.InputJsonValue,
          resourceId: result.resourceId ?? null,
          expiresAt: new Date(
            Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000,
          ),
        },
      })
      .catch(() => undefined);
    return {
      body: result.body,
      resourceId: result.resourceId ?? null,
      replayed: false,
    };
  }
}
