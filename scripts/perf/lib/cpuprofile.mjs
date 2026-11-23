// TASK-200.1 — turn V8 `.cpuprofile` files into a Top-10 self-time table.
//
// The API is profiled out of band (`node --cpu-prof --cpu-prof-dir …`); this
// module only reads the result. A directory is scanned for the newest set of
// `.cpuprofile` files (within a short write window of the newest mtime), and
// every node is aggregated before the Top-10 is taken, so a function that is
// 11th in each of several files can still be a genuine hotspot.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Files written within this window of the newest mtime belong to one run. */
export const PROFILE_SET_WINDOW_MS = 60_000;

async function listProfileFiles(directory) {
  const names = (await readdir(directory)).filter((entry) =>
    entry.endsWith(".cpuprofile"),
  );
  const files = await Promise.all(
    names.map(async (name) => {
      const file = path.join(directory, name);
      const info = await stat(file);
      return { file, name, mtimeMs: info.mtimeMs };
    }),
  );
  return files;
}

async function selectProfileSet(target) {
  const info = await stat(target);
  if (info.isFile()) {
    return [
      { file: target, name: path.basename(target), mtimeMs: info.mtimeMs },
    ];
  }
  if (!info.isDirectory()) {
    throw new Error(`not a file or directory: ${target}`);
  }
  const files = await listProfileFiles(target);
  if (files.length === 0) {
    throw new Error(`no .cpuprofile files in ${target}`);
  }
  const newest = Math.max(...files.map((file) => file.mtimeMs));
  return files.filter((file) => file.mtimeMs >= newest - PROFILE_SET_WINDOW_MS);
}

function frameKey(frame) {
  const fn = frame?.functionName || "(anonymous)";
  const url = frame?.url || "(native)";
  const line = Number.isFinite(frame?.lineNumber) ? frame.lineNumber + 1 : null;
  const column = Number.isFinite(frame?.columnNumber)
    ? frame.columnNumber + 1
    : null;
  return `${fn}\u0000${url}\u0000${line ?? ""}\u0000${column ?? ""}`;
}

function frameLabel(frame) {
  return {
    function: frame?.functionName || "(anonymous)",
    url: frame?.url || "(native)",
    line: Number.isFinite(frame?.lineNumber) ? frame.lineNumber + 1 : null,
    column: Number.isFinite(frame?.columnNumber)
      ? frame.columnNumber + 1
      : null,
  };
}

/** All self samples for one profile, before any Top-10 truncation. */
function analyzeProfile(profile, { file = null } = {}) {
  const nodes = Array.isArray(profile?.nodes) ? profile.nodes : [];
  const samples = Array.isArray(profile?.samples) ? profile.samples : [];
  const deltas = Array.isArray(profile?.timeDeltas) ? profile.timeDeltas : [];
  const start = Number(profile?.startTime);
  const end = Number(profile?.endTime);
  const totalMs =
    Number.isFinite(start) && Number.isFinite(end) && end > start
      ? (end - start) / 1_000
      : deltas.length > 0
        ? deltas.reduce((sum, value) => sum + (Number(value) || 0), 0) / 1_000
        : 0;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const hits = new Map();
  if (samples.length > 0) {
    for (const id of samples) {
      hits.set(id, (hits.get(id) ?? 0) + 1);
    }
  } else {
    for (const node of nodes) {
      if (Number.isFinite(node.hitCount) && node.hitCount > 0) {
        hits.set(node.id, node.hitCount);
      }
    }
  }

  let totalHits = 0;
  const entries = [];
  for (const [id, count] of hits) {
    const node = byId.get(id);
    if (node === undefined) continue;
    totalHits += count;
    entries.push({
      key: frameKey(node.callFrame ?? {}),
      ...frameLabel(node.callFrame ?? {}),
      hits: count,
    });
  }
  return { file, totalMs, totalHits, entries };
}

function selfMs(entry, totalHits, totalMs) {
  return totalHits > 0 ? (entry.hits / totalHits) * totalMs : 0;
}

/** Count self samples for one profile, already Top-10. */
export function parseCpuProfile(profile, { file = null } = {}) {
  const analyzed = analyzeProfile(profile, { file });
  const top = analyzed.entries
    .map((entry) => ({
      function: entry.function,
      url: entry.url,
      line: entry.line,
      column: entry.column,
      selfMs:
        Math.round(selfMs(entry, analyzed.totalHits, analyzed.totalMs) * 100) /
        100,
      selfPct:
        analyzed.totalMs > 0
          ? Math.round(
              (selfMs(entry, analyzed.totalHits, analyzed.totalMs) /
                analyzed.totalMs) *
                10000,
            ) / 100
          : null,
    }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 10);
  return {
    file,
    totalMs: Math.round(analyzed.totalMs * 100) / 100,
    samples: analyzed.totalHits,
    top,
  };
}

/** Parse the newest set of profiles, aggregating every node before Top-10. */
export async function collectCpuProfile(target, { freshSince = null } = {}) {
  if (target === undefined || target === null || target === "") {
    return { enabled: false };
  }
  try {
    const files = await selectProfileSet(target);
    if (
      Number.isFinite(freshSince) &&
      files.every((file) => file.mtimeMs < freshSince - 1_000)
    ) {
      return {
        enabled: true,
        available: false,
        reason: `cpu profile is stale (older than this run): ${target}`,
      };
    }
    const aggregate = new Map();
    let totalMs = 0;
    let totalSamples = 0;
    for (const file of files) {
      const text = await readFile(file.file, "utf8");
      const analyzed = analyzeProfile(JSON.parse(text), {
        file: file.name,
      });
      totalMs += analyzed.totalMs;
      totalSamples += analyzed.totalHits;
      for (const entry of analyzed.entries) {
        const current = aggregate.get(entry.key) ?? {
          ...entry,
          selfMs: 0,
        };
        current.selfMs += selfMs(entry, analyzed.totalHits, analyzed.totalMs);
        aggregate.set(entry.key, current);
      }
    }
    const top = [...aggregate.values()]
      .map((entry) => ({
        function: entry.function,
        url: entry.url,
        line: entry.line,
        column: entry.column,
        selfMs: Math.round(entry.selfMs * 100) / 100,
        selfPct:
          totalMs > 0
            ? Math.round((entry.selfMs / totalMs) * 10000) / 100
            : null,
      }))
      .sort((a, b) => b.selfMs - a.selfMs)
      .slice(0, 10);
    return {
      enabled: true,
      available: true,
      files: files.map((file) => file.name),
      newestWindowMs: PROFILE_SET_WINDOW_MS,
      totalMs: Math.round(totalMs * 100) / 100,
      samples: totalSamples,
      top,
    };
  } catch (error) {
    return {
      enabled: true,
      available: false,
      reason:
        error?.code === "ENOENT"
          ? `cpu profile path does not exist: ${target}`
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
}
