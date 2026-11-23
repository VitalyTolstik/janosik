// TASK-200.1 — optional API-process probe.
//
// Load it explicitly when starting the API on a dedicated perf host:
//
//   PERF_API_PROBE_FILE=/tmp/janosik-api-probe.jsonl \
//   PERF_API_PROBE_INTERVAL_MS=1000 \
//   node --import ./scripts/perf/api-preload.mjs backend/dist/main.js
//
// It only observes `process.memoryUsage()` and `monitorEventLoopDelay`; it
// does not touch product code or add an endpoint. Without
// `PERF_API_PROBE_FILE` the module is a no-op.

import { appendFileSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";

const file = process.env.PERF_API_PROBE_FILE;
const interval = Math.max(
  100,
  Number(process.env.PERF_API_PROBE_INTERVAL_MS ?? 1_000) || 1_000,
);

if (file !== undefined && file !== "") {
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  let first = true;
  const tick = () => {
    const memory = process.memoryUsage();
    const lag = first ? 0 : histogram.percentile(95) / 1e6;
    const max = first ? 0 : histogram.max / 1e6;
    first = false;
    histogram.reset();
    const line = JSON.stringify({
      ts: Date.now(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      eventLoopLagMs: Math.round(lag * 1_000) / 1_000,
      eventLoopLagMaxMs: Math.round(max * 1_000) / 1_000,
    });
    try {
      appendFileSync(file, `${line}\n`);
    } catch {
      // The harness must never take the API down because a probe file is gone.
    }
  };
  tick();
  const timer = setInterval(tick, interval);
  timer.unref();
}
