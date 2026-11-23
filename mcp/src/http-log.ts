/**
 * Structured JSON logs for the Streamable HTTP gateway.
 *
 * The gateway handles personal API keys, so logging is deliberately narrow:
 * callers pass explicit fields (request id, session id, method, status,
 * duration), never headers or bodies. Every string is still scrubbed for a
 * bearer token or a `jnk_…` key before it reaches the sink, so an upstream
 * error message cannot accidentally publish a credential.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Record<string, unknown>;

/** A logger accepts an event name and a small, structured field bag. */
export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Defaults to stderr; stdout is kept free for protocol/tooling. */
  stream?: { write(chunk: string): unknown };
  now?: () => Date;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const TOKEN_PATTERNS: readonly RegExp[] = [
  // An Authorization header value or a copied "Bearer …" fragment.
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  // Janosik personal API keys. The exact length is not important; a prefix
  // match is enough to redact a key embedded in a longer message.
  /\bjnk_[A-Za-z0-9._~+/=-]+/g,
];

/** Remove bearer credentials and Janosik keys from arbitrary text. */
export function redactSecrets(value: string): string {
  let out = value;
  for (const pattern of TOKEN_PATTERNS)
    out = out.replace(pattern, "[redacted]");
  return out;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (value instanceof Error) return redactSecrets(value.message);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 4) return "[object]";
  if (Array.isArray(value)) {
    return value.slice(0, 32).map((item) => sanitize(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (count >= 32) break;
    out[key] = sanitize(item, depth + 1);
    count += 1;
  }
  return out;
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** Build a logger that writes one JSON object per line. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVEL_RANK[options.level ?? "info"];
  const stream = options.stream ?? process.stderr;
  const now = options.now ?? (() => new Date());

  const write = (level: LogLevel, event: string, fields?: LogFields): void => {
    if (LEVEL_RANK[level] < threshold) return;
    const line = {
      time: now().toISOString(),
      level,
      event,
      ...(fields ? (sanitize(fields) as Record<string, unknown>) : {}),
    };
    stream.write(`${JSON.stringify(line)}\n`);
  };

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

/** An in-memory logger for tests and for embedding the gateway. */
export function createBufferLogger(options: LoggerOptions = {}): {
  logger: Logger;
  lines: string[];
} {
  const lines: string[] = [];
  const logger = createLogger({
    ...options,
    stream: {
      write(chunk: string) {
        lines.push(chunk);
      },
    },
  });
  return { logger, lines };
}
