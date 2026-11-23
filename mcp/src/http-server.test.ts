import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import v8 from "node:v8";
import vm from "node:vm";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_TOOLSETS } from "./config.js";
import type { GatewayConfig } from "./http-config.js";
import { createBufferLogger } from "./http-log.js";
import {
  createHttpGateway,
  type HttpGateway,
  type HttpGatewayOptions,
} from "./http-server.js";

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
  readyCalls: number;
  readyDelayMs: number;
  authCalls: number;
  throttledOnce: Set<string>;
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
    readyCalls: 0,
    readyDelayMs: 0,
    authCalls: 0,
    throttledOnce: new Set<string>(),
    close: async () => closeServer(server),
  };
  const server = createHttpServer((req: IncomingMessage, res) => {
    const path = new URL(req.url ?? "/", "http://upstream.invalid").pathname;
    const authorization = req.headers.authorization;
    state.calls.push({ method: req.method ?? "GET", path, authorization });
    if (path === "/api/v1/health/ready") {
      state.readyCalls += 1;
      const respond = () =>
        json(res, state.ready ? 200 : 503, {
          status: state.ready ? "ready" : "not_ready",
        });
      if (state.readyDelayMs > 0) {
        setTimeout(respond, state.readyDelayMs);
      } else {
        respond();
      }
      return;
    }
    if (path === "/api/v1/auth/me" && req.method === "GET") {
      state.authCalls += 1;
      const valid = () =>
        json(res, 200, { user: { id: "u1" }, token: { id: "t1" } });
      if (authorization === "Bearer jnk_limited_secret") {
        res.setHeader("Retry-After", "7");
        json(res, 429, { code: "rate_limited" });
        return;
      }
      if (authorization === "Bearer jnk_auth_down_secret") {
        json(res, 503, { code: "unavailable" });
        return;
      }
      if (authorization === "Bearer jnk_retry_secret") {
        if (!state.throttledOnce.has(authorization)) {
          state.throttledOnce.add(authorization);
          res.setHeader("Retry-After", "0");
          json(res, 429, { code: "rate_limited" });
        } else {
          valid();
        }
        return;
      }
      if (
        authorization === "Bearer jnk_slow_auth_secret" ||
        authorization === "Bearer jnk_slow_auth_two_secret"
      ) {
        setTimeout(valid, 100);
        return;
      }
      const known =
        authorization === `Bearer ${ALPHA}` ||
        authorization === `Bearer ${BETA}` ||
        authorization === "Bearer jnk_third_secret" ||
        /^Bearer jnk_load_\d+_secret$/.test(authorization ?? "");
      if (known) {
        valid();
      } else {
        json(res, 401, {
          message: "invalid token",
          code: "unauthorized",
        });
      }
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
    maxSessionsPerToken: 50,
    initRateLimitPerMinute: 600,
    tokenInitRateLimitPerMinute: 10,
    negativeCacheTtlMs: 60_000,
    negativeCacheMaxEntries: 1_000,
    authValidationAttempts: 2,
    authValidationMaxDelayMs: 1_000,
    authValidationMaxInFlight: 64,
    sessionIdleMs: 60_000,
    sessionSweepMs: 0,
    maxBodyBytes: 64 * 1024,
    sessionlessMaxBodyBytes: 4 * 1024,
    allowedOrigins: new Set(),
    readinessUrl: `${upstream.url}/api/v1/health/ready`,
    readinessCacheMs: 0,
    readinessTimeoutMs: 1_000,
    authValidateUrl: `${upstream.url}/api/v1/auth/me`,
    authValidateTimeoutMs: 1_000,
    sseKeepAliveMs: 60_000,
    trustProxyHops: 0,
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
  extra: Pick<HttpGatewayOptions, "createMcpServer"> = {},
): Promise<RunningGateway> {
  const { logger, lines } = createBufferLogger({ level: "debug" });
  const gateway = createHttpGateway({
    config: gatewayConfig(upstream, overrides),
    logger,
    version: "test",
    ...extra,
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
  events: Record<string, unknown>[];
}

/** Parse complete `event: message` blocks from a POST SSE response. */
function parseSse(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data === "") continue;
    try {
      events.push(JSON.parse(data) as Record<string, unknown>);
    } catch {
      // A keep-alive or a partial frame is not a JSON-RPC message.
    }
  }
  return events;
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
  const contentType = response.headers.get("content-type") ?? "";
  let json: Record<string, unknown> | null = null;
  let events: Record<string, unknown>[] = [];
  if (contentType.includes("text/event-stream")) {
    events = parseSse(text);
    if (events.length === 1) json = events[0]!;
  } else {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
      events = json === null ? [] : [json];
    } catch {
      json = null;
    }
  }
  return {
    status: response.status,
    headers: response.headers,
    text,
    json,
    events,
  };
}

async function initializeRaw(
  running: RunningGateway,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ sessionId: string; response: RpcResult }> {
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
  return { sessionId, response };
}

async function initialize(
  running: RunningGateway,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  return (await initializeRaw(running, token, extraHeaders)).sessionId;
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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Best-effort GC for the stream-memory smoke; map assertions are primary. */
function forceGc(): void {
  try {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as (() => void) | undefined;
    gc?.();
    v8.setFlagsFromString("--no-expose-gc");
  } catch {
    // Vitest or the Node build may not expose GC; the loose bound still holds.
  }
}

interface TransportMapSizes {
  streams: number;
  requests: number;
  responses: number;
}

/** SDK internals used only to prove a completed POST stream is released. */
function streamMaps(
  running: RunningGateway,
  sessionId: string,
): TransportMapSizes {
  const session = running.gateway.manager.get(sessionId);
  if (session === undefined) {
    return { streams: -1, requests: -1, responses: -1 };
  }
  const transport = session.transport as unknown as {
    _webStandardTransport?: {
      _streamMapping?: Map<string, unknown>;
      _requestToStreamMapping?: Map<unknown, unknown>;
      _requestResponseMap?: Map<unknown, unknown>;
    };
  };
  const web = transport._webStandardTransport;
  return {
    streams: web?._streamMapping?.size ?? -1,
    requests: web?._requestToStreamMapping?.size ?? -1,
    responses: web?._requestResponseMap?.size ?? -1,
  };
}

function expectStreamMapsEmpty(running: RunningGateway, sessionId: string) {
  expect(streamMaps(running, sessionId)).toEqual({
    streams: 0,
    requests: 0,
    responses: 0,
  });
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
  timeoutMs: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (!buffer.includes(needle)) {
    if (Date.now() > deadline) {
      throw new Error(`SSE did not contain ${JSON.stringify(needle)}`);
    }
    const next = await Promise.race([
      reader.read(),
      sleep(Math.max(1, deadline - Date.now())).then(() => null),
    ]);
    if (next === null) continue;
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
  }
  return buffer;
}

async function waitForStreamEnd(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        sleep(Math.max(1, deadline - Date.now())).then(() => null),
      ]);
      if (next === null) continue;
      if (next.done) return true;
    }
  } catch {
    return true;
  }
  return false;
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe("MCP Streamable HTTP gateway", () => {
  it("handshakes, lists tools and reports health/readiness", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream);
    const { sessionId, response: init } = await initializeRaw(running, ALPHA);
    expect(init.headers.get("content-type")).toContain("text/event-stream");
    expect(init.events).toHaveLength(1);
    const instructions =
      (init.json as { result?: { instructions?: string } } | null)?.result
        ?.instructions ?? "";
    expect(instructions).toContain("Authorization: Bearer");
    expect(instructions).not.toContain("JANOSIK_TOKEN");

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
    expect(notReady.headers.get("retry-after")).toBe("5");
    expect(await notReady.json()).toMatchObject({
      status: "not_ready",
      upstream: "unavailable",
    });
  });

  it("works with the official Streamable HTTP client", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream);
    const transport = new StreamableHTTPClientTransport(
      new URL(`${running.url}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${ALPHA}` },
        },
      },
    );
    const client = new Client({
      name: "streamable-http-test",
      version: "0.0.0",
    });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("janosik_list_boards");
      const result = await client.callTool({
        name: "janosik_list_boards",
        arguments: { response_format: "json" },
      });
      const payload = result.structuredContent as {
        boards?: Array<{ title?: string }>;
      };
      expect(payload.boards?.map((board) => board.title)).toEqual([
        "Alpha board",
      ]);
    } finally {
      await client.close();
    }
  });

  it("streams large results without retaining completed POST streams", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const createBigServer = () => {
      const server = new McpServer({ name: "big-result", version: "0.0.0" });
      server.registerTool(
        "big_result",
        {
          title: "Big result",
          description: "Returns a one-megabyte text block for the stream test.",
          inputSchema: {},
        },
        async () => ({
          content: [{ type: "text", text: "x".repeat(1024 * 1024) }],
        }),
      );
      return server;
    };
    const running = await startGateway(
      upstream,
      {},
      { createMcpServer: createBigServer },
    );
    const sessionId = await initialize(running, ALPHA);
    const callBig = async (id: number) => {
      const result = await rpc(
        running,
        ALPHA,
        {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "big_result", arguments: {} },
        },
        sessionId,
      );
      const payload = toolResult(result) as {
        content?: Array<{ text?: string }>;
      };
      expect(payload.content?.[0]?.text?.length).toBe(1024 * 1024);
      expectStreamMapsEmpty(running, sessionId);
    };

    await callBig(100);
    forceGc();
    const before = process.memoryUsage().heapUsed;
    for (let index = 1; index <= 20; index += 1) await callBig(100 + index);
    forceGc();
    const after = process.memoryUsage().heapUsed;
    const deltaMb = (after - before) / (1024 * 1024);
    console.info(
      `[stream-smoke] 20 MiB of SSE results: heap +${deltaMb.toFixed(1)} MB`,
    );
    expectStreamMapsEmpty(running, sessionId);
    // The empty maps are the deterministic leak check; with best-effort GC
    // the retained heap should stay well below the 20 MiB result volume.
    expect(deltaMb).toBeLessThan(32);
  });

  it("keeps GET SSE alive, stops an idle sweep and closes on DELETE", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      sessionIdleMs: 75,
      sessionSweepMs: 10,
      sseKeepAliveMs: 30,
    });
    const sessionId = await initialize(running, ALPHA);
    const headers = {
      authorization: `Bearer ${ALPHA}`,
      "mcp-session-id": sessionId,
      "mcp-protocol-version": "2025-06-18",
      accept: "text/event-stream",
    };
    const response = await fetch(`${running.url}/mcp`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    await readUntil(reader, ": keepalive", 2_000);

    // An open stream is an active request and must outlive the idle window.
    await sleep(200);
    expect(running.gateway.manager.stats().sessions).toBe(1);
    expect(running.gateway.manager.activeRequestCount()).toBe(1);

    expect(await deleteSession(running, ALPHA, sessionId)).toBe(200);
    expect(await waitForStreamEnd(reader, 2_000)).toBe(true);
    await waitFor(() => running.gateway.manager.stats().sessions === 0);

    // A client that just disappears is cleaned up by the idle sweeper.
    const second = await initialize(running, ALPHA);
    const secondResponse = await fetch(`${running.url}/mcp`, {
      headers: { ...headers, "mcp-session-id": second },
    });
    const secondReader = secondResponse.body!.getReader();
    await readUntil(secondReader, ": keepalive", 2_000);
    await secondReader.cancel();
    await waitFor(() => running.gateway.manager.stats().sessions === 0);
  });

  it("drains an active slow tool call before closing", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const createSlowServer = () => {
      const server = new McpServer({ name: "slow-tool", version: "0.0.0" });
      server.registerTool(
        "slow_result",
        {
          title: "Slow result",
          description: "Finishes after the gateway starts draining.",
          inputSchema: {},
        },
        async () => {
          started();
          await sleep(150);
          return { content: [{ type: "text", text: "drained" }] };
        },
      );
      return server;
    };
    const running = await startGateway(
      upstream,
      { shutdownGraceMs: 1_000 },
      { createMcpServer: createSlowServer },
    );
    const sessionId = await initialize(running, ALPHA);
    const callPromise = rpc(
      running,
      ALPHA,
      {
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: { name: "slow_result", arguments: {} },
      },
      sessionId,
    );
    await startedPromise;
    const closePromise = running.gateway.close("test");
    await sleep(25);
    const duringDrain = await rpc(running, ALPHA, INITIALIZE);
    expect(duringDrain.status).toBe(503);
    expect(duringDrain.headers.get("retry-after")).toBe("1");
    expect(duringDrain.json).toMatchObject({ error: "shutting_down" });
    const call = await callPromise;
    expect(call.status).toBe(200);
    const payload = toolResult(call) as { content?: Array<{ text?: string }> };
    expect(payload.content?.[0]?.text).toBe("drained");
    await closePromise;
    expect(running.gateway.manager.stats()).toMatchObject({
      sessions: 0,
      pending: 0,
    });
  });

  it("closes an open GET SSE stream during drain", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      shutdownGraceMs: 100,
      sseKeepAliveMs: 30,
    });
    const sessionId = await initialize(running, ALPHA);
    const response = await fetch(`${running.url}/mcp`, {
      headers: {
        authorization: `Bearer ${ALPHA}`,
        "mcp-session-id": sessionId,
        "mcp-protocol-version": "2025-06-18",
        accept: "text/event-stream",
      },
    });
    const reader = response.body!.getReader();
    await readUntil(reader, ": keepalive", 2_000);
    const closePromise = running.gateway.close("test");
    expect(await waitForStreamEnd(reader, 2_000)).toBe(true);
    await closePromise;
    expect(running.gateway.manager.stats().sessions).toBe(0);
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

  it("validates a key with the API before registering a session", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream);

    const beforeCache = upstream.authCalls;
    const fabricated = await rpc(running, "jnk_fabricated_secret", INITIALIZE);
    expect(fabricated.status).toBe(401);
    expect(fabricated.json).toMatchObject({ error: "unauthorized" });
    expect(running.gateway.manager.stats()).toMatchObject({
      sessions: 0,
      pending: 0,
    });
    expect(running.logs.join("")).toContain("auth_validation_failed");
    expect(running.logs.join("")).not.toContain("jnk_fabricated_secret");

    // The bounded negative cache stops a repeated bad key reaching the API.
    const repeated = await rpc(running, "jnk_fabricated_secret", INITIALIZE);
    expect(repeated.status).toBe(401);
    expect(upstream.authCalls - beforeCache).toBe(1);
    expect(running.logs.join("")).toContain("auth_validation_cached");

    const beforeLimited = upstream.authCalls;
    const limited = await rpc(running, "jnk_limited_secret", INITIALIZE);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("7");
    expect(limited.json).toMatchObject({ error: "rate_limited" });
    // 7 s is above AUTH_RETRY_MAX_DELAY_MS (1 s): do not sleep/retry.
    expect(upstream.authCalls - beforeLimited).toBe(1);
    expect(running.gateway.manager.stats()).toMatchObject({
      sessions: 0,
      pending: 0,
    });

    const down = await rpc(running, "jnk_auth_down_secret", INITIALIZE);
    expect(down.status).toBe(503);
    expect(down.headers.get("retry-after")).toBe("5");
    expect(down.json).toMatchObject({ error: "auth_unavailable" });
    expect(running.gateway.manager.stats()).toMatchObject({
      sessions: 0,
      pending: 0,
    });

    const retried = await initialize(running, "jnk_retry_secret");
    expect(retried).toBeTruthy();

    const valid = await initialize(running, ALPHA);
    expect(valid).toBeTruthy();
  });

  it("floods are stopped locally before more API validation calls", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      initRateLimitPerMinute: 2,
    });
    const before = upstream.authCalls;
    const responses = [];
    for (const suffix of ["one", "two", "three"]) {
      responses.push(
        await rpc(running, `jnk_fabricated_${suffix}`, INITIALIZE),
      );
    }
    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 429,
    ]);
    expect(responses[2]?.json).toMatchObject({
      error: "initialize_rate_limited",
    });
    expect(Number(responses[2]?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(upstream.authCalls - before).toBe(2);
    expect(running.gateway.manager.stats().sessions).toBe(0);
  });

  it("rejects an unauthenticated oversized body before admission", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      sessionlessMaxBodyBytes: 1_024,
      initRateLimitPerMinute: 1,
    });
    const before = upstream.authCalls;
    const unauthenticated = await rpc(running, null, "x".repeat(2_000));
    expect(unauthenticated.status).toBe(401);
    expect(upstream.authCalls).toBe(before);
    // The anonymous attempt did not consume the initialize bucket.
    const valid = await initialize(running, ALPHA);
    expect(valid).toBeTruthy();
  });

  it("rejects an oversized sessionless body before buffering it", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      sessionlessMaxBodyBytes: 64,
      initRateLimitPerMinute: 1,
    });
    const before = upstream.authCalls;
    const oversized = await rpc(running, ALPHA, "x".repeat(1_000));
    expect(oversized.status).toBe(413);
    expect(oversized.json).toMatchObject({ error: "payload_too_large" });
    expect(upstream.authCalls).toBe(before);
    // The oversized attempt consumed the initialize bucket.
    const after = await rpc(running, ALPHA, INITIALIZE);
    expect(after.status).toBe(429);
    expect(after.headers.get("retry-after")).toBeTruthy();
  });

  it("consumes the initialize bucket even for malformed sessionless bodies", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      initRateLimitPerMinute: 1,
    });
    const before = upstream.authCalls;
    const malformed = await rpc(running, ALPHA, "{");
    expect(malformed.status).toBe(400);
    expect(malformed.json).toMatchObject({ error: "invalid_json" });
    expect(upstream.authCalls).toBe(before);
    const after = await rpc(running, ALPHA, INITIALIZE);
    expect(after.status).toBe(429);
  });

  it("uses trusted XFF hops instead of the spoofable left edge", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      trustProxyHops: 2,
      initRateLimitPerMinute: 1,
    });
    const first = await rpc(
      running,
      "jnk_fabricated_alpha",
      INITIALIZE,
      undefined,
      { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    );
    expect(first.status).toBe(401);
    const spoofed = await rpc(
      running,
      "jnk_fabricated_beta",
      INITIALIZE,
      undefined,
      { "x-forwarded-for": "9.9.9.9, 1.2.3.4, 10.0.0.1" },
    );
    expect(spoofed.status).toBe(429);
    expect(spoofed.json).toMatchObject({ error: "initialize_rate_limited" });
  });

  it("rate-limits initialize per token fingerprint as well as per IP", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      tokenInitRateLimitPerMinute: 1,
    });
    const first = await initialize(running, ALPHA);
    expect(first).toBeTruthy();
    const before = upstream.authCalls;
    const second = await rpc(running, ALPHA, INITIALIZE);
    expect(second.status).toBe(429);
    expect(second.json).toMatchObject({ error: "initialize_rate_limited" });
    expect(upstream.authCalls).toBe(before);
  });

  it("single-flights concurrent auth validation for one key", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream);
    const before = upstream.authCalls;
    const [a, b] = await Promise.all([
      rpc(running, "jnk_slow_auth_secret", INITIALIZE),
      rpc(running, "jnk_slow_auth_secret", INITIALIZE),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(upstream.authCalls - before).toBe(1);
    expect(running.gateway.manager.stats().sessions).toBe(2);
  });

  it("bounds distinct auth validations in flight", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      authValidationMaxInFlight: 1,
    });
    const before = upstream.authCalls;
    const first = rpc(running, "jnk_slow_auth_secret", INITIALIZE);
    await waitFor(() => upstream.authCalls > before);
    const busy = await rpc(running, "jnk_slow_auth_two_secret", INITIALIZE);
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("1");
    expect(busy.json).toMatchObject({ error: "auth_busy" });
    const completed = await first;
    expect(completed.status).toBe(200);
  });

  it("keeps one valid key from exhausting the global session pool", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream, {
      maxSessions: 4,
      maxSessionsPerToken: 2,
    });
    await initialize(running, ALPHA);
    await initialize(running, ALPHA);
    const capped = await rpc(running, ALPHA, INITIALIZE);
    expect(capped.status).toBe(503);
    expect(capped.json).toMatchObject({ error: "session_limit" });
    expect(capped.headers.get("retry-after")).toBe("5");
    const other = await initialize(running, BETA);
    expect(other).toBeTruthy();
    expect(running.gateway.manager.stats().sessions).toBe(3);
  });

  it("single-flights concurrent readiness probes", async () => {
    const upstream = await startUpstream();
    cleanup.push(() => upstream.close());
    const running = await startGateway(upstream);
    upstream.readyCalls = 0;
    upstream.readyDelayMs = 100;
    const [a, b] = await Promise.all([
      fetch(`${running.url}/ready`),
      fetch(`${running.url}/ready`),
    ]);
    await a.body?.cancel();
    await b.body?.cancel();
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(upstream.readyCalls).toBe(1);
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
      sessionlessMaxBodyBytes: 1_000,
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
    const sessions: Array<{ token: string; id: string }> = [];
    let tokenIndex = 0;

    async function addSessions(total: number): Promise<void> {
      for (let offset = 0; offset < total; offset += 20) {
        const batch = Math.min(20, total - offset);
        const opened = await Promise.all(
          Array.from({ length: batch }, () => {
            const token = `jnk_load_${tokenIndex}_secret`;
            tokenIndex += 1;
            return initialize(running, token).then((id) => ({ token, id }));
          }),
        );
        sessions.push(...opened);
      }
    }

    await addSessions(100);
    expect(running.gateway.manager.stats().sessions).toBe(100);
    await addSessions(400);
    expect(running.gateway.manager.stats().sessions).toBe(500);

    // A tool call at the cap still uses that session's own key.
    const last = sessions[499]!;
    expect(await listBoards(running, last.token, last.id)).toEqual([
      "Unknown board",
    ]);

    const after = process.memoryUsage();
    const heapDeltaMb = (after.heapUsed - before.heapUsed) / (1024 * 1024);
    const rssMb = after.rss / (1024 * 1024);
    // Evidence for the DoD: 500 sessions share one process and a bounded
    // heap, instead of 500 × 100 MB stdio processes. The number includes the
    // Vitest worker and the mock upstream, so treat it as an upper bound.
    console.info(
      `[http-sessions] 500 sessions: heap +${heapDeltaMb.toFixed(1)} MB, ` +
        `RSS ${rssMb.toFixed(1)} MB`,
    );
    expect(heapDeltaMb).toBeLessThan(750);
    expect(rssMb).toBeLessThan(1_536);

    await running.gateway.close("test");
    expect(running.gateway.manager.stats()).toMatchObject({
      sessions: 0,
      pending: 0,
    });
  }, 120_000);
});
