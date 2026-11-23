import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
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
