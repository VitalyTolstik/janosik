import { Injectable } from "@nestjs/common";
import type { AdminObservabilityDto } from "@janosik/shared";
import { Prisma } from "@prisma/client";
import { createRequire } from "node:module";
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";
import {
  COMMENT_ACTIVITY_BUDGET_BYTES,
  COMMENT_REVISION_BUDGET_BYTES,
  COMMENT_REVISION_LIMIT,
} from "@/comments/comment-history";
import { RealtimeService } from "@/realtime/realtime.service";
import { PresenceService } from "@/realtime/presence.service";
import { TranscodeService } from "@/attachments/transcode.service";
import { MediaService } from "@/attachments/media.service";
import { MailQueueService } from "@/mailer/mail-queue.service";
import { BroadcastQueueService } from "@/ops/broadcast-queue.service";
import { MaintenanceQueueService } from "@/ops/maintenance-queue.service";
import { CommsSchedulerService } from "@/ops/comms-scheduler.service";
import { OpsSettingsService } from "@/ops/ops-settings.service";
import { DemoService } from "./demo.service";
import type { QueueStats } from "@/ops/queue-core";
import { DemoQueueService } from "./demo-queue.service";
import { ExportsService } from "./exports.service";
import { readCommandLogStats } from "./command-log-stats";

type CommandLogStats = NonNullable<AdminObservabilityDto["commandLog"]>;

const BACKEND_VERSION: string = (() => {
  try {
    const localRequire = createRequire(__filename);
    const pkg = localRequire("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/**
 * The six history aggregates scan `Comment`, `CommentRevision` and `Activity`,
 * so the admin-only panel caches them briefly and bounds the transaction. A
 * timeout/failure must read as "unavailable", never as healthy zeros.
 */
const HISTORY_METRICS_TTL_MS = 30_000;
const HISTORY_METRICS_TIMEOUT_MS = 10_000;

let historyMetricsCache: {
  at: number;
  value: AdminObservabilityDto["commentHistory"];
} | null = null;

function unavailableHistoryCounters(): AdminObservabilityDto["commentHistory"] {
  return {
    available: false,
    revisions: { count: 0, bytes: 0 },
    activity: { count: 0, bytes: 0 },
    derivedTrimmedRevisions: 0,
    incompleteComments: 0,
    reasons: {
      legacy_cutover: 0,
      revision_limit: 0,
      gdpr_erase: 0,
      writer_gap: 0,
    },
    overBudget: { revisions: 0, activity: 0 },
  };
}

function unavailableCommandLog(): CommandLogStats {
  return {
    available: false,
    retentionDays: env.PURGE_AFTER_DAYS,
    partitions: [],
    defaultRows: 0,
  };
}

interface TableStat {
  name: string;
  rows: number;
  sizeBytes: number;
}

function prettyBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Observability (TASK-64): a single snapshot for the panel — runtime/version,
 * deploy info, database size + biggest tables, background-job state and a
 * compact health table. Read-only; every field degrades gracefully when a
 * subsystem is unavailable.
 */
@Injectable()
export class ObservabilityService {
  private readonly startedAt = Date.now() - Math.round(process.uptime() * 1000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
    private readonly demo: DemoService,
    private readonly demoQueue: DemoQueueService,
    private readonly exports: ExportsService,
    private readonly transcode: TranscodeService,
    private readonly media: MediaService,
    private readonly mail: MailQueueService,
    private readonly broadcast: BroadcastQueueService,
    private readonly maintenance: MaintenanceQueueService,
    private readonly comms: CommsSchedulerService,
    private readonly ops: OpsSettingsService,
  ) {}

  async snapshot(): Promise<AdminObservabilityDto> {
    const [
      size,
      tables,
      transcode,
      demo,
      health,
      queues,
      commentHistory,
      commandLog,
    ] = await Promise.all([
      this.databaseSize(),
      this.tableStats(),
      this.transcodeCounts(),
      this.demo.status(),
      this.healthChecks(),
      this.queueCounters(),
      this.commentHistoryCounters().catch(() => unavailableHistoryCounters()),
      this.commandLogStats().catch(() => unavailableCommandLog()),
    ]);

    return {
      version: BACKEND_VERSION,
      nodeEnv: process.env.NODE_ENV ?? "development",
      uptimeSec: Math.round(process.uptime()),
      deploy: {
        startedAt: this.startedAt,
        commit: process.env.GIT_COMMIT ?? null,
      },
      database: {
        sizeBytes: size,
        sizePretty: prettyBytes(size),
        tables,
      },
      jobs: {
        transcode,
        demo: { running: demo.running, boardId: demo.boardId },
        realtime: {
          boards: this.realtime.activeBoards,
          clients:
            this.realtime.subscriberCount + this.presence.totalSessions(),
          slowDrops: this.realtime.slowSubscriberDrops,
        },
        queues,
      },
      commentHistory,
      commandLog,
      health,
    };
  }

  /**
   * TASK-200.11: delegate the catalog/statistics read; the default-partition
   * count is exact there, partition rows are estimates.
   */
  private async commandLogStats(): Promise<CommandLogStats> {
    const retentionDays =
      (await this.ops.retentionDays()) ?? env.PURGE_AFTER_DAYS;
    return readCommandLogStats(this.prisma, retentionDays);
  }

  /**
   * TASK-185.6 §3.5 observation: how many revisions exist and how many text
   * bytes they and their Activity copies take, how many were trimmed, which
   * reasons mark an incomplete chain and how many comments exceed the 4 MB /
   * 6 MB text budgets. Counts and byte sizes only — the queries never select
   * or return the text itself.
   */
  private async commentHistoryCounters(): Promise<
    AdminObservabilityDto["commentHistory"]
  > {
    const cached = historyMetricsCache;
    if (cached !== null && Date.now() - cached.at < HISTORY_METRICS_TTL_MS) {
      return cached.value;
    }

    const [revisions, activity, trims, reasons, overRevisions, overActivity] =
      await this.prisma.$transaction(
        (tx) =>
          Promise.all([
            tx.$queryRaw<Array<{ count: bigint; bytes: bigint }>>(
              Prisma.sql`
                SELECT count(*)::bigint AS "count",
                       COALESCE(
                         sum(octet_length("beforeText") + octet_length("afterText")),
                         0
                       )::bigint AS "bytes"
                  FROM "CommentRevision"
              `,
            ),
            tx.$queryRaw<Array<{ count: bigint; bytes: bigint }>>(
              Prisma.sql`
                SELECT count(*)::bigint AS "count",
                       COALESCE(
                         sum(
                           COALESCE(octet_length("details"->>'beforeText'), 0)
                           + COALESCE(octet_length("details"->>'afterText'), 0)
                           + COALESCE(octet_length("details"->>'text'), 0)
                         ),
                         0
                       )::bigint AS "bytes"
                  FROM "Activity"
                 WHERE "type" = 'comment_updated'
                   AND "details"->>'revisionId' IS NOT NULL
              `,
            ),
            // Derived, not an exact trim-event counter: `lastRevisionNumber`
            // stays monotonic across trimming and GDPR erase, so a chain that
            // was erased after 60 edits still contributes 10 here.
            tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
              SELECT COALESCE(
                       sum(GREATEST("lastRevisionNumber" - ${COMMENT_REVISION_LIMIT}, 0)),
                       0
                     )::bigint AS "count"
                FROM "Comment"
            `),
            tx.$queryRaw<Array<{ reason: string; count: bigint }>>(
              Prisma.sql`
                SELECT "historyIncompleteReason"::text AS "reason",
                       count(*)::bigint AS "count"
                  FROM "Comment"
                 WHERE "historyIncompleteReason" IS NOT NULL
                 GROUP BY "historyIncompleteReason"
              `,
            ),
            tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
              SELECT count(*)::bigint AS "count"
                FROM (
                  SELECT "commentId"
                    FROM "CommentRevision"
                   GROUP BY "commentId"
                  HAVING sum(
                           octet_length("beforeText") + octet_length("afterText")
                         ) > ${COMMENT_REVISION_BUDGET_BYTES}
                ) AS over_budget
            `),
            tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
              SELECT count(*)::bigint AS "count"
                FROM (
                  SELECT "commentId"
                    FROM "Activity"
                   WHERE "type" = 'comment_updated'
                     AND "details"->>'revisionId' IS NOT NULL
                   GROUP BY "commentId"
                  HAVING sum(
                           COALESCE(octet_length("details"->>'beforeText'), 0)
                           + COALESCE(octet_length("details"->>'afterText'), 0)
                           + COALESCE(octet_length("details"->>'text'), 0)
                         ) > ${COMMENT_ACTIVITY_BUDGET_BYTES}
                ) AS over_budget
            `),
          ]),
        {
          timeout: HISTORY_METRICS_TIMEOUT_MS,
          maxWait: 5_000,
        },
      );

    const reasonCount = (name: string): number =>
      Number(reasons.find((row) => row.reason === name)?.count ?? 0);
    const value: AdminObservabilityDto["commentHistory"] = {
      available: true,
      revisions: {
        count: Number(revisions[0]?.count ?? 0),
        bytes: Number(revisions[0]?.bytes ?? 0),
      },
      activity: {
        count: Number(activity[0]?.count ?? 0),
        bytes: Number(activity[0]?.bytes ?? 0),
      },
      derivedTrimmedRevisions: Number(trims[0]?.count ?? 0),
      incompleteComments: reasons.reduce(
        (sum, row) => sum + Number(row.count),
        0,
      ),
      reasons: {
        legacy_cutover: reasonCount("legacy_cutover"),
        revision_limit: reasonCount("revision_limit"),
        gdpr_erase: reasonCount("gdpr_erase"),
        writer_gap: reasonCount("writer_gap"),
      },
      overBudget: {
        revisions: Number(overRevisions[0]?.count ?? 0),
        activity: Number(overActivity[0]?.count ?? 0),
      },
    };
    historyMetricsCache = { at: Date.now(), value };
    return value;
  }

  /** Per-queue counters for every BullMQ/in-process queue (TASK-66…73). */
  private async queueCounters(): Promise<
    Array<{
      name: string;
      pending: number;
      processed: number;
      failed: number;
      backend: "redis" | "memory";
    }>
  > {
    const entries: Array<[string, { stats: () => Promise<QueueStats> }]> = [
      ["broadcast", this.broadcast],
      ["mail", this.mail],
      ["transcode", this.transcode],
      ["media", this.media],
      ["maintenance", this.maintenance],
      ["demo", this.demoQueue],
      ["exports", this.exports],
      ["comms", this.comms],
    ];
    return Promise.all(
      entries.map(async ([name, service]) => {
        try {
          return { name, ...(await service.stats()) };
        } catch {
          return {
            name,
            pending: 0,
            processed: 0,
            failed: 0,
            backend: "memory" as const,
          };
        }
      }),
    );
  }

  private async databaseSize(): Promise<number> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ size: bigint }>>`
        SELECT pg_database_size(current_database()) AS size`;
      return Number(rows[0]?.size ?? 0);
    } catch {
      return 0;
    }
  }

  private async tableStats(): Promise<TableStat[]> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ relname: string; n_live_tup: bigint; size: bigint }>
      >`
        SELECT c.relname, s.n_live_tup, pg_total_relation_size(c.oid) AS size
        FROM pg_class c
        JOIN pg_stat_user_tables s ON s.relid = c.oid
        WHERE c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 12`;
      return rows.map((row) => ({
        name: row.relname,
        rows: Number(row.n_live_tup),
        sizeBytes: Number(row.size),
      }));
    } catch {
      return [];
    }
  }

  private async transcodeCounts(): Promise<{
    pending: number;
    done: number;
    failed: number;
  }> {
    const grouped = await this.prisma.attachment.groupBy({
      by: ["transcodeStatus"],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const byStatus = new Map(
      grouped.map((row) => [row.transcodeStatus, row._count._all]),
    );
    return {
      pending: byStatus.get("pending") ?? 0,
      done: byStatus.get("done") ?? 0,
      failed: byStatus.get("failed") ?? 0,
    };
  }

  private async healthChecks(): Promise<
    Array<{ name: string; ok: boolean; detail: string }>
  > {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.push({
        name: "database",
        ok: true,
        detail: `SELECT 1 in ${Date.now() - dbStart} ms`,
      });
    } catch (error) {
      checks.push({
        name: "database",
        ok: false,
        detail: error instanceof Error ? error.message : "unreachable",
      });
    }
    checks.push({
      name: "realtime",
      ok: true,
      detail: `${this.realtime.activeBoards} board channels`,
    });
    // Read through the cached singleton (TASK-156) — the panel probe must
    // not become another unindexed read on the hot path.
    const maintenance = await this.ops
      .maintenance()
      .catch(() => ({ mode: false, message: null }));
    checks.push({
      name: "maintenance",
      ok: true,
      detail: maintenance.mode ? "ON" : "off",
    });
    return checks;
  }
}
