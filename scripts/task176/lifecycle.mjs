import { fork, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  openSync,
  lstatSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { childEnv, DemoError } from "./target.mjs";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const backend = join(root, "backend");
const entry = join(root, "scripts/task176/backend-worker.cjs");
const main = join(backend, "dist/main.js");
const noncePattern = /^[a-f0-9]{64}$/;

function processState(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2)
    throw new Error("Invalid process ID.");
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z" || fields[0] === "X") return null;
    return {
      group: Number(fields[2]),
      session: Number(fields[3]),
      start: fields[19],
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function privateDirectory(dir) {
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stat = lstatSync(dir);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o700
  ) {
    throw new DemoError(
      "TASK-176 state directory must be private and owned by this user.",
    );
  }
}

export function lockDemo(target) {
  if (process.platform !== "linux" || !processState(process.pid)) {
    throw new DemoError(
      "TASK-176 lifecycle requires Linux/WSL with readable /proc.",
    );
  }
  const dir = `/tmp/janosik-task176-${process.getuid()}`;
  privateDirectory(dir);
  const stateDir = join(dir, target.database);
  privateDirectory(stateDir);
  // Keep one inode across runs. flock is tied to this open file description
  // and is released by the kernel on normal exit or SIGKILL.
  const fd = openSync(
    join(stateDir, "lock"),
    constants.O_CREAT | constants.O_NOFOLLOW | constants.O_RDONLY,
    0o600,
  );
  const stat = fstatSync(fd);
  if (
    !stat.isFile() ||
    stat.uid !== process.getuid() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600
  ) {
    closeSync(fd);
    throw new DemoError("Invalid TASK-176 lock file.");
  }
  const result = spawnSync(
    "flock",
    ["--nonblock", "--conflict-exit-code", "73", "3"],
    {
      stdio: ["ignore", "ignore", "ignore", fd],
    },
  );
  if (result.status !== 0) {
    closeSync(fd);
    throw new DemoError(
      result.status === 73
        ? `Another TASK-176 operation holds the lock for ${target.database}.`
        : "TASK-176 lifecycle requires a working flock command.",
    );
  }
  return { stateDir, fd, close: () => closeSync(fd) };
}

function bootArgs(record, dir) {
  return [
    record.entry,
    record.main,
    "--demo-reset",
    `--demo-reset-env-file=${join(dir, `env-${record.nonce}.json`)}`,
    `--demo-reset-nonce=${record.nonce}`,
    `--demo-reset-port=${record.port}`,
  ];
}

function assertOwnership(record, dir) {
  try {
    const state = processState(record.pid);
    // A dead group leader needs no signal. A reused PID fails ownership.
    if (!state) return false;
    if (
      state.start !== record.start ||
      state.group !== record.pid ||
      state.session !== record.pid ||
      !noncePattern.test(record.nonce) ||
      !Number.isInteger(record.port) ||
      record.port < 1024 ||
      record.port > 65535
    )
      throw new Error();
    const worktree = resolve(record.entry, "../../..");
    if (
      !isAbsolute(record.entry) ||
      record.entry !== join(worktree, "scripts/task176/backend-worker.cjs") ||
      record.main !== join(worktree, "backend/dist/main.js")
    )
      throw new Error();
    const args = readFileSync(`/proc/${record.pid}/cmdline`, "utf8")
      .split("\0")
      .slice(0, -1);
    if (
      args[0] !== record.node ||
      args.slice(1).join("\0") !== bootArgs(record, dir).join("\0") ||
      readlinkSync(`/proc/${record.pid}/exe`) !== record.node
    )
      throw new Error();
    return true;
  } catch {
    const pid = Number.isSafeInteger(record?.pid)
      ? ` for PID ${record.pid}`
      : "";
    throw new DemoError(
      `Unproven TASK-176 process ownership${pid} in ${dir}. No signal sent.`,
    );
  }
}

async function stopOwned(record, dir) {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    if (!assertOwnership(record, dir)) return;
    try {
      process.kill(-record.pid, signal);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (!processState(record.pid)) return;
      await delay(50);
    }
  }
  throw new DemoError("The TASK-176 backend did not exit.");
}

export async function sweepStale(stateDir) {
  for (const name of readdirSync(stateDir)) {
    if (!/^run-[A-Za-z0-9]{6}$/.test(name)) continue;
    const dir = join(stateDir, name);
    let record;
    try {
      record = JSON.parse(readFileSync(join(dir, "backend.json"), "utf8"));
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      if (error.code !== "ENOENT")
        throw new DemoError(`Invalid stale TASK-176 state in ${dir}.`);
      continue;
    }
    try {
      await stopOwned(record, dir);
    } catch (error) {
      // Clear unproven bookkeeping and abort this invocation. A live
      // listener continues to block a later reset via the explicit port check.
      if (error instanceof DemoError && error.message.startsWith("Unproven")) {
        rmSync(dir, { recursive: true, force: true });
      }
      throw error;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function assertFreePort(port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
    });
  } catch {
    throw new DemoError(`TASK-176 API port ${port} is unavailable.`);
  }
  await new Promise((resolve) => server.close(resolve));
}

function ownsListener(pid, port) {
  const local = `0100007F:${port.toString(16).padStart(4, "0").toUpperCase()}`;
  const sockets = new Set(
    readFileSync("/proc/net/tcp", "utf8")
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields[1] === local && fields[3] === "0A")
      .map((fields) => `socket:[${fields[9]}]`),
  );
  if (sockets.size !== 1) return false;
  return readdirSync(`/proc/${pid}/fd`).some((fd) => {
    try {
      return sockets.has(readlinkSync(`/proc/${pid}/fd/${fd}`));
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  });
}

export function createBackendLifecycle(lock, target, settings) {
  const dir = mkdtempSync(join(lock.stateDir, "run-"));
  const recordPath = join(dir, "backend.json");
  let running;

  async function stop() {
    if (!running) return;
    const { child, exited, record } = running;
    if (record) await stopOwned(record, dir);
    else if (child.connected) child.disconnect();
    await exited; // Reap our direct child before Prisma reset/verification.
    running = undefined;
    rmSync(recordPath, { force: true });
  }

  function assertListening() {
    const record = running?.record;
    if (
      !record ||
      !assertOwnership(record, dir) ||
      !ownsListener(record.pid, target.port)
    ) {
      throw new DemoError("The TASK-176 backend no longer owns its API port.");
    }
  }

  async function start() {
    await assertFreePort(target.port);
    const record = {
      node: process.execPath,
      entry,
      main,
      port: target.port,
      nonce: randomBytes(32).toString("hex"),
    };
    const env = childEnv(target);
    const envFile = join(dir, `env-${record.nonce}.json`);
    writeFileSync(
      envFile,
      JSON.stringify({
        nonce: record.nonce,
        env: {
          DATABASE_URL: env.DATABASE_URL,
          NODE_ENV: env.NODE_ENV,
          PORT: String(record.port),
          JWT_SECRET: settings.jwtSecret,
          SETTINGS_SECRET: settings.settingsSecret,
          PUBLIC_ORIGIN: settings.publicOrigin,
          COOKIE_SECURE: "false",
          UPLOAD_DIR: join(dir, "uploads"),
        },
      }),
      { mode: 0o600, flag: "wx" },
    );
    const child = fork(entry, bootArgs(record, dir).slice(1), {
      cwd: backend,
      env,
      detached: true,
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let finished = false;
    const exited = new Promise((resolve) => {
      child.once("close", () => {
        finished = true;
        resolve();
      });
      child.on("error", () => {
        finished = true;
      });
    });
    // The worker cannot start until its identity is durable. A crash before
    // the send closes IPC and the unarmed worker exits on its own.
    running = { child, exited };
    const state = child.pid ? processState(child.pid) : null;
    if (!state)
      throw new DemoError("Could not start the TASK-176 backend process.");
    Object.assign(record, { pid: child.pid, start: state.start });
    writeFileSync(recordPath, JSON.stringify(record), {
      mode: 0o600,
      flag: "wx",
    });
    running.record = record;
    assertOwnership(record, dir);
    child.send("start");
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (finished)
        throw new DemoError("The TASK-176 backend exited during startup.");
      if (ownsListener(child.pid, target.port)) {
        assertListening();
        console.log(
          `TASK-176 backend PID ${child.pid} listening on port ${target.port}.`,
        );
        return;
      }
      await delay(50);
    }
    throw new DemoError("Timed out waiting for the TASK-176 backend.");
  }

  return {
    start,
    stop,
    assertListening,
    async dispose() {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
