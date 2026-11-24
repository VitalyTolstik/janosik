/**
 * TASK-200.11 — naming and arithmetic for the monthly command-log partitions.
 *
 * The database side (see the migration) owns the DDL: two small functions,
 * `janosik_ensure_command_partition(date)` and
 * `janosik_drop_command_partition(date)`, create/drop the matching monthly
 * partitions of `Command`, `CommandDetail` and `CommandPreimage` together.
 * This module is the pure, testable half: which months to pre-create, which
 * catalog names are a monthly partition of which parent, and whether a whole
 * month has left the retention window.
 *
 * Month boundaries are UTC. `Command.createdAt` is a `timestamp(3)` without
 * time zone written by Prisma from a JS `Date` (UTC wall clock), so a local
 * boundary would move a few rows between partitions around midnight on the
 * first day of a month depending on the server's TZ.
 */

export const COMMAND_LOG_TABLES = [
  "Command",
  "CommandDetail",
  "CommandPreimage",
] as const;

export type CommandLogTable = (typeof COMMAND_LOG_TABLES)[number];

/** Current month is always ensured; a couple of future months absorb clock
 * skew and a maintenance run that is late. */
export const COMMAND_PARTITION_MONTHS_AHEAD = 3;
/** The previous month stays long enough for a request that crossed midnight. */
export const COMMAND_PARTITION_MONTHS_BEHIND = 1;

/** First instant of the UTC month containing `date`. */
export function utcMonthStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

/** `2026-11` → `2026-12`; keeps the first instant of the month. */
export function addMonths(month: Date, delta: number): Date {
  const start = utcMonthStart(month);
  return new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + delta, 1),
  );
}

/** The `YYYYMM` suffix used by every partition name. */
export function monthSuffix(month: Date): string {
  const start = utcMonthStart(month);
  return `${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `Command` + `2026-11` → `Command_202611`. */
export function commandPartitionName(
  table: CommandLogTable,
  month: Date,
): string {
  return `${table}_${monthSuffix(month)}`;
}

/** Half-open `[from, to)` bounds in UTC. */
export function monthBounds(month: Date): { from: Date; to: Date } {
  const from = utcMonthStart(month);
  return { from, to: addMonths(from, 1) };
}

/**
 * Months the maintenance job must exist for: previous, current and the next
 * `ahead` months. Duplicates are impossible because this always starts at a
 * UTC month boundary, but the helper de-duplicates defensively.
 */
export function partitionMonthsToEnsure(
  now: Date,
  ahead: number = COMMAND_PARTITION_MONTHS_AHEAD,
  behind: number = COMMAND_PARTITION_MONTHS_BEHIND,
): Date[] {
  const current = utcMonthStart(now);
  const months: Date[] = [];
  const seen = new Set<string>();
  for (let delta = -behind; delta <= ahead; delta += 1) {
    const month = addMonths(current, delta);
    const key = month.toISOString();
    if (seen.has(key)) continue;
    seen.add(key);
    months.push(month);
  }
  return months;
}

/**
 * Does `name` look like a monthly partition of `table`? The default
 * partition (`Command_default`) deliberately does not match: it must never
 * be dropped by the retention sweep.
 */
export function parseCommandPartitionMonth(
  table: CommandLogTable,
  name: string,
): Date | null {
  const prefix = `${table}_`;
  if (!name.startsWith(prefix)) return null;
  const suffix = name.slice(prefix.length);
  if (!/^\d{6}$/.test(suffix)) return null;
  const year = Number(suffix.slice(0, 4));
  const month = Number(suffix.slice(4, 6));
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

/** `true` when the whole month is strictly older than the cutoff. */
export function isWholeMonthExpired(month: Date, cutoff: Date): boolean {
  return monthBounds(month).to <= cutoff;
}
