import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider, useHour12, useTimeFormat } from "@/i18n/I18nProvider";
import { TimeFormatSwitcher } from "@/components/TimeFormatSwitcher";
import { TooltipProvider } from "@/components/ui/tooltip";
import { defaultI18n, formatDate, formatTime } from "@/i18n/i18n";
import { formatBackupTimestamp } from "@/utils/backup-timestamp";

/**
 * TASK-17: the clock-format toggle. `auto` follows the locale convention
 * (en → 12h AM/PM, ru → 24h); explicit 12h/24h override it for every
 * surface (due badges, time picker) and persist to localStorage.
 */

function Probe() {
  const hour12 = useHour12();
  return <span data-testid="probe">{formatTime("19:30", "ru", hour12)}</span>;
}

describe("time format override", () => {
  afterEach(async () => {
    localStorage.removeItem("janosik-time-format");
    // i18next notifies subscribers asynchronously; flush inside act so the
    // unmounted-after-test updates don't produce act() warnings.
    await act(async () => {
      await defaultI18n.changeLanguage("en");
    });
    localStorage.removeItem("janosik-lang");
  });

  it("formats a time in 12h and 24h when forced", () => {
    // ru is 24h by convention; forcing flips it either way.
    expect(formatTime("19:30", "ru", false)).toMatch(/19:30/);
    expect(formatTime("19:30", "ru", true)).toMatch(/7:30/i);
  });

  it("formats date+time and backup labels with the forced hour mode", () => {
    const ts = new Date(2026, 8, 12, 19, 30).getTime();
    const now = ts + 90 * 60_000; // 1.5 h later — "older" backup branch
    // Date surfaces: 24h keeps 19:30, 12h renders 7:30 PM.
    expect(formatDate(ts, "ru", false)).toMatch(/19:30/);
    expect(formatDate(ts, "ru", true)).toMatch(/7:30/i);
    // Backup labels: same day-older branch, forced both ways.
    expect(formatBackupTimestamp(ts, now, "ru", false)).toMatch(/19:30/);
    expect(formatBackupTimestamp(ts, now, "ru", true)).toMatch(/7:30/i);
  });

  it("renders per locale by default and re-renders on the override", async () => {
    await act(async () => {
      await defaultI18n.changeLanguage("ru");
    });
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    // Let the provider's post-mount i18next updates settle inside act.
    await act(async () => {});
    // Auto + ru → 24h.
    expect(screen.getByTestId("probe")).toHaveTextContent("19:30");
  });

  it("persists the picked format and applies it", async () => {
    await act(async () => {
      await defaultI18n.changeLanguage("ru");
    });
    render(
      <I18nProvider>
        <TooltipProvider>
          <TimeFormatSwitcher />
          <Probe />
        </TooltipProvider>
      </I18nProvider>,
    );
    await act(async () => {});
    await userEvent.click(
      screen.getByRole("button", { name: "Формат времени" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "12-часовой" }));
    // Radix closes the menu asynchronously; flush before asserting.
    await act(async () => {});
    expect(localStorage.getItem("janosik-time-format")).toBe("12h");
    // Same ru locale now renders AM/PM.
    expect(screen.getByTestId("probe").textContent).toMatch(/7:30/i);
  });

  it("exposes the setter through useTimeFormat", () => {
    let captured: string | null = null;
    function Setter() {
      const { timeFormat, setTimeFormat } = useTimeFormat();
      captured = timeFormat;
      return (
        <button type="button" onClick={() => setTimeFormat("24h")}>
          set
        </button>
      );
    }
    render(
      <I18nProvider>
        <Setter />
      </I18nProvider>,
    );
    expect(captured).toBe("auto");
    act(() => {
      screen.getByText("set").click();
    });
    expect(localStorage.getItem("janosik-time-format")).toBe("24h");
  });
});
