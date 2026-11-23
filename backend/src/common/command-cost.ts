import { COMMAND_BATCH_MAX } from "@janosik/shared";

/**
 * TASK-200.3: the budget cost of one request.
 *
 * A batch or plan apply executes up to 100 commands under one lock and one
 * HTTP request. Charging it as a single request would let one caller spend
 * the whole board window for a hundred commands, so the board, token and
 * session buckets are charged by the command count. The cost is clamped to the
 * published batch bound: a malformed or oversized body is rejected by the
 * validation pipe after this point and must not be able to drain a budget
 * beyond the work the service could actually do.
 *
 * A body that is not a well-shaped `commands[]` of 1–100 entries costs one
 * unit, not the array length: otherwise an oversized array could spend 100
 * units before the validation pipe answers `400`.
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
  if (!isCommandBatch(commands)) return 1;
  return commands.length;
}

/**
 * The queue remembers bodies, so the per-board byte cap needs their size.
 * `Content-Length` is exact for the parsed JSON body; tests and embedders that
 * build a synthetic request fall back to the serialized body.
 */
export function commandBodyBytes(request: {
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}): number {
  const raw = request.headers?.["content-length"];
  const declared = Number(Array.isArray(raw) ? raw[0] : raw);
  if (Number.isFinite(declared) && declared >= 0) return Math.ceil(declared);
  if (request.body === undefined) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(request.body));
  } catch {
    return 0;
  }
}

function isCommandBatch(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= COMMAND_BATCH_MAX &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item) &&
        typeof (item as { commandId?: unknown }).commandId === "string" &&
        (item as { commandId: string }).commandId !== "" &&
        typeof (item as { action?: unknown }).action === "object" &&
        (item as { action?: unknown }).action !== null &&
        !Array.isArray((item as { action?: unknown }).action) &&
        typeof (item as { action: { type?: unknown } }).action.type ===
          "string" &&
        (item as { action: { type: string } }).action.type !== "",
    )
  );
}
