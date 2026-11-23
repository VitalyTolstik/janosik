/**
 * Per-session MCP servers and transports.
 *
 * A Streamable HTTP session owns its own `McpServer` and `JanosikClient`; the
 * API key is accepted on the initialize request, hashed for a binding check,
 * and never kept in module state. Every later request must present the same
 * key and the matching `Mcp-Session-Id`, so two agents cannot read each
 * other's board through a shared process.
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { Logger } from "./http-log.js";

/** A session that has passed initialize and is addressable by id. */
export interface GatewaySession {
  id: string | null;
  tokenHash: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  createdAt: number;
  lastSeenAt: number;
  activeRequests: number;
  /** True while `server.connect` is still running. */
  initializing: boolean;
  closed: boolean;
}

export type OpenSessionResult =
  | { ok: true; session: GatewaySession }
  | { ok: false; reason: "closed" | "session_limit" | "token_limit" };

export interface SessionManagerOptions {
  maxSessions: number;
  /** 0 disables the per-token cap. */
  maxSessionsPerToken: number;
  idleMs: number;
  sweepMs: number;
  createMcpServer: (token: string) => McpServer;
  logger: Logger;
  now?: () => number;
  sessionId?: () => string;
  transportOptions?: Omit<
    StreamableHTTPServerTransportOptions,
    "sessionIdGenerator" | "onsessioninitialized"
  >;
}

export interface SessionStats {
  sessions: number;
  pending: number;
  maxSessions: number;
  maxSessionsPerToken: number;
  idleMs: number;
}

/** A stable, non-reversible identifier used only for session binding. */
export function fingerprintToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of the bound fingerprint and a presented token. */
export function sessionMatchesToken(
  session: GatewaySession,
  token: string,
): boolean {
  const presented = Buffer.from(fingerprintToken(token), "hex");
  const bound = Buffer.from(session.tokenHash, "hex");
  return presented.length === bound.length && timingSafeEqual(presented, bound);
}

export class SessionManager {
  private readonly sessions = new Map<string, GatewaySession>();
  private readonly pending = new Set<GatewaySession>();
  private readonly createMcpServer: (token: string) => McpServer;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly sessionId: () => string;
  private readonly transportOptions: SessionManagerOptions["transportOptions"];
  private readonly maxSessions: number;
  private readonly maxSessionsPerToken: number;
  private readonly idleMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: SessionManagerOptions) {
    this.maxSessions = options.maxSessions;
    this.maxSessionsPerToken = options.maxSessionsPerToken;
    this.idleMs = options.idleMs;
    this.createMcpServer = options.createMcpServer;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.sessionId = options.sessionId ?? randomUUID;
    this.transportOptions = options.transportOptions;
    if (options.sweepMs > 0) {
      this.sweepTimer = setInterval(() => {
        void this.sweep();
      }, options.sweepMs);
      this.sweepTimer.unref?.();
    }
  }

  /** Number of initialized and initializing sessions (used by limits). */
  private count(): number {
    return this.sessions.size + this.pending.size;
  }

  private countToken(tokenHash: string): number {
    let total = 0;
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) total += 1;
    }
    for (const session of this.pending) {
      if (session.tokenHash === tokenHash) total += 1;
    }
    return total;
  }

  /**
   * Reserve and connect a session for a token. The session becomes visible
   * under its id only after the initialize request succeeds.
   */
  async open(token: string): Promise<OpenSessionResult> {
    if (this.closed) return { ok: false, reason: "closed" };
    if (this.count() >= this.maxSessions) {
      return { ok: false, reason: "session_limit" };
    }
    const tokenHash = fingerprintToken(token);
    if (
      this.maxSessionsPerToken > 0 &&
      this.countToken(tokenHash) >= this.maxSessionsPerToken
    ) {
      return { ok: false, reason: "token_limit" };
    }

    const id = this.sessionId();
    let session: GatewaySession | null = null;
    const transport = new StreamableHTTPServerTransport({
      ...this.transportOptions,
      sessionIdGenerator: () => id,
      onsessioninitialized: (sessionId) => {
        if (session === null) return;
        if (session.closed) {
          this.pending.delete(session);
          return;
        }
        session.id = sessionId;
        this.sessions.set(sessionId, session);
        this.pending.delete(session);
        this.logger.info("session_opened", {
          sessionId,
          sessions: this.sessions.size,
        });
      },
    });
    const server = this.createMcpServer(token);
    session = {
      id: null,
      tokenHash,
      server,
      transport,
      createdAt: this.now(),
      lastSeenAt: this.now(),
      activeRequests: 0,
      initializing: true,
      closed: false,
    };
    this.pending.add(session);

    transport.onclose = () => {
      if (session !== null) this.detach(session, "transport_closed");
    };
    transport.onerror = (error: Error) => {
      this.logger.warn("session_transport_error", {
        sessionId: session?.id ?? undefined,
        error: error.message,
      });
    };

    try {
      await server.connect(transport);
      session.initializing = false;
      // A shutdown may have closed the pending session while connect awaited.
      if (this.closed || session.closed) {
        await this.close(session, "closed_during_open");
        return { ok: false, reason: "closed" };
      }
    } catch (error) {
      this.pending.delete(session);
      session.closed = true;
      session.initializing = false;
      await transport.close().catch(() => undefined);
      this.logger.error("session_open_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return { ok: true, session };
  }

  /** Look up an initialized session by its exact id. */
  get(id: string): GatewaySession | undefined {
    const session = this.sessions.get(id);
    if (session === undefined || session.closed) return undefined;
    return session;
  }

  /** Mark the start of a request; idle expiry skips active sessions. */
  begin(session: GatewaySession): void {
    session.activeRequests += 1;
    session.lastSeenAt = this.now();
  }

  /** Mark request completion, including a closed or failed one. */
  end(session: GatewaySession): void {
    session.activeRequests = Math.max(0, session.activeRequests - 1);
    session.lastSeenAt = this.now();
  }

  private detach(session: GatewaySession, reason: string): void {
    this.pending.delete(session);
    if (session.id !== null && this.sessions.get(session.id) === session) {
      this.sessions.delete(session.id);
    }
    if (session.closed) return;
    session.closed = true;
    this.logger.info("session_closed", {
      sessionId: session.id ?? undefined,
      reason,
      ageMs: this.now() - session.createdAt,
    });
  }

  /** Close one session and release its server and transport. */
  async close(session: GatewaySession, reason: string): Promise<void> {
    const wasClosed = session.closed;
    this.detach(session, reason);
    if (wasClosed) return;
    try {
      await session.server.close();
    } catch (error) {
      this.logger.debug("session_close_failed", {
        sessionId: session.id ?? undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      await session.transport.close().catch(() => undefined);
    }
  }

  /** Close sessions idle for at least `idleMs`; active requests are kept. */
  async sweep(now = this.now()): Promise<number> {
    if (this.closed) return 0;
    const expired = new Set<GatewaySession>([
      ...this.sessions.values(),
      ...this.pending,
    ]);
    const targets = [...expired].filter(
      (session) =>
        !session.closed &&
        !session.initializing &&
        session.activeRequests === 0 &&
        now - session.lastSeenAt >= this.idleMs,
    );
    await Promise.allSettled(
      targets.map((session) => this.close(session, "idle")),
    );
    return targets.length;
  }

  /** Number of requests currently being served across all sessions. */
  activeRequestCount(): number {
    let total = 0;
    for (const session of this.sessions.values()) {
      total += session.activeRequests;
    }
    for (const session of this.pending) total += session.activeRequests;
    return total;
  }

  /** Close sessions with no request in flight, leaving active work alone. */
  async closeIdle(reason = "shutdown"): Promise<void> {
    const targets = [
      ...new Set<GatewaySession>([...this.sessions.values(), ...this.pending]),
    ].filter(
      (session) =>
        !session.closed &&
        !session.initializing &&
        session.activeRequests === 0,
    );
    await Promise.allSettled(
      targets.map((session) => this.close(session, reason)),
    );
  }

  /** Stop the sweeper and close every session (graceful shutdown). */
  async closeAll(reason = "shutdown"): Promise<void> {
    this.closed = true;
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    const all = new Set<GatewaySession>([
      ...this.sessions.values(),
      ...this.pending,
    ]);
    await Promise.allSettled(
      [...all].map((session) => this.close(session, reason)),
    );
  }

  stats(): SessionStats {
    return {
      sessions: this.sessions.size,
      pending: this.pending.size,
      maxSessions: this.maxSessions,
      maxSessionsPerToken: this.maxSessionsPerToken,
      idleMs: this.idleMs,
    };
  }
}
