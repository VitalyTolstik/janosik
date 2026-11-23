import { setTimeout as delay } from "node:timers/promises";
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { env } from "@/config/env";
import { ApprovalsService } from "@/approvals/approvals.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { StorageService } from "@/attachments/storage.service";
import {
  AccountDeletionService,
  ACCOUNT_DELETE_GRACE_DAYS,
  ACCOUNT_DELETE_SCHEDULED_ACTION,
  ACCOUNT_DELETE_CANCELLED_ACTION,
  BOARD_CLEANUP_FAILED_ACTION,
} from "@/users/account-deletion.service";
import { OpsSettingsService } from "./ops-settings.service";
import { AttentionService } from "@/notifications/attention.service";
import {
  COMMENT_ACTIVITY_TYPES,
  COMMENT_HISTORY_STATE_SELECT,
  deleteCommentActivitySnapshots,
  lockBoardWrites,
  markHistoryIncomplete,
  verifyCommentHistory,
} from "@/comments/comment-history";
import {
  COMMAND_LOG_TABLES,
  isWholeMonthExpired,
  parseCommandPartitionMonth,
  partitionMonthsToEnsure,
} from "@/commands/command-log-partitions";
import { commandKeyBoardIndexState } from "@/commands/command-key-index";
/**
 * TASK-68 — regular housekeeping. Everything that used to accumulate
 * forever is swept by a named job: soft-deleted rows past the retention
 * window, expired/consumed verification + email-change codes, dead refresh
 * tokens (user and admin), expired board shares, lapsed invitations and
 * orphaned blobs. Each sweep returns a count so the panel and the audit log
 * can show what a run actually removed; every sweep is idempotent.
 */
export const MAINTENANCE_JOBS = [
  // TASK-200.11: build the deferred CommandKey(boardId) index before any
  // board-scoped purge/demo scan can run. On a large registry migration 6
  // skips the inline build; the purge's orphan passes need this index.
  "ensure-command-key-index",
  // TASK-185.6 review: repair legacy Activity links before the purge can
  // delete a comment. The purge also matches `details.commentId`, so a direct
  // `purge-soft-deleted` run is safe too.
  "sweep-comment-history",
  "purge-soft-deleted",
  "sweep-codes",
  "sweep-tokens",
  "sweep-shares",
  "sweep-invitations",
  "sweep-claims",
  "sweep-exports",
  "sweep-commands",
  "ensure-command-partitions",
  "sweep-runs",
  "sweep-agent-sessions",
  "sweep-approvals",
  "sweep-reminders",
  "sweep-activity",
  "sweep-audit",
  "sweep-accounts",
  "sweep-unverified-users",
  "sweep-orphan-boards",
  "sweep-security-audit",
  "sweep-orphan-blobs",
  "sweep-idempotency",
  "sweep-attention",
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
/**
 * TASK-200.11: the command log is the only table whose inflow alone can beat
 * the generic budget (50 commands/s = 4.32M/day; 100k/hour = 2.4M/day). A
 * dedicated 1,000-row chunk × 1,000 chunks allows 1M command rows per run per
 * table, i.e. 24M/day at the hourly cadence — above target load — while still
 * bounding a single run. This is a drain budget, not a retention guarantee;
 * see the size plan in `docs/TASK-200.11-command-log-partitioning.md`.
 */
export const COMMAND_PURGE_CHUNK = 1_000;
export const COMMAND_PURGE_MAX_CHUNKS = 1_000;
/**
 * The board-subtree purge runs in one board-locked transaction so a restore
 * cannot interleave. Prisma's 5 s default is far too short for a 25k-card
 * board; keep the lock bounded but generous enough for a full subtree.
 */
export const PURGE_BOARD_TX_TIMEOUT_MS = 5 * 60_000;
export const PURGE_BOARD_TX_MAX_WAIT_MS = 10_000;

/** Whole-month DDL waits for readers inside the SQL helper, then the sweep retries. */
export const COMMAND_DROP_ATTEMPTS = 3;
const COMMAND_DROP_RETRY_DELAY_MS = 75;

/** `YYYY-MM-01` for a UTC month boundary; safe to cast to `date`. */
function monthSql(month: Date): string {
  return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ops: OpsSettingsService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly attention: AttentionService,
    private readonly approvals: ApprovalsService,
  ) {}

  /** Runs one named sweep, or all of them. */
  async run(job: MaintenanceJobName): Promise<MaintenanceRunResult[]> {
    if (job === "all") {
      const results: MaintenanceRunResult[] = [];
      for (const name of MAINTENANCE_JOBS) {
        try {
          results.push(...(await this.run(name)));
        } catch (error) {
          // One wedged sweep (a locked partition, a default partition that
          // needs moving) must not stop retention/token cleanup that follows.
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(`maintenance ${name} failed: ${message}`);
          results.push({
            job: name,
            removed: 0,
            detail: `failed: ${message}`,
          });
        }
      }
      return results;
    }
    const outcome = await this.dispatch(job);
    const removed = typeof outcome === "number" ? outcome : outcome.removed;
    const detail = typeof outcome === "number" ? undefined : outcome.detail;
    this.logger.log(
      `maintenance ${job}: removed ${removed}${detail ? ` (${detail})` : ""}`,
    );
    return [{ job, removed, ...(detail !== undefined ? { detail } : {}) }];
  }

  private async dispatch(
    job: MaintenanceJobName,
  ): Promise<number | { removed: number; detail: string }> {
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
      case "sweep-claims":
        return this.sweepClaims();
      case "sweep-exports":
        return this.sweepExports();
      case "ensure-command-partitions":
        return this.ensureCommandPartitions();
      case "ensure-command-key-index":
        return this.ensureCommandKeyIndex();
      case "sweep-commands":
        return this.sweepCommands();
      case "sweep-runs":
        return this.sweepRuns();
      case "sweep-agent-sessions":
        return this.sweepAgentSessions();
      case "sweep-approvals":
        return this.sweepApprovals();
      case "sweep-reminders":
        return this.sweepReminders();
      case "sweep-comment-history":
        return this.sweepCommentHistory();
      case "sweep-activity":
        return this.sweepActivity();
      case "sweep-audit":
        return this.sweepAudit();
      case "sweep-security-audit":
        return this.sweepSecurityAudit();
      case "sweep-accounts":
        return this.sweepAccounts();
      case "sweep-unverified-users":
        return this.sweepUnverifiedUsers();
      case "sweep-orphan-boards":
        return this.accountDeletion.reapOrphanBoards();
      case "sweep-orphan-blobs":
        return this.sweepOrphanBlobs();
      case "sweep-idempotency":
        return this.sweepIdempotency();
      case "sweep-attention":
        return this.sweepAttention();
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
   * `retentionDays` lets the owner-triggered purge use the window currently
   * shown in the panel (QA-A1) instead of a stale saved setting. The scheduled
   * sweep keeps calling it without an argument and uses the saved window.
   *
   * B-7: ordinary passes are chunked. One unbounded transaction over every
   * stale row of every table held locks (and a connection) for as long as the
   * purge took — on a large instance, minutes. Each ordinary chunk is now its
   * own short transaction of at most `PURGE_CHUNK` ids; a crash mid-run leaves
   * only fully-purged chunks behind and the next run picks up the rest.
   * Parents go last: children first, then cards (with everything hanging off
   * them), then the columns/labels that no longer hold any card.
   *
   * The board-subtree fallback is the deliberate exception: one board per
   * transaction, holding that board's advisory lock for the whole subtree and
   * using `PURGE_BOARD_TX_TIMEOUT_MS` instead of the ordinary short chunk
   * timeout, so a restore can never interleave with a partial subtree delete.
   */
  async purgeSoftDeleted(retentionDays?: number): Promise<number> {
    const days = retentionDays ?? (await this.retentionDays());
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const stale = { deletedAt: { not: null, lte: cutoff } } as const;
    let count = 0;

    count += await this.purgeChunks(
      (take) =>
        this.prisma.attachment.findMany({
          where: {
            ...stale,
            card: { column: { board: { deletedAt: null } } },
          },
          select: {
            id: true,
            storedName: true,
            thumbnailName: true,
            posterName: true,
          },
          take,
        }),
      async (rows) => {
        const removedRows: typeof rows = [];
        for (const row of rows) {
          // A row restored after the chunk query must keep its blob.
          const deleted = await this.prisma.attachment.deleteMany({
            where: {
              id: row.id,
              ...stale,
              card: { column: { board: { deletedAt: null } } },
            },
          });
          if (deleted.count > 0) removedRows.push(row);
        }
        await this.removeBlobs(removedRows);
        return removedRows.length;
      },
    );
    count += await this.purgeChunks(
      (take) =>
        this.prisma.comment.findMany({
          where: {
            ...stale,
            card: { column: { board: { deletedAt: null } } },
          },
          select: { id: true },
          take,
        }),
      async (rows) =>
        this.prisma.$transaction(async (tx) => {
          const ids = rows.map((row) => row.id);
          const candidates = await tx.comment.findMany({
            where: {
              id: { in: ids },
              ...stale,
              card: { column: { board: { deletedAt: null } } },
            },
            select: {
              id: true,
              card: { select: { column: { select: { boardId: true } } } },
            },
          });
          if (candidates.length === 0) return 0;
          // TASK-185.1: lock each affected board, then re-check the flag. A
          // restore that won the lock keeps its comment and revisions.
          await lockBoardWrites(
            tx,
            candidates.map((row) => row.card.column.boardId),
          );
          const stillIds = (
            await tx.comment.findMany({
              where: {
                id: { in: ids },
                ...stale,
                card: { column: { board: { deletedAt: null } } },
              },
              select: { id: true },
            })
          ).map((row) => row.id);
          if (stillIds.length === 0) return 0;
          // Revisions and comment snapshots are children of the comment and
          // are explicitly removed before the hard delete.
          await deleteCommentActivitySnapshots(tx, stillIds);
          await tx.commentRevision.deleteMany({
            where: { commentId: { in: stillIds } },
          });
          return (
            await tx.comment.deleteMany({
              where: { id: { in: stillIds }, ...stale },
            })
          ).count;
        }),
    );
    count += await this.purgeChunks(
      (take) =>
        this.prisma.checklistItem.findMany({
          where: {
            ...stale,
            checklist: {
              deletedAt: null,
              card: { column: { board: { deletedAt: null } } },
            },
          },
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.checklistItem.deleteMany({
            where: {
              id: { in: rows.map((row) => row.id) },
              ...stale,
              checklist: {
                deletedAt: null,
                card: { column: { board: { deletedAt: null } } },
              },
            },
          })
        ).count,
    );
    count += await this.purgeChunks(
      (take) =>
        this.prisma.checklist.findMany({
          where: {
            ...stale,
            card: { column: { board: { deletedAt: null } } },
          },
          select: { id: true },
          take,
        }),
      async (rows) =>
        this.prisma.$transaction(async (tx) => {
          const ids = rows.map((row) => row.id);
          const candidates = await tx.checklist.findMany({
            where: {
              id: { in: ids },
              ...stale,
              card: { column: { board: { deletedAt: null } } },
            },
            select: {
              id: true,
              card: { select: { column: { select: { boardId: true } } } },
            },
          });
          if (candidates.length === 0) return 0;
          await lockBoardWrites(
            tx,
            candidates.map((row) => row.card.column.boardId),
          );
          const stillIds = (
            await tx.checklist.findMany({
              where: {
                id: { in: ids },
                ...stale,
                card: { column: { board: { deletedAt: null } } },
              },
              select: { id: true },
            })
          ).map((row) => row.id);
          if (stillIds.length === 0) return 0;
          await tx.checklistItem.deleteMany({
            where: { checklistId: { in: stillIds } },
          });
          return (
            await tx.checklist.deleteMany({
              where: {
                id: { in: stillIds },
                ...stale,
                items: { none: {} },
              },
            })
          ).count;
        }),
    );
    count += await this.purgeChunks(
      (take) =>
        this.prisma.cardLink.findMany({
          where: { ...stale, board: { deletedAt: null } },
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.cardLink.deleteMany({
            where: {
              id: { in: rows.map((row) => row.id) },
              ...stale,
              board: { deletedAt: null },
            },
          })
        ).count,
    );
    // Cards with everything that hangs off them, one chunk per transaction.
    count += await this.purgeChunks(
      (take) =>
        this.prisma.card.findMany({
          where: {
            ...stale,
            column: { board: { deletedAt: null } },
          },
          select: { id: true },
          take,
        }),
      async (rows) => {
        let blobs: Array<{
          storedName: string;
          thumbnailName: string | null;
          posterName: string | null;
        }> = [];
        const removed = await this.prisma.$transaction(async (tx) => {
          const candidates = await tx.card.findMany({
            where: {
              id: { in: rows.map((row) => row.id) },
              ...stale,
              column: { board: { deletedAt: null } },
            },
            select: {
              id: true,
              column: { select: { boardId: true } },
            },
          });
          if (candidates.length === 0) return 0;
          // TASK-185.1: serialize with restore/edit writers and re-check the
          // soft-delete flag after the lock.
          await lockBoardWrites(
            tx,
            candidates.map((row) => row.column.boardId),
          );
          const ids = (
            await tx.card.findMany({
              where: {
                id: { in: candidates.map((row) => row.id) },
                ...stale,
                column: { board: { deletedAt: null } },
              },
              select: { id: true },
            })
          ).map((row) => row.id);
          if (ids.length === 0) return 0;
          blobs = await tx.attachment.findMany({
            where: { cardId: { in: ids } },
            select: {
              storedName: true,
              thumbnailName: true,
              posterName: true,
            },
          });
          await tx.checklistItem.deleteMany({
            where: { checklist: { cardId: { in: ids } } },
          });
          await tx.checklist.deleteMany({ where: { cardId: { in: ids } } });
          await tx.cardLabel.deleteMany({ where: { cardId: { in: ids } } });
          await tx.cardLink.deleteMany({
            where: {
              OR: [{ fromCardId: { in: ids } }, { toCardId: { in: ids } }],
            },
          });
          await tx.activity.deleteMany({
            where: {
              cardId: { in: ids },
              type: { in: [...COMMENT_ACTIVITY_TYPES] },
            },
          });
          await tx.commentRevision.deleteMany({
            where: { comment: { cardId: { in: ids } } },
          });
          await tx.comment.deleteMany({ where: { cardId: { in: ids } } });
          await tx.attachment.deleteMany({ where: { cardId: { in: ids } } });
          return (
            await tx.card.deleteMany({
              where: { id: { in: ids }, ...stale },
            })
          ).count;
        });
        // A purged card's attachment blobs go with it (they were never
        // soft-deleted themselves, so the attachment pass above missed them).
        await this.removeBlobs(blobs);
        return removed;
      },
    );
    // Containers last, once they no longer hold any card.
    count += (
      await this.prisma.column.deleteMany({
        where: {
          ...stale,
          board: { deletedAt: null },
          cards: { none: {} },
        },
      })
    ).count;
    count += (
      await this.prisma.label.deleteMany({
        where: {
          ...stale,
          board: { deletedAt: null },
          cards: { none: {} },
        },
      })
    ).count;
    // Boards last: a deleted board keeps its row (and its feed/log/shares)
    // until the window passes, then the whole subtree goes — cards and their
    // blobs were already reclaimed by the passes above, but a chunk retried
    // after a crash may still find children, so delete them here too. The
    // feed and command log are paged away first so the final transaction
    // stays small (TASK-156).
    count += await this.purgeChunks(
      (take) =>
        this.prisma.board.findMany({
          where: stale,
          select: { id: true },
          take,
        }),
      async (rows) => {
        let removed = 0;
        for (const row of rows) {
          removed += await this.purgeBoardTree(row.id, cutoff);
        }
        return removed;
      },
    );
    return count;
  }

  /**
   * Purge one stale board subtree. The advisory lock is held for the whole
   * board purge and the deletedAt flag is re-read after taking it, so a
   * restore that won the lock keeps every child row (cards, comments,
   * attachments, members) instead of leaving an empty shell.
   */
  private async purgeBoardTree(boardId: string, cutoff: Date): Promise<number> {
    const stale = { deletedAt: { not: null, lte: cutoff } } as const;
    let removed = 0;
    let blobs: Array<{
      storedName: string;
      thumbnailName: string | null;
      posterName: string | null;
    }> = [];
    await this.prisma.$transaction(
      async (tx) => {
        await lockBoardWrites(tx, [boardId]);
        const board = await tx.board.findMany({
          where: { id: boardId, ...stale },
          select: { id: true },
          take: 1,
        });
        if (board.length === 0) return;
        blobs = await tx.attachment.findMany({
          where: { card: { column: { boardId } } },
          select: {
            storedName: true,
            thumbnailName: true,
            posterName: true,
          },
        });
        // Feed and command log are still paged inside the lock; the pages keep
        // the transaction's bind-parameter list bounded without releasing the
        // board lock between them.
        for (;;) {
          const page = await tx.activity.findMany({
            where: { boardId },
            select: { id: true },
            take: PURGE_CHUNK,
          });
          if (page.length === 0) break;
          await tx.activity.deleteMany({
            where: { id: { in: page.map((row) => row.id) } },
          });
          if (page.length < PURGE_CHUNK) break;
        }
        for (;;) {
          const page = await tx.commandPreimage.findMany({
            where: { boardId },
            select: { commandId: true },
            take: PURGE_CHUNK,
          });
          if (page.length === 0) break;
          await tx.commandPreimage.deleteMany({
            where: {
              commandId: { in: page.map((row) => row.commandId) },
              boardId,
            },
          });
          if (page.length < PURGE_CHUNK) break;
        }
        for (;;) {
          const page = await tx.command.findMany({
            where: { boardId },
            select: { id: true },
            take: PURGE_CHUNK,
          });
          if (page.length === 0) break;
          const ids = page.map((row) => row.id);
          // TASK-200.11: keep each statement bounded. The key/detail ids come
          // from the same command page, so a 25k-command board never issues an
          // unbounded board-wide DELETE inside the 5-minute transaction.
          await tx.commandDetail.deleteMany({
            where: { commandId: { in: ids } },
          });
          await tx.commandKey.deleteMany({
            where: { id: { in: ids }, boardId },
          });
          await tx.command.deleteMany({
            where: { id: { in: ids }, boardId },
          });
          if (page.length < PURGE_CHUNK) break;
        }
        // Defensive bounded passes for legacy/orphan rows whose command was
        // already gone before this purge.
        for (;;) {
          const page = await tx.commandDetail.findMany({
            where: { boardId },
            select: { commandId: true },
            take: PURGE_CHUNK,
          });
          if (page.length === 0) break;
          await tx.commandDetail.deleteMany({
            where: { commandId: { in: page.map((row) => row.commandId) } },
          });
          if (page.length < PURGE_CHUNK) break;
        }
        const keyIndexState = await commandKeyBoardIndexState(tx);
        if (keyIndexState === "valid") {
          for (;;) {
            const page = await tx.commandKey.findMany({
              where: { boardId },
              select: { id: true },
              take: PURGE_CHUNK,
            });
            if (page.length === 0) break;
            await tx.commandKey.deleteMany({
              where: { id: { in: page.map((row) => row.id) }, boardId },
            });
            if (page.length < PURGE_CHUNK) break;
          }
        } else {
          this.logger.warn(
            `purge-board: CommandKey_boardId_idx is ${keyIndexState}; skipping the defensive board key orphan pass`,
          );
        }
        await tx.checklistItem.deleteMany({
          where: { checklist: { card: { column: { boardId } } } },
        });
        await tx.checklist.deleteMany({
          where: { card: { column: { boardId } } },
        });
        await tx.cardLabel.deleteMany({
          where: { card: { column: { boardId } } },
        });
        await tx.cardLink.deleteMany({ where: { boardId } });
        await tx.commentRevision.deleteMany({
          where: { comment: { card: { column: { boardId } } } },
        });
        await tx.comment.deleteMany({
          where: { card: { column: { boardId } } },
        });
        await tx.attachment.deleteMany({
          where: { card: { column: { boardId } } },
        });
        await tx.card.deleteMany({ where: { column: { boardId } } });
        await tx.column.deleteMany({ where: { boardId } });
        await tx.label.deleteMany({ where: { boardId } });
        await tx.agentRun.deleteMany({ where: { boardId } });
        await tx.agentSession.deleteMany({ where: { boardId } });
        await tx.approvalRequest.deleteMany({ where: { boardId } });
        // Snapshot shares are detached by the FK (`SET NULL`) and keep
        // serving; only a live share dies with its board (TASK-156).
        await tx.boardShare.deleteMany({
          where: { boardId, mode: "live" },
        });
        await tx.boardMember.deleteMany({ where: { boardId } });
        removed = (
          await tx.board.deleteMany({
            where: { id: boardId, ...stale },
          })
        ).count;
      },
      {
        maxWait: PURGE_BOARD_TX_MAX_WAIT_MS,
        timeout: PURGE_BOARD_TX_TIMEOUT_MS,
      },
    );
    await this.removeBlobs(blobs);
    return removed;
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
    chunkSize: number = PURGE_CHUNK,
    maxChunks: number = PURGE_MAX_CHUNKS,
  ): Promise<number> {
    let total = 0;
    for (let chunk = 0; chunk < maxChunks; chunk += 1) {
      const rows = await find(chunkSize);
      if (rows.length === 0) break;
      total += await purge(rows);
      if (rows.length < chunkSize) break;
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
    removed += await this.purgeChunks(
      (take) =>
        this.prisma.passwordResetToken.findMany({
          where: { expiresAt: { lt: now } },
          select: { userId: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.passwordResetToken.deleteMany({
            where: {
              userId: { in: rows.map((row) => row.userId) },
              expiresAt: { lt: now },
            },
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

  /**
   * Board shares past their TTL or long revoked (TASK-148 covers revokes).
   *
   * TASK-156: a revoked share is kept while its source board is soft-deleted
   * — the board can still be restored inside the retention window (default
   * 30 d) and the restore revives exactly the shares the board delete
   * revoked, so sweeping them at 24 h would make a day-2..30 restore
   * silently lose its live share. Only shares on a live/archived board (a
   * normal manual revoke) or detached from a purged board are removed; the
   * board purge itself deletes the live shares it kills.
   */
  async sweepShares(): Promise<number> {
    const now = new Date();
    const revokedBefore = new Date(now.getTime() - 86_400_000);
    const result = await this.prisma.boardShare.deleteMany({
      where: {
        OR: [
          { expiresAt: { not: null, lt: now } },
          {
            revokedAt: { not: null, lt: revokedBefore },
            // Live/archived source board, or none at all (detached by the
            // board purge's `SET NULL`); a soft-deleted, still restorable
            // board keeps the share.
            OR: [{ boardId: null }, { board: { deletedAt: null } }],
          },
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

  /**
   * TASK-166.9: reclaim lapsed card claims and raise one attention event per
   * (card, lease, recipient). The conditional `updateMany` is the lock: a
   * concurrent `CLAIM_CARD` that already installed a fresh lease makes it a
   * no-op, so a sweep can never clear a live claim. The event is written only
   * after the row really changed, which also makes a re-run silent.
   */
  async sweepClaims(): Promise<number> {
    const now = new Date();
    const cards = await this.prisma.card.findMany({
      where: {
        deletedAt: null,
        leaseUntil: { not: null, lte: now },
        column: { board: { deletedAt: null } },
        OR: [
          { claimedBy: { not: null } },
          { claimedByTokenId: { not: null } },
          { claimedBySessionId: { not: null } },
        ],
      },
      select: {
        id: true,
        title: true,
        claimedBy: true,
        claimedByTokenId: true,
        claimedBySessionId: true,
        leaseUntil: true,
        column: { select: { boardId: true } },
      },
    });
    let cleared = 0;
    for (const card of cards) {
      if (card.leaseUntil === null) continue;
      const result = await this.prisma.card.updateMany({
        where: { id: card.id, leaseUntil: { lte: now } },
        data: {
          claimedBy: null,
          claimedByTokenId: null,
          claimedBySessionId: null,
          leaseUntil: null,
        },
      });
      if (result.count === 0) continue;
      cleared += result.count;
      const session =
        card.claimedBySessionId === null
          ? null
          : await this.prisma.agentSession.findUnique({
              where: { id: card.claimedBySessionId },
              select: { name: true, clientName: true },
            });
      await this.attention.notifyClaimExpired({
        boardId: card.column.boardId,
        cardId: card.id,
        cardTitle: card.title,
        claimedBy: card.claimedBy,
        agentName: session?.name ?? session?.clientName ?? null,
        leaseUntil: card.leaseUntil,
      });
    }
    return cleared;
  }

  /**
   * TASK-166.9: attention rows follow the same retention window as the board
   * feed. Read/unread state is not a reason to keep copies forever — the
   * underlying approval/comment/audit rows remain the durable record.
   */
  async sweepAttention(): Promise<number> {
    const days = await this.retentionDays();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    await this.prisma.notificationMail.deleteMany({
      where: { finishedAt: { lt: cutoff } },
    });
    return this.purgeChunks(
      (take) =>
        this.prisma.attentionNotification.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.attentionNotification.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
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
   * TASK-200.11: keep the previous, current and next three months' partitions
   * present before a write arrives. The SQL helper creates the matching
   * partition of `Command`, `CommandDetail` and `CommandPreimage`; creating a
   * partition also creates every parent index on it. Idempotent, so a repeated
   * or overlapping scheduler run costs catalog lookups only.
   *
   * A month whose rows already sit in the default partition cannot be added
   * without moving those rows first; the helper raises and this job reports
   * the failure instead of silently leaving the default to grow.
   */
  async ensureCommandPartitions(): Promise<{
    removed: number;
    detail: string;
  }> {
    const days = await this.retentionDays();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const created: string[] = [];
    const skipped: string[] = [];
    const months = partitionMonthsToEnsure(new Date()).filter(
      // Never recreate a month that retention already dropped (a short
      // retention window can make the previous month fully expired).
      (month) => !isWholeMonthExpired(month, cutoff),
    );
    for (const month of months) {
      const rows = await this.prisma.$queryRaw<
        Array<{ created: string | null }>
      >(
        Prisma.sql`SELECT janosik_ensure_command_partition(${monthSql(month)}::date) AS created`,
      );
      const value = rows[0]?.created ?? "";
      if (value.startsWith("skipped:")) {
        // Rows are parked in a default partition for this month. Moving them
        // is an operator action; create no partial month and keep the rest of
        // the scheduler running.
        skipped.push(`${monthSql(month)} ${value.slice("skipped:".length)}`);
        continue;
      }
      if (value !== "") created.push(value);
    }
    if (skipped.length > 0) {
      this.logger.warn(
        `maintenance ensure-command-partitions skipped default-partition rows: ${skipped.join(" | ")}`,
      );
    }
    const parts: string[] = [];
    if (created.length > 0) parts.push(`created ${created.join(", ")}`);
    if (skipped.length > 0) {
      parts.push(`skipped default-partition rows for ${skipped.join(" | ")}`);
    }
    return {
      // DDL creates partitions; it never removes rows. Keep the generic
      // maintenance result honest: the detail carries what changed.
      removed: 0,
      detail: parts.length === 0 ? "partitions up to date" : parts.join("; "),
    };
  }

  /**
   * Build the `CommandKey(boardId)` index outside a transaction when migration
   * 6 skipped it (registry at least 1M rows or 64 MiB). `CREATE INDEX
   * CONCURRENTLY` does not block normal writes; it still consumes I/O and
   * needs free disk/WAL, so an operator should run it in a quiet window. An
   * invalid leftover index from a failed build is rebuilt rather than treated
   * as done.
   */
  async ensureCommandKeyIndex(): Promise<{
    removed: number;
    detail: string;
  }> {
    const state = await commandKeyBoardIndexState(this.prisma);
    if (state === "valid") {
      return { removed: 0, detail: "CommandKey_boardId_idx already present" };
    }
    if (state === "invalid") {
      // A concurrent build interrupted earlier leaves an invalid index.
      await this.prisma.$executeRawUnsafe(
        'DROP INDEX CONCURRENTLY IF EXISTS "CommandKey_boardId_idx"',
      );
    }
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "CommandKey_boardId_idx" ON "CommandKey" ("boardId")',
    );
    return {
      removed: 0,
      detail: "created CommandKey_boardId_idx concurrently",
    };
  }

  /**
   * Trims the command log to the retention window (TASK-84, ADR §6.14;
   * TASK-200.11 partitions).
   *
   * Two complementary mechanisms:
   * - Whole monthly partitions strictly older than the cutoff are dropped.
   *   That is metadata work, not a row-by-row delete, so the 30-day window
   *   does not leave a bloated heap that autovacuum must chase forever. The
   *   database helper drops the side table and pre-images of the same month
   *   first and leaves the default partition alone.
   * - Rows from the partially expired current month and anything parked in
   *   the default partition are deleted in bounded chunks. The pre-images go
   *   first; a real command delete removes the side row through the deferred
   *   detail trigger. A separate bounded `NOT EXISTS Command` pass drains
   *   `CommandKey`, because the registry is unpartitioned and a month DDL
   *   cannot cheaply delete it inline.
   *
   * Window = `OpsSettings.retentionDays` (same knob as the soft-delete purge),
   * default 30 days. Agent and human commands share the window: a shorter
   * agent window would strand `AgentRun` rollback after its pre-images were
   * dropped. Operators who accept that trade-off lower the global knob.
   */
  async sweepCommands(): Promise<number> {
    const days = await this.retentionDays();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let removed = await this.dropExpiredCommandPartitions(cutoff);

    // Rows left in the active month and in the default partition.
    const stale = { createdAt: { lt: cutoff } };
    removed += await this.purgeChunks(
      (take) =>
        this.prisma.commandPreimage.findMany({
          where: stale,
          select: { commandId: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.commandPreimage.deleteMany({
            where: { commandId: { in: rows.map((row) => row.commandId) } },
          })
        ).count,
      COMMAND_PURGE_CHUNK,
      COMMAND_PURGE_MAX_CHUNKS,
    );
    removed += await this.purgeChunks(
      (take) =>
        this.prisma.command.findMany({
          where: stale,
          select: { id: true, boardId: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.command.deleteMany({
            // Pair the id with its board even though CommandKey makes the id
            // globally unique: a purge page must never cross a board boundary.
            where: {
              OR: rows.map((row) => ({
                id: row.id,
                boardId: row.boardId,
              })),
            },
          })
        ).count,
      COMMAND_PURGE_CHUNK,
      COMMAND_PURGE_MAX_CHUNKS,
    );
    // The registry is large and unpartitioned. A month DDL must not delete it
    // inline; this pass removes only keys that have no Command at all (a live
    // key can be older than its moved command), in bounded chunks. `boardId`
    // is part of the NOT EXISTS probe so a same-id row on another board can
    // never mask or delete a live key.
    removed += await this.purgeChunks(
      (take) =>
        this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT k."id"
            FROM "CommandKey" k
           WHERE k."createdAt" < ${cutoff}
             AND NOT EXISTS (
               SELECT 1 FROM "Command" c
                WHERE c."id" = k."id" AND c."boardId" = k."boardId"
             )
           ORDER BY k."createdAt", k."id"
           LIMIT ${take}
        `),
      async (rows) =>
        this.prisma.$executeRaw(Prisma.sql`
          DELETE FROM "CommandKey" k
           WHERE k."id" IN (${Prisma.join(rows.map((row) => row.id))})
             AND NOT EXISTS (
               SELECT 1 FROM "Command" c
                WHERE c."id" = k."id" AND c."boardId" = k."boardId"
             )
        `),
      COMMAND_PURGE_CHUNK,
      COMMAND_PURGE_MAX_CHUNKS,
    );
    return removed;
  }

  /**
   * Drop every monthly command-log partition whose whole range is older than
   * `cutoff`. The caller has already resolved the retention window; this
   * helper is separate so a test (and an operator) can exercise the partition
   * path without running the row chunks.
   */
  async dropExpiredCommandPartitions(cutoff: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ name: string }>>(
      Prisma.sql`
        SELECT child.relname AS name
          FROM pg_inherits
          JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
          JOIN pg_class child ON child.oid = pg_inherits.inhrelid
          JOIN pg_namespace ns ON ns.oid = parent.relnamespace
         WHERE ns.nspname = current_schema()
           AND parent.relname IN (${Prisma.join([...COMMAND_LOG_TABLES])})
         ORDER BY child.relname
      `,
    );
    const months = new Map<string, Date>();
    for (const row of rows) {
      for (const table of COMMAND_LOG_TABLES) {
        const month = parseCommandPartitionMonth(table, row.name);
        if (month === null) continue;
        months.set(month.toISOString(), month);
        break;
      }
    }
    let removed = 0;
    for (const month of months.values()) {
      if (!isWholeMonthExpired(month, cutoff)) continue;
      for (let attempt = 0; attempt < COMMAND_DROP_ATTEMPTS; attempt += 1) {
        const dropped = await this.prisma.$queryRaw<Array<{ removed: bigint }>>(
          Prisma.sql`SELECT janosik_drop_command_partition(${monthSql(month)}::date) AS removed`,
        );
        const value = Number(dropped[0]?.removed ?? 0n);
        if (value >= 0) {
          removed += value;
          break;
        }
        if (attempt === COMMAND_DROP_ATTEMPTS - 1) {
          this.logger.warn(
            `sweep-commands: ${monthSql(month)} is still locked by readers; leaving the partition for the next run`,
          );
          break;
        }
        await delay(COMMAND_DROP_RETRY_DELAY_MS * (attempt + 1));
      }
    }
    return removed;
  }

  /**
   * Removes runs that no longer have a command log to audit (ADR §6.14).
   * A run younger than the window or still referenced by any `Command` is
   * kept. A `reverted` original and its `kind: "revert"` child are removed
   * together once both are stale and empty; deleting one without the other
   * would leave a dangling audit half.
   */
  async sweepRuns(): Promise<number> {
    const days = await this.retentionDays();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let removed = 0;
    let cursor: string | undefined;
    let withCommands = new Set<string>();
    let childWithCommands = new Set<string>();

    for (let page = 0; page < PURGE_MAX_CHUNKS; page += 1) {
      const runs = await this.prisma.agentRun.findMany({
        where: {
          createdAt: { lt: cutoff },
          ...(cursor !== undefined ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: PURGE_CHUNK,
        select: {
          id: true,
          kind: true,
          status: true,
          revertsRunId: true,
          createdAt: true,
        },
      });
      if (runs.length === 0) break;
      cursor = runs[runs.length - 1]!.id;

      const ids = runs.map((run) => run.id);
      const usedBy = await this.prisma.command.findMany({
        where: { runId: { in: ids } },
        select: { runId: true },
        distinct: ["runId"],
      });
      withCommands = new Set(
        usedBy
          .map((row) => row.runId)
          .filter((id): id is string => id !== null),
      );

      const revertedIds = runs
        .filter((run) => run.status === "reverted")
        .map((run) => run.id);
      const children =
        revertedIds.length === 0
          ? []
          : await this.prisma.agentRun.findMany({
              where: { revertsRunId: { in: revertedIds } },
              select: {
                id: true,
                kind: true,
                status: true,
                revertsRunId: true,
                createdAt: true,
              },
            });
      const childIds = children.map((child) => child.id);
      const childUsedBy =
        childIds.length === 0
          ? []
          : await this.prisma.command.findMany({
              where: { runId: { in: childIds } },
              select: { runId: true },
              distinct: ["runId"],
            });
      childWithCommands = new Set(
        childUsedBy
          .map((row) => row.runId)
          .filter((id): id is string => id !== null),
      );

      // A revert child is deleted by its original's pair branch, never on its
      // own; an orphan child (original already gone) is deletable normally.
      const originals = runs
        .filter((run) => run.kind === "revert" && run.revertsRunId !== null)
        .map((run) => run.revertsRunId!);
      const existingOriginals =
        originals.length === 0
          ? []
          : await this.prisma.agentRun.findMany({
              where: { id: { in: originals } },
              select: { id: true },
            });
      const originalIds = new Set(existingOriginals.map((row) => row.id));

      const deletable = new Set<string>();
      for (const run of runs) {
        if (withCommands.has(run.id)) continue;
        if (run.kind === "revert" && run.revertsRunId !== null) {
          if (!originalIds.has(run.revertsRunId)) deletable.add(run.id);
          continue;
        }
        if (run.status !== "reverted") {
          deletable.add(run.id);
          continue;
        }
        const child = children.find(
          (entry) => entry.kind === "revert" && entry.revertsRunId === run.id,
        );
        if (child === undefined) {
          deletable.add(run.id);
          continue;
        }
        if (
          child.createdAt.getTime() >= cutoff.getTime() ||
          childWithCommands.has(child.id)
        ) {
          continue;
        }
        deletable.add(run.id);
        deletable.add(child.id);
      }

      if (deletable.size === 0) continue;
      const result = await this.prisma.agentRun.deleteMany({
        where: { id: { in: [...deletable] } },
      });
      removed += result.count;
    }
    return removed;
  }

  async sweepAgentSessions(): Promise<number> {
    const cutoff = new Date(
      Date.now() - (await this.retentionDays()) * 86_400_000,
    );
    const where = { endedAt: { lte: cutoff } };
    return this.purgeChunks(
      (take) =>
        this.prisma.agentSession.findMany({
          where,
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.agentSession.deleteMany({
            where: { ...where, id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
  }

  async sweepApprovals(): Promise<number> {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - (await this.retentionDays()) * 86_400_000,
    );
    for (let chunk = 0; chunk < PURGE_MAX_CHUNKS; chunk++) {
      const scanned = await this.approvals.expireOverdue(
        undefined,
        now,
        PURGE_CHUNK,
      );
      if (scanned < PURGE_CHUNK) break;
    }
    const where: Prisma.ApprovalRequestWhereInput = {
      OR: [
        {
          status: { in: ["rejected", "cancelled"] },
          decidedAt: { lte: cutoff },
        },
        {
          // Lapsed requests are eligible even on a board with no approval traffic.
          status: { in: ["expired", "approved"] },
          expiresAt: { lte: cutoff },
        },
        { status: "consumed", consumedAt: { lte: cutoff } },
      ],
    };
    return this.purgeChunks(
      (take) =>
        this.prisma.approvalRequest.findMany({
          where,
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.approvalRequest.deleteMany({
            where: { ...where, id: { in: rows.map((row) => row.id) } },
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
   * TASK-185.6 §3.5 reconciliation sweep. A writer from an older release can
   * move `editedAt` (or the text) without appending a revision, so the next
   * PATCH sees a gap and answers 409. This sweep finds those rows — including
   * soft-deleted comments and a broken verified pair — marks `writer_gap`,
   * adopts the current text as the new verified point with a null revision
   * number and keeps the confirmed revisions and monotonic counter. The next
   * edit then appends a fresh number from the actual text.
   *
   * It also repairs the Activity half: a legacy `details.commentId` that
   * resolves to the same card and board fills the typed column, and a
   * post-cutover `comment_updated` whose text is not backed by its own
   * revision keeps only metadata. Confirmed pre-cutover snapshots stay.
   *
   * The board lock keeps a live writer from interleaving the mark and the
   * adoption. Every pass is idempotent; a row repaired between the SELECT and
   * the lock is simply skipped.
   */
  async sweepCommentHistory(): Promise<{
    removed: number;
    detail: string;
  }> {
    let reconciled = 0;
    for (;;) {
      const candidates = await this.prisma.$queryRaw<
        Array<{ id: string; boardId: string }>
      >(Prisma.sql`
        SELECT c."id", col."boardId"
          FROM "Comment" c
          JOIN "Card" card ON card."id" = c."cardId"
          JOIN "Column" col ON col."id" = card."columnId"
          LEFT JOIN "CommentRevision" r
            ON r."commentId" = c."id"
           AND r."revisionNumber" = c."historyVerifiedRevisionNumber"
         WHERE c."editedAt" IS DISTINCT FROM c."historyVerifiedEditedAt"
            OR (c."historyVerifiedRevisionNumber" IS NOT NULL AND (
                 c."historyVerifiedRevisionNumber" <= 0
                 OR c."editedAt" IS NULL
                 OR c."lastRevisionNumber" <> c."historyVerifiedRevisionNumber"
                 OR r."id" IS NULL
                 OR r."createdAt" <> c."editedAt"
                 OR r."createdAt" <= c."historyCutoverAt"
                 OR r."afterText" <> c."text"
               ))
         ORDER BY c."id"
         LIMIT 200
      `);
      if (candidates.length === 0) break;

      let changedInPass = 0;
      for (let offset = 0; offset < candidates.length; offset += 50) {
        const batch = candidates.slice(offset, offset + 50);
        changedInPass += await this.prisma.$transaction(
          async (tx) => {
            await lockBoardWrites(
              tx,
              batch.map((candidate) => candidate.boardId),
            );
            let changed = 0;
            for (const candidate of batch) {
              const comment = await tx.comment.findUnique({
                where: { id: candidate.id },
                select: COMMENT_HISTORY_STATE_SELECT,
              });
              if (comment === null) continue;
              if (await verifyCommentHistory(tx, comment)) continue;
              await markHistoryIncomplete(tx, comment.id, "writer_gap");
              const adopted = await tx.comment.updateMany({
                where: { id: comment.id },
                data: {
                  historyVerifiedEditedAt: comment.editedAt,
                  historyVerifiedRevisionNumber: null,
                },
              });
              if (adopted.count > 0) changed += 1;
            }
            return changed;
          },
          { timeout: 30_000 },
        );
      }
      reconciled += changedInPass;
      // Defensive: a candidate that keeps matching the suspect predicate
      // without a writable row must not spin the whole sweep forever.
      if (changedInPass === 0) break;
    }

    const activity = await this.repairCommentHistoryActivity();
    return {
      removed: reconciled + activity.filled + activity.stripped,
      detail:
        `${reconciled} comments reconciled; ` +
        `${activity.filled} Activity links filled; ` +
        `${activity.stripped} snapshots stripped`,
    };
  }

  /**
   * The Activity half of the history sweep: fill typed comment ids from a
   * verified legacy link and strip post-cutover text that no revision backs.
   * Candidates are re-checked under the same board-write lock the purge and
   * writers take, so a concurrent hard delete cannot interleave between the
   * query and the update. Neither statement touches a confirmed pre-cutover
   * snapshot.
   */
  private async repairCommentHistoryActivity(): Promise<{
    filled: number;
    stripped: number;
  }> {
    let filled = 0;
    for (let pass = 0; pass < 200; pass += 1) {
      const candidates = await this.prisma.$queryRaw<
        Array<{ id: string; boardId: string }>
      >(Prisma.sql`
        SELECT a."id", a."boardId"
          FROM "Activity" a
          JOIN "Comment" c ON c."id" = a."details"->>'commentId'
          JOIN "Card" card ON card."id" = c."cardId"
          JOIN "Column" col ON col."id" = card."columnId"
         WHERE a."commentId" IS NULL
           AND a."type" IN ('comment_added', 'comment_updated', 'comment_deleted')
           AND jsonb_typeof(a."details") = 'object'
           AND jsonb_typeof(a."details"->'commentId') = 'string'
           AND a."cardId" = c."cardId"
           AND a."boardId" = col."boardId"
         LIMIT 500
      `);
      if (candidates.length === 0) break;
      const changed = await this.prisma.$transaction(
        async (tx) => {
          await lockBoardWrites(
            tx,
            candidates.map((row) => row.boardId),
          );
          return Number(
            await tx.$executeRaw(Prisma.sql`
              UPDATE "Activity"
                 SET "commentId" = "details"->>'commentId'
               WHERE "id" IN (${Prisma.join(candidates.map((row) => row.id))})
                 AND "commentId" IS NULL
                 AND jsonb_typeof("details"->'commentId') = 'string'
            `),
          );
        },
        { timeout: 30_000 },
      );
      filled += changed;
      if (changed === 0) break;
    }

    let stripped = 0;
    for (let pass = 0; pass < 200; pass += 1) {
      const candidates = await this.prisma.$queryRaw<
        Array<{ id: string; boardId: string }>
      >(Prisma.sql`
        SELECT a."id", a."boardId"
          FROM "Activity" a
          JOIN "Comment" c
            ON c."id" = COALESCE(a."commentId", a."details"->>'commentId')
          LEFT JOIN "CommentRevision" r
            ON r."id" = a."details"->>'revisionId'
           AND r."commentId" = c."id"
         WHERE a."type" = 'comment_updated'
           AND a."createdAt" >= c."historyCutoverAt"
           AND (a."details" ? 'text'
                OR a."details" ? 'beforeText'
                OR a."details" ? 'afterText')
           AND (
             r."id" IS NULL
             OR r."beforeText" IS DISTINCT FROM a."details"->>'beforeText'
             OR r."afterText" IS DISTINCT FROM a."details"->>'afterText'
           )
         LIMIT 500
      `);
      if (candidates.length === 0) break;
      const changed = await this.prisma.$transaction(
        async (tx) => {
          await lockBoardWrites(
            tx,
            candidates.map((row) => row.boardId),
          );
          return Number(
            await tx.$executeRaw(Prisma.sql`
              UPDATE "Activity"
                 SET "details" = "details" - 'text' - 'beforeText' - 'afterText'
               WHERE "id" IN (${Prisma.join(candidates.map((row) => row.id))})
                 AND ("details" ? 'text'
                      OR "details" ? 'beforeText'
                      OR "details" ? 'afterText')
            `),
          );
        },
        { timeout: 30_000 },
      );
      stripped += changed;
      if (changed === 0) break;
    }

    return { filled, stripped };
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
   * TASK-166.6: the security trail uses the long audit window
   * (`AUDIT_RETENTION_DAYS`, default 365), not the soft-delete retention.
   * `SecurityAuditLog` is accountability, like `AdminAuditLog`; ADR §12.2
   * explicitly excludes it from the 30/90/365 product setting.
   */
  async sweepSecurityAudit(): Promise<number> {
    const cutoff = new Date(Date.now() - env.AUDIT_RETENTION_DAYS * 86_400_000);
    return this.purgeChunks(
      (take) =>
        this.prisma.securityAuditLog.findMany({
          where: {
            createdAt: { lt: cutoff },
            // Lifecycle markers are the only record of a pending/cancelled
            // self-service deletion; keep them regardless of audit retention.
            action: {
              notIn: [
                ACCOUNT_DELETE_SCHEDULED_ACTION,
                ACCOUNT_DELETE_CANCELLED_ACTION,
                BOARD_CLEANUP_FAILED_ACTION,
              ],
            },
          },
          select: { id: true },
          take,
        }),
      async (rows) =>
        (
          await this.prisma.securityAuditLog.deleteMany({
            where: { id: { in: rows.map((row) => row.id) } },
          })
        ).count,
    );
  }

  /**
   * TASK-166.4: idempotency records live 24 h (ADR §6.11). The row is also
   * ignored by the service after `expiresAt`, but the sweep keeps the table
   * from growing with every retried write.
   */
  async sweepIdempotency(): Promise<number> {
    return (
      await this.prisma.idempotencyRecord.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      })
    ).count;
  }

  /**
   * TASK-166 §12.5: hard-delete accounts whose seven-day self-service grace
   * window elapsed. A panel re-enable clears `disabledAt`, so the service
   * skips it. Each deletion writes `account.deleted`.
   */
  async sweepAccounts(): Promise<number> {
    const cutoff = new Date(
      Date.now() - ACCOUNT_DELETE_GRACE_DAYS * 86_400_000,
    );
    const userIds = await this.accountDeletion.usersDueForDeletion(cutoff);
    let removed = 0;
    for (const userId of userIds) {
      try {
        const deleted = await this.accountDeletion.deleteAccount(
          userId,
          {
            actorId: userId,
            actorType: "human",
          },
          cutoff,
        );
        if (deleted) removed += 1;
      } catch (error) {
        // One broken account must not abort the whole sweep; it is retried
        // on the next run and the failure is visible in the log.
        this.logger.error(
          `Account deletion sweep failed for ${userId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return removed;
  }

  /**
   * M3: release addresses held by abandoned, never-verified registrations.
   *
   * `User.email` is unique, so an unverified row blocks a legitimate person
   * from registering the same address forever. Only an account that never
   * became a member of a board and never wrote anything is eligible.
   *
   * The four counts here are a prefilter only: `deleteAccount` repeats every
   * one of them inside its `FOR UPDATE` transaction, so a membership, comment,
   * command or attachment committed between the two reads keeps the account.
   * A self-created board always carries an accepted ADMIN membership, so the
   * membership count covers that case as well.
   */
  async sweepUnverifiedUsers(): Promise<number> {
    const cutoff = new Date(
      Date.now() - env.UNVERIFIED_ACCOUNT_TTL_DAYS * 86_400_000,
    );
    const candidates = await this.prisma.user.findMany({
      where: { emailVerifiedAt: null, createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    let removed = 0;
    for (const candidate of candidates) {
      const [memberships, comments, commands, attachments] = await Promise.all([
        this.prisma.boardMember.count({
          where: { userId: candidate.id, acceptedAt: { not: null } },
        }),
        this.prisma.comment.count({ where: { authorId: candidate.id } }),
        this.prisma.command.count({ where: { actorId: candidate.id } }),
        this.prisma.attachment.count({
          where: { uploadedById: candidate.id },
        }),
      ]);
      if (memberships > 0 || comments > 0 || commands > 0 || attachments > 0) {
        continue;
      }
      try {
        const deleted = await this.accountDeletion.deleteAccount(
          candidate.id,
          { actorType: "admin" },
          undefined,
          cutoff,
        );
        if (deleted) removed += 1;
      } catch (error) {
        this.logger.error(
          `Unverified-account sweep failed for ${candidate.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return removed;
  }

  /**
   * Every blob name still referenced by a row, read in bounded pages
   * (TASK-156) instead of one unbounded `findMany` per table.
   */
  private async referencedBlobs(): Promise<Set<string>> {
    const referenced = new Set<string>();

    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.attachment.findMany({
        select: {
          id: true,
          storedName: true,
          thumbnailName: true,
          posterName: true,
        },
        orderBy: { id: "asc" },
        take: PURGE_CHUNK,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const row of rows) {
        for (const name of [
          row.storedName,
          row.thumbnailName,
          row.posterName,
        ]) {
          if (name) referenced.add(name);
        }
      }
      if (rows.length < PURGE_CHUNK) break;
      cursor = rows[rows.length - 1]?.id;
      if (cursor === undefined) break;
    }

    cursor = undefined;
    for (;;) {
      const rows: Array<{ id: string; avatarPath: string | null }> =
        await this.prisma.user.findMany({
          where: { avatarPath: { not: null } },
          select: { id: true, avatarPath: true },
          orderBy: { id: "asc" },
          take: PURGE_CHUNK,
          ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
      for (const user of rows) {
        if (user.avatarPath) referenced.add(user.avatarPath);
      }
      if (rows.length < PURGE_CHUNK) break;
      cursor = rows[rows.length - 1]?.id;
      if (cursor === undefined) break;
    }

    cursor = undefined;
    for (;;) {
      const rows: Array<{ id: string; storedName: string | null }> =
        await this.prisma.dataExport.findMany({
          where: { storedName: { not: null } },
          select: { id: true, storedName: true },
          orderBy: { id: "asc" },
          take: PURGE_CHUNK,
          ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
      for (const row of rows) {
        if (row.storedName) referenced.add(row.storedName);
      }
      if (rows.length < PURGE_CHUNK) break;
      cursor = rows[rows.length - 1]?.id;
      if (cursor === undefined) break;
    }

    cursor = undefined;
    for (;;) {
      const rows: Array<{ storedName: string }> =
        await this.prisma.boardShareSnapshotBlob.findMany({
          select: { storedName: true },
          orderBy: { storedName: "asc" },
          take: PURGE_CHUNK,
          ...(cursor !== undefined
            ? { cursor: { storedName: cursor }, skip: 1 }
            : {}),
        });
      for (const row of rows) referenced.add(row.storedName);
      if (rows.length < PURGE_CHUNK) break;
      cursor = rows[rows.length - 1]?.storedName;
    }

    return referenced;
  }

  /**
   * Blobs no row points at anymore (failed uploads, missed deletes), older
   * than the grace window (TASK-77), plus the `.tmp-*` scratch files ffmpeg
   * leaves behind when a derive/encode is killed (TASK-107/OOM, TASK-148).
   */
  async sweepOrphanBlobs(): Promise<number> {
    const referenced = await this.referencedBlobs();
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
