/**
 * Shared 24-hour clock formatting.
 *
 * These helpers build the internal "HH:mm" representation (and read a
 * `Date`'s local time into it). Locale-aware display — 12h vs 24h, AM/PM,
 * separators — stays in `@/i18n`'s `formatTime`.
 */

/** Zero-pad a non-negative integer to two digits ("7" → "07"). */
export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Compose a 24-hour "HH:mm" string from hour and minute parts. */
export function composeTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** The local 24-hour "HH:mm" time of a `Date`. */
export function formatTimeOfDay(date: Date): string {
  return composeTime(date.getHours(), date.getMinutes());
}

/**
 * Local timestamp (Unix ms) for a calendar day plus a "HH:mm" time —
 * used by the due-date and access-expiry pickers.
 */
export function composeTimestamp(date: Date, time: string): number {
  const [hh, mm] = time.split(":").map((value) => Number.parseInt(value, 10));
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hh || 0,
    mm || 0,
  ).getTime();
}
