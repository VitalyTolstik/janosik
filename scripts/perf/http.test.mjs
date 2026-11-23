import assert from "node:assert/strict";
import test from "node:test";
import { HttpClient } from "./lib/http.mjs";
import { RunMetrics } from "./lib/metrics.mjs";

test("readBoard ignores a null x-board-seq header instead of turning it into 0", async () => {
  const client = new HttpClient({
    baseUrl: "http://example.test/api/v1",
    token: "",
    metrics: new RunMetrics("bootstrap"),
    fetchImpl: async () =>
      new Response(JSON.stringify({ id: "b1", seq: 7, columns: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  const result = await client.readBoard("b1");
  assert.equal(result.seq, 7);
});

test("an external abort cancels an in-flight request and is not a network error", async () => {
  const metrics = new RunMetrics("abort");
  const controller = new AbortController();
  const client = new HttpClient({
    baseUrl: "http://example.test/api/v1",
    token: "",
    metrics,
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      }),
  });
  const pending = client.request("board.read", "/boards/b1", {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending);
  const snapshot = metrics.snapshot({ durationMs: 1_000, agents: 1 });
  assert.equal(snapshot.requests, 1);
  assert.equal(snapshot.errors.aborted, 1);
  assert.equal(snapshot.errors.network, 0);
});

test("a per-request timeout is counted as a network failure", async () => {
  const metrics = new RunMetrics("timeout");
  const client = new HttpClient({
    baseUrl: "http://example.test/api/v1",
    token: "",
    metrics,
    timeoutMs: 10,
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("timed out");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      }),
  });
  await assert.rejects(client.request("board.read", "/boards/b1"));
  const snapshot = metrics.snapshot({ durationMs: 1_000, agents: 1 });
  assert.equal(snapshot.errors.network, 1);
  assert.equal(snapshot.errors.aborted, 0);
});
