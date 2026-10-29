import { BadRequestException } from "@nestjs/common";

/**
 * PostgreSQL `bigint` maximum — the ceiling of `Command.seq` (§7.3). Held as
 * an exact `BigInt` and compared as one, because no JS number literal can
 * carry this value precisely. A safe integer can never reach it
 * (2^53-1 < 2^63-1), but the boundary this guard protects is the database
 * column, and stating it keeps the next editor from loosening the check.
 */
const MAX_SEQ = 9_223_372_036_854_775_807n;

/**
 * Parse the `?since=` query of the command delta feed and the SSE stream
 * (§7.4): a non-negative integer or absent. Anything else is a client bug —
 * garbage must not silently replay the whole log.
 *
 * TASK-156 (item 43): the value is later cast with `BigInt(since)` into a
 * `bigint` column, so it must stay inside the column's range. `1e30` used
 * to pass the bare integer check and overflow PostgreSQL as a 500 on the
 * delta endpoint, the events stream and the public share stream; a value
 * that is not a safe integer, or is outside `0..MAX_SEQ`, is a 400 here.
 */
export function parseSince(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || BigInt(parsed) > MAX_SEQ) {
    throw new BadRequestException("since must be a non-negative integer");
  }
  return parsed;
}
