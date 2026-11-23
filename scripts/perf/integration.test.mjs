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
    const pgFile = path.join(directory, "pg.url");
    const redisFile = path.join(directory, "redis.url");
    await writeFile(
      pgFile,
      "postgresql://perf:pgsecret@127.0.0.1:1/perf?sslpassword=sslsecret&client_secret=pgclientsecret\n",
      "utf8",
    );
    await writeFile(
      redisFile,
      "redis://:redissecret@127.0.0.1:1/0?auth_token=redisquerysecret\n",
      "utf8",
    );
    const result = await run(
      process.execPath,
      [
        cli,
        "--scenario",
        "S2",
        "--base-url",
        mock.baseUrl,
        "--board",
        "board-1",
        "--agents",
        "2",
        "--cadence",
        "150ms",
        "--duration",
        "1200ms",
        "--pg-url-file",
        pgFile,
        "--psql",
        "/definitely/not-psql",
        "--pg-activity",
        "--cpu-profile",
        cpuPath,
        "--redis-url-file",
        redisFile,
        "--redis-cli",
        "/definitely/not-redis-cli",
        "--output",
        output,
      ],
      {
        env: {
          JANOSIK_PERF_TOKEN: "jnk_real_secret_a,jnk_real_secret_b",
        },
      },
    );
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    const markdown = await readFile(output.replace(/\.json$/, ".md"), "utf8");
    assert.equal(report.mode, "real");
    assert.equal(report.config.mock, null);
    assert.deepEqual(report.config.resolvedBoards, ["board-1"]);
    assert.equal(report.scenarios.length, 1);
    assert.equal(report.scenarios[0].status, "ok");
    assert.equal(report.scenarios[0].summary.cycles > 0, true);
    assert.equal(
      report.scenarios[0].summary.agentCadence.agentsMeasured > 0,
      true,
    );
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
    const viewer = await run(
      process.execPath,
      [
        cli,
        "--scenario",
        "S2",
        "--base-url",
        mock.baseUrl,
        "--board",
        "board-1",
        "--agents",
        "2",
        "--duration",
        "300ms",
        "--output",
        path.join(directory, "viewer.json"),
      ],
      {
        env: { JANOSIK_PERF_TOKEN: "jnk_ok,jnk_viewer" },
      },
    );
    assert.equal(viewer.code, 2);
    assert.match(viewer.stderr, /token 2, board 1 \(board-1\)/);
    assert.match(viewer.stderr, /role VIEWER cannot write/);

    const readOnly = await run(
      process.execPath,
      [
        cli,
        "--scenario",
        "S2",
        "--base-url",
        mock.baseUrl,
        "--board",
        "board-1",
        "--agents",
        "1",
        "--duration",
        "300ms",
        "--output",
        path.join(directory, "readonly.json"),
      ],
      {
        env: { JANOSIK_PERF_TOKEN: "jnk_readonly" },
      },
    );
    assert.equal(readOnly.code, 2);
    assert.match(readOnly.stderr, /token 1 is read-only/);

    const scoped = await run(
      process.execPath,
      [
        cli,
        "--scenario",
        "S2",
        "--base-url",
        mock.baseUrl,
        "--board",
        "board-1",
        "--board",
        "board-2",
        "--agents",
        "1",
        "--duration",
        "300ms",
        "--output",
        path.join(directory, "scoped.json"),
      ],
      {
        env: { JANOSIK_PERF_TOKEN: "jnk_board1only" },
      },
    );
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
        "--agents",
        "1",
        "--duration",
        "10s",
        "--cadence",
        "200ms",
        "--output",
        output,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, JANOSIK_PERF_TOKEN: "jnk_sigint" },
        stdio: ["ignore", "pipe", "pipe"],
      },
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

test("credential-bearing URL argv is rejected before load", async () => {
  for (const [option, value, envName] of [
    [
      "--base-url",
      "https://user:secret@api.test/api/v1",
      "JANOSIK_PERF_BASE_URL",
    ],
    [
      "--pg-url",
      "postgresql://perf:secret@db.test/perf",
      "JANOSIK_PERF_PG_URL",
    ],
    [
      "--redis-url",
      "redis://:secret@redis.test:6379/0",
      "JANOSIK_PERF_REDIS_URL",
    ],
  ]) {
    const result = await run(process.execPath, [
      cli,
      "--scenario",
      "S2",
      "--mock",
      option,
      value,
    ]);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, new RegExp(`set ${envName}`));
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

test("harness argv contains no PAT or URL credentials", async () => {
  const mock = await startMockProcess();
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-argv-"));
  try {
    const output = path.join(directory, "argv.json");
    const token = "jnk_argv_secret_must_not_leak";
    const pgSecret = "pgsecret_must_not_leak";
    const redisSecret = "redissecret_must_not_leak";
    const pgFile = path.join(directory, "pg.url");
    const redisFile = path.join(directory, "redis.url");
    await writeFile(
      pgFile,
      `postgresql://perf:${pgSecret}@127.0.0.1:1/perf\n`,
      "utf8",
    );
    await writeFile(
      redisFile,
      `redis://:${redisSecret}@127.0.0.1:1/0\n`,
      "utf8",
    );
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
        "--agents",
        "1",
        "--duration",
        "2s",
        "--pg-url-file",
        pgFile,
        "--psql",
        "/definitely/not-psql",
        "--redis-url-file",
        redisFile,
        "--redis-cli",
        "/definitely/not-redis-cli",
        "--output",
        output,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, JANOSIK_PERF_TOKEN: token },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const closed = new Promise((resolve) => child.on("close", resolve));
    let cmdline = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        cmdline = (
          await readFile(`/proc/${child.pid}/cmdline`, "utf8")
        ).replace(/\0/g, " ");
        if (cmdline.includes("agent-scale.mjs")) break;
      } catch {
        // Process may not be visible yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.match(cmdline, /agent-scale\.mjs/);
    assert.equal(cmdline.includes(token), false);
    assert.equal(cmdline.includes("--token"), false);
    assert.equal(cmdline.includes(pgSecret), false);
    assert.equal(cmdline.includes(redisSecret), false);
    assert.equal(cmdline.includes("--pg-url "), false);
    assert.equal(cmdline.includes("--redis-url "), false);
    child.kill("SIGTERM");
    await closed;
  } finally {
    mock.child.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  }
});

async function startInspectorProcess() {
  const child = spawn(
    process.execPath,
    [
      "--inspect=127.0.0.1:0",
      "-e",
      "function spin(){let x=0; for(let i=0;i<10000;i++) x+=i;} setInterval(spin,1);",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(
      () => reject(new Error("inspector child did not print its URL")),
      10_000,
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = /Debugger listening on (ws:\/\/\S+)/.exec(stderr);
      if (match === null) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.on("error", reject);
  });
  return { child, wsUrl };
}

test("--api-inspect profiles a live process and reports Top-10", async () => {
  const inspector = await startInspectorProcess();
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-live-cpu-"));
  try {
    const profile = path.join(directory, "api.cpuprofile");
    const output = path.join(directory, "live.json");
    const result = await run(
      process.execPath,
      [
        cli,
        "--scenario",
        "S2",
        "--mock",
        "--agents",
        "1",
        "--cadence",
        "100ms",
        "--duration",
        "500ms",
        "--api-inspect",
        inspector.wsUrl,
        "--cpu-profile",
        profile,
        "--output",
        output,
      ],
      { timeout: 120_000 },
    );
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.cpuProfile.enabled, true);
    assert.equal(report.cpuProfile.available, true);
    assert.equal(report.cpuProfile.top.length > 0, true);
    assert.equal(report.cpuProfile.top.length <= 10, true);
  } finally {
    inspector.child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed --api-inspect start still writes a failed report", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "janosik-live-cpu-fail-"),
  );
  try {
    const profile = path.join(directory, "api.cpuprofile");
    const output = path.join(directory, "failed.json");
    const result = await run(
      process.execPath,
      [
        cli,
        "--scenario",
        "S2",
        "--mock",
        "--agents",
        "1",
        "--duration",
        "300ms",
        "--api-inspect",
        "ws://127.0.0.1:1/",
        "--cpu-profile",
        profile,
        "--output",
        output,
      ],
      { timeout: 30_000 },
    );
    assert.equal(result.code, 1, result.stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.status, "failed");
    assert.equal(report.instrumentationFailed, true);
    assert.match(report.instrumentationError, /api-inspect failed/);
    assert.equal(report.cpuProfile.available, false);

    await writeFile(
      profile,
      JSON.stringify({
        startTime: 0,
        endTime: 1_000_000,
        samples: [1],
        nodes: [{ id: 1, callFrame: { functionName: "recovered" } }],
      }),
      "utf8",
    );
    const attach = await run(process.execPath, [
      cli,
      "--report-only",
      output,
      "--cpu-profile",
      profile,
    ]);
    assert.equal(attach.code, 0, attach.stderr);
    const recovered = JSON.parse(await readFile(output, "utf8"));
    assert.equal(recovered.instrumentationFailed, false);
    assert.equal(recovered.instrumentationError, null);
    assert.equal(recovered.status, recovered.scenarios[0].status);
    assert.equal(recovered.cpuProfile.available, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("--report-only attaches a static profile without rerunning the load", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "janosik-report-only-"),
  );
  try {
    const output = path.join(directory, "run.json");
    const profile = path.join(directory, "static.cpuprofile");
    const first = await run(process.execPath, [
      cli,
      "--scenario",
      "S2",
      "--mock",
      "--agents",
      "1",
      "--duration",
      "300ms",
      "--output",
      output,
    ]);
    assert.equal(first.code, 0, first.stderr);
    const before = JSON.parse(await readFile(output, "utf8"));
    await writeFile(
      profile,
      JSON.stringify({
        startTime: 0,
        endTime: 1_000_000,
        samples: [1, 1],
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: "staticHot",
              url: "file:///app/old.js",
              lineNumber: 2,
            },
          },
        ],
      }),
      "utf8",
    );
    const tokenGuard = await run(process.execPath, [
      cli,
      "--report-only",
      output,
      "--cpu-profile",
      profile,
      "--token",
      "jnk_report_only_secret",
    ]);
    assert.equal(tokenGuard.code, 2, tokenGuard.stderr);
    assert.match(tokenGuard.stderr, /--token is no longer accepted in argv/);

    const urlGuard = await run(process.execPath, [
      cli,
      "--report-only",
      output,
      "--cpu-profile",
      profile,
      "--base-url",
      "https://jnk_username_only@api.test/api/v1",
    ]);
    assert.equal(urlGuard.code, 2, urlGuard.stderr);
    assert.match(urlGuard.stderr, /--base-url must not contain credentials/);

    const inspectGuard = await run(process.execPath, [
      cli,
      "--report-only",
      output,
      "--cpu-profile",
      profile,
      "--api-inspect",
      "ws://jnk_username_only@127.0.0.1:9229/uuid",
    ]);
    assert.equal(inspectGuard.code, 2, inspectGuard.stderr);
    assert.match(
      inspectGuard.stderr,
      /--api-inspect must not contain credentials/,
    );

    const attach = await run(process.execPath, [
      cli,
      "--report-only",
      output,
      "--cpu-profile",
      profile,
    ]);
    assert.equal(attach.code, 0, attach.stderr);
    const after = JSON.parse(await readFile(output, "utf8"));
    assert.equal(after.scenarios.length, before.scenarios.length);
    assert.equal(after.generatedAt, before.generatedAt);
    assert.equal(after.cpuProfile.available, true);
    assert.equal(after.cpuProfile.top[0].function, "staticHot");
    assert.equal(after.instrumentationFailed, false);
    assert.equal(after.instrumentationError, null);
    assert.equal(after.status, "ok");
    const markdown = await readFile(output.replace(/\.json$/, ".md"), "utf8");
    assert.match(markdown, /staticHot/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("--report-only rejects missing, unreadable and malformed reports", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "janosik-report-only-bad-"),
  );
  try {
    const profile = path.join(directory, "static.cpuprofile");
    await writeFile(
      profile,
      JSON.stringify({
        startTime: 0,
        endTime: 1_000_000,
        samples: [1],
        nodes: [{ id: 1, callFrame: { functionName: "x" } }],
      }),
      "utf8",
    );
    const missing = await run(process.execPath, [
      cli,
      "--report-only",
      path.join(directory, "missing.json"),
      "--cpu-profile",
      profile,
    ]);
    assert.equal(missing.code, 1, missing.stderr);
    assert.match(missing.stderr, /ENOENT|no such file/i);

    const unreadable = await run(process.execPath, [
      cli,
      "--report-only",
      directory,
      "--cpu-profile",
      profile,
    ]);
    assert.equal(unreadable.code, 1, unreadable.stderr);
    assert.match(unreadable.stderr, /EISDIR|directory|illegal operation/i);

    const malformedPath = path.join(directory, "malformed.json");
    await writeFile(malformedPath, "{not json", "utf8");
    const malformed = await run(process.execPath, [
      cli,
      "--report-only",
      malformedPath,
      "--cpu-profile",
      profile,
    ]);
    assert.equal(malformed.code, 1, malformed.stderr);
    assert.match(malformed.stderr, /JSON|Unexpected|position/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
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
        "--agents",
        "1",
        "--output",
        output,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, JANOSIK_PERF_TOKEN: "jnk_preflight" },
        stdio: ["ignore", "pipe", "pipe"],
      },
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

test("token-file and recycle-token-file drive per-board recycling", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-recycle-"));
  try {
    const agentsFile = path.join(directory, "agents.tokens");
    const recycleFile = path.join(directory, "recycle.token");
    await writeFile(agentsFile, "jnk_ok\n", "utf8");
    await writeFile(recycleFile, "jnk_admin_recycle\n", "utf8");
    const output = path.join(directory, "recycle.json");
    const result = await run(process.execPath, [
      cli,
      "--scenario",
      "S2",
      "--mock",
      "--mock-boards",
      "2",
      "--mock-cards",
      "1",
      "--board",
      "board-1",
      "--board",
      "board-2",
      "--token-file",
      agentsFile,
      "--shared-identity",
      "--recycle",
      "--recycle-token-file",
      recycleFile,
      "--agents",
      "2",
      "--cadence",
      "50ms",
      "--duration",
      "1200ms",
      "--output",
      output,
    ]);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.config.recycle, true);
    assert.deepEqual(report.config.resolvedBoards, ["board-1", "board-2"]);
    assert.equal(report.scenarios[0].summary.recycled > 0, true);
    assert.equal(report.scenarios[0].recycle.requests > 0, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("--mock --recycle works with the ADMIN fallback token", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "janosik-mock-recycle-"),
  );
  try {
    const output = path.join(directory, "mock-recycle.json");
    const result = await run(process.execPath, [
      cli,
      "--scenario",
      "S2",
      "--mock",
      "--mock-cards",
      "1",
      "--recycle",
      "--agents",
      "1",
      "--cadence",
      "50ms",
      "--duration",
      "1200ms",
      "--output",
      output,
    ]);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.config.recycle, true);
    assert.equal(report.scenarios[0].summary.recycled > 0, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("--require-ok makes a partial smoke run fail", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "janosik-require-ok-"),
  );
  try {
    const output = path.join(directory, "partial.json");
    const result = await run(process.execPath, [
      cli,
      "--scenario",
      "S2",
      "--mock",
      "--mock-cards",
      "1",
      "--agents",
      "1",
      "--duration",
      "500ms",
      "--cadence",
      "50ms",
      "--require-ok",
      "--output",
      output,
    ]);
    assert.equal(result.code, 1, result.stderr);
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.status, "partial");
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
