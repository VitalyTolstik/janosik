import type { i18n as I18nInstance } from "i18next";
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import {
  defaultI18n,
  is12HourLocale,
  loadTimeFormat,
  saveTimeFormat,
  type Lang,
  type MessageKey,
  type TimeFormat,
} from "@/i18n/i18n";

/**
 * Thin adapter over react-i18next.
 *
 * Exposes the same surface the app already uses (`t`, `tp` for plurals,
 * `setLang`, `lang`) so components only import `useI18n` from `@/i18n`.
 * Defaults to the shared i18next singleton; tests may inject their own
 * instance via the `i18n` prop.
 */

export function I18nProvider({
  children,
  i18n = defaultI18n,
}: {
  children: ReactNode;
  i18n?: I18nInstance;
}) {
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>(loadTimeFormat);

  const setTimeFormat = (next: TimeFormat) => {
    saveTimeFormat(next);
    setTimeFormatState(next);
  };

  return (
    <I18nextProvider i18n={i18n}>
      <TimeFormatContext.Provider value={{ timeFormat, setTimeFormat }}>
        {children}
      </TimeFormatContext.Provider>
    </I18nextProvider>
  );
}

const TimeFormatContext = createContext<{
  timeFormat: TimeFormat;
  setTimeFormat: (next: TimeFormat) => void;
}>({ timeFormat: "auto", setTimeFormat: () => {} });

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translate a key; `params` become `{{param}}` placeholders. */
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /** Translate a key with a count — i18next resolves the plural form. */
  tp: (
    key: MessageKey,
    count: number,
    params?: Record<string, string | number>,
  ) => string;
}

export function useI18n(): I18nContextValue {
  const { t, i18n } = useTranslation();

  const lang: Lang = i18n.language.startsWith("ru") ? "ru" : "en";

  const setLang = (next: Lang) => {
    void i18n.changeLanguage(next);
  };

  const tp = (
    key: MessageKey,
    count: number,
    params?: Record<string, string | number>,
  ) => t(key, { ...params, count });

  return { lang, setLang, t, tp };
}

/**
 * Whether clocks should render as 12-hour (AM/PM): the user's
 * `janosik-time-format` override when set, otherwise the locale convention
 * (`is12HourLocale`). Reactive — components re-render when the toggle changes.
 */
export function useHour12(): boolean {
  const { timeFormat } = useContext(TimeFormatContext);
  const { i18n } = useTranslation();
  const lang = i18n.language.startsWith("ru") ? "ru" : "en";
  if (timeFormat === "auto") return is12HourLocale(lang);
  return timeFormat === "12h";
}

export { type TimeFormat };

/** Access the time-format override and its setter (persists to localStorage). */
export function useTimeFormat() {
  return useContext(TimeFormatContext);
}
