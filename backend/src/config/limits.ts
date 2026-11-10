import { env } from "./env";

/**
 * TASK-166 D19 — the effective board cap. `process.env` is read at call time
 * (the value was already validated by envalid at boot) so an operator/test
 * can change it without rebuilding the frozen config object. `0` means no
 * limit.
 */
export function maxBoardsPerUser(): number {
  const raw = process.env.MAX_BOARDS_PER_USER;
  const parsed =
    raw === undefined || raw.trim() === ""
      ? env.MAX_BOARDS_PER_USER
      : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
