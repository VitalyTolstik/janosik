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
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown }).message ?? "");
  // P2024: timed out fetching a connection from the pool.
  if (code === "P2024") return "pool_wait";
  // PostgreSQL statement_timeout is surfaced by Prisma as P2010 with
  // `meta.code = "57014"` (query_canceled), or as a timeout message.
  if (code === "P2010") {
    const sqlState = (error as { meta?: { code?: unknown } }).meta?.code;
    return sqlState === "57014" ||
      /statement timeout|canceling statement|query canceled|query_canceled/i.test(
        message,
      )
      ? "timeout"
      : undefined;
  }
  // P2028 covers both "could not start a transaction in time" (pool wait) and
  // "transaction already closed / expired" (the transaction budget elapsed).
  if (code === "P2028") {
    return /unable to start a transaction|transaction start|acquire a connection|connection pool/i.test(
      message,
    )
      ? "pool_wait"
      : "timeout";
  }
  return undefined;
}
