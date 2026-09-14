import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en/translation.json";
import ru from "@/locales/ru/translation.json";
import { migrateStorageKey } from "@/utils/storage";

/**
 * i18next singleton — the de-facto standard React i18n layer.
 *
 * - Resources: plain JSON files per locale (src/locales/{lang}/translation.json),
 *   fully decoupled from code so translators can edit them directly.
 * - Detection: localStorage `janosik-lang` (existing key) → navigator.language
 *   → <html lang>. The choice is cached back into localStorage.
 * - Typed keys: `CustomTypeOptions` derives valid message keys from the EN
 *   catalog, so `t("typo.key")` fails to compile.
 * - Plurals: handled by i18next via Intl.PluralRules — keys use the
 *   `_one/_few/_many` suffixes (en: one/other, ru: one/few/many/other).
 */

export type Lang = "en" | "ru";

const STORAGE_KEY = "janosik-lang";

// One-time brand migration (Vortex → Janosik): move the persisted language
// to the new key before the detector reads it.
migrateStorageKey("vortex-lang", STORAGE_KEY);

export const defaultI18n = i18n;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    fallbackLng: "en",
    defaultNS: "translation",
    supportedLngs: ["en", "ru"],
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    interpolation: {
      // React escapes by default; no need for i18next to double-escape.
      escapeValue: false,
    },
    react: {
      // Resources are bundled synchronously — no Suspense boundary needed.
      useSuspense: false,
    },
    initAsync: false,
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

function syncHtmlLang(lang: string) {
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable — language still works for the session */
  }
}

// Initial sync + keep <html lang> and the persisted choice up to date.
syncHtmlLang(i18n.language);
i18n.on("languageChanged", syncHtmlLang);

/**
 * Locale-aware short date(time) formatter, e.g. "2/10/25, 14:30".
 * `hour12` forces 12/24-hour rendering on top of the locale default
 * (the user's time-format override) — `dateStyle`/`timeStyle` shorthand
 * is replaced by explicit components so the option actually applies.
 */
export function formatDate(
  timestamp: number,
  lang: string,
  hour12?: boolean,
): string {
  const locale = lang.startsWith("ru") ? "ru-RU" : "en-US";
  try {
    return new Date(timestamp).toLocaleString(
      locale,
      hour12 === undefined
        ? { dateStyle: "short", timeStyle: "short" }
        : {
            year: "2-digit",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12,
          },
    );
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

/** Locale-aware short date-only formatter, e.g. "10 февр." — for badges. */
export function formatDateOnly(timestamp: number, lang: string): string {
  try {
    return new Date(timestamp).toLocaleDateString(
      lang.startsWith("ru") ? "ru-RU" : "en-US",
      { day: "numeric", month: "short" },
    );
  } catch {
    return new Date(timestamp).toLocaleDateString();
  }
}

/**
 * Locale-aware relative time for recent moments — "5 minutes ago" /
 * "5 минут назад", "yesterday" / "вчера" (Intl.RelativeTimeFormat with
 * `numeric: "auto"`). Beyond a week it degrades to the exact short
 * date(time), which reads better than "3 months ago".
 */
export function formatRelative(
  timestamp: number,
  lang: string,
  now: number = Date.now(),
  hour12?: boolean,
): string {
  const locale = lang.startsWith("ru") ? "ru-RU" : "en-US";
  const diff = timestamp - now;
  const abs = Math.abs(diff);
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  if (abs >= WEEK_MS) return formatDate(timestamp, lang, hour12);
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
    if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
    if (abs < 86_400_000) {
      return rtf.format(Math.round(diff / 3_600_000), "hour");
    }
    return rtf.format(Math.round(diff / 86_400_000), "day");
  } catch {
    return formatDate(timestamp, lang);
  }
}

/**
 * Whether the locale conventionally reads clocks as 12-hour (AM/PM).
 * `ru` is 24-hour everywhere; `en` defaults to 12-hour (US convention —
 * our main English audience). The user's `janosik-time-format` override
 * (see `TimeFormat`) is applied on top of this in `useHour12`.
 */
export function is12HourLocale(lang: string): boolean {
  return !lang.startsWith("ru");
}

// --- Time format override (TASK-17) -----------------------------------------

/** User preference for clock rendering: locale default or forced 12/24h. */
export type TimeFormat = "auto" | "12h" | "24h";

const TIME_FORMAT_KEY = "janosik-time-format";

/** Read the persisted time-format override; invalid values fall back to "auto". */
export function loadTimeFormat(): TimeFormat {
  try {
    const raw = localStorage.getItem(TIME_FORMAT_KEY);
    if (raw === "12h" || raw === "24h" || raw === "auto") return raw;
  } catch {
    /* storage unavailable — locale default */
  }
  return "auto";
}

/** Persist the time-format override; best-effort (private mode etc.). */
export function saveTimeFormat(format: TimeFormat): void {
  try {
    localStorage.setItem(TIME_FORMAT_KEY, format);
  } catch {
    /* storage unavailable — choice still applies for the session */
  }
}

/** "19:30" → { hour: 19, minute: 30 } (internal, always 24h). */
export function parseTime(value: string): { hour: number; minute: number } {
  const [hh, mm] = value.split(":").map((v) => Number.parseInt(v, 10));
  return { hour: hh || 0, minute: mm || 0 };
}

/** { hour: 19, minute: 30 } → "19:30" (internal, always 24h). */
export function composeTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Locale-aware time formatter for badges/triggers: "19:30" (ru) or
 * "7:30 PM" (en). `hour12` forces 12/24-hour rendering on top of the
 * locale default (the user's time-format override); format-only — the
 * stored value stays a timestamp / "HH:mm" string.
 */
export function formatTime(
  time: string,
  lang: string,
  hour12?: boolean,
): string {
  const { hour, minute } = parseTime(time);
  try {
    return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(
      lang.startsWith("ru") ? "ru-RU" : "en-US",
      hour12 === undefined
        ? { hour: "numeric", minute: "2-digit" }
        : { hour: "numeric", minute: "2-digit", hour12 },
    );
  } catch {
    return time;
  }
}

// Typed message keys — derived from the EN catalog (the source of truth for
// key names); tsc then rejects unknown/misspelled keys everywhere. Plural
// suffix keys (_one/_few/_many/_other) don't exist in code: you always call
// the base key and let i18next pick the form via Intl.PluralRules — so the
// union re-adds those bases (e.g. `overlay.columnCardCount`) while pruning
// the suffixed variants.
type PluralSuffixes = "_one" | "_few" | "_many" | "_other" | "_zero" | "_two";
type RawKeys = keyof typeof en;
type NonPluralKeys = Exclude<RawKeys, `${string}${PluralSuffixes}`>;
type PluralBases = {
  [K in RawKeys]: K extends `${infer Base}${PluralSuffixes}` ? Base : never;
}[RawKeys];
export type MessageKey = NonPluralKeys | PluralBases;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof en;
    };
  }
}

export default i18n;
