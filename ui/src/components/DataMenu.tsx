import { useRef, type RefObject } from "react";
import {
  Archive,
  Download,
  FileDown,
  HardDrive,
  HardDriveDownload,
  Undo2,
  Upload,
  Workflow,
} from "lucide-react";

import { ArchiveDialog } from "@/components/board/ArchiveDialog";
import { BackupDialog } from "@/components/board/BackupDialog";
import { RecentlyDeletedDialog } from "@/components/board/RecentlyDeletedDialog";
import { WorkflowRulesDialog } from "@/components/board/WorkflowRulesDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDataMenu, type DataMenuController } from "@/hooks/use-data-menu";
import { useI18n } from "@/i18n";

/**
 * Data & backups actions — export/import the board data as JSON, create a
 * manual backup copy, plus entry points that open the card archive and the
 * automatic backups browser. Export failures and import validation errors
 * surface as toasts. With a server (TASK-29) import goes to
 * `POST /boards/import`; the account itself lives in the header panel
 * (TASK-36.1), not here.
 *
 * H1 splits the stateful controller (`useDataMenu`) from the menu rows: the
 * header's Board menu renders the same rows in a submenu, so the standalone
 * DataMenu and the Board menu can never drift into two implementations.
 */

/** The menu rows. `includeArchive` is false in the Board menu, which lifts
 *  the card archive to a top-level item. */
export function DataMenuItems({
  menu,
  includeArchive = true,
}: {
  menu: DataMenuController;
  includeArchive?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      <DropdownMenuItem
        className="max-lg:h-11"
        data-testid="data-export-board"
        disabled={menu.menuBoard === undefined}
        title={
          menu.menuBoard === undefined
            ? t("data.exportBoardDisabled")
            : undefined
        }
        onClick={() => void menu.handleExportBoard()}
      >
        <FileDown className="h-4 w-4" />
        {t("data.exportBoard")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className="max-lg:h-11"
        onClick={() => void menu.handleExport()}
      >
        <Download className="h-4 w-4" />
        {t("data.export")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className="max-lg:h-11"
        onSelect={() => menu.inputRef.current?.click()}
      >
        <Upload className="h-4 w-4" />
        {t("data.import")}
      </DropdownMenuItem>
      {!menu.serverMode ? (
        <DropdownMenuItem
          className="max-lg:h-11"
          onClick={() => void menu.handleBackupNow()}
        >
          <HardDriveDownload className="h-4 w-4" />
          {t("data.backupNow")}
        </DropdownMenuItem>
      ) : null}
      {includeArchive ? (
        <DropdownMenuItem
          className="max-lg:h-11"
          data-testid="data-archive"
          onClick={() => menu.setArchiveOpen(true)}
        >
          <Archive className="h-4 w-4" />
          {menu.archivedCount > 0
            ? `${t("data.archiveTitle")} · ${menu.archivedCount}`
            : t("data.archiveTitle")}
        </DropdownMenuItem>
      ) : null}
      {menu.serverMode && menu.menuRole !== "VIEWER" ? (
        <DropdownMenuItem
          className="max-lg:h-11"
          data-testid="data-deleted"
          disabled={menu.menuBoard === undefined || menu.menuRole === undefined}
          title={
            menu.menuBoard === undefined || menu.menuRole === undefined
              ? t("data.exportBoardDisabled")
              : undefined
          }
          onClick={() => menu.setDeletedOpen(true)}
        >
          <Undo2 className="h-4 w-4" />
          {t("deleted.title")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        className="max-lg:h-11"
        data-testid="data-workflow-rules"
        onClick={() => menu.setRulesOpen(true)}
      >
        <Workflow className="h-4 w-4" />
        {t("workflow.rules")}
      </DropdownMenuItem>
      {!menu.serverMode ? (
        <DropdownMenuItem
          className="max-lg:h-11"
          data-testid="data-backups"
          onClick={() => menu.setBackupsOpen(true)}
        >
          <HardDrive className="h-4 w-4" />
          {menu.backupCount !== null && menu.backupCount > 0
            ? `${t("data.backupTitle")} · ${menu.backupCount}`
            : t("data.backupTitle")}
          {menu.backupCount === null ? (
            <Skeleton
              width={18}
              height={10}
              data-testid="data-backup-count-skeleton"
            />
          ) : null}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/** Dialogs and the hidden import input, mounted once per controller. */
export function DataMenuDialogs({
  menu,
  returnFocusRef,
}: {
  menu: DataMenuController;
  returnFocusRef?: RefObject<HTMLElement>;
}) {
  const {
    archiveOpen,
    backupsOpen,
    deletedOpen,
    handleFileChosen,
    inputRef,
    menuBoard,
    rulesOpen,
    serverMode,
    setArchiveOpen,
    setBackupsOpen,
    setDeletedOpen,
    setRulesOpen,
  } = menu;
  return (
    <>
      <input
        ref={inputRef}
        name="import-file"
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          void handleFileChosen(file);
          e.target.value = "";
        }}
      />
      <ArchiveDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        boardId={menuBoard?.id}
        returnFocusRef={returnFocusRef}
      />
      <RecentlyDeletedDialog
        open={deletedOpen && menuBoard !== undefined}
        onOpenChange={setDeletedOpen}
        boardId={menuBoard?.id}
        returnFocusRef={returnFocusRef}
      />
      {!serverMode ? (
        <BackupDialog
          open={backupsOpen}
          onOpenChange={setBackupsOpen}
          returnFocusRef={returnFocusRef}
        />
      ) : null}
      <WorkflowRulesDialog
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}

/** Standalone Data & backups menu (kept for tests and other board shells). */
export function DataMenu() {
  const { t } = useI18n();
  const menu = useDataMenu();
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <DropdownMenu onOpenChange={menu.onMenuOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={triggerRef}
                variant="ghost"
                size="icon"
                aria-label={t("data.tooltip")}
                className="max-lg:h-11 max-lg:w-11 max-lg:min-w-11"
              >
                {/* Cloud + restore-cycle: the recognizable “backup” symbol
                 * (same as OneDrive/iCloud sync badges). Intentionally static. */}
                <LazyAnimatedIcon name="archive" size={20} />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("data.tooltip")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{t("data.tooltip")}</DropdownMenuLabel>
          <DataMenuItems menu={menu} />
        </DropdownMenuContent>
      </DropdownMenu>
      <DataMenuDialogs menu={menu} returnFocusRef={triggerRef} />
    </>
  );
}
