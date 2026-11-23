import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HttpClient } from "./lib/http.mjs";
import { RunMetrics } from "./lib/metrics.mjs";
import { createMcpWorker } from "./lib/mcp.mjs";
import { startMockServer } from "./lib/mock-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

test("an MCP handshake that never completes times out and kills the child", async () => {
  const started = Date.now();
  let failure;
  try {
    await createMcpWorker({
      baseUrl: "http://127.0.0.1:1/api/v1",
      token: "jnk_handshake",
      boardId: "board-1",
      cwd: repoRoot,
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      connectTimeoutMs: 300,
      metrics: new RunMetrics("mcp-timeout"),
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /handshake timed out/);
  assert.equal(Date.now() - started < 5_000, true);
  assert.equal(Number.isInteger(failure.pid) || failure.pid === null, true);
});

test("scenario abort cancels an MCP handshake", async () => {
  const controller = new AbortController();
  const pending = createMcpWorker({
    baseUrl: "http://127.0.0.1:1/api/v1",
    token: "jnk_handshake",
    boardId: "board-1",
    cwd: repoRoot,
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    connectTimeoutMs: 10_000,
    signal: controller.signal,
    metrics: new RunMetrics("mcp-abort"),
  });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, /aborted by scenario signal/);
});

test("MCP tool errors are counted as requests with their real status", async () => {
  for (const status of [409, 429, 500]) {
    const mock = await startMockServer({
      boardCount: 1,
      cardsPerBoard: 4,
      commandStatus: status,
    });
    const metrics = new RunMetrics("mcp-error");
    const http = new HttpClient({
      baseUrl: mock.baseUrl,
      token: "perf-mcp-error",
      metrics: new RunMetrics("bootstrap"),
    });
    const { board } = await http.readBoard("board-1");
    const cardId = board.columns[0].cardIds[0];
    const worker = await createMcpWorker({
      baseUrl: mock.baseUrl,
      token: "perf-mcp-error",
      boardId: "board-1",
      cwd: repoRoot,
      metrics,
    });
    try {
      await assert.rejects(
        worker.call("janosik_claim_card", {
          boardId: "board-1",
          cardId,
          leaseMs: 60_000,
        }),
      );
      const snapshot = metrics.snapshot({ durationMs: 1_000, agents: 1 });
      assert.equal(snapshot.requests > 0, true);
      assert.equal(snapshot.statuses[String(status)] >= 1, true);
      assert.equal(snapshot.requestsPerAgentPerMinute > 0, true);
      assert.equal(snapshot.toolCalls > 0, true);
    } finally {
      await worker.close();
      await mock.close();
    }
  }
});

test("MCP network failure is recorded as status 0, not hidden latency", async () => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 4 });
  const metrics = new RunMetrics("mcp-network");
  const http = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-mcp-network",
    metrics: new RunMetrics("bootstrap"),
  });
  const { board } = await http.readBoard("board-1");
  const cardId = board.columns[0].cardIds[0];
  const worker = await createMcpWorker({
    baseUrl: mock.baseUrl,
    token: "perf-mcp-network",
    boardId: "board-1",
    cwd: repoRoot,
    metrics,
  });
  await mock.close();
  try {
    await assert.rejects(
      worker.call("janosik_claim_card", {
        boardId: "board-1",
        cardId,
        leaseMs: 60_000,
      }),
    );
    const snapshot = metrics.snapshot({ durationMs: 1_000, agents: 1 });
    assert.equal(snapshot.errors.network >= 1, true);
    assert.equal(snapshot.requests > 0, true);
  } finally {
    await worker.close();
  }
});
