import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HttpClient } from "./lib/http.mjs";
import { RunMetrics } from "./lib/metrics.mjs";
import { McpToolError, createMcpWorker, runMcpAgentLoop } from "./lib/mcp.mjs";
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

test("MCP worker close is bounded and reaps the child", async () => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 2 });
  const worker = await createMcpWorker({
    baseUrl: mock.baseUrl,
    token: "perf-close",
    boardId: "board-1",
    cwd: repoRoot,
    metrics: new RunMetrics("mcp-close"),
    closeTimeoutMs: 50,
  });
  const pid = worker.pid;
  const started = Date.now();
  await worker.close();
  await mock.close();
  assert.equal(Date.now() - started < 3_000, true);
  assert.equal(Number.isInteger(pid), true);
  let gone = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      gone = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(gone, true);
});

test("runMcpAgentLoop releases a card after a network-status claim error", async () => {
  let releaseCalls = 0;
  const errors = [];
  const metrics = new RunMetrics("mcp-claim-timeout");
  const worker = {
    sampleRss() {},
    async call(name) {
      if (name === "janosik_list_ready_cards") {
        return { results: [{ id: "c1" }] };
      }
      if (name === "janosik_get_workflow") {
        return { doneColumnIds: ["done"], seq: 1 };
      }
      if (name === "janosik_claim_card") {
        throw new McpToolError({
          name,
          message: "request timed out",
          status: 0,
          code: "ETIMEDOUT",
        });
      }
      if (name === "janosik_release_card") {
        releaseCalls += 1;
        return {};
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
  await runMcpAgentLoop({
    worker,
    boardId: "board-1",
    agentIndex: 0,
    mode: "work",
    config: { id: "S2", cadenceMs: 1, jitter: 0, leaseMs: 60_000 },
    deadline: Date.now() + 25,
    signal: new AbortController().signal,
    metrics,
    random: () => 0.5,
    onError: (entry) => errors.push(entry),
  });
  assert.equal(releaseCalls > 0, true);
  assert.equal(errors.length > 0, true);
  assert.equal(
    errors.every((entry) => entry.orphan === false),
    true,
  );
  assert.equal(metrics.orphans, 0);
});

test("MCP cleanup with no response is cleanupFailed, not orphan", async () => {
  const errors = [];
  const worker = {
    sampleRss() {},
    async call(name) {
      if (name === "janosik_list_ready_cards") {
        return { results: [{ id: "c1" }] };
      }
      if (name === "janosik_get_workflow") {
        return { doneColumnIds: ["done"], seq: 1 };
      }
      if (name === "janosik_claim_card") {
        throw new McpToolError({
          name,
          message: "request timed out",
          status: 0,
          code: "ETIMEDOUT",
        });
      }
      if (name === "janosik_release_card") {
        throw new Error("socket closed");
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
  await runMcpAgentLoop({
    worker,
    boardId: "board-1",
    agentIndex: 0,
    mode: "work",
    config: { id: "S2", cadenceMs: 1, jitter: 0, leaseMs: 60_000 },
    deadline: Date.now() + 25,
    signal: new AbortController().signal,
    metrics: new RunMetrics("mcp-cleanup-failed"),
    random: () => 0.5,
    onError: (entry) => errors.push(entry),
  });
  assert.equal(errors.length > 0, true);
  assert.equal(
    errors.every(
      (entry) => entry.cleanupFailed === true && entry.orphan === false,
    ),
    true,
  );
});

test("MCP orphan is counted once by the scenario onError site", async () => {
  const errors = [];
  const metrics = new RunMetrics("mcp-orphan-count");
  const worker = {
    sampleRss() {},
    async call(name) {
      if (name === "janosik_list_ready_cards") {
        return { results: [{ id: "c1" }] };
      }
      if (name === "janosik_get_workflow") {
        return { doneColumnIds: ["done"], seq: 1 };
      }
      if (name === "janosik_claim_card") {
        throw new McpToolError({
          name,
          message: "network down",
          status: 0,
          code: "network_error",
        });
      }
      if (name === "janosik_release_card") {
        throw new McpToolError({
          name,
          message: "release rejected",
          status: 500,
        });
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
  await runMcpAgentLoop({
    worker,
    boardId: "board-1",
    agentIndex: 0,
    mode: "work",
    config: { id: "S2", cadenceMs: 1, jitter: 0, leaseMs: 60_000 },
    deadline: Date.now() + 25,
    signal: new AbortController().signal,
    metrics,
    random: () => 0.5,
    onError: (entry) => {
      errors.push(entry);
      if (entry.orphan === true) metrics.recordOrphan();
    },
  });
  const orphanEvents = errors.filter((entry) => entry.orphan === true).length;
  assert.equal(orphanEvents > 0, true);
  assert.equal(metrics.orphans, orphanEvents);
});

test("MCP uses wait_for_work when idle and evidence comments when working", async () => {
  const metrics = new RunMetrics("mcp-tools");
  const idleCalls = [];
  const idleWorker = {
    sampleRss() {},
    async call(name) {
      idleCalls.push(name);
      return {};
    },
  };
  await runMcpAgentLoop({
    worker: idleWorker,
    boardId: "board-1",
    mode: "idle",
    config: { id: "S1", cadenceMs: 1, jitter: 0, leaseMs: 60_000 },
    deadline: Date.now() + 15,
    signal: new AbortController().signal,
    metrics,
    random: () => 0.5,
  });
  assert.equal(idleCalls.includes("janosik_wait_for_work"), true);

  const idleTimes = [];
  const pacedWorker = {
    sampleRss() {},
    async call() {
      idleTimes.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { card: null };
    },
  };
  await runMcpAgentLoop({
    worker: pacedWorker,
    boardId: "board-1",
    mode: "idle",
    config: { id: "S1", cadenceMs: 40, jitter: 0.5, leaseMs: 60_000 },
    deadline: Date.now() + 140,
    signal: new AbortController().signal,
    metrics,
    random: () => 0.999,
  });
  assert.equal(idleTimes.length >= 2, true);
  assert.equal(idleTimes[1] - idleTimes[0] < 55, true);

  let commentArgs;
  const worker = {
    sampleRss() {},
    async call(name, args) {
      if (name === "janosik_list_ready_cards") {
        return { results: [{ id: "c1" }] };
      }
      if (name === "janosik_get_workflow") {
        return { doneColumnIds: ["done"], seq: 1 };
      }
      if (name === "janosik_claim_card" || name === "janosik_move_card") {
        return {};
      }
      if (name === "janosik_add_comment") {
        commentArgs = args;
        return {};
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
  await runMcpAgentLoop({
    worker,
    boardId: "board-1",
    mode: "work",
    config: { id: "S2", cadenceMs: 1, jitter: 0, leaseMs: 60_000 },
    deadline: Date.now() + 15,
    signal: new AbortController().signal,
    metrics,
    random: () => 0.5,
  });
  assert.equal(commentArgs?.kind, "evidence");
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
