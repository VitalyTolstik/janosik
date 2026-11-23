/**
 * Configuration for the Streamable HTTP gateway.
 *
 * The gateway is a separate process: it needs a Janosik origin and the same
 * toolset/read-only/filesystem policy as the stdio server, but it deliberately
 * has no `JANOSIK_TOKEN`. Every MCP session authenticates with the personal
 * API key in its own `Authorization` header.
 */

import { ConfigError, loadConfig, type Config } from "./config.js";
import { LOG_LEVELS, isLogLevel, type LogLevel } from "./http-log.js";

export const DEFAULT_HTTP_PORT = 8080;
export const DEFAULT_PATH = "/mcp";

export interface GatewayConfig {
  /** Shared server settings; `token` is always empty in gateway mode. */
  base: Config;
  host: string;
  port: number;
  path: string;
  /** Global number of live sessions. */
  maxSessions: number;
  /** Per-token session cap; 0 disables the second limit. */
  maxSessionsPerToken: number;
  /** A session with no request for this long is closed. */
  sessionIdleMs: number;
  /** How often the idle sweeper runs. */
  sessionSweepMs: number;
  /** Largest accepted JSON-RPC request body. */
  maxBodyBytes: number;
  /** Exact browser origins allowed to call the gateway; empty denies all. */
  allowedOrigins: ReadonlySet<string>;
  /** API readiness probe used by `GET /ready`. */
  readinessUrl: string;
  readinessCacheMs: number;
  readinessTimeoutMs: number;
  /** Trust the first `X-Forwarded-For` hop for logs. */
  trustProxy: boolean;
  logLevel: LogLevel;
  shutdownGraceMs: number;
  /** Node's request timeout; 0 disables it (long `wait_for_work` calls). */
  requestTimeoutMs: number;
  headersTimeoutMs: number;
}

export interface LoadedGatewayConfig {
  config: GatewayConfig;
  /** True when `JANOSIK_TOKEN` was present and intentionally ignored. */
  ignoredSharedToken: boolean;
}

function envString(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function positiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  options: { allowZero?: boolean; max?: number } = {},
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new ConfigError(`${name} must be a non-negative integer.`);
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value)) {
    throw new ConfigError(`${name} is too large.`);
  }
  if (!options.allowZero && value === 0) {
    throw new ConfigError(`${name} must be greater than zero.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new ConfigError(`${name} must be at most ${options.max}.`);
  }
  return value;
}

function boolean(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function normalizePath(raw: string): string {
  const value = raw.trim();
  if (!value.startsWith("/") || /\s|[?#]/.test(value)) {
    throw new ConfigError(
      "JANOSIK_MCP_HTTP_PATH must start with / and contain no query or fragment.",
    );
  }
  const path = value.length > 1 ? value.replace(/\/+$/, "") : value;
  if (path === "/") {
    throw new ConfigError(
      'JANOSIK_MCP_HTTP_PATH cannot be "/" (it would hide /health and /ready).',
    );
  }
  if (path === "/health" || path === "/ready") {
    throw new ConfigError(
      `JANOSIK_MCP_HTTP_PATH cannot be ${path}; that path is reserved.`,
    );
  }
  return path;
}

function normalizeOrigins(raw: string | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  if (raw === undefined || raw.trim() === "") return out;
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value === "") continue;
    if (value === "*") {
      out.add("*");
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new ConfigError(
        `JANOSIK_MCP_HTTP_ALLOWED_ORIGINS contains an invalid origin "${value}".`,
      );
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new ConfigError(
        `JANOSIK_MCP_HTTP_ALLOWED_ORIGINS must list bare origins, got "${value}".`,
      );
    }
    out.add(parsed.origin);
  }
  return out;
}

function normalizeReadinessUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError("JANOSIK_MCP_HTTP_READY_URL must be an HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ConfigError("JANOSIK_MCP_HTTP_READY_URL must be an HTTP(S) URL.");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new ConfigError(
      "JANOSIK_MCP_HTTP_READY_URL cannot contain credentials or a fragment.",
    );
  }
  return parsed.toString();
}

function normalizeHost(raw: string): string {
  const host = raw.trim();
  if (host === "" || /[\s/]/.test(host)) {
    throw new ConfigError(
      "JANOSIK_MCP_HTTP_HOST must be a host or IP address.",
    );
  }
  return host;
}

function logLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env.JANOSIK_MCP_HTTP_LOG_LEVEL?.trim().toLowerCase();
  if (raw === undefined || raw === "") return "info";
  if (!isLogLevel(raw)) {
    throw new ConfigError(
      `JANOSIK_MCP_HTTP_LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}.`,
    );
  }
  return raw;
}

/**
 * Parse gateway settings from the environment. `JANOSIK_TOKEN` and `--token`
 * are ignored (and reported in {@link LoadedGatewayConfig}) so one shared
 * credential can never leak into sessions.
 */
export function loadGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): LoadedGatewayConfig {
  const base = loadConfig(argv, env, { tokenFromRequest: true });
  const host = normalizeHost(
    envString(env, "JANOSIK_MCP_HTTP_HOST", "127.0.0.1"),
  );
  const port = positiveInt(env, "JANOSIK_MCP_HTTP_PORT", DEFAULT_HTTP_PORT, {
    allowZero: true,
    max: 65535,
  });
  const path = normalizePath(
    envString(env, "JANOSIK_MCP_HTTP_PATH", DEFAULT_PATH),
  );
  const maxSessions = positiveInt(env, "JANOSIK_MCP_HTTP_MAX_SESSIONS", 500);
  const maxSessionsPerToken = positiveInt(
    env,
    "JANOSIK_MCP_HTTP_MAX_SESSIONS_PER_TOKEN",
    0,
    { allowZero: true },
  );
  if (maxSessionsPerToken > maxSessions) {
    throw new ConfigError(
      "JANOSIK_MCP_HTTP_MAX_SESSIONS_PER_TOKEN cannot exceed " +
        "JANOSIK_MCP_HTTP_MAX_SESSIONS.",
    );
  }
  const sessionIdleMs = positiveInt(
    env,
    "JANOSIK_MCP_HTTP_SESSION_IDLE_MS",
    5 * 60_000,
  );
  const sessionSweepMs = positiveInt(
    env,
    "JANOSIK_MCP_HTTP_SESSION_SWEEP_MS",
    30_000,
  );
  const maxBodyBytes = positiveInt(
    env,
    "JANOSIK_MCP_HTTP_MAX_BODY_BYTES",
    16 * 1024 * 1024,
  );
  const readinessUrl = normalizeReadinessUrl(
    envString(
      env,
      "JANOSIK_MCP_HTTP_READY_URL",
      `${base.url}/api/v1/health/ready`,
    ),
  );
  const readinessCacheMs = positiveInt(
    env,
    "JANOSIK_MCP_HTTP_READY_CACHE_MS",
    5_000,
    { allowZero: true },
  );
  const readinessTimeoutMs = positiveInt(
    env,
    "JANOSIK_MCP_HTTP_READY_TIMEOUT_MS",
    3_000,
  );
  const shutdownGraceMs = positiveInt(
    env,
    "JANOSIK_MCP_HTTP_SHUTDOWN_GRACE_MS",
    10_000,
  );
  const requestTimeoutMs = positiveInt(
    env,
    "JANOSIK_MCP_HTTP_REQUEST_TIMEOUT_MS",
    360_000,
    { allowZero: true },
  );
  const headersTimeoutMs = positiveInt(
    env,
    "JANOSIK_MCP_HTTP_HEADERS_TIMEOUT_MS",
    60_000,
  );

  return {
    ignoredSharedToken:
      (env.JANOSIK_TOKEN !== undefined && env.JANOSIK_TOKEN.trim() !== "") ||
      argv.some((arg) => arg === "--token" || arg.startsWith("--token=")),
    config: {
      base,
      host,
      port,
      path,
      maxSessions,
      maxSessionsPerToken,
      sessionIdleMs,
      sessionSweepMs,
      maxBodyBytes,
      allowedOrigins: normalizeOrigins(env.JANOSIK_MCP_HTTP_ALLOWED_ORIGINS),
      readinessUrl,
      readinessCacheMs,
      readinessTimeoutMs,
      trustProxy: boolean(env, "JANOSIK_MCP_HTTP_TRUST_PROXY"),
      logLevel: logLevel(env),
      shutdownGraceMs,
      requestTimeoutMs,
      headersTimeoutMs,
    },
  };
}

export const HTTP_USAGE = `janosik-mcp-http — shared MCP Streamable HTTP gateway

Each MCP session supplies its own personal API key; this process never starts
with one shared token. The stdio server remains the desktop-client transport.

Environment:
  JANOSIK_URL                         Instance origin (required)
  JANOSIK_MCP_HTTP_HOST               Bind host (default 127.0.0.1)
  JANOSIK_MCP_HTTP_PORT               Bind port (default ${DEFAULT_HTTP_PORT})
  JANOSIK_MCP_HTTP_PATH               MCP endpoint (default ${DEFAULT_PATH})
  JANOSIK_MCP_HTTP_MAX_SESSIONS       Global session cap (default 500)
  JANOSIK_MCP_HTTP_MAX_SESSIONS_PER_TOKEN  Per-key cap (default 0 = off)
  JANOSIK_MCP_HTTP_SESSION_IDLE_MS    Idle expiry (default 300000)
  JANOSIK_MCP_HTTP_SESSION_SWEEP_MS   Sweep interval (default 30000)
  JANOSIK_MCP_HTTP_MAX_BODY_BYTES     Request body cap (default 16777216)
  JANOSIK_MCP_HTTP_ALLOWED_ORIGINS    Comma-separated browser origins
  JANOSIK_MCP_HTTP_READY_URL          Upstream readiness probe
  JANOSIK_MCP_HTTP_READY_CACHE_MS     Probe cache (default 5000)
  JANOSIK_MCP_HTTP_READY_TIMEOUT_MS   Probe timeout (default 3000)
  JANOSIK_MCP_HTTP_TRUST_PROXY        Trust X-Forwarded-For (default off)
  JANOSIK_MCP_HTTP_LOG_LEVEL          debug|info|warn|error (default info)
  JANOSIK_MCP_HTTP_SHUTDOWN_GRACE_MS  Drain grace (default 10000)
  JANOSIK_MCP_HTTP_REQUEST_TIMEOUT_MS Node request timeout (0 = off)
  JANOSIK_MCP_HTTP_HEADERS_TIMEOUT_MS Node headers timeout (default 60000)

Tool settings (JANOSIK_MCP_TOOLSETS, JANOSIK_MCP_READONLY,
JANOSIK_MCP_ALLOW_FS, JANOSIK_MCP_FS_ROOT, JANOSIK_APP_BASE) are shared with
the stdio server. JANOSIK_TOKEN is ignored: send
"Authorization: Bearer jnk_…" on every MCP request instead.

Endpoints: ${DEFAULT_PATH} (MCP), /health (liveness), /ready (readiness)`;
