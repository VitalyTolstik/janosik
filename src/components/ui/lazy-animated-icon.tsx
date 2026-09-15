import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Clock,
  Keyboard,
  Languages,
  Moon,
  Palette,
  Search,
  Settings,
  SquarePen,
  SunDim,
} from "lucide-react";
import type { ComponentType, LazyExoticComponent } from "react";
import { Suspense, lazy, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

// TASK-21.9 (motion-lazy): the lucide-animated icons pull the whole `motion`
// runtime (~40 KB gzip) onto the critical path. They live behind this wrapper
// so the animated chunk is fetched only after the page goes idle — the first
// paint shows a static `lucide-react` twin, which is already in the bundle.
export type AnimatedIconName =
  | "archive"
  | "arrow-left"
  | "arrow-right"
  | "clock"
  | "keyboard"
  | "languages"
  | "moon"
  | "palette"
  | "search"
  | "settings"
  | "square-pen"
  | "sun-dim";

export interface AnimatedIconProps {
  size?: number;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
  /** Test hook: marks the rendered branch (`static` or `animated`). */
  "data-lazy-state"?: "static" | "animated";
}

type AnimatedIcon = ComponentType<AnimatedIconProps>;

interface IconEntry {
  Fallback: LucideIcon;
  Lazy: LazyExoticComponent<AnimatedIcon>;
}

// Only the wrapper is imported eagerly; each `import()` becomes its own chunk
// whose motion dependency lands in the `motion` vendor group (vite.config.ts).
const ICONS: Record<AnimatedIconName, IconEntry> = {
  archive: {
    Fallback: Archive,
    Lazy: lazy(() =>
      import("@/components/ui/archive-icon").then((m) => ({
        default: m.ArchiveIcon,
      })),
    ),
  },
  "arrow-left": {
    Fallback: ArrowLeft,
    Lazy: lazy(() =>
      import("@/components/ui/arrow-left-icon").then((m) => ({
        default: m.ArrowLeftIcon,
      })),
    ),
  },
  "arrow-right": {
    Fallback: ArrowRight,
    Lazy: lazy(() =>
      import("@/components/ui/arrow-right-icon").then((m) => ({
        default: m.ArrowRightIcon,
      })),
    ),
  },
  clock: {
    Fallback: Clock,
    Lazy: lazy(() =>
      import("@/components/ui/clock-icon").then((m) => ({
        default: m.ClockIcon,
      })),
    ),
  },
  keyboard: {
    Fallback: Keyboard,
    Lazy: lazy(() =>
      import("@/components/ui/keyboard").then((m) => ({
        default: m.KeyboardIcon,
      })),
    ),
  },
  languages: {
    Fallback: Languages,
    Lazy: lazy(() =>
      import("@/components/ui/languages-icon").then((m) => ({
        default: m.LanguagesIcon,
      })),
    ),
  },
  moon: {
    Fallback: Moon,
    Lazy: lazy(() =>
      import("@/components/ui/moon-icon").then((m) => ({
        default: m.MoonIcon,
      })),
    ),
  },
  palette: {
    Fallback: Palette,
    Lazy: lazy(() =>
      import("@/components/ui/palette-icon").then((m) => ({
        default: m.PaletteIcon,
      })),
    ),
  },
  search: {
    Fallback: Search,
    Lazy: lazy(() =>
      import("@/components/ui/search").then((m) => ({ default: m.SearchIcon })),
    ),
  },
  settings: {
    Fallback: Settings,
    Lazy: lazy(() =>
      import("@/components/icons/settings").then((m) => ({
        default: m.SettingsIcon,
      })),
    ),
  },
  "square-pen": {
    Fallback: SquarePen,
    Lazy: lazy(() =>
      import("@/components/ui/square-pen-icon").then((m) => ({
        default: m.SquarePenIcon,
      })),
    ),
  },
  "sun-dim": {
    Fallback: SunDim,
    Lazy: lazy(() =>
      import("@/components/ui/sun-dim-icon").then((m) => ({
        default: m.SunDimIcon,
      })),
    ),
  },
};

/**
 * Resolves once the browser reports an idle frame. `requestIdleCallback` is
 * not in Safari, so a `setTimeout` keeps the icons arriving there too.
 */
function scheduleIdle(onIdle: () => void): () => void {
  if (typeof window === "undefined") {
    onIdle();
    return () => {};
  }
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(onIdle);
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(onIdle, 1);
  return () => window.clearTimeout(id);
}

function useIdleOnce(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (idle) return;
    return scheduleIdle(() => setIdle(true));
  }, [idle]);
  return idle;
}

interface LazyAnimatedIconProps extends AnimatedIconProps {
  name: AnimatedIconName;
}

/**
 * Drop-in lazy replacement for the `lucide-animated` header icons. Before the
 * first idle frame it renders the static lucide twin; afterwards it swaps in
 * the animated component (Suspense keeps the static twin while the chunk
 * loads, so the layout never collapses).
 */
export function LazyAnimatedIcon({
  name,
  size = 20,
  className,
  ...rest
}: LazyAnimatedIconProps) {
  const idle = useIdleOnce();
  const { Fallback, Lazy } = ICONS[name];

  const fallback = (
    <Fallback
      size={size}
      className={cn(className)}
      data-lazy-state="static"
      {...rest}
    />
  );

  if (!idle) return fallback;

  return (
    <Suspense fallback={fallback}>
      <Lazy
        size={size}
        className={className}
        data-lazy-state="animated"
        {...rest}
      />
    </Suspense>
  );
}
