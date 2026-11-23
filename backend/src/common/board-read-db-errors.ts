/**
 * TASK-200.6: classify Prisma connection/transaction failures on the board
 * read path. A saturated pool or a read transaction that outlived its budget
 * is backpressure, not a server bug: it must answer `503` with `Retry-After`
 * instead of leaking `P2028`/`P2024` as `500 internal_error`.
 */
export type BoardReadDbErrorKind = "pool_wait" | "timeout";

export function classifyBoardReadDbError(
  error: unknown,
): BoardReadDbErrorKind | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  // P2024: timed out fetching a connection from the pool.
  if (code === "P2024") return "pool_wait";
  // P2028 covers both "could not start a transaction in time" (pool wait) and
  // "transaction already closed / expired" (the transaction budget elapsed).
  if (code === "P2028") {
    const message =
      error instanceof Error
        ? error.message
        : String((error as { message?: unknown }).message ?? "");
    return /unable to start a transaction|transaction start|acquire a connection|connection pool/i.test(
      message,
    )
      ? "pool_wait"
      : "timeout";
  }
  return undefined;
}
