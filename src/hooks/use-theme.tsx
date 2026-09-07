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
 * main.tsx runs a preflight that applies the persisted theme before first
 * paint, so there is never a theme flash.
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

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = readStoredTheme();
    if (stored) return stored;
    // During SSR-less preflight we already picked a default; keep in sync
    // with the class applied by main.tsx.
    return root().classList.contains("light") ? "light" : "dark";
  });

  useEffect(() => {
    const html = root();
    html.classList.toggle("light", theme === "light");
    html.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — theme still works for the session */
    }
    // Keep the meta theme-color in sync for mobile chrome.
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    meta?.setAttribute("content", theme === "dark" ? "#0a0a0f" : "#f4f5f6");
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
