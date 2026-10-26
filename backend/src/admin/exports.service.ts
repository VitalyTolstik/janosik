import { randomUUID } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";

import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import type { AdminExportRowDto } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { StorageService } from "@/attachments/storage.service";
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  redisQueueStats,
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
/** Below this many authored rows the bundle is built inline. */
const SMALL_THRESHOLD = 5_000;

export interface ExportsJob {
  exportId: string;
}

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);
  private readonly pending: string[] = [];
  private draining = false;

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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException("User not found");

    const rows = await this.authorRowCount(userId);
    const created = await this.prisma.dataExport.create({
      data: {
        userId,
        userEmail: user.email,
        filename: `janosik-user-${userId}.json`,
        createdBy: adminEmail,
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
      },
    });

    if (rows <= SMALL_THRESHOLD) {
      await this.build(created.id).catch((error: unknown) => {
        this.logger.warn(`Inline export failed: ${String(error)}`);
      });
    } else {
      await this.enqueue(created.id);
    }
    return this.row(created.id);
  }

  private async authorRowCount(userId: string): Promise<number> {
    const [comments, commands, activity] = await this.prisma.$transaction([
      this.prisma.comment.count({ where: { authorId: userId } }),
      this.prisma.command.count({ where: { actorId: userId } }),
      this.prisma.activity.count({ where: { actorId: userId } }),
    ]);
    return comments + commands + activity;
  }

  private async enqueue(exportId: string): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add(EXPORTS_JOB, { exportId }, DEFAULT_JOB_OPTIONS);
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

  /** Builds the bundle and stores the artifact (worker entry point). */
  async build(exportId: string): Promise<void> {
    const row = await this.prisma.dataExport.findUnique({
      where: { id: exportId },
    });
    if (!row) return;
    try {
      const bundle = await this.admin.buildUserBundle(row.userId);
      await this.storage.ensureDirs();
      const storedName = `export-${randomUUID()}.json`;
      const absPath = this.storage.attachmentPath(storedName);
      const body = Buffer.from(JSON.stringify(bundle.data, null, 2), "utf8");
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
    } catch (error) {
      await this.prisma.dataExport.update({
        where: { id: exportId },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "unknown",
        },
      });
      this.logger.warn(`Export ${exportId} failed: ${String(error)}`);
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
    return {
      absPath: this.storage.attachmentPath(row.storedName),
      filename: row.filename,
    };
  }

  /** Deletes expired exports (files + rows); used by the maintenance sweep. */
  async sweepExpired(): Promise<number> {
    const stale = await this.prisma.dataExport.findMany({
      where: { expiresAt: { lt: new Date() } },
      select: { id: true, storedName: true },
    });
    for (const row of stale) {
      if (row.storedName) {
        await this.storage
          .remove(this.storage.attachmentPath(row.storedName))
          .catch(() => undefined);
      }
    }
    if (stale.length > 0) {
      await this.prisma.dataExport.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
    }
    return stale.length;
  }

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
        if (exportId) await this.build(exportId);
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
