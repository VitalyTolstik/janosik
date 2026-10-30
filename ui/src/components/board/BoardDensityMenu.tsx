import { AlignJustify } from "lucide-react";

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
import type { BoardDensity } from "@/hooks/use-board-density";
import { useI18n } from "@/i18n";

/**
 * "Simplify design" (TASK-142) — a persisted checkbox that switches the
 * board cards between the full face and the compact one. Lives on the
 * view-switcher row next to the column-glass menu and is shown for the board
 * view only, because it changes the kanban card face and nothing else.
 *
 * Deliberately a dropdown menu (not a bare checkbox): the hint under it
 * explains what changes, and the menu leaves room for the next display
 * option without crowding the toolbar.
 */
export function BoardDensityMenu({
  density,
  onChange,
}: {
  density: BoardDensity;
  onChange: (density: BoardDensity) => void;
}) {
  const { t } = useI18n();
  const compact = density === "compact";

  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("view.densityMenu")}
              aria-haspopup="menu"
              data-testid="density-menu"
            >
              <AlignJustify className="h-5 w-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-64 p-0">
          <div className="space-y-1.5 px-3 py-2.5">
            <label className="flex cursor-pointer items-start gap-2 text-xs">
              <Checkbox
                aria-label={t("view.simplify")}
                checked={compact}
                onCheckedChange={(checked) =>
                  onChange(checked ? "compact" : "full")
                }
                data-testid="density-toggle"
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">
                  {t("view.simplify")}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {t("view.simplifyHint")}
                </span>
              </span>
            </label>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{t("view.densityMenu")}</TooltipContent>
    </Tooltip>
  );
}
