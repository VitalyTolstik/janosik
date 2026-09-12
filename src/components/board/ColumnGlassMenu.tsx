import { SettingsIcon } from "@/components/icons/settings";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GLASS_LIMITS, useBoardGlass } from "@/hooks/use-board-glass";
import { useI18n } from "@/i18n";

/**
 * Column glass controls — sliders for column transparency and backdrop
 * blur over the board background. Lives on the view-switcher row and is
 * shown only for the board view, since it affects nothing else. Changes
 * apply live and persist (see BoardGlassProvider).
 */
export function ColumnGlassMenu() {
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
              aria-label={t("bg.glassMenu")}
              aria-haspopup="menu"
            >
              {/* lucide-animated SettingsIcon — spring-spins 180° on
                  hover (motion-powered, see lucide-animated.com). */}
              <SettingsIcon size={20} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-64 p-0">
          <div className="space-y-1.5 px-3 py-2.5" onKeyDown={stopKeys}>
            <label className="flex h-6 items-center gap-2 text-xs">
              <span className="w-20 shrink-0 text-muted-foreground">
                {t("bg.glassOpacity")}
              </span>
              <input
                type="range"
                aria-label={t("bg.glassOpacity")}
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
                className="h-1 min-w-0 flex-1 accent-primary"
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                {glass.transparency}%
              </span>
            </label>
            <label className="flex h-6 items-center gap-2 text-xs">
              <span className="w-20 shrink-0 text-muted-foreground">
                {t("bg.glassBlur")}
              </span>
              {/* No numeric readout here — a pixel count means nothing to
                  the user; the visual effect is the feedback. The empty
                  chip keeps the row aligned with the transparency one. */}
              <input
                type="range"
                aria-label={t("bg.glassBlur")}
                min={GLASS_LIMITS.blur.min}
                max={GLASS_LIMITS.blur.max}
                step={GLASS_LIMITS.blur.step}
                value={glass.blur}
                onChange={(event) =>
                  setGlass({ ...glass, blur: Number(event.target.value) })
                }
                data-testid="glass-blur"
                className="h-1 min-w-0 flex-1 accent-primary"
              />
              <span aria-hidden className="w-10 shrink-0" />
            </label>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{t("bg.glassMenu")}</TooltipContent>
    </Tooltip>
  );
}
