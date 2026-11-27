import { useRef, useState } from "react";
import {
  Archive,
  Database,
  HelpCircle,
  MoreHorizontal,
  Settings2,
} from "lucide-react";

import { DataMenuDialogs, DataMenuItems } from "@/components/DataMenu";
import { useDataMenu } from "@/hooks/use-data-menu";
import { HelpMenuItems } from "@/components/HelpMenu";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { useShortcutsHotkey } from "@/hooks/use-shortcuts-hotkey";
import { useI18n } from "@/i18n";
import { useBoard, useBoardAccess } from "@/store/BoardContext";

/**
 * The board's overflow menu (H1): low-frequency admin and recovery actions
 * that used to hold permanent header slots. Board settings, data & backups,
 * help and the card archive live here at every width, so the header can keep
 * only the daily jobs and the card archive is never stranded on a phone.
 *
 * The menu rows reuse the existing DataMenu controller, HelpMenu items and
 * dialogs. Focus returns to this trigger after every dialog; after Settings,
 * `restoreBoardSettingsFocus` resolves this trigger once the item itself has
 * unmounted with the menu.
 */
interface BoardMenuProps {
  onOpenSettings: () => void;
  filter?: boolean;
  kanban?: boolean;
  canEdit?: boolean;
  selectable?: boolean;
}

export function BoardMenu({
  onOpenSettings,
  filter,
  kanban,
  canEdit,
  selectable,
}: BoardMenuProps) {
  const { t } = useI18n();
  const { board } = useBoard();
  const { role } = useBoardAccess();
  const data = useDataMenu();
  const [menuOpen, setMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useShortcutsHotkey(() => setShortcutsOpen(true));

  const archived = board?.archivedAt !== undefined;
  const canOpenSettings = board !== undefined && role === "ADMIN" && !archived;

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          data.onMenuOpenChange(open);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={triggerRef}
                variant="ghost"
                size="icon"
                aria-label={t("board.menu.button")}
                data-testid="board-menu-trigger"
                className="max-lg:h-11 max-lg:w-11 max-lg:min-w-11 lg:h-8 lg:w-8 lg:min-w-8"
              >
                <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("board.menu.button")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-60">
          {canOpenSettings ? (
            <>
              <DropdownMenuItem
                className="max-lg:h-11"
                data-testid="board-settings-trigger"
                onClick={onOpenSettings}
              >
                <Settings2 className="h-4 w-4" />
                {t("board.settings.button")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}

          <DropdownMenuSub
            onOpenChange={(open) => {
              if (open) data.onMenuOpenChange(true);
            }}
          >
            <DropdownMenuSubTrigger
              className="max-lg:h-11"
              data-testid="board-menu-data"
            >
              <Database className="h-4 w-4" />
              {t("data.tooltip")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <DataMenuItems menu={data} includeArchive={false} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem
            className="max-lg:h-11"
            data-testid="board-menu-archive"
            onClick={() => data.setArchiveOpen(true)}
          >
            <Archive className="h-4 w-4" />
            {data.archivedCount > 0
              ? `${t("data.archiveTitle")} · ${data.archivedCount}`
              : t("data.archiveTitle")}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="max-lg:h-11"
              data-testid="board-menu-help"
            >
              <HelpCircle className="h-4 w-4" />
              {t("help.aria")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <HelpMenuItems onShortcuts={() => setShortcutsOpen(true)} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <DataMenuDialogs menu={data} returnFocusRef={triggerRef} />
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        filter={filter}
        kanban={kanban}
        canEdit={canEdit}
        selectable={selectable}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
