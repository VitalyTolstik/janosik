import { Injectable } from "@nestjs/common";
import type { AdminObservabilityDto } from "@janosik/shared";
import { createRequire } from "node:module";
import { PrismaService } from "@/common/prisma/prisma.service";
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

const BACKEND_VERSION: string = (() => {
  try {
    const localRequire = createRequire(__filename);
    const pkg = localRequire("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

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
    const [size, tables, transcode, demo, health, queues] = await Promise.all([
      this.databaseSize(),
      this.tableStats(),
      this.transcodeCounts(),
      this.demo.status(),
      this.healthChecks(),
      this.queueCounters(),
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
        },
        queues,
      },
      health,
    };
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
