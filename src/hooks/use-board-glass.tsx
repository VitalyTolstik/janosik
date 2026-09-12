import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Column glass settings — how translucent and how blurred the board columns
 * are over the board background. Persisted to localStorage under
 * `janosik-board-glass` and applied as CSS custom properties on the document
 * root, so ColumnView stays style-only:
 *
 * - `--janosik-glass-transparency` — 0 (opaque) … 100 (invisible fill)
 * - `--janosik-glass-blur` — backdrop blur radius in px
 */

const STORAGE_KEY = "janosik-board-glass";

export const GLASS_LIMITS = {
  transparency: { min: 0, max: 100, step: 20, default: 80 },
  blur: { min: 0, max: 20, step: 5, default: 5 },
} as const;

export interface BoardGlass {
  /** 0 = fully opaque, 100 = no fill at all (frame only). */
  transparency: number;
  /** Backdrop blur radius in px; 0 disables the frosted effect. */
  blur: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const DEFAULT_GLASS: BoardGlass = {
  transparency: GLASS_LIMITS.transparency.default,
  blur: GLASS_LIMITS.blur.default,
};

function readStoredGlass(): BoardGlass {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GLASS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_GLASS };
    }
    const { transparency, blur } = parsed as Record<string, unknown>;
    return {
      transparency:
        typeof transparency === "number"
          ? clamp(
              Math.round(transparency),
              GLASS_LIMITS.transparency.min,
              GLASS_LIMITS.transparency.max,
            )
          : DEFAULT_GLASS.transparency,
      blur:
        typeof blur === "number"
          ? clamp(Math.round(blur), GLASS_LIMITS.blur.min, GLASS_LIMITS.blur.max)
          : DEFAULT_GLASS.blur,
    };
  } catch {
    return { ...DEFAULT_GLASS };
  }
}

interface BoardGlassContextValue {
  glass: BoardGlass;
  setGlass: (glass: BoardGlass) => void;
}

const BoardGlassContext = createContext<BoardGlassContextValue | null>(null);

export function BoardGlassProvider({ children }: { children: ReactNode }) {
  const [glass, setGlassState] = useState<BoardGlass>(readStoredGlass);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(glass));
    } catch {
      /* storage unavailable — glass still works for the session */
    }
    const root = document.documentElement;
    root.style.setProperty("--janosik-glass-transparency", String(glass.transparency));
    root.style.setProperty("--janosik-glass-blur", `${glass.blur}px`);
  }, [glass]);

  const setGlass = useCallback((next: BoardGlass) => setGlassState(next), []);

  const value = useMemo(() => ({ glass, setGlass }), [glass, setGlass]);

  return (
    <BoardGlassContext.Provider value={value}>
      {children}
    </BoardGlassContext.Provider>
  );
}

export function useBoardGlass(): BoardGlassContextValue {
  const ctx = useContext(BoardGlassContext);
  if (!ctx) {
    throw new Error("useBoardGlass must be used within a BoardGlassProvider");
  }
  return ctx;
}
