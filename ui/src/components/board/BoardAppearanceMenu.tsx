import { useState } from "react";
import { MoreHorizontal } from "lucide-react";

import { BoardAppearanceMenuItems } from "@/components/board/BoardDisplayMenu";
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
import { useI18n } from "@/i18n";

/**
 * The toolbar's `...` overflow (recommended header): Board appearance only.
 * The low-frequency board actions live in the header's Board menu, so the two
 * menus never repeat an item.
 */
export function BoardAppearanceMenu() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const label = t("view.displayMenu");

  return (
    <Tooltip>
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              data-testid="board-toolbar-menu"
              className="max-lg:h-11 max-lg:w-11 max-lg:min-w-11 lg:h-8 lg:w-8 lg:min-w-8"
            >
              <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent
          align="end"
          collisionPadding={8}
          className="w-64 max-lg:max-h-[var(--radix-dropdown-menu-content-available-height)] max-lg:w-[min(20rem,calc(100vw-1rem))] max-lg:overflow-y-auto max-lg:overscroll-contain"
        >
          <BoardAppearanceMenuItems />
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
