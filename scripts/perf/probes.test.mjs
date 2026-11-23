import assert from "node:assert/strict";
import test from "node:test";
import {
  RuntimeSampler,
  parseProbeLine,
  parseProcStatus,
  summarizeField,
} from "./lib/probes.mjs";

test("parseProcStatus reads VmRSS/VmHWM/Threads in bytes", () => {
  const text = [
    "Name:\tnode",
    "VmPeak:\t 1500000 kB",
    "VmHWM:\t  204800 kB",
    "VmRSS:\t  102400 kB",
    "Threads:\t12",
  ].join("\n");
  assert.deepEqual(parseProcStatus(text), {
    rssBytes: 102_400 * 1024,
    peakRssBytes: 204_800 * 1024,
    threads: 12,
  });
  assert.equal(parseProcStatus(""), null);
});

test("parseProbeLine parses preload JSONL and ignores garbage", () => {
  const parsed = parseProbeLine(
    JSON.stringify({
      ts: 1_700_000_000_000,
      rssBytes: 123,
      heapUsedBytes: 100,
      heapTotalBytes: 200,
      externalBytes: 3,
      eventLoopLagMs: 4.5,
    }),
  );
  assert.equal(parsed.ts, 1_700_000_000_000);
  assert.equal(parsed.rssBytes, 123);
  assert.equal(parsed.eventLoopLagMs, 4.5);
  assert.equal(parseProbeLine("not json"), null);
  assert.equal(parseProbeLine(""), null);
});

test("summary field ignores nulls and computes p95", () => {
  const samples = [{ rss: null }, { rss: 100 }, { rss: 200 }, { rss: 300 }];
  const summary = summarizeField(samples, "rss");
  assert.equal(summary.count, 3);
  assert.equal(summary.max, 300);
  assert.equal(Math.round(summary.p95), 290);
});

test("RuntimeSampler reads proc and probe-file samples with injected IO", () => {
  let probe = "";
  let now = 1_000;
  const sampler = new RuntimeSampler({
    apiPid: 42,
    apiProbeFile: "/tmp/probe.jsonl",
    now: () => now,
    readProc: () => ({
      rssBytes: 1_000,
      peakRssBytes: 2_000,
      threads: 3,
    }),
    readText: () => probe,
  });
  sampler.poll();
  probe = `${JSON.stringify({
    ts: 1_000,
    rssBytes: 5_000,
    heapUsedBytes: 4_000,
    eventLoopLagMs: 7,
  })}\n`;
  now = 2_000;
  sampler.poll();
  now = 3_000;
  sampler.poll();
  const summary = sampler.summarize(1_000, 3_000);
  assert.equal(summary.source, "api-preload");
  assert.equal(summary.api.rss.p95, 5_000);
  assert.equal(summary.api.heapUsed.p95, 4_000);
  assert.equal(summary.api.eventLoopLag.p95, 7);
  assert.equal(summary.samples, 1);
  assert.equal(summary.generator.rss.count, 3);
  assert.equal(summary.errors.length, 0);
  sampler.stop();
});
