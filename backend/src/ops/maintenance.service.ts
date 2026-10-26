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

  /** Hard-deletes soft-deleted rows past the retention window (TASK-38a/63). */
  async purgeSoftDeleted(): Promise<number> {
    const days = await this.retentionDays();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const stale = { deletedAt: { not: null, lte: cutoff } } as const;
    const blobs = await this.prisma.attachment.findMany({
      where: stale,
      select: { storedName: true, thumbnailName: true, posterName: true },
    });
    const affected = await this.prisma.$transaction(async (tx) => {
      let count = 0;
      count += (await tx.attachment.deleteMany({ where: stale })).count;
      count += (await tx.comment.deleteMany({ where: stale })).count;
      count += (await tx.checklistItem.deleteMany({ where: stale })).count;
      count += (await tx.checklist.deleteMany({ where: stale })).count;
      count += (await tx.cardLink.deleteMany({ where: stale })).count;
      count += (
        await tx.column.deleteMany({
          where: { ...stale, cards: { none: {} } },
        })
      ).count;
      count += (
        await tx.label.deleteMany({
          where: { ...stale, cards: { none: {} } },
        })
      ).count;
      const cards = await tx.card.findMany({
        where: stale,
        select: { id: true },
      });
      for (const card of cards) {
        await tx.checklistItem.deleteMany({
          where: { checklist: { cardId: card.id } },
        });
        await tx.checklist.deleteMany({ where: { cardId: card.id } });
        await tx.cardLabel.deleteMany({ where: { cardId: card.id } });
        await tx.cardLink.deleteMany({
          where: { OR: [{ fromCardId: card.id }, { toCardId: card.id }] },
        });
        await tx.comment.deleteMany({ where: { cardId: card.id } });
        await tx.attachment.deleteMany({ where: { cardId: card.id } });
        await tx.card.delete({ where: { id: card.id } });
        count += 1;
      }
      return count;
    });
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
    return affected;
  }

  /** Expired or consumed verification / email-change codes. */
  async sweepCodes(): Promise<number> {
    const now = new Date();
    const [verify, change] = await this.prisma.$transaction([
      this.prisma.emailVerificationCode.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }],
        },
      }),
      this.prisma.emailChangeCode.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }],
        },
      }),
    ]);
    return verify.count + change.count;
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

  /** Board shares past their TTL (live shares have no expiry and stay). */
  async sweepShares(): Promise<number> {
    const result = await this.prisma.boardShare.deleteMany({
      where: { expiresAt: { not: null, lt: new Date() } },
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
    const result = await this.prisma.command.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
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
   * Blobs no row points at anymore (failed uploads, missed deletes), older
   * than the grace window (TASK-77).
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
    return removed;
  }
}
