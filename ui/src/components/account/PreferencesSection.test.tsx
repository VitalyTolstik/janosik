import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PreferencesSection } from "@/components/account/PreferencesSection";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { defaultI18n } from "@/i18n/i18n";

/**
 * Preferences section (TASK-36.1): the personal display options moved out of
 * the header. Every control still writes the same storage keys the header
 * switchers used, so existing sessions keep their choices.
 */

function renderPreferences() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <I18nProvider>
          <PreferencesSection />
        </I18nProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

describe("PreferencesSection (TASK-36.1)", () => {
  beforeEach(async () => {
    document.documentElement.className = "";
    // The i18n singleton is module-level: the language test would leak "ru"
    // into the later tests of this file without an explicit reset.
    await defaultI18n.changeLanguage("en");
  });

  afterEach(() => {
    document.documentElement.className = "";
  });

  it("switches the theme immediately", async () => {
    renderPreferences();

    await userEvent.click(screen.getByTestId("pref-theme-light"));
    expect(document.documentElement.classList.contains("light")).toBe(true);

    await userEvent.click(screen.getByTestId("pref-theme-dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("switches the interface language from the row", async () => {
    renderPreferences();
    const row = screen.getByTestId("pref-language");
    expect(row).toHaveTextContent("English");

    await userEvent.click(row);
    await userEvent.click(await screen.findByText("Русский"));

    expect(row).toHaveTextContent("Русский");
    expect(await screen.findByText("Настройки")).toBeInTheDocument();
  });

  it("changes the time format and persists it", async () => {
    renderPreferences();

    await userEvent.click(screen.getByTestId("pref-time-format"));
    await userEvent.click(await screen.findByText("24-hour"));

    expect(screen.getByTestId("pref-time-format")).toHaveTextContent("24-hour");
    expect(localStorage.getItem("janosik-time-format")).toBe("24h");
  });

  it("changes the board background from the row", async () => {
    renderPreferences();
    const row = screen.getByTestId("pref-background");
    expect(row).toHaveTextContent("Solid");

    await userEvent.click(row);
    await userEvent.click(await screen.findByText("Dots"));

    expect(row).toHaveTextContent("Dots");
    expect(localStorage.getItem("janosik-board-bg")).toBe("dots");
  });
});
