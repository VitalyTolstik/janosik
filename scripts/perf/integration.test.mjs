import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(here, "agent-scale.mjs");
const mockMain = path.join(here, "mock-server-main.mjs");

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeout ?? 90_000,
    );
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function startMockProcess(env = {}) {
  const child = spawn(process.execPath, [mockMain], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MOCK_CARDS: "80",
      MOCK_BOARDS: "1",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("mock server did not print its URL")),
      10_000,
    );
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const line = buffer.split(/\r?\n/).find((entry) => entry.trim() !== "");
      if (line === undefined) return;
      try {
        const parsed = JSON.parse(line);
        clearTimeout(timer);
        resolve(parsed);
      } catch {
        // Keep waiting for the complete JSON line.
      }
    });
    child.on("error", reject);
  });
  return { child, ...info };
}

test("real mode writes JSON and Markdown with no 400s (out-of-process mock)", async () => {
  const mock = await startMockProcess();
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-real-"));
  try {
    const output = path.join(directory, "run.json");
    const cpuPath = path.join(directory, "api.cpuprofile");
    await writeFile(
      cpuPath,
      JSON.stringify({
        startTime: 0,
        endTime: 1_000_000,
        samples: [1, 1],
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: "loadBoardAggregate",
              url: "file:///app/backend/board.js",
              lineNumber: 4,
            },
          },
        ],
      }),
      "utf8",
    );
    const result = await run(process.execPath, [
      cli,
      "--scenario",
      "S2",
      "--base-url",
      mock.baseUrl,
      "--board",
      "board-1",
      "--token",
      "jnk_real_secret_a",
      "--token",
      "jnk_real_secret_b",
      "--agents",
      "2",
      "--cadence",
      "150ms",
      "--duration",
      "1200ms",
      "--pg-url",
      "postgresql://perf:pgsecret@127.0.0.1:1/perf?sslpassword=sslsecret&client_secret=pgclientsecret",
      "--psql",
      "/definitely/not-psql",
      "--pg-activity",
      "--cpu-profile",
      cpuPath,
      "--redis-url",
      "redis://:redissecret@127.0.0.1:1/0?auth_token=redisquerysecret",
      "--redis-cli",
      "/definitely/not-redis-cli",
      "--output",
      output,
    ]);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    const markdown = await readFile(output.replace(/\.json$/, ".md"), "utf8");
    assert.equal(report.mode, "real");
    assert.equal(report.config.mock, null);
    assert.equal(report.scenarios.length, 1);
    assert.equal(report.scenarios[0].status, "ok");
    assert.equal(report.scenarios[0].summary.cycles > 0, true);
    assert.equal(report.scenarios[0].summary.errors.badRequest400, 0);
    assert.equal(report.scenarios[0].summary.errors.conflict409 >= 0, true);
    assert.equal(report.scenarios[0].summary.statuses["400"], undefined);
    assert.equal(report.pg.available, false);
    assert.match(report.pg.reason, /command failed/);
    assert.equal(report.pgActivity.enabled, true);
    assert.equal(report.pgActivity.available, false);
    assert.equal(report.cpuProfile.enabled, true);
    assert.equal(report.cpuProfile.available, true);
    assert.equal(report.cpuProfile.top[0].function, "loadBoardAggregate");
    assert.equal(report.redis.available, false);
    for (const secret of [
      "jnk_real_secret",
      "pgsecret",
      "redissecret",
      "sslsecret",
      "pgclientsecret",
      "redisquerysecret",
    ]) {
      assert.equal(JSON.stringify(report).includes(secret), false);
      assert.equal(markdown.includes(secret), false);
      assert.equal(result.stdout.includes(secret), false);
      assert.equal(result.stderr.includes(secret), false);
    }
    assert.equal(markdown.includes("## Throughput and errors"), true);
  } finally {
    mock.child.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  }
});

test("preflight fails token/board mixed access before load with exit 2", async () => {
  const mock = await startMockProcess({ MOCK_BOARDS: "2" });
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-preflight-"));
  try {
    const viewer = await run(process.execPath, [
      cli,
      "--scenario",
      "S2",
      "--base-url",
      mock.baseUrl,
      "--board",
      "board-1",
      "--token",
      "jnk_ok",
      "--token",
      "jnk_viewer",
      "--agents",
      "2",
      "--duration",
      "300ms",
      "--output",
      path.join(directory, "viewer.json"),
    ]);
    assert.equal(viewer.code, 2);
    assert.match(viewer.stderr, /token 2, board 1 \(board-1\)/);
    assert.match(viewer.stderr, /role VIEWER cannot write/);

    const readOnly = await run(process.execPath, [
      cli,
      "--scenario",
      "S2",
      "--base-url",
      mock.baseUrl,
      "--board",
      "board-1",
      "--token",
      "jnk_readonly",
      "--agents",
      "1",
      "--duration",
      "300ms",
      "--output",
      path.join(directory, "readonly.json"),
    ]);
    assert.equal(readOnly.code, 2);
    assert.match(readOnly.stderr, /token 1 is read-only/);

    const scoped = await run(process.execPath, [
      cli,
      "--scenario",
      "S2",
      "--base-url",
      mock.baseUrl,
      "--board",
      "board-1",
      "--board",
      "board-2",
      "--token",
      "jnk_board1only",
      "--agents",
      "1",
      "--duration",
      "300ms",
      "--output",
      path.join(directory, "scoped.json"),
    ]);
    assert.equal(scoped.code, 2);
    assert.match(scoped.stderr, /token 1, board 2 \(board-2\): not accessible/);
  } finally {
    mock.child.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  }
});

test("first Ctrl-C writes a partial report and exits 130", async () => {
  const mock = await startMockProcess();
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-sigint-"));
  try {
    const output = path.join(directory, "interrupted.json");
    const child = spawn(
      process.execPath,
      [
        cli,
        "--scenario",
        "S2",
        "--base-url",
        mock.baseUrl,
        "--board",
        "board-1",
        "--token",
        "jnk_sigint",
        "--agents",
        "1",
        "--duration",
        "10s",
        "--cadence",
        "200ms",
        "--output",
        output,
      ],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const closed = new Promise((resolve) => child.on("close", resolve));
    const deadline = Date.now() + 10_000;
    while (!stdout.includes("S2") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.match(stdout, /S2/);
    child.kill("SIGINT");
    const code = await Promise.race([
      closed,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 20_000)),
    ]);
    assert.equal(code, 130, stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    await readFile(output.replace(/\.json$/, ".md"), "utf8");
    assert.equal(report.status, "interrupted");
    assert.equal(report.scenarios[0].status, "interrupted");
  } finally {
    mock.child.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  }
});

test("standalone mock applies the same board/card limits", async () => {
  const mock = await startMockProcess({
    MOCK_BOARDS: "17",
    MOCK_CARDS: "2001",
  });
  try {
    assert.equal(mock.boards, 16);
    assert.equal(mock.cards, 2_000);
  } finally {
    mock.child.kill("SIGTERM");
  }
});

test("Ctrl-C during preflight writes a minimal partial report", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "janosik-pre-sigint-"),
  );
  try {
    const output = path.join(directory, "preflight.json");
    const child = spawn(
      process.execPath,
      [
        cli,
        "--scenario",
        "S2",
        "--base-url",
        "http://127.0.0.1:1/api/v1",
        "--token",
        "jnk_preflight",
        "--agents",
        "1",
        "--output",
        output,
      ],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const closed = new Promise((resolve) => child.on("close", resolve));
    await new Promise((resolve) => setTimeout(resolve, 800));
    child.kill("SIGINT");
    const code = await Promise.race([
      closed,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 20_000)),
    ]);
    assert.equal(code, 130, stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    await readFile(output.replace(/\.json$/, ".md"), "utf8");
    assert.equal(report.status, "interrupted");
    assert.equal(report.scenarios.length, 0);
    assert.match(report.preflightError, /interrupted|health/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("MCP report uses actual processes, not the requested agents", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-mcp-count-"));
  try {
    const output = path.join(directory, "mcp-count.json");
    const result = await run(
      process.execPath,
      [
        cli,
        "--scenario",
        "S2",
        "--driver",
        "mcp",
        "--mock",
        "--agents",
        "2",
        "--mcp-processes",
        "1",
        "--cadence",
        "250ms",
        "--duration",
        "1500ms",
        "--output",
        output,
      ],
      { timeout: 120_000 },
    );
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    const scenario = report.scenarios[0];
    assert.equal(scenario.mcp.processes, 1);
    assert.equal(scenario.summary.agents, 1);
    assert.equal(scenario.config.agents, 1);
    const expected =
      Math.round(
        (scenario.summary.requests /
          1 /
          (scenario.summary.durationMs / 60_000)) *
          1_000,
      ) / 1_000;
    assert.equal(scenario.summary.requestsPerAgentPerMinute, expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("MCP mock smoke spawns a real stdio process and counts tools", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-mcp-"));
  try {
    const output = path.join(directory, "mcp.json");
    const result = await run(
      process.execPath,
      [
        cli,
        "--scenario",
        "S2",
        "--driver",
        "mcp",
        "--mock",
        "--agents",
        "1",
        "--cadence",
        "300ms",
        "--duration",
        "2000ms",
        "--output",
        output,
      ],
      { timeout: 120_000 },
    );
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    const scenario = report.scenarios[0];
    assert.equal(scenario.status, "ok");
    assert.equal(scenario.mcp.processes, 1);
    assert.equal(scenario.mcp.pids.length, 1);
    assert.equal(scenario.summary.toolCalls > 0, true);
    assert.equal(scenario.summary.cycles > 0, true);
    assert.equal(scenario.summary.requests > 0, true);
    assert.equal(scenario.summary.requestsPerAgentPerMinute > 0, true);
    assert.equal(scenario.summary.success2xx > 0, true);
    assert.equal(
      Object.keys(scenario.summary.tools).includes("janosik_claim_card"),
      true,
    );
    assert.equal(report.driver, "mcp");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
