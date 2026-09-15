import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "@/hooks/use-theme";
import { THEME_STORAGE_KEY } from "@/utils/storage-keys";

/**
 * Theme bootstrap (B-1 / T-4): the inline preflight in index.html resolves the
 * saved preference before the OS setting and writes the resulting class on
 * <html>. jsdom never runs that preflight, so these tests seed the DOM
 * classes / storage directly to pin the init precedence and persistence.
 */

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function mockSystemPrefersDark(dark: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("dark") ? dark : !dark,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.remove());
});

describe("useTheme", () => {
  it("defaults to the system preference when nothing is stored", () => {
    mockSystemPrefersDark(true);
    const dark = renderHook(() => useTheme(), { wrapper });
    expect(dark.result.current.theme).toBe("dark");

    document.documentElement.className = "";
    localStorage.clear();
    mockSystemPrefersDark(false);
    const light = renderHook(() => useTheme(), { wrapper });
    expect(light.result.current.theme).toBe("light");
  });

  it("trusts the prewritten DOM classes over the system preference", () => {
    mockSystemPrefersDark(true);
    document.documentElement.classList.add("light");

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("persists the chosen theme and applies both DOM classes", () => {
    mockSystemPrefersDark(true);
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => result.current.setTheme("light"));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("migrates the legacy vortex-theme key exactly once on read", () => {
    localStorage.setItem("vortex-theme", "light");

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(localStorage.getItem("vortex-theme")).toBeNull();
  });

  it("reads the meta theme-color from the --background token", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#0a0a0f";
    document.head.appendChild(meta);
    document.documentElement.style.setProperty("--background", "#123456");

    renderHook(() => useTheme(), { wrapper });

    expect(meta.getAttribute("content")).toBe("#123456");
  });
});
