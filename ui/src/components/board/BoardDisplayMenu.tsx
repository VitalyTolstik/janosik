import { Paintbrush } from "lucide-react";
import { DEFAULT_COLUMN_ACCENT_STYLE } from "@janosik/shared";
import {
  useBoardAccess,
  useBoardActions,
  useBoardState,
} from "@/store/BoardContext";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useBoardGlass } from "@/hooks/use-board-glass";
import { useBoardView } from "@/components/board/BoardViewProvider";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n";
import { GLASS_PRESETS } from "@/utils/board-glass";
import { ColumnStyleOptions } from "./ColumnStyleMenu";

/**
 * Board appearance controls (column style, density, glass) as menu content.
 * The recommended header has no standalone appearance trigger: BoardMenu
 * renders these items from its `...` overflow, so the toolbar keeps one row.
 */
export function BoardAppearanceMenuItems() {
  const { t } = useI18n();
  const { board } = useBoardState();
  const { setBoardColumnStyle } = useBoardActions();
  const { role } = useBoardAccess();
  const { density, setDensity } = useBoardView();
  const { glass, setGlass } = useBoardGlass();
  // Below lg the portal submenu can be clamped off-screen by the phone
  // viewport; render the same options inline in the anchored menu.
  const inlineColumnStyles = useMediaQuery("(max-width: 1023px)");
  const readOnly = role === "VIEWER" || board?.archivedAt !== undefined;

  return (
    <>
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
              value={board?.columnStyle ?? DEFAULT_COLUMN_ACCENT_STYLE}
              onChange={setBoardColumnStyle}
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
                  value={board?.columnStyle ?? DEFAULT_COLUMN_ACCENT_STYLE}
                  onChange={setBoardColumnStyle}
                />
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ))}
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={density === "compact"}
        onCheckedChange={(checked) => setDensity(checked ? "compact" : "full")}
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
    </>
  );
}
