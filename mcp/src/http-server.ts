/**
 * The shared MCP Streamable HTTP gateway.
 *
 * This is a separate service from the API: it accepts MCP JSON-RPC over HTTP,
 * keeps one `McpServer` + `JanosikClient` per session, and forwards the
 * caller's personal API key from `Authorization` to the Janosik API. It has no
 * database and no shared token.
 */

import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { isIP, type AddressInfo } from "node:net";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import type { Config } from "./config.js";
import { parseRetryAfter } from "./errors.js";
import {
  KeyedTokenBucket,
  NegativeTokenCache,
  SingleFlight,
  SingleFlightCapacityError,
  TenantConcurrencyGate,
} from "./http-admission.js";
import {
  createServer as createMcpServer,
  type CreateServerOptions,
} from "./server.js";
import type { GatewayConfig } from "./http-config.js";
import type { Logger } from "./http-log.js";
import {
  ToolTracker,
  installToolTracking,
  toolRequestContext,
} from "./http-tool-lifecycle.js";
import {
  SessionManager,
  fingerprintToken,
  sessionMatchesToken,
  type GatewaySession,
} from "./http-session.js";

const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
const SESSION_HEADER = "mcp-session-id";
const RETRY_AFTER_SESSION_LIMIT = "5";
const RETRY_AFTER_AUTH = "5";
const RETRY_AFTER_SHUTDOWN = "1";
const RETRY_AFTER_READY = "5";

class GatewayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "GatewayHttpError";
  }
}

class ClientBodyAbortError extends Error {
  constructor() {
    super("The client aborted the request body.");
    this.name = "ClientBodyAbortError";
  }
}

class BodyReadTimeoutError extends Error {
  constructor() {
    super("The request body read timed out.");
    this.name = "BodyReadTimeoutError";
  }
}

interface BodySlot {
  release(): void;
}

export interface HttpGatewayOptions {
  config: GatewayConfig;
  logger: Logger;
  /** Injection points for tests; production uses the stdio server factory. */
  createMcpServer?: (
    config: Config,
    options?: CreateServerOptions,
  ) => McpServer;
  fetchImpl?: typeof fetch;
  version?: string;
}

export interface GatewayAddress {
  host: string;
  port: number;
}

export interface HttpGateway {
  readonly server: HttpServer;
  readonly manager: SessionManager;
  readonly config: GatewayConfig;
  readonly closing: boolean;
  listen(): Promise<GatewayAddress>;
  close(reason?: string): Promise<void>;
  address(): GatewayAddress | null;
}

function headerString(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

function pathnameOf(url: string | undefined): string | null {
  try {
    return new URL(url ?? "/", "http://gateway.invalid").pathname;
  } catch {
    return null;
  }
}

/** Parse exactly one Bearer credential; never accept one from a query. */
export function bearerToken(
  authorization: string | string[] | undefined,
): string | null {
  const header = headerString(authorization);
  if (header === undefined) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  if (match === null) return null;
  const token = match[1]!;
  if (token.length < 8 || token.length > 4096) return null;
  for (const character of token) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }
  return token;
}

function containsInitialize(body: unknown): boolean {
  return Array.isArray(body)
    ? body.some((message) => isInitializeRequest(message))
    : isInitializeRequest(body);
}

async function readJsonBody(
  req: IncomingMessage,
  limit: number,
): Promise<unknown> {
  const declared = Number(headerString(req.headers["content-length"]) ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    throw new GatewayHttpError(
      413,
      "payload_too_large",
      "Request body too large.",
    );
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > limit) {
      throw new GatewayHttpError(
        413,
        "payload_too_large",
        "Request body too large.",
      );
    }
    chunks.push(buffer);
  }
  if (total === 0) {
    throw new GatewayHttpError(400, "invalid_json", "Request body is empty.");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new GatewayHttpError(
      400,
      "invalid_json",
      "Request body must be valid JSON.",
    );
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(text);
}

function sendNoContent(
  res: ServerResponse,
  headers: Record<string, string>,
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(204, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end();
}

function unauthorized(res: ServerResponse): void {
  sendJson(
    res,
    401,
    {
      error: "unauthorized",
      message:
        "A valid personal API key is required in Authorization: Bearer ….",
    },
    { "WWW-Authenticate": 'Bearer realm="janosik-mcp"' },
  );
}

function sessionLimitResponse(
  res: ServerResponse,
  reason: "session_limit" | "token_limit",
): void {
  sendJson(
    res,
    503,
    {
      error: "session_limit",
      message:
        reason === "token_limit"
          ? "This API key has reached its concurrent MCP session limit."
          : "The MCP gateway has reached its concurrent session limit.",
    },
    { "Retry-After": RETRY_AFTER_SESSION_LIMIT },
  );
}

function initializeRateLimited(
  res: ServerResponse,
  retryAfterSeconds: number,
): void {
  sendJson(
    res,
    429,
    {
      error: "initialize_rate_limited",
      message: "Too many initialize attempts; retry shortly.",
    },
    {
      "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))),
    },
  );
}

type TokenValidation =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid" | "rate_limited" | "unavailable";
      retryAfter?: number;
      retryable?: boolean;
    };

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function clientAddress(
  req: IncomingMessage,
  trustedHops: number,
): string {
  if (trustedHops > 0) {
    const forwarded = headerString(req.headers["x-forwarded-for"]);
    if (forwarded !== undefined) {
      const chain = forwarded
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      // Each trusted proxy appends the address it saw to the right. Read
      // from the right by the number of trusted hops; never the attacker-
      // controlled left edge.
      const index = chain.length - trustedHops;
      const candidate = index >= 0 ? chain[index] : undefined;
      if (candidate !== undefined && isIP(candidate) !== 0) return candidate;
    }
  }
  const remote = req.socket.remoteAddress ?? "unknown";
  return remote.startsWith("::ffff:") ? remote.slice(7) : remote;
}

/**
 * Build (but do not start) the gateway. Call {@link HttpGateway.listen} to
 * bind the port; the idle sweeper starts with the process.
 */
export function createHttpGateway(options: HttpGatewayOptions): HttpGateway {
  const { config, logger } = options;
  const factory = options.createMcpServer ?? createMcpServer;
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = Date.now();
  const version = options.version ?? "0.0.0";
  const allowedOrigins = config.allowedOrigins;

  const manager = new SessionManager({
    maxSessions: config.maxSessions,
    maxSessionsPerToken: config.maxSessionsPerToken,
    idleMs: config.sessionIdleMs,
    sweepMs: config.sessionSweepMs,
    createMcpServer: (token) => {
      const server = factory({ ...config.base, token }, { transport: "http" });
      installToolTracking(server);
      return server;
    },
    logger,
    transportOptions: { keepAliveMs: config.sseKeepAliveMs },
  });

  const ipInitLimiter =
    config.initRateLimitPerMinute > 0
      ? new KeyedTokenBucket({
          capacity: config.initRateLimitPerMinute,
          refillPerMinute: config.initRateLimitPerMinute,
        })
      : null;
  const tokenInitLimiter =
    config.tokenInitRateLimitPerMinute > 0
      ? new KeyedTokenBucket({
          capacity: config.tokenInitRateLimitPerMinute,
          refillPerMinute: config.tokenInitRateLimitPerMinute,
        })
      : null;
  const negativeTokens = new NegativeTokenCache({
    ttlMs: config.negativeCacheTtlMs,
    maxEntries: config.negativeCacheMaxEntries,
  });
  const authValidation = new SingleFlight<TokenValidation>({
    maxKeys: config.authValidationMaxInFlight,
  });
  const bodyReads = new TenantConcurrencyGate(
    config.maxConcurrentBodyReadsPerToken,
    config.maxConcurrentBodyReads,
  );
  const initBodyReads = new TenantConcurrencyGate(
    config.maxConcurrentInitBodyReadsPerIp,
    config.maxConcurrentInitBodyReads,
  );

  let closing = false;
  let closePromise: Promise<void> | null = null;
  let readinessCache: { at: number; ok: boolean } | null = null;
  let readinessInFlight: Promise<boolean> | null = null;

  function originAllowed(origin: string | undefined): boolean {
    if (origin === undefined || origin === "") return true;
    return allowedOrigins.has("*") || allowedOrigins.has(origin);
  }

  /** CORS headers only for an explicitly allowed browser origin. */
  function corsHeaders(origin: string | undefined): Record<string, string> {
    if (origin === undefined || origin === "" || !originAllowed(origin)) {
      return {};
    }
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Expose-Headers":
        "Mcp-Session-Id, WWW-Authenticate, Retry-After",
      Vary: "Origin",
    };
  }

  async function runReadinessProbe(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      config.readinessTimeoutMs,
    );
    timer.unref?.();
    let ok = false;
    try {
      const response = await fetchImpl(config.readinessUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: controller.signal,
      });
      ok = response.ok;
      await response.body?.cancel().catch(() => undefined);
    } catch {
      ok = false;
    } finally {
      clearTimeout(timer);
      readinessCache = { at: Date.now(), ok };
    }
    return ok;
  }

  /** One upstream probe at a time, shared by concurrent `/ready` callers. */
  async function probeReadiness(force = false): Promise<boolean> {
    if (closing) return false;
    const now = Date.now();
    if (
      !force &&
      readinessCache !== null &&
      now - readinessCache.at < config.readinessCacheMs
    ) {
      return readinessCache.ok;
    }
    if (readinessInFlight !== null) return readinessInFlight;
    const probe = runReadinessProbe();
    readinessInFlight = probe;
    try {
      return await probe;
    } finally {
      if (readinessInFlight === probe) readinessInFlight = null;
    }
  }

  /**
   * Reserve a body slot. The caller holds it through `handleRequest` and all
   * tool promises, because the parsed body stays referenced for the whole
   * call. A client close/abort does not release the slot while a detached
   * handler is still running; the caller's `finally` is idempotent.
   */
  function acquireBodySlot(gate: TenantConcurrencyGate, key: string): BodySlot {
    const decision = gate.tryAcquire(key);
    if (!decision.ok) {
      logger.warn("body_read_busy", { scope: decision.scope });
      throw new GatewayHttpError(
        503,
        "body_busy",
        decision.scope === "key"
          ? "This client has too many request bodies in flight."
          : "The gateway has too many request bodies in flight.",
        { "Retry-After": "1" },
      );
    }
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        gate.release(key);
      },
    };
  }

  /**
   * Read a body under an explicit deadline. The parsed body is retained by
   * the caller until `handleRequest` returns; the deadline is independent of
   * Node's request checker and resets a stalled connection.
   */
  async function readBodyWithDeadline(
    req: IncomingMessage,
    limit: number,
    scope: "initialize" | "session",
  ): Promise<unknown> {
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    if (config.bodyReadTimeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        logger.warn("body_read_timeout", { scope });
        req.destroy(new Error("body_read_timeout"));
      }, config.bodyReadTimeoutMs);
      timer.unref?.();
    }
    try {
      return await readJsonBody(req, limit);
    } catch (error) {
      if (timedOut) throw new BodyReadTimeoutError();
      // A size/JSON error is the gateway's answer, even if the request stream
      // is marked destroyed after the failed read.
      if (error instanceof GatewayHttpError) throw error;
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (
        req.aborted ||
        req.destroyed ||
        code === "ECONNRESET" ||
        code === "ECONNABORTED" ||
        code === "ERR_STREAM_PREMATURE_CLOSE" ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new ClientBodyAbortError();
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Prove that a personal key exists before a session is registered. This is
   * a cheap read (`/api/v1/auth/me`) and prevents fabricated keys from
   * consuming the global session pool. The token itself is never logged.
   */
  async function validateTokenOnce(token: string): Promise<TokenValidation> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      config.authValidateTimeoutMs,
    );
    timer.unref?.();
    try {
      const response = await fetchImpl(config.authValidateUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      await response.body?.cancel().catch(() => undefined);
      if (response.ok) return { ok: true };
      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: "invalid" };
      }
      if (response.status === 429) {
        return {
          ok: false,
          reason: "rate_limited",
          retryAfter,
          retryable: true,
        };
      }
      if (response.status === 503) {
        return {
          ok: false,
          reason: "unavailable",
          retryAfter,
          retryable: true,
        };
      }
      return { ok: false, reason: "unavailable" };
    } catch {
      return { ok: false, reason: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** One or two bounded retries, honouring a small API `Retry-After`. */
  async function validateTokenWithRetry(
    token: string,
  ): Promise<TokenValidation> {
    let result = await validateTokenOnce(token);
    for (
      let attempt = 1;
      attempt < config.authValidationAttempts;
      attempt += 1
    ) {
      if (result.ok || result.retryable !== true) return result;
      const delayMs = Math.max(0, (result.retryAfter ?? 0) * 1_000);
      if (delayMs > config.authValidationMaxDelayMs) return result;
      if (delayMs > 0) await sleep(delayMs);
      result = await validateTokenOnce(token);
    }
    return result;
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const requestId = randomUUID();
    const started = Date.now();
    const method = req.method ?? "GET";
    const path = pathnameOf(req.url);
    let logSessionId: string | null = null;
    let logLevel: "debug" | "info" | "warn" = "info";

    try {
      if (path === null) {
        throw new GatewayHttpError(400, "bad_request", "Invalid request URL.");
      }
      if (path === "/health") {
        logLevel = "debug";
        if (method !== "GET") {
          sendJson(
            res,
            405,
            { error: "method_not_allowed", message: "Use GET /health." },
            { Allow: "GET" },
          );
          return;
        }
        sendJson(
          res,
          closing ? 503 : 200,
          {
            status: closing ? "shutting_down" : "ok",
            uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
            version,
            ...manager.stats(),
            bodyReads: {
              session: {
                active: bodyReads.inUse,
                globalMax: config.maxConcurrentBodyReads,
                perTokenMax: config.maxConcurrentBodyReadsPerToken,
              },
              initialize: {
                active: initBodyReads.inUse,
                globalMax: config.maxConcurrentInitBodyReads,
                perIpMax: config.maxConcurrentInitBodyReadsPerIp,
              },
              timeoutMs: config.bodyReadTimeoutMs,
            },
          },
          closing ? { "Retry-After": RETRY_AFTER_SHUTDOWN } : {},
        );
        return;
      }
      if (path === "/ready") {
        logLevel = "debug";
        if (method !== "GET") {
          sendJson(
            res,
            405,
            { error: "method_not_allowed", message: "Use GET /ready." },
            { Allow: "GET" },
          );
          return;
        }
        const upstreamReady = await probeReadiness();
        const ready = upstreamReady && !closing;
        sendJson(
          res,
          ready ? 200 : 503,
          {
            status: ready ? "ready" : "not_ready",
            upstream: upstreamReady ? "ready" : "unavailable",
            ...manager.stats(),
          },
          ready ? {} : { "Retry-After": RETRY_AFTER_READY },
        );
        return;
      }
      if (path !== config.path) {
        throw new GatewayHttpError(404, "not_found", "Not found.");
      }
      const origin = headerString(req.headers.origin);
      if (!originAllowed(origin)) {
        logLevel = "warn";
        logger.warn("origin_rejected", { requestId, origin: "present" });
        throw new GatewayHttpError(
          403,
          "origin_not_allowed",
          "This Origin is not allowed by the gateway.",
        );
      }
      const cors = corsHeaders(origin);
      for (const [name, value] of Object.entries(cors)) {
        res.setHeader(name, value);
      }
      if (closing) {
        throw new GatewayHttpError(
          503,
          "shutting_down",
          "The gateway is shutting down.",
          { "Retry-After": RETRY_AFTER_SHUTDOWN },
        );
      }
      if (method === "OPTIONS") {
        if (origin === undefined || origin === "") {
          throw new GatewayHttpError(
            405,
            "method_not_allowed",
            "CORS preflight requires an Origin header.",
          );
        }
        sendNoContent(res, {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, DELETE",
          "Access-Control-Allow-Headers":
            "Authorization, Content-Type, Mcp-Session-Id, " +
            "Mcp-Protocol-Version, Last-Event-ID",
          "Access-Control-Max-Age": "600",
        });
        return;
      }
      if (!MCP_METHODS.has(method)) {
        sendJson(
          res,
          405,
          {
            error: "method_not_allowed",
            message: "Use POST, GET or DELETE on the MCP endpoint.",
          },
          { Allow: "GET, POST, DELETE" },
        );
        return;
      }

      const token = bearerToken(req.headers.authorization);
      if (token === null) {
        logLevel = "warn";
        logger.warn("auth_failed", {
          requestId,
          reason:
            req.headers.authorization === undefined ? "missing" : "malformed",
        });
        unauthorized(res);
        return;
      }

      const requestedSessionId = headerString(req.headers[SESSION_HEADER]);
      if (requestedSessionId !== undefined && requestedSessionId.length > 128) {
        throw new GatewayHttpError(
          400,
          "bad_session_id",
          "Invalid session id.",
        );
      }

      let session: GatewaySession;
      if (requestedSessionId === undefined || requestedSessionId === "") {
        if (method !== "POST") {
          throw new GatewayHttpError(
            400,
            "session_required",
            "An Mcp-Session-Id header is required after initialize.",
          );
        }
        // Local admission comes before the API and before reading the body:
        // global/per-key capacity, per-IP and per-fingerprint buckets, then
        // the bounded negative cache. Only a genuinely unknown key reaches
        // `/auth/me`.
        const tokenHash = fingerprintToken(token);
        if (!manager.hasCapacity()) {
          logLevel = "warn";
          logger.warn("session_limit_reached", { requestId, scope: "global" });
          sessionLimitResponse(res, "session_limit");
          return;
        }
        if (
          config.maxSessionsPerToken > 0 &&
          manager.countForToken(tokenHash) >= config.maxSessionsPerToken
        ) {
          logLevel = "warn";
          logger.warn("session_limit_reached", {
            requestId,
            scope: "token",
          });
          sessionLimitResponse(res, "token_limit");
          return;
        }
        // Take the per-IP body slot before charging initialize budgets, so a
        // `body_busy` retry cannot spend the caller's init allowance.
        const ipAddress = clientAddress(req, config.trustProxyHops);
        const bodySlot = acquireBodySlot(initBodyReads, `ip:${ipAddress}`);
        try {
          const ipDecision = ipInitLimiter?.take(ipAddress);
          if (ipDecision !== undefined && !ipDecision.ok) {
            bodySlot.release();
            logLevel = "warn";
            logger.warn("initialize_rate_limited", { requestId, scope: "ip" });
            initializeRateLimited(res, ipDecision.retryAfterSeconds);
            return;
          }
          const tokenDecision = tokenInitLimiter?.take(tokenHash);
          if (tokenDecision !== undefined && !tokenDecision.ok) {
            bodySlot.release();
            logLevel = "warn";
            logger.warn("initialize_rate_limited", {
              requestId,
              scope: "token",
            });
            initializeRateLimited(res, tokenDecision.retryAfterSeconds);
            return;
          }
          if (negativeTokens.has(tokenHash)) {
            bodySlot.release();
            logLevel = "warn";
            logger.warn("auth_validation_cached", { requestId });
            unauthorized(res);
            return;
          }

          // The body reader checks a declared Content-Length before reading and
          // applies the same strict cap while streaming chunked requests.
          const body = await readBodyWithDeadline(
            req,
            config.sessionlessMaxBodyBytes,
            "initialize",
          );
          if (Array.isArray(body)) {
            throw new GatewayHttpError(
              400,
              "batch_not_supported",
              "JSON-RPC batches are not supported; send one message per POST.",
            );
          }
          if (!containsInitialize(body)) {
            throw new GatewayHttpError(
              400,
              "initialization_required",
              "Create a session with an initialize request first.",
            );
          }

          let validation: TokenValidation;
          try {
            validation = await authValidation.run(tokenHash, async () => {
              const result = await validateTokenWithRetry(token);
              if (!result.ok && result.reason === "invalid") {
                negativeTokens.set(tokenHash);
              }
              return result;
            });
          } catch (error) {
            if (!(error instanceof SingleFlightCapacityError)) throw error;
            logLevel = "warn";
            logger.warn("auth_validation_busy", { requestId });
            throw new GatewayHttpError(
              503,
              "auth_busy",
              "Too many key validations are in flight; retry shortly.",
              { "Retry-After": "1" },
            );
          }
          if (!validation.ok) {
            logLevel = "warn";
            logger.warn("auth_validation_failed", {
              requestId,
              reason: validation.reason,
            });
            if (validation.reason === "invalid") {
              unauthorized(res);
              return;
            }
            const retryAfter = String(
              Math.max(
                1,
                Math.ceil(validation.retryAfter ?? Number(RETRY_AFTER_AUTH)),
              ),
            );
            if (validation.reason === "rate_limited") {
              sendJson(
                res,
                429,
                {
                  error: "rate_limited",
                  message:
                    "The API rate-limited key validation; retry shortly.",
                },
                { "Retry-After": retryAfter },
              );
              return;
            }
            throw new GatewayHttpError(
              503,
              "auth_unavailable",
              "The API could not validate this key; retry shortly.",
              { "Retry-After": retryAfter },
            );
          }
          const opened = await manager.open(token);
          if (!opened.ok) {
            logLevel = "warn";
            if (opened.reason === "closed") {
              throw new GatewayHttpError(
                503,
                "shutting_down",
                "The gateway is shutting down.",
                { "Retry-After": RETRY_AFTER_SHUTDOWN },
              );
            }
            sessionLimitResponse(res, opened.reason);
            return;
          }
          session = opened.session;
          if (session.closed) {
            await manager.close(session, "closed_after_open");
            throw new GatewayHttpError(
              503,
              "shutting_down",
              "The gateway is shutting down.",
              { "Retry-After": RETRY_AFTER_SHUTDOWN },
            );
          }
          logSessionId = session.id;
          manager.begin(session);
          try {
            await session.transport.handleRequest(req, res, body);
          } finally {
            manager.end(session);
            logSessionId = session.id;
            if (session.id === null) {
              await manager.close(session, "initialize_failed");
            }
          }
          return;
        } finally {
          bodySlot.release();
        }
      }

      const found = manager.get(requestedSessionId);
      if (found === undefined) {
        throw new GatewayHttpError(
          404,
          "session_not_found",
          "This MCP session does not exist or has expired.",
        );
      }
      session = found;
      logSessionId = session.id;
      if (!sessionMatchesToken(session, token)) {
        logLevel = "warn";
        logger.warn("session_token_mismatch", {
          requestId,
          sessionId: session.id ?? undefined,
        });
        throw new GatewayHttpError(
          403,
          "token_mismatch",
          "This MCP session belongs to a different API key.",
        );
      }

      const bodySlot =
        method === "POST"
          ? acquireBodySlot(bodyReads, `token:${session.tokenHash}`)
          : undefined;
      manager.begin(session);
      try {
        const body =
          method === "POST"
            ? await readBodyWithDeadline(req, config.maxBodyBytes, "session")
            : undefined;
        if (Array.isArray(body)) {
          throw new GatewayHttpError(
            400,
            "batch_not_supported",
            "JSON-RPC batches are not supported; send one message per POST.",
          );
        }
        if (method === "POST") {
          const tracker = new ToolTracker();
          await toolRequestContext.run(tracker, async () => {
            try {
              await session.transport.handleRequest(req, res, body);
            } finally {
              // A disconnected client can resolve handleRequest while tool
              // handlers still retain their arguments. Keep the body slot and
              // session activity until those promises settle.
              await tracker.waitForIdle();
            }
          });
        } else {
          await session.transport.handleRequest(req, res, body);
        }
      } finally {
        manager.end(session);
        bodySlot?.release();
      }
      if (
        method === "DELETE" &&
        res.statusCode >= 200 &&
        res.statusCode < 300 &&
        !session.closed
      ) {
        await manager.close(session, "client_delete");
      }
    } catch (error) {
      if (
        error instanceof ClientBodyAbortError ||
        error instanceof BodyReadTimeoutError
      ) {
        logLevel = "debug";
        if (error instanceof ClientBodyAbortError) {
          logger.debug("body_read_aborted", { requestId });
        }
        if (!res.headersSent) res.destroy();
        return;
      }
      const status = error instanceof GatewayHttpError ? error.status : 500;
      if (!(error instanceof GatewayHttpError)) {
        logger.error("request_failed", {
          requestId,
          method,
          path: path ?? undefined,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof GatewayHttpError) {
        sendJson(
          res,
          error.status,
          {
            error: error.code,
            message: error.message,
          },
          {
            ...error.headers,
            ...(status === 413 ? { Connection: "close" } : {}),
          },
        );
      } else {
        sendJson(res, 500, {
          error: "internal_error",
          message: "The gateway could not handle this request.",
        });
      }
    } finally {
      if (!res.headersSent && !res.writableEnded) {
        res.end();
      }
      logger[logLevel]("http_request", {
        requestId,
        method,
        path: path ?? undefined,
        status: res.statusCode,
        durationMs: Date.now() - started,
        sessionId: logSessionId ?? undefined,
        clientIp: clientAddress(req, config.trustProxyHops),
      });
    }
  }

  const server = createHttpServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      logger.error("request_handler_crashed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: "internal_error",
          message: "The gateway could not handle this request.",
        });
      } else {
        res.destroy();
      }
    });
  });
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;
  server.keepAliveTimeout = Math.max(config.headersTimeoutMs, 65_000);
  server.on("error", (error) => {
    logger.error("server_error", { error: error.message });
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    }
  });

  async function listen(): Promise<GatewayAddress> {
    if (closing) {
      throw new Error("Cannot listen after the gateway started closing.");
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(config.port, config.host);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("The gateway did not bind a TCP address.");
    }
    logger.info("gateway_listening", {
      host: address.address,
      port: address.port,
      path: config.path,
      maxSessions: config.maxSessions,
      sessionIdleMs: config.sessionIdleMs,
    });
    return { host: address.address, port: address.port };
  }

  function close(reason = "shutdown"): Promise<void> {
    if (closePromise !== null) return closePromise;
    closing = true;
    logger.info("gateway_stopping", { reason });
    closePromise = (async () => {
      // Keep the listening socket briefly so requests arriving during the
      // drain get a clean 503 + Retry-After instead of a connection reset.
      await manager.closeIdle("shutdown_idle");
      const deadline = Date.now() + config.shutdownGraceMs;
      while (manager.activeRequestCount() > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (manager.activeRequestCount() > 0) {
        logger.warn("shutdown_drain_timeout", {
          activeRequests: manager.activeRequestCount(),
        });
      }
      const stopped = new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
      await manager.closeAll(reason);
      const force = setTimeout(() => {
        logger.warn("gateway_force_close");
        server.closeAllConnections();
      }, 1_000);
      force.unref?.();
      await stopped;
      clearTimeout(force);
      logger.info("gateway_stopped");
    })();
    return closePromise;
  }

  function address(): GatewayAddress | null {
    const value = server.address();
    if (value === null || typeof value === "string") return null;
    const info = value as AddressInfo;
    return { host: info.address, port: info.port };
  }

  return {
    server,
    manager,
    config,
    get closing() {
      return closing;
    },
    listen,
    close,
    address,
  };
}
