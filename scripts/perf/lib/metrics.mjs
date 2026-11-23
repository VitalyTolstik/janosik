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

export function statusCounts(statuses) {
  let success2xx = 0;
  let client4xx = 0;
  let server5xx = 0;
  let network = 0;
  let aborted = 0;
  let auth401403 = 0;
  let badRequest400 = 0;
  for (const [key, count] of Object.entries(statuses)) {
    const status = Number(key);
    if (status >= 200 && status < 300) success2xx += count;
    else if (status === 0) network += count;
    else if (status === -1) aborted += count;
    else if (status >= 500) server5xx += count;
    else if (status >= 400) {
      client4xx += count;
      if (status === 400) badRequest400 += count;
      if (status === 401 || status === 403) auth401403 += count;
    }
  }
  return {
    success2xx,
    client4xx,
    server5xx,
    network,
    aborted,
    auth401403,
    badRequest400,
  };
}

function rate(count, requests) {
  return requests > 0 ? round(count / requests, 5) : 0;
}

/**
 * Per-scenario metrics collector. Requests are recorded once (including
 * network failures, which use status 0, and deadline aborts, which use -1) so
 * rates stay honest even when the generator itself starts failing.
 */
export class RunMetrics {
  constructor(id) {
    this.id = id;
    this.requests = 0;
    this.bytes = 0;
    this.actions = 0;
    this.cycles = 0;
    this.noWork = 0;
    this.exhausted = 0;
    this.stranded = 0;
    this.recycled = 0;
    this.orphans = 0;
    this.expectedExtra = 0;
    this.readyFallback404 = 0;
    this.durations = [];
    this.operations = new Map();
    this.statuses = new Map();
    this.activity = { reads: 0, writes: 0, comments: 0 };
    this.agentActions = new Map();
    this.toolCalls = 0;
    this.tools = new Map();
    this.sse = {
      opened: 0,
      closed: 0,
      closedEarly: 0,
      failed: 0,
      readErrors: 0,
      current: 0,
      maxConcurrent: 0,
      liveAtHoldStart: null,
      liveAtHoldEnd: null,
      frames: 0,
      bytes: 0,
      rampObservedMs: null,
      holdObservedMs: null,
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

  /** `status` 0 means no HTTP answer; `-1` means a deadline abort. */
  recordRequest(
    name,
    durationMs,
    status,
    bytes = 0,
    { expected = false, readyFallback = false } = {},
  ) {
    if (expected) this.expectedExtra += 1;
    if (readyFallback) this.readyFallback404 += 1;
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

  recordAction(count = 1, kind = null) {
    this.actions += count;
    void kind;
  }

  recordActivity(kind) {
    const key =
      kind === "read"
        ? "reads"
        : kind === "write"
          ? "writes"
          : kind === "comment"
            ? "comments"
            : null;
    if (key !== null) this.activity[key] += 1;
  }

  recordAgentAction(agentIndex, at = Date.now()) {
    const key = Number.isInteger(agentIndex) ? agentIndex : 0;
    const entry = this.agentActions.get(key) ?? {
      count: 0,
      firstAt: at,
      lastAt: at,
    };
    entry.count += 1;
    entry.lastAt = at;
    this.agentActions.set(key, entry);
  }

  recordCycle() {
    this.cycles += 1;
  }

  recordNoWork({ exhausted = false, stranded = false } = {}) {
    this.noWork += 1;
    if (exhausted) this.exhausted += 1;
    if (stranded) this.stranded += 1;
  }

  recordRecycled(count = 1) {
    this.recycled += count;
  }

  recordOrphan(count = 1) {
    this.orphans += count;
  }

  recordTool(name, durationMs) {
    this.toolCalls += 1;
    let entry = this.tools.get(name);
    if (entry === undefined) {
      entry = { durations: [], count: 0 };
      this.tools.set(name, entry);
    }
    entry.count += 1;
    entry.durations.push(Number.isFinite(durationMs) ? durationMs : 0);
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

  recordSseClose(early = false) {
    this.sse.closed += 1;
    if (early) this.sse.closedEarly += 1;
    this.sse.current = Math.max(0, this.sse.current - 1);
  }

  recordSseEarlyClose() {
    this.sse.closedEarly += 1;
  }

  recordSseReadError() {
    this.sse.readErrors += 1;
  }

  recordSseHoldStart() {
    this.sse.liveAtHoldStart = this.sse.current;
  }

  recordSseHoldEnd() {
    this.sse.liveAtHoldEnd = this.sse.current;
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
    const conflict409 = statuses["409"] ?? 0;
    const rateLimited429 = statuses["429"] ?? 0;
    const expected = conflict409 + rateLimited429 + this.expectedExtra;
    const totalErrors = counts.client4xx + counts.server5xx + counts.network;
    const unexpected = Math.max(0, totalErrors - expected);
    const other4xx =
      counts.client4xx -
      conflict409 -
      rateLimited429 -
      counts.auth401403 -
      counts.badRequest400;
    const unexpected4xx = Math.max(
      0,
      counts.badRequest400 + other4xx - this.expectedExtra,
    );
    const activityTotal =
      this.activity.reads + this.activity.writes + this.activity.comments;
    const tools = {};
    for (const [name, entry] of [...this.tools.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      tools[name] = {
        calls: entry.count,
        latency: summarizeNumbers(entry.durations),
      };
    }
    const perAgentIntervals = [];
    for (const entry of this.agentActions.values()) {
      if (entry.count > 1) {
        perAgentIntervals.push(
          (entry.lastAt - entry.firstAt) / (entry.count - 1),
        );
      }
    }
    const cadence = summarizeNumbers(perAgentIntervals);
    const agentCadence = {
      agentsMeasured: perAgentIntervals.length,
      minMs: cadence.min,
      medianMs: cadence.p50,
      maxMs: cadence.max,
      actionsPerAgentPerMinute:
        agents > 0 && durationMs > 0
          ? round(this.actions / agents / (durationMs / 60_000), 3)
          : null,
    };
    return {
      id: this.id,
      durationMs,
      agents,
      requests: this.requests,
      success2xx: counts.success2xx,
      bytes: this.bytes,
      actions: this.actions,
      cycles: this.cycles,
      noWork: this.noWork,
      exhausted: this.exhausted,
      stranded: this.stranded,
      recycled: this.recycled,
      orphans: this.orphans,
      toolCalls: this.toolCalls,
      tools,
      agentCadence,
      actionsPerSecond: actionsPerSecond(this.actions, durationMs),
      requestsPerAgentPerMinute: requestsPerAgentPerMinute(
        this.requests,
        agents,
        durationMs,
      ),
      bytesPerRequest:
        this.requests > 0 ? round(this.bytes / this.requests, 1) : null,
      activity: {
        ...this.activity,
        total: activityTotal,
        mix:
          activityTotal > 0
            ? {
                reads: round(this.activity.reads / activityTotal, 4),
                writes: round(this.activity.writes / activityTotal, 4),
                comments: round(this.activity.comments / activityTotal, 4),
              }
            : null,
      },
      statuses,
      errors: {
        total: totalErrors,
        expected,
        unexpected,
        rate: rate(unexpected, this.requests),
        client4xx: counts.client4xx,
        server5xx: counts.server5xx,
        network: counts.network,
        aborted: counts.aborted,
        auth401403: counts.auth401403,
        badRequest400: counts.badRequest400,
        leaseConflict400: Math.max(
          0,
          this.expectedExtra - this.readyFallback404,
        ),
        readyFallback404: this.readyFallback404,
        unexpected400: Math.max(0, counts.badRequest400 - this.expectedExtra),
        conflict409,
        rateLimited429,
        other4xx,
        unexpected4xx,
        rates: {
          client4xx: rate(counts.client4xx, this.requests),
          server5xx: rate(counts.server5xx, this.requests),
          network: rate(counts.network, this.requests),
          conflict409: rate(conflict409, this.requests),
          rateLimited429: rate(rateLimited429, this.requests),
          unexpected: rate(unexpected, this.requests),
          unexpected4xx: rate(unexpected4xx, this.requests),
        },
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
