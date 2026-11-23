// TASK-200.1 — API/generator probes.
//
// The API process is sampled in one of two ways:
//   * `--api-pid` reads `/proc/<pid>/status` (RSS/threads) on Linux;
//   * `--api-probe` tails JSONL written by `api-preload.mjs`, which also has
//     heap and event-loop lag because it runs inside the API process.
// The generator's own RSS/heap/event-loop lag is sampled in-process.

import { readFileSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { summarizeNumbers } from "./metrics.mjs";

/** Parse `/proc/<pid>/status`; returns null fields when unavailable. */
export function parseProcStatus(text) {
  if (typeof text !== "string" || text === "") return null;
  const field = (name) => {
    const match = new RegExp(`^${name}:\\s+(\\d+)`, "m").exec(text);
    return match ? Number(match[1]) : null;
  };
  const vmRssKb = field("VmRSS");
  const vmHwmKb = field("VmHWM");
  const threads = field("Threads");
  return {
    rssBytes: vmRssKb === null ? null : vmRssKb * 1024,
    peakRssBytes: vmHwmKb === null ? null : vmHwmKb * 1024,
    threads,
  };
}

/** Parse one JSONL line written by `api-preload.mjs`. */
export function parseProbeLine(line) {
  const trimmed = String(line).trim();
  if (trimmed === "") return null;
  let value;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const ts = Number(value.ts);
  return {
    ts: Number.isFinite(ts) ? ts : Date.now(),
    rssBytes: finite(value.rssBytes),
    heapUsedBytes: finite(value.heapUsedBytes),
    heapTotalBytes: finite(value.heapTotalBytes),
    externalBytes: finite(value.externalBytes),
    eventLoopLagMs: finite(value.eventLoopLagMs),
  };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Sample the API and the generator while a scenario runs.
 *
 * `readProc`/`readText` are injectable for tests. `poll()` is public so a test
 * (or a script) can take a deterministic sample without waiting for a timer.
 */
export class RuntimeSampler {
  constructor({
    apiPid = null,
    apiProbeFile = null,
    intervalMs = 1_000,
    readProc = (pid) =>
      parseProcStatus(readFileSync(`/proc/${pid}/status`, "utf8")),
    readText = (file) => readFileSync(file, "utf8"),
    now = () => Date.now(),
  } = {}) {
    this.apiPid = apiPid;
    this.apiProbeFile = apiProbeFile;
    this.intervalMs = intervalMs;
    this.readProc = readProc;
    this.readText = readText;
    this.now = now;
    this.samples = [];
    this.probeOffset = 0;
    this.probeLines = 0;
    this.errors = [];
    this.timer = null;
    this.loopDelay = monitorEventLoopDelay({ resolution: 5 });
    this.loopDelay.enable();
    this.firstSample = true;
  }

  start() {
    if (this.timer !== null) return this;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.loopDelay.disable();
  }

  poll() {
    const ts = this.now();
    const memory = process.memoryUsage();
    const generator = {
      ts,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      eventLoopLagMs: this.firstSample
        ? 0
        : round(this.loopDelay.percentile(95) / 1e6),
    };
    this.firstSample = false;
    this.loopDelay.reset();
    this.samples.push({ ts, source: "generator", ...generator });

    if (this.apiPid !== null) this.pollProc(ts);
    if (this.apiProbeFile !== null) this.pollProbeFile();
  }

  pollProc(ts) {
    try {
      const status = this.readProc(this.apiPid);
      if (status === null) return;
      this.samples.push({
        ts,
        source: "api-proc",
        rssBytes: status.rssBytes,
        peakRssBytes: status.peakRssBytes,
        threads: status.threads,
      });
    } catch (error) {
      this.recordError("api-proc", error);
    }
  }

  pollProbeFile() {
    try {
      const text = this.readText(this.apiProbeFile);
      if (text.length < this.probeOffset) this.probeOffset = 0;
      const chunk = text.slice(this.probeOffset);
      this.probeOffset = text.length;
      if (chunk === "") return;
      for (const line of chunk.split(/\r?\n/)) {
        const parsed = parseProbeLine(line);
        if (parsed === null) continue;
        this.probeLines += 1;
        this.samples.push({ source: "api-preload", ...parsed });
      }
    } catch (error) {
      this.recordError("api-preload", error);
    }
  }

  recordError(source, error) {
    if (this.errors.length >= 5) return;
    this.errors.push({
      source,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  samplesSince(from, to) {
    return this.samples.filter(
      (sample) => sample.ts >= from && sample.ts <= to,
    );
  }

  /** Aggregate only the sources that produced samples in this window. */
  summarize(from, to) {
    const samples = this.samplesSince(from, to);
    const generator = samples.filter((sample) => sample.source === "generator");
    const preload = samples.filter((sample) => sample.source === "api-preload");
    const proc = samples.filter((sample) => sample.source === "api-proc");
    const api = preload.length > 0 ? preload : proc;
    return {
      source:
        preload.length > 0
          ? "api-preload"
          : proc.length > 0
            ? "api-proc"
            : "none",
      samples: api.length,
      api: {
        rss: summarizeField(api, "rssBytes"),
        peakRss: summarizeField(api, "peakRssBytes"),
        heapUsed: summarizeField(api, "heapUsedBytes"),
        heapTotal: summarizeField(api, "heapTotalBytes"),
        eventLoopLag: summarizeField(api, "eventLoopLagMs"),
        threads: summarizeField(api, "threads"),
      },
      generator: {
        rss: summarizeField(generator, "rssBytes"),
        heapUsed: summarizeField(generator, "heapUsedBytes"),
        eventLoopLag: summarizeField(generator, "eventLoopLagMs"),
      },
      errors: this.errors,
    };
  }
}

export function summarizeField(samples, key) {
  const values = samples
    .map((sample) => sample[key])
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  return summarizeNumbers(values);
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}
