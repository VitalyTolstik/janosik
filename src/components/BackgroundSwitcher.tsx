import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PaletteIcon } from "@/components/ui/palette-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBoardBackground } from "@/hooks/use-board-background";
import {
  GLASS_LIMITS,
  useBoardGlass,
} from "@/hooks/use-board-glass";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { BOARD_BACKGROUNDS } from "@/types/board-background";

/**
 * Board background picker — palette icon next to the language switcher.
 * Each option shows a live preview tile of the preset's CSS class; the
 * active one gets a ring + a check badge pinned to the tile's corner,
 * wallpaper-picker style, and dimmed labels on the inactive rows.
 *
 * Below the presets: column glass sliders (transparency + blur) — changes
 * apply live and persist. The sliders live in plain (non-item) rows so the
 * menu doesn't close on interaction; keydown is stopped from bubbling so
 * arrow keys drive the slider, not menu navigation.
 */
export function BackgroundSwitcher() {
  const { background, setBackground } = useBoardBackground();
  const { glass, setGlass } = useBoardGlass();
  const { t } = useI18n();

  const stopKeys = (event: React.KeyboardEvent) => event.stopPropagation();

  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("bg.aria")}
              aria-haspopup="menu"
            >
              <PaletteIcon size={20} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {BOARD_BACKGROUNDS.map((bg) => {
            const active = background === bg.id;
            return (
              <DropdownMenuItem
                key={bg.id}
                onClick={() => setBackground(bg.id)}
                className="gap-2.5"
              >
                <span
                  aria-hidden
                  className={cn(
                    "relative h-6 w-9 shrink-0 rounded-md border border-border/60",
                    bg.previewClassName,
                    active &&
                      "ring-2 ring-[var(--janosik-brand-accent)] ring-offset-1 ring-offset-popover",
                  )}
                >
                  {active && (
                    <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--janosik-brand-accent)] text-primary-foreground ring-2 ring-popover">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "flex-1",
                    active && "font-medium text-foreground",
                    !active && "text-muted-foreground",
                  )}
                >
                  {t(bg.labelKey)}
                </span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5" onKeyDown={stopKeys}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {t("bg.glassTitle")}
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 text-muted-foreground">
                {t("bg.glassOpacity")}
              </span>
              <input
                type="range"
                min={GLASS_LIMITS.transparency.min}
                max={GLASS_LIMITS.transparency.max}
                step={GLASS_LIMITS.transparency.step}
                value={glass.transparency}
                onChange={(event) =>
                  setGlass({
                    ...glass,
                    transparency: Number(event.target.value),
                  })
                }
                data-testid="glass-opacity"
                className="h-1 flex-1 accent-primary"
              />
              <span className="w-9 text-right tabular-nums text-muted-foreground">
                {glass.transparency}%
              </span>
            </label>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 text-muted-foreground">
                {t("bg.glassBlur")}
              </span>
              <input
                type="range"
                min={GLASS_LIMITS.blur.min}
                max={GLASS_LIMITS.blur.max}
                step={GLASS_LIMITS.blur.step}
                value={glass.blur}
                onChange={(event) =>
                  setGlass({ ...glass, blur: Number(event.target.value) })
                }
                data-testid="glass-blur"
                className="h-1 flex-1 accent-primary"
              />
              <span className="w-9 text-right tabular-nums text-muted-foreground">
                {glass.blur}px
              </span>
            </label>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{t("bg.tooltip")}</TooltipContent>
    </Tooltip>
  );
}
