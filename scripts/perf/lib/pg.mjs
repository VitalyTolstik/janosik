// TASK-200.1 — optional PostgreSQL instrumentation.
//
// No npm dependency: it shells out to `psql`, which a dedicated perf host
// already has. The URL's userinfo never reaches argv, console, JSON or
// Markdown: the password goes through `PGPASSWORD` (or an existing
// `.pgpass`), the argv connection string is stripped, and child-process
// errors are sanitized before they are reported.

import { execFile } from "node:child_process";
import { safeChildError, sanitizeText, stripUserInfo } from "./redact.mjs";

export const PG_STAT_STATEMENTS_SQL = `
SELECT
  queryid::text,
  calls,
  round(total_exec_time::numeric, 2)::text,
  round(mean_exec_time::numeric, 2)::text,
  rows,
  regexp_replace(query, E'[\\t\\n\\r]+', ' ', 'g')
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_exec_time DESC
LIMIT %LIMIT%
`.trim();

export const PG_ACTIVITY_SQL = `
SELECT
  coalesce(state, 'unknown'),
  coalesce(wait_event_type, ''),
  coalesce(wait_event, ''),
  count(*)::text
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
GROUP BY 1, 2, 3
ORDER BY 4 DESC
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

/** Parse the grouped pg_stat_activity rows. */
export function parsePgActivityRows(text) {
  const states = {};
  const waits = {};
  let total = 0;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const fields = line.split("\t");
    if (fields.length < 4) continue;
    const state = fields[0] || "unknown";
    const waitType = fields[1] || "";
    const waitEvent = fields[2] || "";
    const count = number(fields[3]) ?? 0;
    total += count;
    states[state] = (states[state] ?? 0) + count;
    if (waitType !== "" || waitEvent !== "") {
      const key = [waitType, waitEvent].filter(Boolean).join(":");
      waits[key] = (waits[key] ?? 0) + count;
    }
  }
  return { total, states, waits };
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort((a, b) => b[1] - a[1]));
}

function decode(value) {
  if (typeof value !== "string" || value === "") return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Build a psql invocation that keeps the password out of argv. Returns the
 * sanitized connection string for diagnostics only.
 */
export function psqlInvocation({ databaseUrl, psql = "psql", sql }) {
  let connection;
  let username;
  let password;
  try {
    const parsed = new URL(databaseUrl);
    username = decode(parsed.username) || undefined;
    password = decode(parsed.password) || undefined;
    parsed.username = "";
    parsed.password = "";
    connection = parsed.toString();
  } catch {
    connection = stripUserInfo(String(databaseUrl));
  }
  const args = ["-X", "-A", "-t", "-F", "\t", "--no-psqlrc"];
  if (username !== undefined) args.push("--username", username);
  args.push(connection, "-c", sql);
  return {
    command: psql,
    args,
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? "5",
      ...(password !== undefined ? { PGPASSWORD: password } : {}),
    },
    connection: stripUserInfo(connection),
    secrets: password === undefined ? [] : [password],
  };
}

function runPsql({
  databaseUrl,
  psql,
  sql,
  signal,
  execFileImpl,
  timeout = 15_000,
}) {
  const invocation = psqlInvocation({ databaseUrl, psql, sql });
  return new Promise((resolve, reject) => {
    execFileImpl(
      invocation.command,
      invocation.args,
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout,
        signal,
        env: invocation.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              safeChildError(
                { ...error, stderr: error.stderr ?? stderr },
                invocation.secrets,
              ),
            ),
          );
          return;
        }
        resolve({ stdout, connection: invocation.connection });
      },
    );
  });
}

/**
 * @returns {Promise<{enabled: boolean, available?: boolean, rows?: object[], reason?: string}>}
 */
export async function collectPgStatements({
  databaseUrl,
  psql = "psql",
  limit = 20,
  signal,
  execFileImpl = execFile,
} = {}) {
  return collectPgSnapshot({
    databaseUrl,
    psql,
    sql: pgStatementsSql(limit),
    parse: parsePsqlRows,
    signal,
    execFileImpl,
  });
}

async function collectPgSnapshot({
  databaseUrl,
  psql,
  sql,
  parse,
  signal,
  execFileImpl,
}) {
  if (databaseUrl === undefined || databaseUrl === "") {
    return { enabled: false, reason: "no --pg-url" };
  }
  try {
    const { stdout } = await runPsql({
      databaseUrl,
      psql,
      sql,
      signal,
      execFileImpl,
    });
    return {
      enabled: true,
      available: true,
      rows: parse(stdout),
    };
  } catch (error) {
    return {
      enabled: true,
      available: false,
      reason: sanitizeText(error instanceof Error ? error.message : error),
    };
  }
}

/** Kept for callers/tests that only need one snapshot. */
export async function collectPgStats(options = {}) {
  return collectPgStatements(options);
}

function isInternalQuery(query) {
  return /\bpg_stat_(statements|activity|database)\b/i.test(query ?? "");
}

/**
 * Per-scenario delta by queryid. Returns Top-20 by calls and by total time;
 * suites report both, because a rare slow query and a hot cheap one are
 * different findings.
 */
export function diffPgStatements(before, after, limit = 20) {
  if (
    before?.available !== true ||
    after?.available !== true ||
    !Array.isArray(before.rows) ||
    !Array.isArray(after.rows)
  ) {
    return {
      available: false,
      reason:
        after?.reason ?? before?.reason ?? "pg_stat_statements unavailable",
      topByCalls: [],
      topByTotalTime: [],
    };
  }
  const previous = new Map(before.rows.map((row) => [row.queryid, row]));
  const deltas = [];
  for (const row of after.rows) {
    const old = previous.get(row.queryid);
    if (old === undefined) continue;
    const calls = (row.calls ?? 0) - (old.calls ?? 0);
    const totalMs = (row.totalMs ?? 0) - (old.totalMs ?? 0);
    if (calls <= 0 || isInternalQuery(row.query)) continue;
    const rows = (row.rows ?? 0) - (old.rows ?? 0);
    deltas.push({
      queryid: row.queryid,
      calls,
      totalMs: Math.round(totalMs * 100) / 100,
      meanMs: Math.round((totalMs / calls) * 100) / 100,
      rows: Math.max(0, rows),
      query: row.query,
    });
  }
  const topByCalls = [...deltas]
    .sort((a, b) => b.calls - a.calls || b.totalMs - a.totalMs)
    .slice(0, limit);
  const topByTotalTime = [...deltas]
    .sort((a, b) => b.totalMs - a.totalMs || b.calls - a.calls)
    .slice(0, limit);
  return { available: true, topByCalls, topByTotalTime };
}

/** One pg_stat_activity sample (states and wait events for this database). */
export async function collectPgActivity({
  databaseUrl,
  psql = "psql",
  signal,
  execFileImpl = execFile,
} = {}) {
  if (databaseUrl === undefined || databaseUrl === "") {
    return { enabled: false, reason: "no --pg-url" };
  }
  try {
    const { stdout } = await runPsql({
      databaseUrl,
      psql,
      sql: PG_ACTIVITY_SQL,
      signal,
      execFileImpl,
    });
    const sample = parsePgActivityRows(stdout);
    return {
      enabled: true,
      available: true,
      total: sample.total,
      states: sortedObject(sample.states),
      waits: sortedObject(sample.waits),
    };
  } catch (error) {
    return {
      enabled: true,
      available: false,
      reason: sanitizeText(error instanceof Error ? error.message : error),
    };
  }
}

/**
 * Periodic pg_stat_activity sampler. Each poll is a separate psql process;
 * a slow poll is skipped rather than queued. `stop()` returns a summary whose
 * state counts are the peak observed per state.
 */
export class PgActivitySampler {
  constructor({
    databaseUrl,
    psql = "psql",
    intervalMs = 2_000,
    collect = collectPgActivity,
    now = () => Date.now(),
  } = {}) {
    this.databaseUrl = databaseUrl;
    this.psql = psql;
    this.intervalMs = Math.max(100, intervalMs);
    this.collect = collect;
    this.now = now;
    this.samples = [];
    this.errors = [];
    this.timer = null;
    this.inFlight = null;
  }

  start(signal) {
    if (this.timer !== null) return this;
    this.signal = signal;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref?.();
    return this;
  }

  async poll() {
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const result = await this.collect({
          databaseUrl: this.databaseUrl,
          psql: this.psql,
          signal: this.signal,
        });
        if (result.available === true) {
          this.samples.push({ ts: this.now(), ...result });
        } else if (result.reason !== undefined && this.errors.length < 5) {
          this.errors.push({ ts: this.now(), reason: result.reason });
        }
      } catch (error) {
        if (this.errors.length < 5) {
          this.errors.push({
            ts: this.now(),
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
    return undefined;
  }

  async stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.inFlight !== null) await this.inFlight;
    return this.summarize();
  }

  summarize() {
    const states = {};
    const waits = {};
    let peakConnections = 0;
    for (const sample of this.samples) {
      peakConnections = Math.max(peakConnections, sample.total ?? 0);
      for (const [state, count] of Object.entries(sample.states ?? {})) {
        states[state] = Math.max(states[state] ?? 0, count);
      }
      for (const [wait, count] of Object.entries(sample.waits ?? {})) {
        waits[wait] = Math.max(waits[wait] ?? 0, count);
      }
    }
    return {
      enabled: this.databaseUrl !== undefined && this.databaseUrl !== "",
      available: this.samples.length > 0,
      samples: this.samples.length,
      peakConnections,
      states: sortedObject(states),
      waits: sortedObject(waits),
      errors: this.errors,
    };
  }
}
