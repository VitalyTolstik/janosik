// TASK-200.1 — optional pg_stat_statements collection.
//
// No npm dependency: it shells out to `psql`, which a dedicated perf host
// already has. `--pg-url` is optional and its absence is reported explicitly.

import { execFile } from "node:child_process";

export const PG_STAT_STATEMENTS_SQL = `
SELECT
  queryid::text,
  calls,
  round(total_exec_time::numeric, 2)::text,
  round(mean_exec_time::numeric, 2)::text,
  rows,
  regexp_replace(query, E'[\\t\\n\\r]+', ' ', 'g')
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT %LIMIT%
`.trim();

export function pgStatementsSql(limit = 20) {
  const safe = Math.max(1, Math.min(1_000, Math.floor(Number(limit) || 20)));
  return PG_STAT_STATEMENTS_SQL.replace("%LIMIT%", String(safe));
}

/**
 * Parse `psql -A -t -F '\t'` output. The SQL statement itself has tabs and
 * newlines collapsed, so the first five columns split safely.
 */
export function parsePsqlRows(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const fields = line.split("\t");
    if (fields.length < 6) continue;
    rows.push({
      queryid: fields[0],
      calls: number(fields[1]),
      totalMs: number(fields[2]),
      meanMs: number(fields[3]),
      rows: number(fields[4]),
      query: fields.slice(5).join("\t").trim(),
    });
  }
  return rows;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @returns {Promise<{enabled: boolean, available?: boolean, queries?: object[], reason?: string}>}
 */
export async function collectPgStats({
  databaseUrl,
  psql = "psql",
  limit = 20,
  execFileImpl = execFile,
} = {}) {
  if (databaseUrl === undefined || databaseUrl === "") {
    return { enabled: false, reason: "no --pg-url" };
  }
  const args = [
    "-X",
    "-A",
    "-t",
    "-F",
    "\t",
    databaseUrl,
    "-c",
    pgStatementsSql(limit),
  ];
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFileImpl(
        psql,
        args,
        { maxBuffer: 10 * 1024 * 1024, timeout: 15_000 },
        (error, output) => {
          if (error) reject(error);
          else resolve(output);
        },
      );
    });
    return {
      enabled: true,
      available: true,
      queries: parsePsqlRows(stdout),
    };
  } catch (error) {
    return {
      enabled: true,
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
