import { BadRequestException } from "@nestjs/common";

/**
 * Parse the `?since=` query of the command delta feed and the SSE stream
 * (§7.4): a non-negative integer or absent. Anything else is a client bug —
 * garbage must not silently replay the whole log.
 */
export function parseSince(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException("since must be a non-negative integer");
  }
  return parsed;
}
