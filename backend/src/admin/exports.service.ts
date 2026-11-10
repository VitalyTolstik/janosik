import { randomUUID } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";

import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import type { AdminExportRowDto } from "@janosik/shared";
import { MAX_EXPORT_BUNDLE_BYTES } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { StorageService } from "@/attachments/storage.service";
import {
  DEFAULT_JOB_OPTIONS,
  jobAttribution,
  logQueueJob,
  QUEUE_NAMES,
  redisQueueStats,
  type AttributedJob,
  type QueueStats,
} from "@/ops/queue-core";
import { AdminService } from "./admin.service";

/**
 * TASK-71 — background data exports. A large user's GDPR bundle is built by
 * the `exports` queue, written to a file under the blob store and handed out
 * by a TTL'd link, instead of blocking the request for minutes. Small users
 * keep the synchronous fast path (built inline and returned `ready` at once).
 * On Redis the job survives a restart; without Redis it runs inline.
 */
export const EXPORTS_QUEUE = QUEUE_NAMES.exports;
export const EXPORTS_JOB = "export-user";

/** Artifact lifetime; the sweep deletes expired exports. */
const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Below this many authored rows the bundle is built inline. Deliberately
 * small (TASK-111): a synchronous build blocks the request, so anything but
 * a genuinely tiny account goes to the queue.
 */
const SMALL_THRESHOLD = 1_000;

export interface ExportsJob extends AttributedJob {
  exportId: string;
}

/** TASK-166.6: the bundle ceiling is enforced before the file is written. */
export function assertExportBundleSize(bytes: number): void {
  if (bytes <= MAX_EXPORT_BUNDLE_BYTES) return;
  throw new PayloadTooLargeException({
    message: `Account export exceeds ${Math.round(
      MAX_EXPORT_BUNDLE_BYTES / (1024 * 1024),
    )} MB. Use pg_dump for a full-instance copy.`,
    code: "payload_too_large",
    limit: MAX_EXPORT_BUNDLE_BYTES,
  });
}

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);
  private readonly pending: string[] = [];
  private draining = false;
  /** One in-process build/download request at a time per account. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly storage: StorageService,
    @Optional()
    @InjectQueue(EXPORTS_QUEUE)
    private readonly queue?: Queue<ExportsJob>,
  ) {}

  get usingRedis(): boolean {
    return this.queue !== undefined;
  }

  /**
   * Requests an export: a small account is built inline (row `ready`), a
   * large one is queued (row `pending`). Returns the export row either way.
   */
  async request(
    userId: string,
    adminEmail: string,
  ): Promise<AdminExportRowDto> {
    if (this.inFlight.has(userId)) {
      throw new ConflictException({
        message: "An export is already being prepared for this account",
        code: "export_in_progress",
      });
    }
    this.inFlight.add(userId);
    try {
      return await this.requestLocked(userId, adminEmail);
    } finally {
      this.inFlight.delete(userId);
    }
  }

  private async requestLocked(
    userId: string,
    adminEmail: string,
  ): Promise<AdminExportRowDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException("User not found");

    const now = new Date();
    const rows = await this.authorRowCount(userId);
    const created = await this.prisma.$transaction(async (tx) => {
      // Cross-node serialization: the pending check and row creation are
      // one critical section per account.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`export:${userId}`}, 0))`;
      const pending = await tx.dataExport.findFirst({
        where: { userId, status: "pending", expiresAt: { gt: now } },
        select: { id: true },
      });
      if (pending) {
        throw new ConflictException({
          message: "An export is already queued for this account",
          code: "export_in_progress",
          exportId: pending.id,
        });
      }
      // The previous ready artifact stays downloadable until the new build
      // succeeds. `buildOnce` removes it only after this row becomes ready.
      return tx.dataExport.create({
        data: {
          userId,
          userEmail: user.email,
          filename: `janosik-user-${userId}.json`,
          createdBy: adminEmail,
          expiresAt: new Date(now.getTime() + EXPORT_TTL_MS),
        },
      });
    });

    if (rows <= SMALL_THRESHOLD) {
      try {
        await this.build(created.id);
      } catch (error) {
        // A budget refusal is not a transient failure: remove the row and
        // answer 413 instead of leaving a failed artifact behind.
        if (error instanceof PayloadTooLargeException) {
          await this.prisma.dataExport.deleteMany({
            where: { id: created.id },
          });
          throw error;
        }
        this.logger.warn(`Inline export failed: ${String(error)}`);
      }
    } else {
      await this.enqueue(created.id, userId);
    }
    return this.row(created.id);
  }

  /**
   * Delete every old ready artifact except the one that just became ready.
   * On a failed/pending next build the previous file is still served.
   */
  private async cleanupOtherReady(
    userId: string,
    keepId: string,
    keepCreatedAt: Date,
  ): Promise<void> {
    const rows = await this.prisma.dataExport.findMany({
      where: {
        userId,
        status: "ready",
        id: { not: keepId },
        // Never delete a ready artifact created after this one (another
        // node may have finished a newer export while we were building).
        createdAt: { lt: keepCreatedAt },
      },
      select: { id: true, storedName: true },
    });
    if (rows.length === 0) return;
    await this.prisma.dataExport.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    for (const row of rows) {
      if (row.storedName) {
        await this.storage
          .remove(this.storage.attachmentPath(row.storedName))
          .catch(() => undefined);
      }
    }
  }

  private async authorRowCount(userId: string): Promise<number> {
    const [comments, commands, activity] = await this.prisma.$transaction([
      this.prisma.comment.count({ where: { authorId: userId } }),
      this.prisma.command.count({ where: { actorId: userId } }),
      this.prisma.activity.count({ where: { actorId: userId } }),
    ]);
    return comments + commands + activity;
  }

  private async enqueue(exportId: string, userId: string): Promise<void> {
    const attribution = jobAttribution({
      actorType: "human",
      actorId: userId,
    });
    if (this.queue) {
      try {
        await this.queue.add(
          EXPORTS_JOB,
          { exportId, ...(attribution !== undefined ? { attribution } : {}) },
          DEFAULT_JOB_OPTIONS,
        );
        logQueueJob(EXPORTS_QUEUE, EXPORTS_JOB, attribution);
        return;
      } catch (error) {
        this.logger.warn(
          `BullMQ enqueue failed, building inline: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
      }
    }
    this.pending.push(exportId);
    await this.drain();
  }

  /**
   * Builds the bundle and stores the artifact (worker entry point).
   *
   * TASK-148 (B21): BullMQ retries only when the job *throws*. The old code
   * swallowed every error and wrote `failed`, so `attempts: 3` never fired —
   * a transient DB/disk hiccup dead-lettered the export permanently. While
   * attempts remain, leave the row `pending` and rethrow; settle on `failed`
   * only for the final attempt (or the inline path, which never retries).
   */
  async build(
    exportId: string,
    retry?: { attemptsMade: number; attempts: number },
  ): Promise<void> {
    return this.buildOnce(exportId, retry);
  }

  private async buildOnce(
    exportId: string,
    retry?: { attemptsMade: number; attempts: number },
  ): Promise<void> {
    const row = await this.prisma.dataExport.findUnique({
      where: { id: exportId },
    });
    if (!row || row.status !== "pending") return;
    try {
      const bundle = await this.admin.buildUserBundle(row.userId);
      await this.storage.ensureDirs();
      const storedName = `export-${randomUUID()}.json`;
      const absPath = this.storage.attachmentPath(storedName);
      const text = JSON.stringify(bundle.data, null, 2);
      const bytes = Buffer.byteLength(text, "utf8");
      assertExportBundleSize(bytes);
      const body = Buffer.from(text, "utf8");
      await writeFile(absPath, body);
      const { size } = await stat(absPath);
      await this.prisma.dataExport.update({
        where: { id: exportId },
        data: {
          status: "ready",
          storedName,
          sizeBytes: size,
          filename: bundle.filename,
        },
      });
      await this.cleanupOtherReady(row.userId, exportId, row.createdAt).catch(
        (error) => {
          this.logger.warn(
            `Could not remove old ready exports for ${row.userId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      );
    } catch (error) {
      const nonRetryable = error instanceof PayloadTooLargeException;
      const willRetry =
        !nonRetryable &&
        retry !== undefined &&
        retry.attemptsMade + 1 < retry.attempts;
      if (!willRetry) {
        await this.prisma.dataExport.update({
          where: { id: exportId },
          data: {
            status: "failed",
            error: error instanceof Error ? error.message : "unknown",
          },
        });
      }
      this.logger.warn(
        `Export ${exportId} failed (attempt ${(retry?.attemptsMade ?? 0) + 1}${
          retry ? `/${retry.attempts}` : ""
        }): ${String(error)}`,
      );
      // A queued oversized bundle is a terminal `failed` row, not a BullMQ
      // retry. The inline path still throws so the HTTP request gets 413.
      if (nonRetryable && retry !== undefined) return;
      throw error;
    }
  }

  async list(): Promise<AdminExportRowDto[]> {
    const rows = await this.prisma.dataExport.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((row) => this.toDto(row));
  }

  async row(exportId: string): Promise<AdminExportRowDto> {
    const row = await this.prisma.dataExport.findUnique({
      where: { id: exportId },
    });
    if (!row) throw new NotFoundException("Export not found");
    return this.toDto(row);
  }

  /** Absolute path + filename of a ready export's artifact. */
  async download(
    exportId: string,
  ): Promise<{ absPath: string; filename: string }> {
    const row = await this.prisma.dataExport.findUnique({
      where: { id: exportId },
    });
    if (!row || row.status !== "ready" || !row.storedName) {
      throw new NotFoundException("Export is not ready");
    }
    // TASK-109: the TTL is enforced at download too, not only by the sweep —
    // a stale link must not keep serving a GDPR bundle.
    if (row.expiresAt.getTime() < Date.now()) {
      throw new GoneException("Export has expired");
    }
    const absPath = this.storage.attachmentPath(row.storedName);
    let actualSize: number;
    try {
      actualSize = (await stat(absPath)).size;
    } catch {
      throw new GoneException("Export artifact is missing");
    }
    if (Math.max(row.sizeBytes ?? 0, actualSize) > MAX_EXPORT_BUNDLE_BYTES) {
      throw new PayloadTooLargeException({
        message: "This export exceeds the account bundle limit",
        code: "payload_too_large",
        limit: MAX_EXPORT_BUNDLE_BYTES,
      });
    }
    return {
      absPath,
      filename: row.filename,
    };
  }

  // Expiry sweep lives in `MaintenanceService.sweepExports` (TASK-68) — a
  // duplicate here was dead code (TASK-114).

  async stats(): Promise<QueueStats> {
    if (this.queue) return redisQueueStats(this.queue);
    return {
      pending: this.pending.length,
      processed: 0,
      failed: 0,
      backend: "memory",
    };
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const exportId = this.pending.shift();
        if (exportId) {
          // `build` rethrows so BullMQ can retry; the in-process queue has no
          // retry, so the row is already settled on `failed` — just drain on.
          await this.build(exportId).catch(() => undefined);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private toDto(row: {
    id: string;
    userId: string;
    userEmail: string;
    status: string;
    filename: string;
    sizeBytes: number | null;
    error: string | null;
    createdAt: Date;
    expiresAt: Date;
  }): AdminExportRowDto {
    return {
      id: row.id,
      userId: row.userId,
      userEmail: row.userEmail,
      status: row.status as AdminExportRowDto["status"],
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      error: row.error,
      createdAt: row.createdAt.getTime(),
      expiresAt: row.expiresAt.getTime(),
    };
  }
}
