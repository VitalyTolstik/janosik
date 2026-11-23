// TASK-200.1 — optional Redis INFO sampling.
//
// Uses `redis-cli` rather than a client dependency. The password is passed
// through `REDISCLI_AUTH` (never argv), and the URL is redacted before it is
// reported.

import { execFile } from "node:child_process";
import { safeChildError, sanitizeText, stripUserInfo } from "./redact.mjs";

/** Parse `redis-cli INFO` into the fields the report needs. */
export function parseRedisInfo(text) {
  const sections = {};
  let section = "default";
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("#")) {
      section = trimmed.slice(1).trim().toLowerCase() || "default";
      continue;
    }
    const index = trimmed.indexOf(":");
    if (index < 0) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    const numeric = Number(value);
    sections[section] ??= {};
    sections[section][key] = Number.isFinite(numeric) ? numeric : value;
  }
  const memory = sections.memory ?? {};
  const clients = sections.clients ?? {};
  const stats = sections.stats ?? {};
  const keyspace = {};
  for (const [db, value] of Object.entries(sections.keyspace ?? {})) {
    if (typeof value !== "string") continue;
    const fields = {};
    for (const part of value.split(",")) {
      const [key, raw] = part.split("=");
      if (key === undefined) continue;
      const parsed = Number(raw);
      fields[key] = Number.isFinite(parsed) ? parsed : raw;
    }
    keyspace[db] = fields;
  }
  return {
    memory: {
      used: numberOrNull(memory.used_memory),
      usedHuman: memory.used_memory_human ?? null,
      peak: numberOrNull(memory.used_memory_peak),
      max: numberOrNull(memory.maxmemory),
      fragmentation: numberOrNull(memory.mem_fragmentation_ratio),
    },
    clients: {
      connected: numberOrNull(clients.connected_clients),
      blocked: numberOrNull(clients.blocked_clients),
      maxInputBuffer: numberOrNull(clients.client_recent_max_input_buffer),
    },
    stats: {
      opsPerSecond: numberOrNull(stats.instantaneous_ops_per_sec),
      rejectedConnections: numberOrNull(stats.rejected_connections),
      keyspaceHits: numberOrNull(stats.keyspace_hits),
      keyspaceMisses: numberOrNull(stats.keyspace_misses),
      expiredKeys: numberOrNull(stats.expired_keys),
      evictedKeys: numberOrNull(stats.evicted_keys),
      totalCommandsProcessed: numberOrNull(stats.total_commands_processed),
    },
    keyspace,
  };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function redisInvocation({ redisUrl, redisCli = "redis-cli" }) {
  let host = "127.0.0.1";
  let port = "6379";
  let username;
  let password;
  let tls = false;
  try {
    const parsed = new URL(redisUrl);
    host = parsed.hostname || host;
    port = parsed.port || port;
    username = parsed.username === "" ? undefined : parsed.username;
    password = parsed.password === "" ? undefined : parsed.password;
    tls = parsed.protocol === "rediss:";
  } catch {
    // Keep defaults; the disabled/unavailable reason names the CLI, not the URL.
  }
  const args = ["-h", host, "-p", port, "INFO"];
  if (username !== undefined) args.unshift("--user", username);
  if (tls) args.unshift("--tls");
  return {
    command: redisCli,
    args,
    env: {
      ...process.env,
      ...(password !== undefined ? { REDISCLI_AUTH: password } : {}),
    },
    url: stripUserInfo(redisUrl),
    secrets: password === undefined ? [] : [password],
  };
}

/** One INFO snapshot. The failure reason never contains argv or the URL. */
export async function collectRedisInfo({
  redisUrl,
  redisCli = "redis-cli",
  signal,
  execFileImpl = execFile,
} = {}) {
  if (redisUrl === undefined || redisUrl === "") {
    return { enabled: false, reason: "no --redis-url" };
  }
  const invocation = redisInvocation({ redisUrl, redisCli });
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFileImpl(
        invocation.command,
        invocation.args,
        {
          maxBuffer: 4 * 1024 * 1024,
          timeout: 10_000,
          signal,
          env: invocation.env,
        },
        (error, output, stderr) => {
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
          resolve(output);
        },
      );
    });
    return {
      enabled: true,
      available: true,
      url: invocation.url,
      info: parseRedisInfo(stdout),
    };
  } catch (error) {
    return {
      enabled: true,
      available: false,
      url: invocation.url,
      reason: sanitizeText(error instanceof Error ? error.message : error),
    };
  }
}

/** Summarize start/end samples; counters are deltas, gauges are maxima. */
export function diffRedisInfo(before, after, durationMs) {
  if (before?.available !== true || after?.available !== true) {
    return {
      enabled: after?.enabled ?? before?.enabled ?? true,
      available: false,
      reason: after?.reason ?? before?.reason ?? "Redis INFO unavailable",
    };
  }
  const a = after.info;
  const b = before.info;
  const counter = (path) => {
    const end = path(a);
    const start = path(b);
    return end === null || start === null ? null : Math.max(0, end - start);
  };
  const ops = a.stats.opsPerSecond === null ? null : a.stats.opsPerSecond;
  return {
    enabled: true,
    available: true,
    url: after.url ?? before.url,
    samples: 2,
    durationMs,
    memory: {
      used: a.memory.used,
      peak: a.memory.peak,
      max: a.memory.max,
      usedHuman: a.memory.usedHuman,
    },
    clients: {
      connected: Math.max(b.clients.connected ?? 0, a.clients.connected ?? 0),
      blocked: Math.max(b.clients.blocked ?? 0, a.clients.blocked ?? 0),
    },
    opsPerSecond: ops,
    rejected: counter((info) => info.stats.rejectedConnections),
    keyspaceHits: counter((info) => info.stats.keyspaceHits),
    keyspaceMisses: counter((info) => info.stats.keyspaceMisses),
    keyspaceHitRate: hitRate(b, a),
    commands: counter((info) => info.stats.totalCommandsProcessed),
    keyspace: a.keyspace,
  };
}

function hitRate(before, after) {
  const hits =
    (after.stats.keyspaceHits ?? 0) - (before.stats.keyspaceHits ?? 0);
  const misses =
    (after.stats.keyspaceMisses ?? 0) - (before.stats.keyspaceMisses ?? 0);
  const total = hits + misses;
  if (total <= 0) return null;
  return Math.round((hits / total) * 10000) / 10000;
}
