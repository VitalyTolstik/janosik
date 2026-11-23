import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_TOOLSETS } from "./config.js";
import type { GatewayConfig } from "./http-config.js";
import { createBufferLogger } from "./http-log.js";
import { createHttpGateway, type HttpGateway } from "./http-server.js";

const ALPHA = "jnk_alpha_secret";
const BETA = "jnk_beta_secret";
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vitest", version: "0.0.0" },
  },
};

interface UpstreamCall {
  method: string;
  path: string;
  authorization: string | undefined;
}

interface Upstream {
  url: string;
  calls: UpstreamCall[];
  ready: boolean;
  close(): Promise<void>;
}

interface RunningGateway {
  gateway: HttpGateway;
  url: string;
  logs: string[];
}

const cleanup: Array<() => Promise<void>> = [];

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function startUpstream(): Promise<Upstream> {
  const state: Upstream = {
    url: "",
    calls: [],
    ready: true,
    close: async () => closeServer(server),
  };
  const server = createHttpServer((req: IncomingMessage, res) => {
    const path = new URL(req.url ?? "/", "http://upstream.invalid").pathname;
    const authorization = req.headers.authorization;
    state.calls.push({ method: req.method ?? "GET", path, authorization });
    if (path === "/api/v1/health/ready") {
      json(res, state.ready ? 200 : 503, {
        status: state.ready ? "ready" : "not_ready",
      });
      return;
    }
    if (path === "/api/v1/boards" && req.method === "GET") {
      const title =
        authorization === `Bearer ${ALPHA}`
          ? "Alpha board"
          : authorization === `Bearer ${BETA}`
            ? "Beta board"
            : "Unknown board";
      json(res, 200, [
        {
          id: title === "Alpha board" ? "b-alpha" : "b-beta",
          title,
          counters: { cards: 1, columns: 1 },
          role: "MEMBER",
        },
      ]);
      return;
    }
    json(res, 404, { message: "not found" });
  });
  const port = await listen(server);
  state.url = `http://127.0.0.1:${port}`;
  return state;
}

function gatewayConfig(
  upstream: Upstream,
  overrides: Partial<GatewayConfig> = {},
): GatewayConfig {
  return {
    base: {
      url: upstream.url,
      token: "",
      appBase: "",
      allowFs: false,
      fsRoot: null,
      toolsets: new Set(DEFAULT_TOOLSETS),
      readOnly: false,
    },
    host: "127.0.0.1",
    port: 0,
    path: "/mcp",
    maxSessions: 20,
    maxSessionsPerToken: 0,
    sessionIdleMs: 60_000,
    sessionSweepMs: 0,
    maxBodyBytes: 64 * 1024,
    allowedOrigins: new Set(),
    readinessUrl: `${upstream.url}/api/v1/health/ready`,
    readinessCacheMs: 0,
    readinessTimeoutMs: 1_000,
    trustProxy: false,
    logLevel: "debug",
    shutdownGraceMs: 1_000,
    requestTimeoutMs: 10_000,
    headersTimeoutMs: 5_000,
    ...overrides,
  };
}

async function startGateway(
  upstream: Upstream,
  overrides: Partial<GatewayConfig> = {},
): Promise<RunningGateway> {
  const { logger, lines } = createBufferLogger({ level: "debug" });
  const gateway = createHttpGateway({
    config: gatewayConfig(upstream, overrides),
    logger,
    version: "test",
  });
  const address = await gateway.listen();
  const running = {
    gateway,
    url: `http://127.0.0.1:${address.port}`,
    logs: lines,
  };
  cleanup.push(() => gateway.close("test_cleanup"));
  return running;
}

interface RpcResult {
  status: number;
  headers: Headers;
  text: string;
  json: Record<string, unknown> | null;
}

async function rpc(
  running: RunningGateway,
  token: string | null,
  body: unknown,
  sessionId?: string,
  extraHeaders: Record<string, string> = {},
): Promise<RpcResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extraHeaders,
  };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (sessionId !== undefined) {
    headers["mcp-session-id"] = sessionId;
    headers["mcp-protocol-version"] = "2025-06-18";
  }
  const response = await fetch(`${running.url}/mcp`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown> | null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return {
    status: response.status,
    headers: response.headers,
    text,
    json,
  };
}

async function initialize(
  running: RunningGateway,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const response = await rpc(
    running,
    token,
    INITIALIZE,
    undefined,
    extraHeaders,
  );
  if (response.status !== 200) {
    throw new Error(`initialize failed: ${response.status} ${response.text}`);
  }
  const sessionId = response.headers.get("mcp-session-id");
  if (sessionId === null) throw new Error("initialize returned no session id");
  const initialized = await rpc(
    running,
    token,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sessionId,
    extraHeaders,
  );
  if (initialized.status !== 202) {
    throw new Error(`initialized notification: ${initialized.status}`);
  }
  return sessionId;
}

async function deleteSession(
  running: RunningGateway,
  token: string,
  sessionId: string,
): Promise<number> {
  const response = await fetch(`${running.url}/mcp`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      "mcp-session-id": sessionId,
      "mcp-protocol-version": "2025-06-18",
    },
  });
  await response.body?.cancel();
  return response.status;
}

function toolResult(result: RpcResult): Record<string, unknown> {
  const value = (result.json as { result?: Record<string, unknown> } | null)
    ?.result;
  if (value === undefined) {
    throw new Error(`no tool result: ${result.status} ${result.text}`);
  }
  return value;
}

async function listBoards(
  running: RunningGateway,
  token: string,
  sessionId: string,
): Promise<string[]> {
  const result = await rpc(
    running,
    token,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "janosik_list_boards",
        arguments: { response_format: "json" },
      },
    },
    sessionId,
  );
  const payload = toolResult(result) as {
    structuredContent?: { boards?: Array<{ title?: string }> };
    isError?: boolean;
  };
  if (payload.isError) throw new Error(result.text);
  return (payload.structuredContent?.boards ?? []).map(
    (board) => board.title ?? "",
  );
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before the timeout");
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe("MCP Streamable HTTP gateway", () => {
  it("handshakes, lists tools and reports health/readiness", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream);
    const sessionId = await initialize(running, ALPHA);

    const tools = await rpc(
      running,
      ALPHA,
      { jsonrpc: "2.0", id: 10, method: "tools/list" },
      sessionId,
    );
    const names = (
      toolResult(tools) as { tools?: Array<{ name?: string }> }
    ).tools?.map((tool) => tool.name);
    expect(names).toContain("janosik_list_boards");
    expect(names?.length).toBeGreaterThan(50);
    expect(running.gateway.manager.stats().sessions).toBe(1);

    const health = await fetch(`${running.url}/health`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as Record<string, unknown>;
    expect(healthBody).toMatchObject({ status: "ok", version: "test" });

    const ready = await fetch(`${running.url}/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: "ready",
      upstream: "ready",
    });

    upstream.ready = false;
    const notReady = await fetch(`${running.url}/ready`);
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toMatchObject({
      status: "not_ready",
      upstream: "unavailable",
    });
  });

  it("passes each session's token through and isolates A from B", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream);
    const alphaSession = await initialize(running, ALPHA);
    const betaSession = await initialize(running, BETA);

    expect(await listBoards(running, ALPHA, alphaSession)).toEqual([
      "Alpha board",
    ]);
    expect(await listBoards(running, BETA, betaSession)).toEqual([
      "Beta board",
    ]);
    const boardCalls = () =>
      upstream.calls.filter((call) => call.path === "/api/v1/boards");
    expect(boardCalls().map((call) => call.authorization)).toEqual([
      `Bearer ${ALPHA}`,
      `Bearer ${BETA}`,
    ]);

    // B's key on A's session must not reach the API or leak A's data.
    const stolen = await rpc(
      running,
      BETA,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "janosik_list_boards",
          arguments: { response_format: "json" },
        },
      },
      alphaSession,
    );
    expect(stolen.status).toBe(403);
    expect(stolen.json).toMatchObject({ error: "token_mismatch" });
    expect(boardCalls()).toHaveLength(2);

    // A's key on B's session is refused the same way.
    const reverse = await rpc(
      running,
      ALPHA,
      { jsonrpc: "2.0", id: 4, method: "tools/list" },
      betaSession,
    );
    expect(reverse.status).toBe(403);

    // A mismatch on DELETE must not terminate A's session.
    expect(await deleteSession(running, BETA, alphaSession)).toBe(403);
    expect(await listBoards(running, ALPHA, alphaSession)).toEqual([
      "Alpha board",
    ]);

    const logs = running.logs.join("");
    expect(logs).not.toContain(ALPHA);
    expect(logs).not.toContain(BETA);
    expect(logs).not.toContain("Bearer ");
    expect(logs).toContain("session_token_mismatch");
  });

  it("rejects missing and malformed auth without logging the secret", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream);

    const missing = await rpc(running, null, INITIALIZE);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    expect(missing.json).toMatchObject({ error: "unauthorized" });

    const malformed = await rpc(running, null, INITIALIZE, undefined, {
      authorization: "Basic jnk_never_log_this",
    });
    expect(malformed.status).toBe(401);
    expect(running.gateway.manager.stats().sessions).toBe(0);

    const logs = running.logs.join("");
    expect(logs).not.toContain("jnk_never_log_this");
    expect(logs).toContain("auth_failed");
  });

  it("enforces session limits, deletes explicitly and drains cleanly", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, { maxSessions: 2 });
    const first = await initialize(running, ALPHA);
    const second = await initialize(running, BETA);

    const third = await rpc(running, "jnk_third_secret", INITIALIZE);
    expect(third.status).toBe(503);
    expect(third.json).toMatchObject({ error: "session_limit" });
    expect(third.headers.get("retry-after")).toBe("5");

    expect(await deleteSession(running, ALPHA, first)).toBe(200);
    await waitFor(() => running.gateway.manager.stats().sessions === 1);
    const replacement = await initialize(running, "jnk_third_secret");
    expect(replacement).toBeTruthy();

    expect(await deleteSession(running, BETA, second)).toBe(200);
    await running.gateway.close("test");
    expect(running.gateway.manager.stats().sessions).toBe(0);
    expect(running.gateway.address()).toBeNull();
  });

  it("expires idle sessions and returns 404 for their old id", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      sessionIdleMs: 75,
      sessionSweepMs: 10,
    });
    const sessionId = await initialize(running, ALPHA);
    expect(running.gateway.manager.stats().sessions).toBe(1);
    await waitFor(() => running.gateway.manager.stats().sessions === 0);
    const expired = await rpc(
      running,
      ALPHA,
      { jsonrpc: "2.0", id: 20, method: "tools/list" },
      sessionId,
    );
    expect(expired.status).toBe(404);
    expect(expired.json).toMatchObject({ error: "session_not_found" });
  });

  it("rejects disallowed origins and oversized bodies", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      maxBodyBytes: 1_000,
      allowedOrigins: new Set(["https://allowed.example"]),
    });

    const evil = await rpc(running, ALPHA, INITIALIZE, undefined, {
      origin: "https://evil.example",
    });
    expect(evil.status).toBe(403);
    expect(evil.json).toMatchObject({ error: "origin_not_allowed" });

    const preflight = await fetch(`${running.url}/mcp`, {
      method: "OPTIONS",
      headers: {
        origin: "https://allowed.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, mcp-session-id",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://allowed.example",
    );
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "Authorization",
    );

    const allowed = await rpc(running, ALPHA, INITIALIZE, undefined, {
      origin: "https://allowed.example",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://allowed.example",
    );

    const huge = await rpc(running, ALPHA, {
      ...INITIALIZE,
      padding: "x".repeat(2_000),
    });
    expect(huge.status).toBe(413);
    expect(huge.json).toMatchObject({ error: "payload_too_large" });
  });

  it("keeps 100 and then 500 sessions in one process", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      maxSessions: 600,
      sessionIdleMs: 600_000,
      sessionSweepMs: 0,
    });
    const before = process.memoryUsage();

    async function addSessions(total: number): Promise<void> {
      for (let offset = 0; offset < total; offset += 20) {
        const batch = Math.min(20, total - offset);
        await Promise.all(
          Array.from({ length: batch }, (_, index) =>
            initialize(running, `jnk_load_${offset + index}_secret`),
          ),
        );
      }
    }

    await addSessions(100);
    expect(running.gateway.manager.stats().sessions).toBe(100);
    await addSessions(400);
    expect(running.gateway.manager.stats().sessions).toBe(500);

    const after = process.memoryUsage();
    const heapDeltaMb = (after.heapUsed - before.heapUsed) / (1024 * 1024);
    const rssMb = after.rss / (1024 * 1024);
    // Evidence for the DoD: 500 sessions share one process and a bounded
    // heap, instead of 500 × 100 MB stdio processes.
    console.info(
      `[http-sessions] 500 sessions: heap +${heapDeltaMb.toFixed(1)} MB, ` +
        `RSS ${rssMb.toFixed(1)} MB`,
    );
    expect(heapDeltaMb).toBeLessThan(750);

    await running.gateway.close("test");
    expect(running.gateway.manager.stats()).toMatchObject({
      sessions: 0,
      pending: 0,
    });
  }, 120_000);
});
