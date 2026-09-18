import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
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

interface BackgroundSwitcherProps {
  /** `icon` (header trigger) or `row` (account preferences). */
  variant?: "icon" | "row";
}

/**
 * Board background picker — palette icon next to the language switcher.
 * Each option shows a live preview tile of the preset's CSS class; the
 * active one gets a ring + a check badge pinned to the tile's corner,
 * wallpaper-picker style, and dimmed labels on the inactive rows.
 * (Column transparency/blur live in the board view's ColumnGlassMenu.)
 */
export function BackgroundSwitcher({
  variant = "icon",
}: BackgroundSwitcherProps) {
  const { background, setBackground } = useBoardBackground();
  const { t } = useI18n();
  const active = BOARD_BACKGROUNDS.find((bg) => bg.id === background);

  const trigger =
    variant === "row" ? (
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        data-testid="pref-background"
        aria-label={t("bg.aria")}
        aria-haspopup="menu"
      >
        <span
          aria-hidden
          className={cn(
            "h-4 w-6 shrink-0 rounded border border-border/60",
            active?.previewClassName,
          )}
        />
        <span>{active ? t(active.labelKey) : t("bg.aria")}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-50" />
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("bg.aria")}
        aria-haspopup="menu"
      >
        <LazyAnimatedIcon name="palette" size={20} />
      </Button>
    );

  const menu = (
    <DropdownMenu>
      {variant === "icon" ? (
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        </TooltipTrigger>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="end" className="w-48">
        {BOARD_BACKGROUNDS.map((bg) => {
          const isActive = background === bg.id;
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
                  isActive &&
                    "ring-2 ring-[var(--janosik-brand-accent)] ring-offset-1 ring-offset-popover",
                )}
              >
                {isActive && (
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--janosik-brand-accent)] text-primary-foreground ring-2 ring-popover">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "flex-1",
                  isActive && "font-medium text-foreground",
                  !isActive && "text-muted-foreground",
                )}
              >
                {t(bg.labelKey)}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (variant === "row") return menu;

  return (
    <Tooltip>
      {menu}
      <TooltipContent>{t("bg.tooltip")}</TooltipContent>
    </Tooltip>
  );
}
