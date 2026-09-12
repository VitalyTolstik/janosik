import { SettingsIcon } from "@/components/icons/settings";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { GLASS_PRESETS, useBoardGlass } from "@/hooks/use-board-glass";
import { useI18n } from "@/i18n";

/**
 * Column glass controls — on/off checkboxes for column transparency and
 * backdrop blur over the board background. Lives on the view-switcher row
 * and is shown only for the board view, since it affects nothing else.
 * Changes apply live and persist (see BoardGlassProvider).
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
            <label className="flex h-6 cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                aria-label={t("bg.glassOpacity")}
                checked={glass.transparency > 0}
                onCheckedChange={(checked) =>
                  setGlass({
                    ...glass,
                    transparency: checked
                      ? GLASS_PRESETS.transparency.on
                      : GLASS_PRESETS.transparency.off,
                  })
                }
                data-testid="glass-opacity"
              />
              <span className="text-muted-foreground">
                {t("bg.glassOpacity")}
              </span>
            </label>
            <label className="flex h-6 cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                aria-label={t("bg.glassBlur")}
                checked={glass.blur > 0}
                onCheckedChange={(checked) =>
                  setGlass({
                    ...glass,
                    blur: checked
                      ? GLASS_PRESETS.blur.on
                      : GLASS_PRESETS.blur.off,
                  })
                }
                data-testid="glass-blur"
              />
              <span className="text-muted-foreground">{t("bg.glassBlur")}</span>
            </label>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{t("bg.glassMenu")}</TooltipContent>
    </Tooltip>
  );
}
