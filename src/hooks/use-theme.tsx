import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { migrateStorageKey } from "@/utils/storage";

/**
 * Theme management: `dark` (default) | `light`.
 * The choice is persisted to localStorage and applied as a class on <html>.
 * The inline preflight in `index.html` applies the persisted theme before
 * first paint, so there is never a theme flash.
 */

export type Theme = "dark" | "light";

const STORAGE_KEY = "janosik-theme";
const root = () => document.documentElement;

function readStoredTheme(): Theme | null {
  try {
    // One-time brand migration (Vortex → Janosik) — read before the new key.
    migrateStorageKey("vortex-theme", STORAGE_KEY);
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Resolve the initial theme. The preflight already applied the saved
 * preference (or the OS setting) as classes on <html> before first paint, so
 * the DOM is the source of truth; without it, fall back to the saved value
 * and then the system preference.
 */
function readInitialTheme(): Theme {
  const html = root();
  if (html.classList.contains("light")) return "light";
  if (html.classList.contains("dark")) return "dark";
  return readStoredTheme() ?? systemTheme();
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    const html = root();
    html.classList.toggle("light", theme === "light");
    html.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — theme still works for the session */
    }
    // Keep the meta theme-color in sync for mobile chrome. Read the themed
    // background token from CSS instead of duplicating the palette here.
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!meta) return;
    const background = getComputedStyle(html)
      .getPropertyValue("--background")
      .trim();
    if (background) meta.setAttribute("content", background);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === "dark" ? "light" : "dark")),
    [],
  );

  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
