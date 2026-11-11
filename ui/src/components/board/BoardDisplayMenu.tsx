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
            >
              <Menu className="h-5 w-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs">
            {t("view.displayMenu")}
          </DropdownMenuLabel>
          {!readOnly && (
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
          )}
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
