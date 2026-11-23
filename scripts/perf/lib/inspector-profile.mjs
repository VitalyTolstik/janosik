// TASK-200.1 — live V8 CPU profile through the Node inspector.
//
// `node --cpu-prof` only writes the profile when the process exits, so a
// harness that runs against a live API cannot read it. This module drives the
// inspector `Profiler` domain over the built-in WebSocket (Node 22+), stops it
// after the scenarios and writes a normal `.cpuprofile` for `cpuprofile.mjs`.

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LiveProfiler {
  constructor({
    wsUrl,
    profilePath,
    samplingIntervalUs = 1_000,
    connectTimeoutMs = 5_000,
    requestTimeoutMs = 10_000,
    signal,
  }) {
    this.wsUrl = wsUrl;
    this.profilePath = profilePath;
    this.samplingIntervalUs = samplingIntervalUs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.signal = signal;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    this.started = false;
  }

  async connect() {
    if (typeof WebSocket !== "function") {
      throw new Error(
        "this Node build has no global WebSocket (Node 22+ required)",
      );
    }
    if (!/^wss?:\/\//.test(String(this.wsUrl))) {
      throw new Error("--api-inspect must be a ws:// or wss:// URL");
    }
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              `inspector connect timed out after ${this.connectTimeoutMs}ms`,
            ),
          ),
        this.connectTimeoutMs,
      );
      const onAbort = () =>
        finish(new Error("inspector connect aborted by scenario signal"));
      ws.addEventListener("open", () => finish(null), { once: true });
      ws.addEventListener(
        "error",
        () => finish(new Error(`cannot connect to inspector ${this.wsUrl}`)),
        { once: true },
      );
      if (this.signal !== undefined) {
        if (this.signal.aborted) onAbort();
        else this.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    ws.addEventListener("message", (event) => this.onMessage(event));
    ws.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("inspector connection closed"));
      }
      this.pending.clear();
    });
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      pending.reject(
        new Error(
          `inspector ${pending.method}: ${message.error.message ?? JSON.stringify(message.error)}`,
        ),
      );
    } else {
      pending.resolve(message.result ?? {});
    }
  }

  send(method, params = {}) {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("inspector WebSocket is not open"));
    }
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `inspector ${method} timed out after ${this.requestTimeoutMs}ms`,
          ),
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async start() {
    await this.connect();
    await this.send("Profiler.enable");
    if (this.samplingIntervalUs > 0) {
      await this.send("Profiler.setSamplingInterval", {
        interval: this.samplingIntervalUs,
      });
    }
    await this.send("Profiler.start");
    this.started = true;
  }

  resolveProfilePath() {
    if (this.profilePath.toLowerCase().endsWith(".cpuprofile")) {
      return this.profilePath;
    }
    return path.join(
      this.profilePath,
      `api-${new Date().toISOString().replace(/[:.]/g, "-")}.cpuprofile`,
    );
  }

  async stop() {
    if (!this.started) throw new Error("inspector profiler was not started");
    const result = await this.send("Profiler.stop");
    const profile = result.profile;
    if (profile === undefined || profile === null) {
      throw new Error("inspector Profiler.stop returned no profile");
    }
    const file = this.resolveProfilePath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(profile)}\n`, "utf8");
    this.started = false;
    try {
      await this.send("Profiler.disable");
    } catch {
      // The profile is already written; a closing socket is harmless.
    }
    this.close();
    const info = await stat(file);
    return { path: file, bytes: info.size, mtimeMs: info.mtimeMs };
  }

  close() {
    if (this.ws !== null) {
      try {
        this.ws.close();
      } catch {
        // Already closed.
      }
      this.ws = null;
    }
  }

  async abort() {
    this.close();
    await delay(0);
  }
}
