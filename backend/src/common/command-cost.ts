import { COMMAND_BATCH_MAX } from "@janosik/shared";

/**
 * TASK-200.3: the budget cost of one request.
 *
 * A batch or plan apply executes up to 100 commands under one lock and one
 * HTTP request. Charging it as a single request would let one caller spend
 * the whole board window for a hundred commands, so the board and token
 * buckets are charged by the command count. The cost is clamped to the
 * published batch bound: a malformed or oversized body is rejected by the
 * validation pipe after this point and must not be able to drain a budget
 * beyond the work the service could actually do.
 */
const BATCH_PATHS = [
  /^\/api\/v1\/boards\/[^/]+\/commands\/batch\/?$/,
  /^\/api\/v1\/boards\/[^/]+\/plans\/apply\/?$/,
];

export function commandRateLimitCost(request: {
  method?: string;
  originalUrl?: string;
  url?: string;
  body?: unknown;
}): number {
  if ((request.method ?? "GET").toUpperCase() !== "POST") return 1;
  const path = (request.originalUrl ?? request.url ?? "").split("?")[0] ?? "";
  if (!BATCH_PATHS.some((pattern) => pattern.test(path))) return 1;
  const commands = (request.body as { commands?: unknown } | undefined)
    ?.commands;
  if (!Array.isArray(commands) || commands.length === 0) return 1;
  return Math.min(COMMAND_BATCH_MAX, commands.length);
}
