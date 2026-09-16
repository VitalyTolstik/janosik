import type { Lang } from "@/i18n/i18n";
import { DAY_MS, MINUTE_MS } from "@/utils/duration";

/**
 * Human-friendly backup timestamps, following the common version-history
 * pattern (Google Docs / GitHub):
 *  - < 1 h ago  → relative minutes ("5 min ago"; ru prints its own form)
 *  - today      → "14:32"
 *  - yesterday  → "yesterday, 09:10"
 *  - older      → "Sep 11, 2026, 14:32"
 *
 * Exact ru output is pinned by the unit tests. The caller renders the
 * string as the visible label and keeps a full `toLocaleString()` in the
 * row's `title` attribute.
 */

export function formatBackupTimestamp(
  timestamp: number,
  now: number,
  lang: Lang,
  hour12 = false,
): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const deltaMinutes = Math.round((timestamp - now) / MINUTE_MS);

  if (Math.abs(deltaMinutes) < 60) {
    // Clamp small clock drift into the past ("1 minute ago"), never "in 10 minutes".
    return rtf.format(Math.min(deltaMinutes, -1), "minute");
  }

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysBetween = Math.round(
    (startOfDay(new Date(now)) - startOfDay(new Date(timestamp))) / DAY_MS,
  );

  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12,
  }).format(timestamp);

  if (daysBetween === 0) return time;
  if (daysBetween === 1) return `${rtf.format(-1, "day")}, ${time}`;

  const date = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(timestamp);
  return `${date}, ${time}`;
}
