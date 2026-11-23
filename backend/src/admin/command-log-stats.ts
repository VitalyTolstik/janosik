import { Prisma } from "@prisma/client";
import type { AdminCommandLogObservabilityDto } from "@janosik/shared";
import type { PrismaService } from "@/common/prisma/prisma.service";

/**
 * TASK-200.11 — command-log partition and vacuum health.
 *
 * Partition rows/size/dead tuples are planner/statistics estimates
 * (`pg_class.reltuples`, `pg_stat_user_tables`) so the panel does not count
 * hundreds of millions of rows. The default partitions are the exception: they
 * should be empty, they are small, and an exact count is what tells an operator
 * that a month must be repaired. `defaultRows` is therefore a real `count(*)`
 * over the three `*_default` tables.
 */
export async function readCommandLogStats(
  prisma: Pick<PrismaService, "$queryRaw">,
  retentionDays: number,
): Promise<AdminCommandLogObservabilityDto> {
  const partitions = await prisma.$queryRaw<
    Array<{
      parent: "Command" | "CommandDetail" | "CommandPreimage";
      name: string;
      rows: bigint;
      sizeBytes: bigint;
      deadRows: bigint;
      lastVacuumAt: Date | null;
      lastAutovacuumAt: Date | null;
    }>
  >(Prisma.sql`
    SELECT parent.relname::text AS "parent",
           child.relname::text AS "name",
           GREATEST(child.reltuples, 0)::bigint AS "rows",
           pg_total_relation_size(child.oid)::bigint AS "sizeBytes",
           COALESCE(stats.n_dead_tup, 0)::bigint AS "deadRows",
           stats.last_vacuum AS "lastVacuumAt",
           stats.last_autovacuum AS "lastAutovacuumAt"
      FROM pg_inherits
      JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
      JOIN pg_class child ON child.oid = pg_inherits.inhrelid
      JOIN pg_namespace ns ON ns.oid = parent.relnamespace
      LEFT JOIN pg_stat_user_tables stats ON stats.relid = child.oid
     WHERE ns.nspname = current_schema()
       AND parent.relname IN ('Command', 'CommandDetail', 'CommandPreimage')
     ORDER BY parent.relname, child.relname
  `);
  const defaults = await prisma.$queryRaw<
    Array<{ command: bigint; detail: bigint; preimage: bigint }>
  >(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "Command_default")::bigint AS "command",
      (SELECT count(*) FROM "CommandDetail_default")::bigint AS "detail",
      (SELECT count(*) FROM "CommandPreimage_default")::bigint AS "preimage"
  `);
  return {
    available: true,
    retentionDays,
    partitions: partitions.map((row) => ({
      parent: row.parent,
      name: row.name,
      rows: Number(row.rows),
      sizeBytes: Number(row.sizeBytes),
      deadRows: Number(row.deadRows),
      lastVacuumAt: row.lastVacuumAt?.getTime() ?? null,
      lastAutovacuumAt: row.lastAutovacuumAt?.getTime() ?? null,
    })),
    defaultRows: Number(
      (defaults[0]?.command ?? 0n) +
        (defaults[0]?.detail ?? 0n) +
        (defaults[0]?.preimage ?? 0n),
    ),
  };
}
