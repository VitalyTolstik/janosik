import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectCpuProfile } from "./lib/cpuprofile.mjs";
import { LiveProfiler } from "./lib/inspector-profile.mjs";

function spawnInspector() {
  const child = spawn(
    process.execPath,
    [
      "--inspect=127.0.0.1:0",
      "-e",
      "function spin(){let x=0; for(let i=0;i<20000;i++) x+=i; return x;} setInterval(spin,1);",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolve, reject) => {
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
      resolve({ child, wsUrl: match[1] });
    });
    child.on("error", reject);
  });
}

test("a live inspector profile produces a Top-10 table", async () => {
  const { child, wsUrl } = await spawnInspector();
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-inspect-"));
  try {
    const profilePath = path.join(directory, "api.cpuprofile");
    const startedAt = Date.now();
    const profiler = new LiveProfiler({
      wsUrl,
      profilePath,
      samplingIntervalUs: 100,
    });
    await profiler.start();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const stopped = await profiler.stop();
    assert.equal(stopped.path, profilePath);
    assert.equal(stopped.bytes > 0, true);
    const parsed = JSON.parse(await readFile(profilePath, "utf8"));
    assert.equal(Array.isArray(parsed.nodes), true);
    const profile = await collectCpuProfile(profilePath, {
      freshSince: startedAt,
    });
    assert.equal(profile.available, true);
    assert.equal(profile.top.length > 0, true);
    assert.equal(profile.top.length <= 10, true);
  } finally {
    child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed inspector connect closes the socket", async () => {
  const profiler = new LiveProfiler({
    wsUrl: "ws://127.0.0.1:1/",
    connectTimeoutMs: 1_000,
    requestTimeoutMs: 1_000,
  });
  await assert.rejects(profiler.start(), /cannot connect|timed out|closed/);
  assert.equal(profiler.ws, null);
  assert.equal(profiler.started, false);
});

test("an inspector connect timeout closes the socket", async (t) => {
  const sockets = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const port = server.address().port;
  const profiler = new LiveProfiler({
    wsUrl: `ws://127.0.0.1:${port}/`,
    connectTimeoutMs: 100,
    requestTimeoutMs: 100,
  });
  await assert.rejects(profiler.start(), /timed out/);
  assert.equal(profiler.ws, null);
  assert.equal(profiler.started, false);
});

test("a profile write failure still closes the socket", async () => {
  const { child, wsUrl } = await spawnInspector();
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-write-"));
  try {
    const blocker = path.join(directory, "not-a-directory");
    await writeFile(blocker, "x", "utf8");
    const profiler = new LiveProfiler({
      wsUrl,
      profilePath: blocker,
      samplingIntervalUs: 100,
      requestTimeoutMs: 2_000,
    });
    await profiler.start();
    await assert.rejects(
      profiler.stop(),
      /EEXIST|ENOTDIR|not a directory|file already exists/i,
    );
    assert.equal(profiler.ws, null);
    assert.equal(profiler.started, false);
  } finally {
    child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("a static profile is read without a freshness check", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-static-"));
  try {
    const file = path.join(directory, "api.cpuprofile");
    await writeFile(
      file,
      JSON.stringify({
        startTime: 0,
        endTime: 1_000_000,
        samples: [1, 1],
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: "legacy",
              url: "file:///old.js",
              line: 1,
            },
          },
        ],
      }),
      "utf8",
    );
    await utimes(file, new Date(0), new Date(0));
    const staticProfile = await collectCpuProfile(file);
    assert.equal(staticProfile.available, true);
    assert.equal(staticProfile.top[0].function, "legacy");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("absent and stale profiles are rejected clearly", async () => {
  const absent = await collectCpuProfile("/definitely/missing/api.cpuprofile", {
    freshSince: Date.now(),
  });
  assert.equal(absent.available, false);
  assert.match(absent.reason, /does not exist/);

  const directory = await mkdtemp(path.join(os.tmpdir(), "janosik-stale-"));
  try {
    const file = path.join(directory, "old.cpuprofile");
    await writeFile(
      file,
      JSON.stringify({
        startTime: 0,
        endTime: 1_000_000,
        samples: [1],
        nodes: [{ id: 1, callFrame: { functionName: "old" } }],
      }),
      "utf8",
    );
    await utimes(file, new Date(0), new Date(0));
    const stale = await collectCpuProfile(file, { freshSince: Date.now() });
    assert.equal(stale.available, false);
    assert.match(stale.reason, /stale/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
