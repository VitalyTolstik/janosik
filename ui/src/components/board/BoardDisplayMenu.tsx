import { Menu, Paintbrush } from "lucide-react";
import type { ColumnAccentStyle } from "@janosik/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBoardGlass } from "@/hooks/use-board-glass";
import type { BoardDensity } from "@/hooks/use-board-density";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n";
import { GLASS_PRESETS } from "@/utils/board-glass";
import { ColumnStyleOptions } from "./ColumnStyleMenu";

export function BoardDisplayMenu({
  density,
  onDensityChange,
  columnStyle,
  onColumnStyleChange,
  readOnly,
}: {
  density: BoardDensity;
  onDensityChange: (value: BoardDensity) => void;
  columnStyle: ColumnAccentStyle;
  onColumnStyleChange: (value: ColumnAccentStyle) => void;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const { glass, setGlass } = useBoardGlass();
  // Below lg the portal submenu can be clamped off-screen by the phone
  // viewport; render the same options inline in the anchored display menu.
  const inlineColumnStyles = useMediaQuery("(max-width: 1023px)");
  return (
    <Tooltip>
      <DropdownMenu modal={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("view.displayMenu")}
              data-testid="board-display-menu"
              className="max-lg:h-11 max-lg:w-11"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent
          align="end"
          collisionPadding={8}
          className="w-64 max-lg:max-h-[var(--radix-dropdown-menu-content-available-height)] max-lg:w-[min(20rem,calc(100vw-1rem))] max-lg:overflow-y-auto max-lg:overscroll-contain"
        >
          <DropdownMenuLabel className="text-ui-label">
            {t("view.displayMenu")}
          </DropdownMenuLabel>
          {!readOnly &&
            (inlineColumnStyles ? (
              <div data-testid="column-style-inline">
                <div className="px-2 pb-1 pt-1">
                  <div className="text-ui-label font-medium text-foreground">
                    {t("column.styleMenu")}
                  </div>
                  <div className="mt-0.5 text-ui-meta text-muted-foreground">
                    {t("column.styleMenuHint")}
                  </div>
                </div>
                <ColumnStyleOptions
                  value={columnStyle}
                  onChange={onColumnStyleChange}
                />
              </div>
            ) : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid="column-style-menu">
                  <Paintbrush aria-hidden />
                  {t("column.styleMenu")}
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="max-h-[min(70vh,32rem)] w-72 overflow-y-auto p-1.5">
                    <ColumnStyleOptions
                      value={columnStyle}
                      onChange={onColumnStyleChange}
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={density === "compact"}
            onCheckedChange={(checked) =>
              onDensityChange(checked ? "compact" : "full")
            }
            onSelect={(event) => event.preventDefault()}
            data-testid="density-toggle"
          >
            {t("view.simplify")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={glass.transparency > 0}
            onCheckedChange={(checked) =>
              setGlass({
                ...glass,
                transparency: checked
                  ? GLASS_PRESETS.transparency.on
                  : GLASS_PRESETS.transparency.off,
              })
            }
            onSelect={(event) => event.preventDefault()}
            data-testid="glass-opacity"
          >
            {t("bg.glassOpacity")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={glass.blur > 0}
            onCheckedChange={(checked) =>
              setGlass({
                ...glass,
                blur: checked ? GLASS_PRESETS.blur.on : GLASS_PRESETS.blur.off,
              })
            }
            onSelect={(event) => event.preventDefault()}
            data-testid="glass-blur"
          >
            {t("bg.glassBlur")}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{t("view.displayMenu")}</TooltipContent>
    </Tooltip>
  );
}
