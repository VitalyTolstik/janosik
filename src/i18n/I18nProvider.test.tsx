import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, type i18n as I18nInstance } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useI18n } from "@/i18n";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en/translation.json";
import ru from "@/locales/ru/translation.json";
import * as i18nModule from "@/i18n/i18n";
import { defaultI18n } from "@/i18n/i18n";

/**
 * Tests for the typed adapter over react-i18next: defaults to English,
 * switches to Russian, applies Intl.PluralRules for the plural forms, and
 * surfaces the active language. An isolated i18next instance is used so the
 * global singleton stays untouched.
 */

function createTestI18n(): I18nInstance {
  const instance = createInstance();
  instance.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: "en",
    fallbackLng: "en",
    defaultNS: "translation",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  return instance;
}

function Probe() {
  const { lang, t, tp, setLang } = useI18n();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="add-column">{t("column.add")}</span>
      <span data-testid="count1">{tp("overlay.columnCardCount", 1)}</span>
      <span data-testid="count2">{tp("overlay.columnCardCount", 2)}</span>
      <span data-testid="count5">{tp("overlay.columnCardCount", 5)}</span>
      <button onClick={() => setLang("ru")}>to-ru</button>
      <button onClick={() => setLang("en")}>to-en</button>
    </div>
  );
}

function renderProbe(i18n: I18nInstance) {
  return render(
    <I18nProvider i18n={i18n}>
      <Probe />
    </I18nProvider>,
  );
}

describe("I18nProvider (react-i18next)", () => {
  let i18n: I18nInstance;

  beforeEach(() => {
    localStorage.clear();
    i18n = createTestI18n();
  });

  it("defaults to English", () => {
    renderProbe(i18n);
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("add-column").textContent).toBe("Add column");
  });

  it("switches to Russian and back", async () => {
    const user = userEvent.setup();
    renderProbe(i18n);

    await user.click(screen.getByText("to-ru"));
    await waitFor(() =>
      expect(screen.getByTestId("add-column").textContent).toBe(
        "Добавить колонку",
      ),
    );
    expect(screen.getByTestId("lang").textContent).toBe("ru");

    await user.click(screen.getByText("to-en"));
    await waitFor(() =>
      expect(screen.getByTestId("add-column").textContent).toBe("Add column"),
    );
  });

  it("applies Intl.PluralRules for Russian (1/2/5)", async () => {
    const user = userEvent.setup();
    renderProbe(i18n);

    await user.click(screen.getByText("to-ru"));
    await waitFor(() =>
      expect(screen.getByTestId("lang").textContent).toBe("ru"),
    );

    expect(screen.getByTestId("count1").textContent).toBe("1 карточка");
    expect(screen.getByTestId("count2").textContent).toBe("2 карточки");
    expect(screen.getByTestId("count5").textContent).toBe("5 карточек");
  });

  it("notifies languageChanged observers (persistence hook in singleton)", async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    i18n.on("languageChanged", (lang) => seen.push(lang));

    renderProbe(i18n);
    await user.click(screen.getByText("to-ru"));
    await waitFor(() => expect(seen).toContain("ru"));
  });

  it("lazily loads the ru catalog through the singleton before switching (TASK-21.6)", async () => {
    const user = userEvent.setup();
    renderProbe(i18n);

    // The switcher must pull the catalog via ensureLocale() (the singleton's
    // lazy loader) before changeLanguage, or the UI would show raw keys.
    await user.click(screen.getByText("to-ru"));
    await waitFor(() =>
      expect(screen.getByTestId("add-column").textContent).toBe(
        "Добавить колонку",
      ),
    );
    expect(defaultI18n.hasResourceBundle("ru", "translation")).toBe(true);
    expect(screen.getByTestId("lang").textContent).toBe("ru");
  });

  it("stays on the current language when the lazy bundle fails to load", async () => {
    const user = userEvent.setup();
    const ensure = vi
      .spyOn(i18nModule, "ensureLocale")
      .mockResolvedValue(false);
    renderProbe(i18n);

    await user.click(screen.getByText("to-ru"));
    // No changeLanguage call — no languageChanged event, UI keeps English.
    expect(i18n.language).toBe("en");
    expect(screen.getByTestId("add-column").textContent).toBe("Add column");
    expect(ensure).toHaveBeenCalledWith("ru");
    ensure.mockRestore();
  });
});
