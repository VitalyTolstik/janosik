// TASK-200.1 — one place that decides what a scenario result means.
//
// `429`, `409` and claim-lease `400` conflicts are expected data. A run is
// `failed` when it measured no successful 2xx work, when authentication
// failed, or when nothing was measured at all. A small number of other 5xx /
// 4xx is data; above the documented thresholds it degrades the run to
// `partial`. Orphans and S5 failed streams are always at least `partial`.

export const SCENARIO_STATUSES = ["ok", "partial", "failed", "interrupted"];

/** Documented degradation thresholds (fractions of requests). */
export const STATUS_THRESHOLDS = {
  server5xxRate: 0.01,
  server5xxCount: 5,
  unexpected4xxRate: 0.001,
  unexpected4xxCount: 5,
};

function overThreshold({ count, requests, rateThreshold, countThreshold }) {
  if (count <= 0) return false;
  const rate = requests > 0 ? count / requests : 1;
  return count >= countThreshold || rate > rateThreshold;
}

export function evaluateScenarioStatus({
  id,
  scenario,
  summary,
  errors = [],
  fatal = false,
  interrupted = false,
  driver = "http",
  workDurationMs = null,
}) {
  if (interrupted) {
    return {
      status: "interrupted",
      reason: "run interrupted before the deadline",
    };
  }
  if (fatal || errors.some((error) => error.fatal === true)) {
    const error = errors.find((entry) => entry.fatal === true);
    return {
      status: "failed",
      reason: `fatal error${error?.message ? `: ${error.message}` : ""}`,
    };
  }
  const requests = summary.requests ?? 0;
  const measuredCalls =
    requests > 0 ? requests : driver === "mcp" ? (summary.toolCalls ?? 0) : 0;
  if (measuredCalls === 0) {
    return { status: "failed", reason: "no requests were measured" };
  }
  const success2xx = summary.success2xx ?? 0;
  if (success2xx === 0) {
    return {
      status: "failed",
      reason: "no successful 2xx response was measured",
    };
  }
  if ((summary.errors?.auth401403 ?? 0) > 0) {
    return {
      status: "failed",
      reason: "authentication or authorization failed",
    };
  }
  const timedOut = summary.timedOut === true;
  const sseScenario = id === "S5" || (id === "S3" && (scenario.sse ?? 0) > 0);
  if (timedOut && sseScenario && (summary.sse?.liveAtHoldStart ?? 0) === 0) {
    return {
      status: "failed",
      reason: "scenario deadline expired before any live SSE hold started",
    };
  }
  if (id === "S5") {
    if ((summary.sse?.opened ?? 0) === 0) {
      return { status: "failed", reason: "no SSE stream opened" };
    }
    if ((summary.sse?.liveAtHoldStart ?? 0) === 0) {
      return {
        status: "failed",
        reason: "no live SSE stream when the hold started",
      };
    }
    // A hold cut by the scenario deadline is reported as partial below, not
    // failed: there were real live streams, just not for the full window.
    if (!timedOut && (summary.sse?.liveAtHoldEnd ?? 0) === 0) {
      return {
        status: "failed",
        reason: "no live SSE stream at the end of the hold",
      };
    }
  }
  if (
    id === "S3" &&
    (scenario.sse ?? 0) > 0 &&
    ((summary.sse?.opened ?? 0) === 0 ||
      (summary.sse?.liveAtHoldStart ?? 0) === 0 ||
      (!timedOut && (summary.sse?.liveAtHoldEnd ?? 0) === 0))
  ) {
    return { status: "failed", reason: "S3 opened or held no live SSE stream" };
  }
  const expectsCycles =
    id === "S2" ||
    id === "S4" ||
    (id === "S3" && (scenario.mix?.writes ?? 0.3) > 0);
  if (
    expectsCycles &&
    (scenario.agents ?? 0) > 0 &&
    (summary.cycles ?? 0) === 0
  ) {
    const why =
      (summary.exhausted ?? 0) > 0
        ? "board was exhausted before one cycle completed"
        : "zero work cycles completed";
    return { status: "failed", reason: why };
  }

  const reasons = [];
  if (timedOut) {
    reasons.push(
      "scenario deadline truncated the run before the ramp/hold drained",
    );
  }
  if ((summary.sse?.failed ?? 0) > 0) {
    reasons.push(
      `${summary.sse.failed} SSE stream(s) failed to open (${summary.sse.opened ?? 0} opened)`,
    );
  }
  if ((summary.sse?.closedEarly ?? 0) > 0) {
    reasons.push(`${summary.sse.closedEarly} SSE stream(s) closed early`);
  }
  if ((summary.sse?.readErrors ?? 0) > 0) {
    reasons.push(`${summary.sse.readErrors} SSE read error(s)`);
  }
  if ((summary.orphans ?? 0) > 0) {
    reasons.push(
      `${summary.orphans} claim(s) could not be released (orphan lease)`,
    );
  }
  if (
    overThreshold({
      count: summary.errors?.server5xx ?? 0,
      requests,
      rateThreshold: STATUS_THRESHOLDS.server5xxRate,
      countThreshold: STATUS_THRESHOLDS.server5xxCount,
    })
  ) {
    reasons.push(
      `${summary.errors.server5xx} server 5xx (${formatRate(summary.errors.rates?.server5xx)})`,
    );
  }
  if (
    overThreshold({
      count: summary.errors?.unexpected4xx ?? 0,
      requests,
      rateThreshold: STATUS_THRESHOLDS.unexpected4xxRate,
      countThreshold: STATUS_THRESHOLDS.unexpected4xxCount,
    })
  ) {
    reasons.push(
      `${summary.errors.unexpected4xx} unexpected 4xx (${formatRate(summary.errors.rates?.unexpected4xx)})`,
    );
  }
  if ((summary.exhausted ?? 0) > 0) {
    reasons.push(
      `board exhausted after ${summary.cycles ?? 0} cycle(s); add cards or use --recycle`,
    );
  }
  if ((summary.stranded ?? 0) > 0) {
    reasons.push(`${summary.stranded} cycle(s) found only leased cards`);
  }
  if ((summary.errors?.network ?? 0) > 0) {
    reasons.push(`${summary.errors.network} network error(s)`);
  }
  if (
    id === "S4" &&
    Number.isFinite(workDurationMs) &&
    (scenario.durationMs ?? 0) > 0 &&
    workDurationMs < scenario.durationMs * 0.5
  ) {
    reasons.push(
      `work window ${workDurationMs}ms is under half the requested ${scenario.durationMs}ms`,
    );
  }
  if (reasons.length > 0) {
    return { status: "partial", reason: reasons.join("; ") };
  }
  return { status: "ok", reason: null };
}

function formatRate(rate) {
  return Number.isFinite(rate) ? `${(rate * 100).toFixed(2)}%` : "—";
}
