// TASK-200.1 — one place that decides what a scenario result means.
//
// `429` and `5xx` are data: they are reported, not used as a pass/fail gate.
// A run is `failed` when it measured nothing (zero requests, zero work),
// when authentication failed, or when the API could not be reached at all.
// `partial` means work happened but the board or the transport degraded it.

export const SCENARIO_STATUSES = ["ok", "partial", "failed", "interrupted"];

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
  const measuredCalls =
    driver === "mcp" ? (summary.toolCalls ?? 0) : (summary.requests ?? 0);
  if (measuredCalls === 0) {
    return { status: "failed", reason: "no requests were measured" };
  }
  if ((summary.errors?.auth401403 ?? 0) > 0) {
    return {
      status: "failed",
      reason: "authentication or authorization failed",
    };
  }
  if (id === "S5") {
    if ((summary.sse?.opened ?? 0) === 0) {
      return { status: "failed", reason: "no SSE stream opened" };
    }
    if ((summary.sse?.maxConcurrent ?? 0) === 0) {
      return { status: "failed", reason: "no SSE stream was held" };
    }
  }
  if (id === "S6" && (summary.requests ?? 0) === 0) {
    return { status: "failed", reason: "read burst measured no requests" };
  }
  const expectsWork =
    ["S2", "S3", "S4"].includes(id) && (scenario.agents ?? 0) > 0;
  if (expectsWork && (summary.cycles ?? 0) === 0) {
    const why =
      (summary.exhausted ?? 0) > 0
        ? "board was exhausted before one cycle completed"
        : "zero work cycles completed";
    return { status: "failed", reason: why };
  }
  const reasons = [];
  if ((summary.exhausted ?? 0) > 0 && (summary.recycled ?? 0) === 0) {
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
