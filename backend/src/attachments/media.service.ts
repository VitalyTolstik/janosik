import { spawn } from "node:child_process";
import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Injectable, Logger, Optional, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import ffmpegPath from "ffmpeg-static";

import { PrismaService } from "@/common/prisma/prisma.service";
import { RealtimeService } from "@/realtime/realtime.service";
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  redisQueueStats,
  type QueueStats,
} from "@/ops/queue-core";
import { StorageService } from "./storage.service";

/**
 * TASK-70 — media derivatives. Two cheap, ffmpeg-made previews that keep the
 * UI from downloading full blobs: a **thumbnail** for images (lists/cards)
 * and a **poster frame** for videos (the first meaningful frame). Generated
 * in the background on upload (queue `media`, BullMQ when `REDIS_URL` is set,
 * otherwise an in-process FIFO), stored next to the original as
 * `thumb-*.jpg` / `poster-*.jpg` and served by `GET /attachments/:id/thumbnail`
 * and `/poster` with cache headers; a missing derivative falls back to the
 * original blob (images) or the plain player (videos).
 *
 * Generation never blocks the upload and is idempotent (a `jobId` = the
 * attachment id), so re-uploading or a restart mid-job is safe.
 */

const DERIVE_TIMEOUT_MS = 60 * 1000;

export const MEDIA_QUEUE = QUEUE_NAMES.media;
export const MEDIA_JOB = "derive";

export interface MediaJob {
  attachmentId: string;
}

/** Thumbnail for an image — one frame, capped at 320px wide. */
export function buildThumbArgs(input: string, output: string): string[] {
  return [
    "-y",
    "-i",
    input,
    "-vf",
    "scale='min(320,iw)':-2",
    "-frames:v",
    "1",
    output,
  ];
}

/** Poster for a video — one frame in, capped at 640px wide. */
export function buildPosterArgs(input: string, output: string): string[] {
  return [
    "-y",
    "-ss",
    "0.5",
    "-i",
    input,
    "-vf",
    "scale='min(640,iw)':-2",
    "-frames:v",
    "1",
    output,
  ];
}

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private chain: Promise<void> = Promise.resolve();
  private readonly queued = new Set<string>();
  private processed = 0;
  private failed = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    @Optional()
    @InjectQueue(MEDIA_QUEUE)
    private readonly queue?: Queue<MediaJob>,
  ) {}

  get usingRedis(): boolean {
    return this.queue !== undefined;
  }

  /** Boot recovery: rows whose derivatives never finished re-queue. */
  onModuleInit(): void {
    void this.prisma.attachment
      .findMany({
        where: { deletedAt: null, derivativeStatus: "pending" },
        select: { id: true },
      })
      .then((rows) => {
        for (const { id } of rows) this.enqueue(id);
        if (rows.length > 0) {
          this.logger.log(`Re-queued ${rows.length} media derive job(s)`);
        }
      })
      .catch((error: unknown) => {
        this.logger.error(`Boot recovery failed: ${String(error)}`);
      });
  }

  /** Queue one attachment for derivative generation; safe to call twice. */
  enqueue(attachmentId: string): void {
    if (this.queue) {
      void this.queue
        .add(
          MEDIA_JOB,
          { attachmentId },
          { ...DEFAULT_JOB_OPTIONS, jobId: attachmentId },
        )
        .catch((error: unknown) => {
          this.logger.warn(
            `BullMQ enqueue failed, falling back to in-process: ${
              error instanceof Error ? error.message : "unknown"
            }`,
          );
          this.enqueueInProcess(attachmentId);
        });
      return;
    }
    this.enqueueInProcess(attachmentId);
  }

  private enqueueInProcess(attachmentId: string): void {
    if (this.queued.has(attachmentId)) return;
    this.queued.add(attachmentId);
    this.chain = this.chain
      .then(() => this.process(attachmentId))
      .catch((error: unknown) => {
        this.logger.error(`Derive of ${attachmentId} failed: ${String(error)}`);
      })
      .finally(() => this.queued.delete(attachmentId));
  }

  /**
   * Generate the derivatives for one attachment (shared by both backends).
   *
   * TASK-148 (B21): a rejection must reach BullMQ or `attempts: 3` never
   * fires; while attempts remain the row stays `pending` (so the next run's
   * guard does not no-op) and only the final attempt settles on `failed`.
   */
  async process(
    attachmentId: string,
    retry?: { attemptsMade: number; attempts: number },
  ): Promise<void> {
    const row = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, deletedAt: null },
      select: {
        id: true,
        cardId: true,
        boardId: true,
        storedName: true,
        mimeType: true,
        derivativeStatus: true,
        thumbnailName: true,
        posterName: true,
      },
    });
    if (!row) return;

    const isImage = row.mimeType.startsWith("image/");

    // Idempotency (TASK-107): a re-run must not mint a second derivative and
    // orphan the first. If the work is already done and the blob is present,
    // leave it alone.
    if (row.derivativeStatus === "done") {
      const existing =
        isImage && row.thumbnailName
          ? row.thumbnailName
          : !isImage && row.posterName
            ? row.posterName
            : null;
      if (existing) {
        try {
          await stat(this.storage.attachmentPath(existing));
          return;
        } catch {
          // The derivative went missing — regenerate it below.
        }
      }
    }
    const isVideo = row.mimeType.startsWith("video/");
    if (!isImage && !isVideo) {
      await this.prisma.attachment.updateMany({
        where: { id: row.id, deletedAt: null },
        data: { derivativeStatus: "none" },
      });
      return;
    }

    const original = this.storage.attachmentPath(row.storedName);
    const dir = path.dirname(original);
    const data: Record<string, string> = {};
    const created: string[] = [];
    try {
      if (isImage) {
        const tmp = path.join(dir, `.tmp-${randomUUID()}.jpg`);
        await this.derive(buildThumbArgs(original, tmp), tmp);
        const name = `thumb-${randomUUID()}.jpg`;
        await rename(tmp, this.storage.attachmentPath(name));
        data.thumbnailName = name;
        created.push(name);
      } else {
        const tmp = path.join(dir, `.tmp-${randomUUID()}.jpg`);
        await this.derive(buildPosterArgs(original, tmp), tmp);
        const name = `poster-${randomUUID()}.jpg`;
        await rename(tmp, this.storage.attachmentPath(name));
        data.posterName = name;
        created.push(name);
      }
      const updated = await this.prisma.attachment.updateMany({
        where: { id: row.id, deletedAt: null },
        data: { ...data, derivativeStatus: "done" },
      });
      if (updated.count === 0) {
        for (const name of created) {
          await rm(this.storage.attachmentPath(name), { force: true });
        }
        return;
      }
      this.processed += 1;
      this.publish(row);
    } catch (error) {
      const willRetry =
        retry !== undefined && retry.attemptsMade + 1 < retry.attempts;
      if (!willRetry) {
        await this.prisma.attachment.updateMany({
          where: { id: row.id, deletedAt: null },
          data: { derivativeStatus: "failed" },
        });
        this.failed += 1;
      }
      this.logger.warn(
        `Derive of ${row.id} failed (attempt ${(retry?.attemptsMade ?? 0) + 1}${
          retry ? `/${retry.attempts}` : ""
        }): ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async stats(): Promise<QueueStats> {
    if (this.queue) return redisQueueStats(this.queue);
    return {
      pending: this.queued.size,
      processed: this.processed,
      failed: this.failed,
      backend: "memory",
    };
  }

  /** Spawn ffmpeg for one derivative; rejects on non-zero exit/timeout. */
  private derive(args: string[], output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        ffmpegPath ?? "ffmpeg",
        [...args, "-hide_banner", "-loglevel", "error", "-nostdin"],
        // No readers on the pipes: a full stderr buffer would deadlock ffmpeg.
        { stdio: ["ignore", "ignore", "ignore"] },
      );
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        // TASK-107: don't leak the partial `.tmp-` file when ffmpeg hangs —
        // the `close` handler may not fire after a SIGKILL.
        void rm(output, { force: true });
        reject(new Error(`derive timed out after ${DERIVE_TIMEOUT_MS} ms`));
      }, DERIVE_TIMEOUT_MS);
      child.on("error", (error: Error) => {
        clearTimeout(timer);
        void rm(output, { force: true }).then(() => reject(error));
      });
      child.on("close", async (code: number | null) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        await rm(output, { force: true });
        reject(new Error(`ffmpeg exited ${code}`));
      });
    });
  }

  /** Absolute path of a stored derivative, if it still exists. */
  async derivativePath(
    attachmentId: string,
    kind: "thumbnail" | "poster",
  ): Promise<string | null> {
    const row = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, deletedAt: null },
      select: { thumbnailName: true, posterName: true },
    });
    const name = kind === "thumbnail" ? row?.thumbnailName : row?.posterName;
    if (!name) return null;
    const abs = this.storage.attachmentPath(name);
    try {
      await stat(abs);
      return abs;
    } catch {
      return null;
    }
  }

  private publish(row: { cardId: string; boardId: string }): void {
    this.realtime.publish(row.boardId, {
      type: "activity",
      id: randomUUID(),
      boardId: row.boardId,
      cardId: row.cardId,
      actorId: "",
      at: Date.now(),
      kind: "attachment_updated",
      detail: row.cardId,
    });
  }
}
