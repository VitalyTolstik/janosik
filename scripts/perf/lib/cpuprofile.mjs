// TASK-200.1 — turn a V8 `.cpuprofile` into a Top-10 self-time table.
//
// The API is profiled out of band (`node --cpu-prof --cpu-prof-dir …`); this
// module only reads the result. A directory is scanned for `.cpuprofile`
// files and the newest set is aggregated by function, so a rolling profile
// directory still produces one stable table.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

function profileFiles(directory) {
  return readdir(directory).then((entries) =>
    entries.filter((entry) => entry.endsWith(".cpuprofile")),
  );
}

async function listProfiles(target) {
  const info = await stat(target);
  if (info.isFile()) return [target];
  if (!info.isDirectory())
    throw new Error(`not a file or directory: ${target}`);
  const names = await profileFiles(target);
  if (names.length === 0) {
    throw new Error(`no .cpuprofile files in ${target}`);
  }
  return names.map((name) => path.join(target, name));
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

/** Count self samples for one profile. */
export function parseCpuProfile(profile, { file = null } = {}) {
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
  const sampleMs = samples.length > 0 ? totalMs / samples.length : totalMs;

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
  const byFunction = new Map();
  for (const [id, count] of hits) {
    const node = byId.get(id);
    if (node === undefined) continue;
    totalHits += count;
    const frame = node.callFrame ?? {};
    const key = frameKey(frame);
    const entry = byFunction.get(key) ?? {
      ...frameLabel(frame),
      hits: 0,
    };
    entry.hits += count;
    byFunction.set(key, entry);
  }

  const top = [...byFunction.values()]
    .map((entry) => ({
      function: entry.function,
      url: entry.url,
      line: entry.line,
      column: entry.column,
      selfMs:
        totalHits > 0
          ? Math.round((entry.hits / totalHits) * totalMs * 100) / 100
          : Math.round(entry.hits * sampleMs * 100) / 100,
      selfPct:
        totalHits > 0
          ? Math.round((entry.hits / totalHits) * 10000) / 100
          : null,
    }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 10);

  return {
    file,
    totalMs: Math.round(totalMs * 100) / 100,
    samples: totalHits,
    top,
  };
}

/** Parse one file or every `.cpuprofile` in a directory, aggregated. */
export async function collectCpuProfile(target) {
  if (target === undefined || target === null || target === "") {
    return { enabled: false };
  }
  try {
    const files = await listProfiles(target);
    const profiles = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      profiles.push({
        file: path.basename(file),
        ...parseCpuProfile(JSON.parse(text), { file: path.basename(file) }),
      });
    }
    const totalMs = profiles.reduce((sum, item) => sum + item.totalMs, 0);
    const aggregate = new Map();
    for (const profile of profiles) {
      for (const entry of profile.top) {
        const key = `${entry.function}\u0000${entry.url}\u0000${entry.line ?? ""}`;
        const current = aggregate.get(key) ?? { ...entry, selfMs: 0 };
        current.selfMs += entry.selfMs;
        aggregate.set(key, current);
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
      files: profiles.map((profile) => profile.file),
      totalMs: Math.round(totalMs * 100) / 100,
      samples: profiles.reduce((sum, profile) => sum + profile.samples, 0),
      top,
    };
  } catch (error) {
    return {
      enabled: true,
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
