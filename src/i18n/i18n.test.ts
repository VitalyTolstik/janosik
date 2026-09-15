import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureLocale,
  formatDate,
  formatDateOnly,
  formatRelative,
  is12HourLocale,
  loadTimeFormat,
  saveTimeFormat,
} from "@/i18n/i18n";

/**
 * Point tests for the i18n formatters and the time-format override. `now`
 * (or a fixed timestamp) is injected everywhere so the assertions never
 * depend on the wall clock; the lazy-locale replay is exercised through a
 * fresh module instance with a persisted non-English language.
 */

const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime(); // Sep 14 2026, 12:00 local

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("formatDateOnly", () => {
  it("formats a short date per locale", () => {
    const ts = new Date(2026, 8, 10, 12, 0, 0).getTime(); // 10 Sep 2026
    expect(formatDateOnly(ts, "en")).toMatch(/Sep\s*10/);
    expect(formatDateOnly(ts, "ru")).toMatch(/10\s*сент/i);
  });
});

describe("formatRelative", () => {
  it("renders seconds, minutes, hours and days for recent moments", () => {
    expect(formatRelative(NOW - 30_000, "en", NOW)).toMatch(/30 seconds ago/);
    expect(formatRelative(NOW - 5 * 60_000, "en", NOW)).toMatch(
      /5 minutes ago/,
    );
    expect(formatRelative(NOW - 3 * 3_600_000, "en", NOW)).toMatch(
      /3 hours ago/,
    );
    expect(formatRelative(NOW - 2 * 86_400_000, "en", NOW)).toMatch(
      /2 days ago/,
    );
  });

  it("localizes to Russian", () => {
    expect(formatRelative(NOW - 5 * 60_000, "ru", NOW)).toMatch(/5 минут/);
  });

  it("degrades to the exact date beyond a week", () => {
    const old = NOW - 30 * 86_400_000;
    expect(formatRelative(old, "en", NOW)).toBe(formatDate(old, "en"));
  });

  it("supports future timestamps", () => {
    expect(formatRelative(NOW + 2 * 3_600_000, "en", NOW)).toMatch(
      /in 2 hours/,
    );
  });
});

describe("is12HourLocale", () => {
  it("treats English as 12-hour and Russian as 24-hour", () => {
    expect(is12HourLocale("en")).toBe(true);
    expect(is12HourLocale("en-GB")).toBe(true);
    expect(is12HourLocale("ru")).toBe(false);
    expect(is12HourLocale("ru-RU")).toBe(false);
  });
});

describe("time-format override", () => {
  it("defaults to auto when unset or invalid", () => {
    expect(loadTimeFormat()).toBe("auto");
    localStorage.setItem("janosik-time-format", "weird");
    expect(loadTimeFormat()).toBe("auto");
  });

  it("round-trips a persisted format", () => {
    saveTimeFormat("24h");
    expect(loadTimeFormat()).toBe("24h");
    saveTimeFormat("12h");
    expect(loadTimeFormat()).toBe("12h");
  });

  it("falls back to auto when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(loadTimeFormat()).toBe("auto");
    vi.restoreAllMocks();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => saveTimeFormat("12h")).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe("lazy locale reload", () => {
  it("replays a persisted non-English locale once its chunk is loaded", async () => {
    vi.resetModules();
    localStorage.setItem("janosik-lang", "ru");
    const fresh = await import("@/i18n/i18n");

    // The RU catalog starts absent from the fresh singleton and is added by
    // the module-level replay path (`ensureLocale` → `changeLanguage`).
    await vi.waitFor(() => {
      expect(fresh.defaultI18n.hasResourceBundle("ru", "translation")).toBe(
        true,
      );
    });
    expect(await fresh.ensureLocale("ru")).toBe(true);
  });
});
