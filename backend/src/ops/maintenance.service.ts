import { Injectable, Logger } from "@nestjs/common";
import { env } from "@/config/env";
import { PrismaService } from "@/common/prisma/prisma.service";
import { StorageService } from "@/attachments/storage.service";
import { OpsSettingsService } from "./ops-settings.service";

/**
 * TASK-68 — regular housekeeping. Everything that used to accumulate
 * forever is swept by a named job: soft-deleted rows past the retention
 * window, expired/consumed verification + email-change codes, dead refresh
 * tokens (user and admin), expired board shares, lapsed invitations and
 * orphaned blobs. Each sweep returns a count so the panel and the audit log
 * can show what a run actually removed; every sweep is idempotent.
 */
export const MAINTENANCE_JOBS = [
  "purge-soft-deleted",
  "sweep-codes",
  "sweep-tokens",
  "sweep-shares",
  "sweep-invitations",
  "sweep-exports",
  "sweep-commands",
  "sweep-reminders",
  "sweep-activity",
  "sweep-audit",
  "sweep-orphan-blobs",
] as const;

export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[number] | "all";

/**
 * TASK-77: how long a blob must sit unreferenced before the orphan sweep may
 * delete it. Blobs are written *before* their DB row commits (upload, media
 * rename, export), so without this window a sweep racing an in-flight write
 * would delete a live file.
 */
const ORPHAN_GRACE_MS = 3_600_000;

export interface MaintenanceRunResult {
  job: MaintenanceJobName;
  removed: number;
  detail?: string;
}

/** Rows per purge transaction (B-7). */
export const PURGE_CHUNK = 500;
/** Safety bound on chunks per table per run (500 × 200 = 100k rows). */
const PURGE_MAX_CHUNKS = 200;

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ops: OpsSettingsService,
  ) {}

  /** Runs one named sweep, or all of them. */
  async run(job: MaintenanceJobName): Promise<MaintenanceRunResult[]> {
    if (job === "all") {
      const results: MaintenanceRunResult[] = [];
      for (const name of MAINTENANCE_JOBS) {
        results.push(...(await this.run(name)));
      }
      return results;
    }
    const removed = await this.dispatch(job);
    this.logger.log(`maintenance ${job}: removed ${removed}`);
    return [{ job, removed }];
  }

  private async dispatch(job: MaintenanceJobName): Promise<number> {
    switch (job) {
      case "purge-soft-deleted":
        return this.purgeSoftDeleted();
      case "sweep-codes":
        return this.sweepCodes();
      case "sweep-tokens":
        return this.sweepTokens();
      case "sweep-shares":
        return this.sweepShares();
      case "sweep-invitations":
        return this.sweepInvitations();
      case "sweep-exports":
        return this.sweepExports();
      case "sweep-commands":
        return this.sweepCommands();
      case "sweep-reminders":
        return this.sweepReminders();
      case "sweep-activity":
        return this.sweepActivity();
      case "sweep-audit":
        return this.sweepAudit();
      case "sweep-orphan-blobs":
        return this.sweepOrphanBlobs();
      default:
        return 0;
    }
  }

  /**
   * Retention window in days: the master-panel setting when present, else the
   * `PURGE_AFTER_DAYS` env (TASK-38a), else 30 — so a bare self-host with no
   * panel changes still has a sane window.
   */
  private async retentionDays(): Promise<number> {
    return (await this.ops.retentionDays()) ?? env.PURGE_AFTER_DAYS;
  }

  /**
   * Hard-deletes soft-deleted rows past the retention window (TASK-38a/63).
   *
   * B-7: chunked. One unbounded transaction over every stale row of every
   * table held locks (and a connection) for as long as the purge took — on a
   * large instance, minutes. Each chunk is now its own short transaction of
   * at most `PURGE_CHUNK` ids; a crash mid-run leaves only fully-purged
   * chunks behind and the next run picks up the rest. Parents go last:
   * children first, then cards (with everything hanging off them), then the
   * columns/labels that no longer hold any card.
   */
  async purgeSoftDeleted(): Promise<number> {
    const days = await this.retentionDays();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const stale = { deletedAt: { not: null, lte: cutoff } } as const;
    let count = 0;

    count += await this.purgeChunks(
      (take) =>
        this.prisma.attachment.findMany({
          where: stale,
          select: {
            id: true,
            storedName: true,
            thumbnailName: true,
            posterName: true,
          },
          take,
        }),
      async (rows) => {
        const removed = await this.prisma.attachment.deleteMany({
          where: { id: { in: rows.map((row) => row.id) } },
        });
        await this.removeBlobs(rows);
        return removed.count;
      },
    );
    count += await this.purgeChunks(
      (take) =>
        this.prisma.comment.findMany({
          where: stale,
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.comment.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
    count += await this.purgeChunks(
      (take) =>
        this.prisma.checklistItem.findMany({
          where: stale,
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.checklistItem.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
    count += await this.purgeChunks(
      (take) =>
        this.prisma.checklist.findMany({
          where: stale,
          select: { id: true },
          take,
        }),
      async (rows) => {
        const ids = rows.map((row) => row.id);
        const [, removed] = await this.prisma.$transaction([
          this.prisma.checklistItem.deleteMany({
            where: { checklistId: { in: ids } },
          }),
          this.prisma.checklist.deleteMany({ where: { id: { in: ids } } }),
        ]);
        return removed.count;
      },
    );
    count += await this.purgeChunks(
      (take) =>
        this.prisma.cardLink.findMany({
          where: stale,
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.cardLink.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
    // Cards with everything that hangs off them, one chunk per transaction.
    count += await this.purgeChunks(
      (take) =>
        this.prisma.card.findMany({ where: stale, select: { id: true }, take }),
      async (rows) => {
        const ids = rows.map((row) => row.id);
        const blobs = await this.prisma.attachment.findMany({
          where: { cardId: { in: ids } },
          select: { storedName: true, thumbnailName: true, posterName: true },
        });
        const results = await this.prisma.$transaction([
          this.prisma.checklistItem.deleteMany({
            where: { checklist: { cardId: { in: ids } } },
          }),
          this.prisma.checklist.deleteMany({ where: { cardId: { in: ids } } }),
          this.prisma.cardLabel.deleteMany({ where: { cardId: { in: ids } } }),
          this.prisma.cardLink.deleteMany({
            where: {
              OR: [{ fromCardId: { in: ids } }, { toCardId: { in: ids } }],
            },
          }),
          this.prisma.comment.deleteMany({ where: { cardId: { in: ids } } }),
          this.prisma.attachment.deleteMany({ where: { cardId: { in: ids } } }),
          this.prisma.card.deleteMany({ where: { id: { in: ids } } }),
        ]);
        // A purged card's attachment blobs go with it (they were never
        // soft-deleted themselves, so the attachment pass above missed them).
        await this.removeBlobs(blobs);
        return results[results.length - 1].count;
      },
    );
    // Containers last, once they no longer hold any card.
    count += (
      await this.prisma.column.deleteMany({
        where: { ...stale, cards: { none: {} } },
      })
    ).count;
    count += (
      await this.prisma.label.deleteMany({
        where: { ...stale, cards: { none: {} } },
      })
    ).count;
    // Boards last: a deleted board keeps its row (and its feed/log/shares)
    // until the window passes, then the whole subtree goes — cards and their
    // blobs were already reclaimed by the passes above, but a chunk retried
    // after a crash may still find children, so delete them here too.
    count += await this.purgeChunks(
      (take) =>
        this.prisma.board.findMany({
          where: stale,
          select: { id: true },
          take,
        }),
      async (rows) => {
        const ids = rows.map((row) => row.id);
        // Purge the cards in bounded pages (TASK-156): a single huge board
        // used to load every card/attachment at once and delete them in one
        // transaction — unbounded memory, bind-parameter blow-ups and a long
        // lock. Each page is its own small transaction.
        for (;;) {
          const cards = await this.prisma.card.findMany({
            where: { column: { boardId: { in: ids } } },
            select: { id: true },
            take: PURGE_CHUNK,
          });
          if (cards.length === 0) break;
          const cardIds = cards.map((card) => card.id);
          const blobs = await this.prisma.attachment.findMany({
            where: { cardId: { in: cardIds } },
            select: {
              storedName: true,
              thumbnailName: true,
              posterName: true,
            },
          });
          await this.prisma.$transaction([
            this.prisma.checklistItem.deleteMany({
              where: { checklist: { cardId: { in: cardIds } } },
            }),
            this.prisma.checklist.deleteMany({
              where: { cardId: { in: cardIds } },
            }),
            this.prisma.cardLabel.deleteMany({
              where: { cardId: { in: cardIds } },
            }),
            this.prisma.cardLink.deleteMany({
              where: {
                OR: [
                  { fromCardId: { in: cardIds } },
                  { toCardId: { in: cardIds } },
                ],
              },
            }),
            this.prisma.comment.deleteMany({
              where: { cardId: { in: cardIds } },
            }),
            this.prisma.attachment.deleteMany({
              where: { cardId: { in: cardIds } },
            }),
            this.prisma.card.deleteMany({ where: { id: { in: cardIds } } }),
          ]);
          await this.removeBlobs(blobs);
          if (cards.length < PURGE_CHUNK) break;
        }
        const results = await this.prisma.$transaction([
          this.prisma.checklistItem.deleteMany({
            where: {
              checklist: { card: { column: { boardId: { in: ids } } } },
            },
          }),
          this.prisma.checklist.deleteMany({
            where: { card: { column: { boardId: { in: ids } } } },
          }),
          this.prisma.cardLabel.deleteMany({
            where: { card: { column: { boardId: { in: ids } } } },
          }),
          this.prisma.cardLink.deleteMany({ where: { boardId: { in: ids } } }),
          this.prisma.comment.deleteMany({
            where: { card: { column: { boardId: { in: ids } } } },
          }),
          this.prisma.attachment.deleteMany({
            where: { card: { column: { boardId: { in: ids } } } },
          }),
          this.prisma.card.deleteMany({
            where: { column: { boardId: { in: ids } } },
          }),
          this.prisma.column.deleteMany({ where: { boardId: { in: ids } } }),
          this.prisma.label.deleteMany({ where: { boardId: { in: ids } } }),
          this.prisma.activity.deleteMany({ where: { boardId: { in: ids } } }),
          this.prisma.command.deleteMany({ where: { boardId: { in: ids } } }),
          // Snapshot shares are detached by the FK (`SET NULL`) and keep
          // serving; only a live share dies with its board (TASK-156).
          this.prisma.boardShare.deleteMany({
            where: { boardId: { in: ids }, mode: "live" },
          }),
          this.prisma.boardMember.deleteMany({
            where: { boardId: { in: ids } },
          }),
          this.prisma.board.deleteMany({ where: { id: { in: ids } } }),
        ]);
        return results[results.length - 1].count;
      },
    );
    return count;
  }

  /**
   * Drain `find` → `purge` in chunks of `PURGE_CHUNK` until a short page.
   * Bounded by `PURGE_MAX_CHUNKS` so one run can never spin forever (a row
   * that refuses to go — say an FK the purge does not know about — would
   * otherwise be found again and again).
   */
  private async purgeChunks<T>(
    find: (take: number) => Promise<T[]>,
    purge: (rows: T[]) => Promise<number>,
  ): Promise<number> {
    let total = 0;
    for (let chunk = 0; chunk < PURGE_MAX_CHUNKS; chunk += 1) {
      const rows = await find(PURGE_CHUNK);
      if (rows.length === 0) break;
      total += await purge(rows);
      if (rows.length < PURGE_CHUNK) break;
    }
    return total;
  }

  private async removeBlobs(
    blobs: Array<{
      storedName: string;
      thumbnailName: string | null;
      posterName: string | null;
    }>,
  ): Promise<void> {
    for (const blob of blobs) {
      for (const name of [
        blob.storedName,
        blob.thumbnailName,
        blob.posterName,
      ]) {
        if (name) {
          await this.storage
            .remove(this.storage.attachmentPath(name))
            .catch(() => undefined);
        }
      }
    }
  }

  /** Expired or consumed verification / email-change codes. */
  async sweepCodes(): Promise<number> {
    const now = new Date();
    const staleVerify = {
      OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }],
    };
    const staleChange = {
      OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }],
    };
    let removed = 0;
    // Bounded pages (TASK-156): one `deleteMany` over a large table is a long
    // transaction and a spike on the write path.
    removed += await this.purgeChunks(
      (take) =>
        this.prisma.emailVerificationCode.findMany({
          where: staleVerify,
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.emailVerificationCode.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
    removed += await this.purgeChunks(
      (take) =>
        this.prisma.emailChangeCode.findMany({
          where: staleChange,
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.emailChangeCode.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
    return removed;
  }

  /** Dead sessions: expired or long-revoked refresh tokens (user + admin). */
  async sweepTokens(): Promise<number> {
    const now = new Date();
    const revokedBefore = new Date(now.getTime() - 86_400_000);
    const [user, admin] = await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { revokedAt: { lt: revokedBefore } },
          ],
        },
      }),
      this.prisma.adminRefreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { revokedAt: { lt: revokedBefore } },
          ],
        },
      }),
    ]);
    return user.count + admin.count;
  }

  /** Board shares past their TTL or long revoked (TASK-148 covers revokes). */
  async sweepShares(): Promise<number> {
    const now = new Date();
    const revokedBefore = new Date(now.getTime() - 86_400_000);
    const result = await this.prisma.boardShare.deleteMany({
      where: {
        OR: [
          { expiresAt: { not: null, lt: now } },
          { revokedAt: { not: null, lt: revokedBefore } },
        ],
      },
    });
    return result.count;
  }

  /** Lapsed invitations: still pending and past their expiry. */
  async sweepInvitations(): Promise<number> {
    const result = await this.prisma.boardMember.deleteMany({
      where: {
        acceptedAt: null,
        expiresAt: { not: null, lt: new Date() },
      },
    });
    return result.count;
  }

  /** Expired background data exports (TASK-71): files + rows. */
  async sweepExports(): Promise<number> {
    return this.purgeChunks(
      (take) =>
        this.prisma.dataExport.findMany({
          where: { expiresAt: { lt: new Date() } },
          select: { id: true, storedName: true },
          take,
        }),
      async (rows) => {
        for (const row of rows) {
          if (row.storedName) {
            await this.storage
              .remove(this.storage.attachmentPath(row.storedName))
              .catch(() => undefined);
          }
        }
        return (
          await this.prisma.dataExport.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count;
      },
    );
  }

  /**
   * Trims the command log to the retention window (TASK-84). The `Command`
   * table is the board's replay log and grows forever otherwise; a client
   * whose `seq` baseline falls outside the window simply re-reads the board
   * envelope on its next connection. Window = `OpsSettings.retentionDays`
   * (same knob as the soft-delete purge), default 30 days.
   */
  async sweepCommands(): Promise<number> {
    const days = await this.retentionDays();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const stale = { createdAt: { lt: cutoff } };
    return this.purgeChunks(
      (take) =>
        this.prisma.command.findMany({
          where: stale,
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.command.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
  }

  /**
   * Due-reminder dedupe rows past their usefulness (TASK-83). A card whose
   * dueDate is more than the retention window in the past will never be
   * reminded again, so its marker can go.
   */
  async sweepReminders(): Promise<number> {
    const days = await this.retentionDays();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const result = await this.prisma.reminderSent.deleteMany({
      where: { dueDate: { lt: cutoff } },
    });
    return result.count;
  }

  /**
   * Keeps the board feed inside the retention window (TASK-148, B9). Membership
   * and comment events used to be kept forever; past the window the command
   * log they mirror is gone anyway, so the row adds only storage.
   */
  async sweepActivity(): Promise<number> {
    const days = await this.retentionDays();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const stale = { createdAt: { lt: cutoff } };
    return this.purgeChunks(
      (take) =>
        this.prisma.activity.findMany({
          where: stale,
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.activity.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
  }

  /**
   * Trims the master audit trail after a longer, separate window (TASK-148,
   * B9): accountability wants history, but not unbounded growth. Default one
   * year (`AUDIT_RETENTION_DAYS`).
   */
  async sweepAudit(): Promise<number> {
    const cutoff = new Date(Date.now() - env.AUDIT_RETENTION_DAYS * 86_400_000);
    const stale = { createdAt: { lt: cutoff } };
    return this.purgeChunks(
      (take) =>
        this.prisma.adminAuditLog.findMany({
          where: stale,
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.adminAuditLog.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
  }

  /**
   * Blobs no row points at anymore (failed uploads, missed deletes), older
   * than the grace window (TASK-77), plus the `.tmp-*` scratch files ffmpeg
   * leaves behind when a derive/encode is killed (TASK-107/OOM, TASK-148).
   */
  async sweepOrphanBlobs(): Promise<number> {
    const [attachments, users, exports] = await Promise.all([
      this.prisma.attachment.findMany({
        select: { storedName: true, thumbnailName: true, posterName: true },
      }),
      this.prisma.user.findMany({
        where: { avatarPath: { not: null } },
        select: { avatarPath: true },
      }),
      this.prisma.dataExport.findMany({
        where: { storedName: { not: null } },
        select: { storedName: true },
      }),
    ]);
    const referenced = new Set<string>();
    for (const row of attachments) {
      for (const name of [row.storedName, row.thumbnailName, row.posterName]) {
        if (name) referenced.add(name);
      }
    }
    for (const user of users) {
      if (user.avatarPath) referenced.add(user.avatarPath);
    }
    for (const row of exports) {
      if (row.storedName) referenced.add(row.storedName);
    }
    const blobs = await this.storage.listBlobs();
    // Spare anything written inside the grace window: its row may still be
    // in flight (blobs land before the DB commit — TASK-77).
    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    let removed = 0;
    for (const blob of blobs) {
      if (referenced.has(blob.name)) continue;
      if (blob.mtimeMs > cutoff) continue;
      await this.storage.remove(blob.absPath);
      removed += 1;
    }
    // TASK-148 (B22): the scan above skips `.tmp-*`; those are pure scratch.
    // A live transcode/media run touches its temp within the grace window, so
    // only truly abandoned ones go.
    for (const blob of await this.storage.listTempBlobs()) {
      if (blob.mtimeMs > cutoff) continue;
      await this.storage.remove(blob.absPath);
      removed += 1;
    }
    return removed;
  }
}
