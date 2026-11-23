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

async function startMockProcess() {
  const child = spawn(process.execPath, [mockMain], {
    cwd: repoRoot,
    env: { ...process.env, MOCK_CARDS: "80", MOCK_BOARDS: "1" },
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
      "postgresql://perf:pgsecret@127.0.0.1:1/perf",
      "--psql",
      "/definitely/not-psql",
      "--pg-activity",
      "--cpu-profile",
      cpuPath,
      "--redis-url",
      "redis://:redissecret@127.0.0.1:1/0",
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
    for (const secret of ["jnk_real_secret", "pgsecret", "redissecret"]) {
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
    assert.equal(scenario.summary.requests, 0);
    assert.equal(
      Object.keys(scenario.summary.tools).includes("janosik_claim_card"),
      true,
    );
    assert.equal(report.driver, "mcp");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
