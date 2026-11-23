// TASK-200.1 — request/action metrics and percentile helpers.
//
// Everything here is pure or only depends on values passed in, so the
// definitions of p50/p95/p99, error rates and req/agent/min are unit-tested
// instead of being re-derived in the report.

/** Linear-interpolated percentile (p in 0…100). `null` for an empty set. */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(100, Math.max(0, p));
  if (sorted.length === 1) return sorted[0];
  const rank = (clamped / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

/** Compact stats block used for latency and system samples. */
export function summarizeNumbers(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      count: 0,
      min: null,
      avg: null,
      max: null,
      p50: null,
      p95: null,
      p99: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: round(sorted[0], 3),
    avg: round(sum / sorted.length, 3),
    max: round(sorted[sorted.length - 1], 3),
    p50: round(percentile(sorted, 50), 3),
    p95: round(percentile(sorted, 95), 3),
    p99: round(percentile(sorted, 99), 3),
  };
}

function round(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function actionsPerSecond(actions, durationMs) {
  if (!Number.isFinite(actions) || !Number.isFinite(durationMs)) return null;
  if (durationMs <= 0) return null;
  return round((actions / durationMs) * 1_000, 3);
}

export function requestsPerAgentPerMinute(requests, agents, durationMs) {
  if (!Number.isFinite(requests) || !Number.isFinite(agents)) return null;
  if (agents <= 0 || durationMs <= 0) return null;
  return round(requests / agents / (durationMs / 60_000), 3);
}

function numericStatus(status) {
  return Number.isInteger(status) ? status : null;
}

/**
 * Per-scenario metrics collector. Requests are recorded once (including
 * network failures, which use status 0) so rates stay honest even when the
 * generator itself starts failing.
 */
export class RunMetrics {
  constructor(id) {
    this.id = id;
    this.requests = 0;
    this.bytes = 0;
    this.actions = 0;
    this.cycles = 0;
    this.durations = [];
    this.operations = new Map();
    this.statuses = new Map();
    this.sse = {
      opened: 0,
      closed: 0,
      failed: 0,
      current: 0,
      maxConcurrent: 0,
      frames: 0,
      bytes: 0,
    };
  }

  operation(name) {
    let entry = this.operations.get(name);
    if (entry === undefined) {
      entry = { durations: [], statuses: new Map() };
      this.operations.set(name, entry);
    }
    return entry;
  }

  /** `status` 0 means the request never produced an HTTP answer. */
  recordRequest(name, durationMs, status, bytes = 0) {
    const entry = this.operation(name);
    const duration = Number.isFinite(durationMs) ? durationMs : 0;
    entry.durations.push(duration);
    this.durations.push(duration);
    this.requests += 1;
    if (Number.isFinite(bytes) && bytes > 0) {
      this.bytes += bytes;
      entry.bytes = (entry.bytes ?? 0) + bytes;
    }
    const key = numericStatus(status) ?? 0;
    entry.statuses.set(key, (entry.statuses.get(key) ?? 0) + 1);
    this.statuses.set(key, (this.statuses.get(key) ?? 0) + 1);
  }

  recordAction(count = 1) {
    this.actions += count;
  }

  recordCycle() {
    this.cycles += 1;
  }

  recordSseOpen(durationMs, status) {
    this.recordRequest("sse.open", durationMs, status);
    if (status >= 200 && status < 300) {
      this.sse.opened += 1;
      this.sse.current += 1;
      this.sse.maxConcurrent = Math.max(
        this.sse.maxConcurrent,
        this.sse.current,
      );
      return true;
    }
    this.sse.failed += 1;
    return false;
  }

  recordSseClose() {
    this.sse.closed += 1;
    this.sse.current = Math.max(0, this.sse.current - 1);
  }

  recordSseFrame(bytes) {
    this.sse.frames += 1;
    this.recordSseBytes(bytes);
  }

  recordSseBytes(bytes) {
    if (Number.isFinite(bytes) && bytes > 0) this.sse.bytes += bytes;
  }

  /** Build the immutable scenario summary consumed by the report. */
  snapshot({ durationMs, agents = 0 } = {}) {
    const operations = {};
    for (const [name, entry] of [...this.operations.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      operations[name] = {
        requests: entry.durations.length,
        bytes: entry.bytes ?? 0,
        latency: summarizeNumbers(entry.durations),
        statuses: sortedStatuses(entry.statuses),
      };
    }
    const statuses = sortedStatuses(this.statuses);
    const counts = statusCounts(statuses);
    const totalErrors = counts.client4xx + counts.server5xx + counts.network;
    return {
      id: this.id,
      durationMs,
      agents,
      requests: this.requests,
      bytes: this.bytes,
      actions: this.actions,
      cycles: this.cycles,
      actionsPerSecond: actionsPerSecond(this.actions, durationMs),
      requestsPerAgentPerMinute: requestsPerAgentPerMinute(
        this.requests,
        agents,
        durationMs,
      ),
      bytesPerRequest:
        this.requests > 0 ? round(this.bytes / this.requests, 1) : null,
      statuses,
      errors: {
        total: totalErrors,
        rate: this.requests > 0 ? round(totalErrors / this.requests, 5) : 0,
        client4xx: counts.client4xx,
        server5xx: counts.server5xx,
        network: counts.network,
        conflict409: statuses["409"] ?? 0,
        rateLimited429: statuses["429"] ?? 0,
      },
      latency: summarizeNumbers(this.durations),
      operations,
      sse: { ...this.sse },
    };
  }
}

function sortedStatuses(map) {
  const output = {};
  for (const key of [...map.keys()].sort((a, b) => a - b)) {
    output[String(key)] = map.get(key);
  }
  return output;
}

export function statusCounts(statuses) {
  let client4xx = 0;
  let server5xx = 0;
  let network = 0;
  for (const [key, count] of Object.entries(statuses)) {
    const status = Number(key);
    if (status === 0) network += count;
    else if (status >= 500) server5xx += count;
    else if (status >= 400) client4xx += count;
  }
  return { client4xx, server5xx, network };
}
