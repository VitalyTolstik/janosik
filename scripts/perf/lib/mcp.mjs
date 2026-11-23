// TASK-200.1 — real MCP stdio driver.
//
// The harness spawns N real `janosik-mcp` processes and runs the documented
// `ready → claim → comment → move` sequence through the MCP client SDK. It
// reuses the same scenarios, metrics and action accounting as the HTTP
// driver; only the transport changes. This is for a small smoke run by
// default — a 500-process MCP swarm is a host-capacity experiment, not a CI
// job.

import path from "node:path";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { jitteredDelay, isAuthError } from "./agent.mjs";
import { sleep } from "./http.mjs";
import { parseProcStatus } from "./probes.mjs";

export class McpToolError extends Error {
  constructor({ name, message, status = null, code = null, structured }) {
    super(`${name}: ${message}`);
    this.name = "McpToolError";
    this.status = status;
    this.code = code;
    this.structured = structured;
  }
}

export function mcpOrigin(baseUrl) {
  return new URL(baseUrl).origin;
}

function resultPayload(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function errorMessage(result) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text === "string" && text !== "") return text;
  return result.structuredContent?.message ?? "MCP tool failed";
}

function errorStatus(error, structured, signal) {
  if (Number.isInteger(structured?.status)) return structured.status;
  if (Number.isInteger(error?.status)) return error.status;
  if (
    signal?.aborted === true ||
    error?.name === "AbortError" ||
    error?.code === "ABORT_ERR"
  ) {
    return -1;
  }
  if (
    structured?.code === "network_error" ||
    /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket|timed out|timeout/i.test(
      String(error?.message ?? ""),
    )
  ) {
    return 0;
  }
  return 400;
}

/** One spawned MCP process plus its measured tool-call client. */
export async function createMcpWorker({
  baseUrl,
  token,
  boardId,
  cwd = process.cwd(),
  command = path.join(cwd, "node_modules", ".bin", "tsx"),
  args = [path.join(cwd, "mcp", "src", "index.ts")],
  requestTimeoutMs = 60_000,
  connectTimeoutMs = 15_000,
  closeTimeoutMs = 2_000,
  signal,
  metrics,
  log = () => {},
}) {
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env: {
      ...getDefaultEnvironment(),
      JANOSIK_URL: mcpOrigin(baseUrl),
      JANOSIK_TOKEN: token,
    },
    stderr: "pipe",
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => {
    if (stderr.length < 20) stderr.push(String(chunk).trim());
  });
  const client = new Client({ name: "janosik-perf", version: "0.1.0" });

  const killChild = (pid = transport.pid) => {
    if (pid === null || pid === undefined) return;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
    const timer = setTimeout(() => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, 500);
    timer.unref?.();
  };
  const dispose = () => {
    const pid = transport.pid;
    try {
      client.close().catch(() => {});
    } catch {
      // Not connected yet.
    }
    try {
      transport.close().catch(() => {});
    } catch {
      // Already closed.
    }
    killChild(pid);
  };

  let timer;
  let onAbort;
  const connectPromise = client.connect(transport);
  connectPromise.catch(() => {});
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `MCP handshake timed out after ${connectTimeoutMs}ms (${command})`,
        ),
      );
    }, connectTimeoutMs);
    if (signal !== undefined) {
      onAbort = () =>
        reject(new Error("MCP handshake aborted by scenario signal"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  try {
    await Promise.race([connectPromise, timeout]);
  } catch (error) {
    const pid = transport.pid;
    dispose();
    const wrapped = new Error(
      `MCP process failed to start: ${error instanceof Error ? error.message : String(error)}\n${stderr.join("\n")}`,
      { cause: error },
    );
    wrapped.pid = pid;
    throw wrapped;
  } finally {
    clearTimeout(timer);
    if (signal !== undefined && onAbort !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
  }
  const pid = transport.pid;
  let peakRssBytes = null;
  let peakVmHwmBytes = null;
  log(`  MCP pid ${pid ?? "?"} board ${boardId}`);

  const worker = {
    pid,
    sampleRss() {
      if (pid === null || pid === undefined) return;
      try {
        const status = parseProcStatus(
          readFileSync(`/proc/${pid}/status`, "utf8"),
        );
        if (status?.rssBytes !== null && status?.rssBytes !== undefined) {
          peakRssBytes = Math.max(peakRssBytes ?? 0, status.rssBytes);
        }
        if (
          status?.peakRssBytes !== null &&
          status?.peakRssBytes !== undefined
        ) {
          peakVmHwmBytes = Math.max(peakVmHwmBytes ?? 0, status.peakRssBytes);
        }
      } catch {
        // Non-Linux hosts simply report no RSS.
      }
    },
    async call(name, args, { signal } = {}) {
      const started = performance.now();
      let result;
      try {
        result = await client.callTool({ name, arguments: args }, undefined, {
          signal,
          timeout: requestTimeoutMs,
        });
      } catch (error) {
        const elapsed = performance.now() - started;
        const status = errorStatus(error, null, signal);
        metrics?.recordRequest(`mcp.${name}`, elapsed, status);
        metrics?.recordTool(name, elapsed);
        throw new McpToolError({
          name,
          message: error instanceof Error ? error.message : String(error),
          status,
          code: error?.code ?? null,
        });
      }
      const elapsed = performance.now() - started;
      if (result.isError === true) {
        const structured = result.structuredContent ?? {};
        const status = errorStatus(null, structured, signal);
        const expectedLeaseConflict =
          status === 400 &&
          structured.field === "action.claimedBy" &&
          /claimed by another|live claim|lease/i.test(
            String(structured.message ?? ""),
          );
        metrics?.recordRequest(`mcp.${name}`, elapsed, status, 0, {
          expected: expectedLeaseConflict,
        });
        metrics?.recordTool(name, elapsed);
        throw new McpToolError({
          name,
          message: errorMessage(result),
          status,
          code: structured.code ?? null,
          structured,
        });
      }
      metrics?.recordRequest(`mcp.${name}`, elapsed, 200);
      metrics?.recordTool(name, elapsed);
      return resultPayload(result);
    },
    rssSummary() {
      return { pid, peakRssBytes, peakVmHwmBytes };
    },
    async close() {
      const pid = transport.pid;
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, closeTimeoutMs);
      });
      await Promise.race([
        Promise.allSettled([
          Promise.resolve()
            .then(() => client.close())
            .catch(() => {}),
          Promise.resolve()
            .then(() => transport.close())
            .catch(() => {}),
        ]),
        timeout,
      ]);
      clearTimeout(timer);
      killChild(pid);
    },
  };
  worker.sampleRss();
  return worker;
}

function toolStatusError(error) {
  if (error instanceof McpToolError) {
    return Number.isInteger(error.status) ? error.status : 0;
  }
  return 0;
}

function mcpLeaseConflict(error) {
  return (
    toolStatusError(error) === 400 &&
    error?.structured?.field === "action.claimedBy"
  );
}

async function releaseViaMcp(worker, boardId, cardId) {
  try {
    await worker.call("janosik_release_card", { boardId, cardId });
    return true;
  } catch {
    return false;
  }
}

/**
 * `ready → claim → comment → move` until the deadline. A tool error is data:
 * the loop records it, releases a stranded claim when possible and retries.
 */
export async function runMcpAgentLoop({
  worker,
  boardId,
  agentIndex = 0,
  mode = "work",
  config,
  deadline,
  signal,
  metrics,
  random,
  startDelayMs = 0,
  startAt = undefined,
  onError,
  onNoWork,
}) {
  if (startAt !== undefined) {
    const wait = startAt - Date.now();
    if (wait > 0) await sleep(wait, signal);
  } else if (startDelayMs > 0) {
    await sleep(startDelayMs, signal);
  }
  while (!signal.aborted && Date.now() < deadline) {
    const cycleStarted = Date.now();
    worker.sampleRss();
    try {
      if (mode === "idle") {
        await worker.call(
          "janosik_list_ready_cards",
          { boardId, limit: 5, response_format: "json" },
          { signal },
        );
      } else {
        const ready = await worker.call(
          "janosik_list_ready_cards",
          { boardId, limit: 5, response_format: "json" },
          { signal },
        );
        const cards = Array.isArray(ready.results) ? ready.results : [];
        if (cards.length === 0) {
          const recycled = (await onNoWork?.(null)) === true;
          if (recycled) continue;
          metrics?.recordNoWork({ exhausted: false, stranded: true });
        } else {
          const cardId = cards[0].id;
          // The workflow payload carries the done column id, the column list
          // and the board seq without dumping the whole board through a
          // response-size-limited tool result.
          const workflow = await worker.call(
            "janosik_get_workflow",
            { boardId, response_format: "json" },
            { signal },
          );
          const doneColumnId = Array.isArray(workflow.doneColumnIds)
            ? workflow.doneColumnIds[0]
            : null;
          if (doneColumnId === null || doneColumnId === undefined) break;
          try {
            await worker.call(
              "janosik_claim_card",
              {
                boardId,
                cardId,
                leaseMs: config.leaseMs,
                expectedVersion: workflow.seq,
              },
              { signal },
            );
          } catch (error) {
            if (mcpLeaseConflict(error) || toolStatusError(error) === 409) {
              continue;
            }
            if (toolStatusError(error) === 0) {
              const released = await releaseViaMcp(worker, boardId, cardId);
              onError?.({
                agentIndex,
                boardId,
                error,
                fatal: false,
                orphan: !released,
              });
              continue;
            }
            throw error;
          }
          metrics?.recordAction(1, "write");
          try {
            await worker.call(
              "janosik_add_comment",
              {
                cardId,
                text: `TASK-200.1 MCP probe (${config.id})`,
                kind: "note",
              },
              { signal },
            );
          } catch (error) {
            const released = await releaseViaMcp(worker, boardId, cardId);
            const fatal = isAuthError(error);
            onError?.({
              agentIndex,
              boardId,
              error,
              fatal,
              orphan: !released,
            });
            if (fatal) return;
            continue;
          }
          metrics?.recordAction(1, "comment");
          try {
            await worker.call(
              "janosik_move_card",
              {
                boardId,
                cardId,
                toColumnId: doneColumnId,
              },
              { signal },
            );
          } catch (error) {
            const released = await releaseViaMcp(worker, boardId, cardId);
            const fatal = isAuthError(error);
            onError?.({
              agentIndex,
              boardId,
              error,
              fatal,
              orphan: !released,
            });
            if (fatal) return;
            continue;
          }
          metrics?.recordAction(1, "write");
          metrics?.recordCycle();
        }
      }
    } catch (error) {
      const fatal = isAuthError(error);
      onError?.({ agentIndex, boardId, error, fatal });
      if (fatal) return;
    }
    worker.sampleRss();
    const delay = jitteredDelay(config.cadenceMs, config.jitter ?? 0, random);
    const elapsed = Date.now() - cycleStarted;
    if (elapsed < delay) await sleep(delay - elapsed, signal);
  }
}

/** Aggregate the per-process RSS summary for the report. */
export function summarizeMcpWorkers(workers) {
  const processes = workers.map((worker) => worker.rssSummary());
  const values = processes
    .map((entry) => entry.peakRssBytes)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const lifetime = processes
    .map((entry) => entry.peakVmHwmBytes)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  return {
    processes: processes.length,
    pids: processes.map((entry) => entry.pid).filter((pid) => pid != null),
    peakRssBytes: values.length > 0 ? Math.max(...values) : null,
    peakVmHwmBytes: lifetime.length > 0 ? Math.max(...lifetime) : null,
    totalPeakRssBytes:
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null,
  };
}
