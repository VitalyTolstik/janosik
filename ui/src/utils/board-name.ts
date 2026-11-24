import { LIMITS, type BoardTemplate } from "@janosik/shared";

export interface GeneratedBoardName {
  /** The name that fits the 100-character board-title limit. */
  name: string;
  /** True when an existing board had the same title and ` (n)` was added. */
  deduped: boolean;
  /** The suffix number used when deduped (2 for the first duplicate). */
  dedupeIndex: number;
  /** True when the base name had to be shortened to stay within the limit. */
  truncated: boolean;
}

/**
 * TASK-177.16 follow-up: deterministic first-run names.
 *
 * The date is a creation context, not a deadline. We format it with
 * `Intl.DateTimeFormat` (never string templates), keep an ISO week separate
 * because Intl has no week field, and never overwrite a manual edit.
 */
export function normalizeBoardTitle(value: string, lang: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC")
    .toLocaleLowerCase(lang.startsWith("ru") ? "ru-RU" : "en-US");
}

function shortDate(now: Date, lang: string): string {
  return new Intl.DateTimeFormat(lang.startsWith("ru") ? "ru-RU" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(now);
}

function monthYear(now: Date, lang: string): string {
  const parts = new Intl.DateTimeFormat(
    lang.startsWith("ru") ? "ru-RU" : "en-US",
    { month: "long", year: "numeric" },
  ).formatToParts(now);
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  return `${month} ${year}`.trim();
}

/** ISO-8601 week (2026-W48), computed from the local calendar date. */
export function isoWeek(now: Date): string {
  const date = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function boardNameContext(
  rule: BoardTemplate["naming"],
  now: Date,
  lang: string,
): string {
  if (rule === "day") return shortDate(now, lang);
  if (rule === "iso-week") return isoWeek(now);
  if (rule === "month") return monthYear(now, lang);
  return "";
}

/**
 * Shorten to `max` without splitting a surrogate pair and without ever
 * dropping a dedupe suffix. The ellipsis is part of the budget.
 */
export function clampBoardName(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, Math.max(1, max - 1)).trimEnd();
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function titleExists(
  candidate: string,
  existingTitles: readonly string[],
  lang: string,
): boolean {
  const normalized = normalizeBoardTitle(candidate, lang);
  return existingTitles.some(
    (title) => normalizeBoardTitle(title, lang) === normalized,
  );
}

/**
 * Resolve a template name against the account's boards (archived included)
 * and add ` (2)`, ` (3)` … until it is unique.
 */
export function dedupeBoardName(
  raw: string,
  existingTitles: readonly string[],
  lang: string,
): GeneratedBoardName {
  const base = clampBoardName(raw, LIMITS.boardTitle);
  const truncated = base !== raw;
  let candidate = base;
  let suffixNumber = 1;
  while (titleExists(candidate, existingTitles, lang)) {
    suffixNumber += 1;
    const suffix = ` (${suffixNumber})`;
    candidate = clampBoardName(raw, LIMITS.boardTitle - suffix.length) + suffix;
  }
  return {
    name: candidate,
    deduped: suffixNumber > 1,
    dedupeIndex: suffixNumber,
    truncated: truncated || !candidate.startsWith(base),
  };
}

export function generateBoardName(
  template: BoardTemplate,
  lang: string,
  now: Date,
  existingTitles: readonly string[],
): GeneratedBoardName {
  const copy = template.copy[lang.startsWith("ru") ? "ru" : "en"];
  const context = boardNameContext(template.naming, now, lang);
  const joiner = template.naming === "iso-week" ? " " : " — ";
  const raw = context ? `${copy.name}${joiner}${context}` : copy.name;
  return dedupeBoardName(raw, existingTitles, lang);
}

/** The name to show under the input: accepted auto name, or a manual value. */
export function boardNameIsDuplicate(
  value: string,
  existingTitles: readonly string[],
  lang: string,
): boolean {
  const normalized = normalizeBoardTitle(value, lang);
  if (normalized.length === 0) return false;
  return existingTitles.some(
    (title) => normalizeBoardTitle(title, lang) === normalized,
  );
}
