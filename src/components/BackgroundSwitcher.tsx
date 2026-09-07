import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PaletteIcon } from "@/components/ui/palette-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBoardBackground } from "@/hooks/use-board-background";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { BOARD_BACKGROUNDS } from "@/types/board-background";

/**
 * Board background picker — palette icon next to the language switcher.
 * Each option shows a live preview tile of the preset's CSS class; the
 * active one gets a ring + a check badge pinned to the tile's corner,
 * wallpaper-picker style, and dimmed labels on the inactive rows.
 */
export function BackgroundSwitcher() {
  const { background, setBackground } = useBoardBackground();
  const { t } = useI18n();

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
        <DropdownMenuContent align="end" className="w-48">
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
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{t("bg.tooltip")}</TooltipContent>
    </Tooltip>
  );
}
