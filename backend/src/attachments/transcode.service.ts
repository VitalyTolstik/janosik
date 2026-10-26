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
 * TASK-50 — the video "ужиматор". Every video upload is re-encoded in the
 * background to a compact, universally playable H.264/AAC MP4 (the way top
 * resources do it): same `<id>/content` URL keeps serving the file, but
 * after a successful job it streams the MP4 — typically 50–80% smaller for
 * phone/screen recordings. The original is removed only after the encode
 * succeeds; on failure the original stays and plays as-is (`failed`).
 *
 * TASK-66 — the queue is now BullMQ (Redis) when `REDIS_URL` is set: jobs
 * survive a restart, `failed` encodes retry with backoff, and encodes can be
 * scaled across worker processes/nodes (ffmpeg is CPU-bound, so this is real
 * throughput). A deterministic `jobId` (= the attachment id) makes a repeat
 * `enqueue` a no-op. Without Redis it falls back to the original in-process
 * FIFO (one encode at a time), which is what self-host/tests use. Either way
 * `pending` rows are re-queued on boot, so a crash mid-encode loses nothing.
 */

/** Where the encode lands: ≤1080p, x264 CRF 25 — visually transparent for
 * recordings, fast enough for a 25 MB clip, `+faststart` for streaming. */
export function buildTranscodeArgs(input: string, output: string): string[] {
  return [
    "-y",
    "-i",
    input,
    "-vf",
    "scale='min(1920,iw)':-2",
    "-c:v",
    "libx264",
    "-crf",
    "25",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    output,
  ];
}

/** Hard cap per job — a stuck encode must not hold the queue forever. */
const ENCODE_TIMEOUT_MS = 10 * 60 * 1000;

export const TRANSCODE_QUEUE = QUEUE_NAMES.transcode;
export const TRANSCODE_JOB = "transcode";

export interface TranscodeJob {
  attachmentId: string;
}

@Injectable()
export class TranscodeService implements OnModuleInit {
  private readonly logger = new Logger(TranscodeService.name);
  /** In-process fallback: one encode at a time, the rest wait in line. */
  private chain: Promise<void> = Promise.resolve();
  /** Ids already queued (dedupes boot-recovery vs. upload enqueue). */
  private readonly queued = new Set<string>();
  private processed = 0;
  private failed = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    @Optional()
    @InjectQueue(TRANSCODE_QUEUE)
    private readonly queue?: Queue<TranscodeJob>,
  ) {}

  /** True when the BullMQ/Redis backend is active. */
  get usingRedis(): boolean {
    return this.queue !== undefined;
  }

  /** Boot recovery: rows stuck in `pending` (restart mid-encode) re-queue. */
  onModuleInit(): void {
    void this.prisma.attachment
      .findMany({
        where: { deletedAt: null, transcodeStatus: "pending" },
        select: { id: true },
      })
      .then((rows) => {
        for (const { id } of rows) this.enqueue(id);
        if (rows.length > 0) {
          this.logger.log(`Re-queued ${rows.length} pending video encode(s)`);
        }
      })
      .catch((error: unknown) => {
        this.logger.error(`Boot recovery failed: ${String(error)}`);
      });
  }

  /** Queue one attachment for encoding; safe to call twice for the same id. */
  enqueue(attachmentId: string): void {
    if (this.queue) {
      // Deterministic id: a second enqueue for the same attachment is a no-op
      // even across processes (BullMQ dedupes by jobId while it is pending).
      void this.queue
        .add(
          TRANSCODE_JOB,
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
        this.logger.error(`Encode of ${attachmentId} failed: ${String(error)}`);
      })
      .finally(() => {
        this.queued.delete(attachmentId);
      });
  }

  /**
   * Encode one attachment. Shared by the BullMQ worker and the in-process
   * fallback, so both backends run the exact same code. Rejections propagate
   * (the worker retries on them); the row is already marked `failed`.
   */
  async process(attachmentId: string): Promise<void> {
    const row = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, deletedAt: null },
      select: {
        id: true,
        cardId: true,
        boardId: true,
        storedName: true,
        transcodeStatus: true,
      },
    });
    // Deleted (or already finished by a previous boot's queue) meanwhile.
    if (!row || row.transcodeStatus !== "pending") return;

    const original = this.storage.attachmentPath(row.storedName);
    const tmpOutput = path.join(
      path.dirname(original),
      `.tmp-${randomUUID()}.mp4`,
    );
    try {
      await this.encode(original, tmpOutput);

      // A poster-quality re-encode: swap the blob, update the metadata —
      // the content URL never changes, so players just keep working.
      const finalName = `${randomUUID()}.mp4`;
      const finalPath = this.storage.attachmentPath(finalName);
      await rename(tmpOutput, finalPath);
      const { size } = await stat(finalPath);
      const updated = await this.prisma.attachment.updateMany({
        where: { id: row.id, deletedAt: null },
        data: {
          storedName: finalName,
          mimeType: "video/mp4",
          sizeBytes: size,
          transcodeStatus: "done",
        },
      });
      // The loser of a race with delete/remove: drop the fresh MP4 too.
      if (updated.count === 0) {
        await rm(finalPath, { force: true });
        return;
      }
      await rm(original, { force: true });
      this.processed += 1;
      this.logger.log(
        `Encoded ${row.id}: ${(size / 1024 / 1024).toFixed(1)} MB mp4`,
      );
      this.publish(row);
    } catch (error) {
      await rm(tmpOutput, { force: true });
      await this.prisma.attachment.updateMany({
        where: { id: row.id, deletedAt: null },
        data: { transcodeStatus: "failed" },
      });
      this.failed += 1;
      this.publish(row);
      throw error;
    }
  }

  /** Queue counts for observability (DB counts live in ObservabilityService). */
  async stats(): Promise<QueueStats> {
    if (this.queue) return redisQueueStats(this.queue);
    return {
      pending: this.queued.size,
      processed: this.processed,
      failed: this.failed,
      backend: "memory",
    };
  }

  /** Spawn ffmpeg once; rejects on non-zero exit or the timeout. */
  private encode(input: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath ?? "ffmpeg", [
        ...buildTranscodeArgs(input, output),
        "-hide_banner",
        "-loglevel",
        "error",
      ]);
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`encode timed out after ${ENCODE_TIMEOUT_MS} ms`));
      }, ENCODE_TIMEOUT_MS);
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.on("error", (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
        }
      });
    });
  }

  /** Live frame so open dialogs re-read the (new) size/status. */
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
