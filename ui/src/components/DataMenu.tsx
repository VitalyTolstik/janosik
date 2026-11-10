import { useCallback, useMemo, useRef, useState } from "react";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import {
  Archive,
  Download,
  HardDrive,
  HardDriveDownload,
  Upload,
  Workflow,
} from "lucide-react";

import { useToast } from "@/components/Toast";
import { ArchiveDialog } from "@/components/board/ArchiveDialog";
import { BackupDialog } from "@/components/board/BackupDialog";
import { WorkflowRulesDialog } from "@/components/board/WorkflowRulesDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { MAX_BOARD_EXPORT_BYTES, MAX_IMPORT_BYTES } from "@janosik/shared";
import { isApiEnabled } from "@/api/client";
import { useBoard } from "@/store/BoardContext";
import { parseExport, serializeExport } from "@janosik/shared";
import { downloadTextFile } from "@/utils/download";
import { estimateBoardExportBytes } from "@/utils/export-size";
import { createBackup, listBackups } from "@/utils/backup";

/**
 * Data & backups menu — export/import the board data as JSON, create a
 * manual backup copy, plus two entry points that open dedicated dialogs:
 * the card archive and the automatic backups browser (keeps the dropdown
 * compact no matter how many entries pile up). Export failures and import
 * validation errors surface as toasts. With a server (TASK-29) import goes
 * to `POST /boards/import`; the account itself lives in the header panel
 * (TASK-36.1), not here.
 */

export function DataMenu() {
  const { t } = useI18n();
  const toast = useToast();
  const { boards, board, importBoards } = useBoard();
  // TASK-166 D21: Janosik does not create backups. Server mode shows only
  // export/import; the local "save a copy" / automatic-backup browser is a
  // localStorage-only safety net and must not imply server backups.
  const serverMode = isApiEnabled();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [backupCount, setBackupCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  // Counted only while the menu is open (TASK-21.4.1): this component
  // re-renders on every keystroke anywhere on the board, and walking every
  // card to label a closed menu item is pure waste.
  const archivedCount = useMemo(
    () =>
      menuOpen && board
        ? Object.values(board.cards).filter(
            (card) => card.archivedAt !== undefined,
          ).length
        : 0,
    [menuOpen, board],
  );

  const refreshBackups = useCallback(async () => {
    try {
      setBackupCount((await listBackups()).length);
    } catch {
      setBackupCount(0);
    }
  }, []);

  const handleExport = () => {
    try {
      // Preflight first: a multi-hundred-MB board must not be stringified
      // just to discover it is over the cap. The estimate is rough, so it
      // only hard-stops gross oversize; the exact check below decides the
      // 25 MB boundary (avoid false positives near the limit).
      if (estimateBoardExportBytes(boards) > MAX_BOARD_EXPORT_BYTES * 4) {
        toast.error(t("data.exportTooLarge"));
        return;
      }
      const raw = serializeExport(boards);
      // TASK-166.6: the combined file must be importable again. The server
      // import cap is 25 MB; never hand the user a file it would reject.
      if (new TextEncoder().encode(raw).length > MAX_BOARD_EXPORT_BYTES) {
        toast.error(t("data.exportTooLarge"));
        return;
      }
      downloadTextFile("janosik-boards.json", raw);
      toast.success(t("data.exportSuccess"));
    } catch {
      toast.error(t("data.exportFailed"));
    }
  };

  const handleFileChosen = async (file: File | undefined) => {
    if (!file) return;
    // Refuse oversized files before reading them into memory.
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error(t("data.importTooLarge"));
      return;
    }
    try {
      const text = await file.text();
      // TASK-166: the 10-board guard is local/offline only. In server mode
      // the operator cap (or no cap) is enforced by the API, so do not clip
      // the file in the browser.
      const boards = parseExport(text, {
        maxBoards: serverMode ? null : undefined,
      });
      // Server mode: the boards land in the database, then the list is
      // re-hydrated; a refusal is reported by the provider and resolves
      // `false`, so this handler does not add a success toast on top.
      const imported = await importBoards(boards);
      if (imported === false) return;
      toast.success(t("data.importSuccess"));
    } catch {
      toast.error(t("data.importError"));
    }
  };

  const handleBackupNow = async () => {
    try {
      await createBackup(boards);
      await refreshBackups();
      toast.success(t("data.backupSaved"));
    } catch {
      toast.error(t("data.backupFailed"));
    }
  };

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open && !serverMode) void refreshBackups();
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("data.tooltip")}
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
          <DropdownMenuItem onClick={handleExport}>
            <Download className="h-4 w-4" />
            {t("data.export")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {t("data.import")}
          </DropdownMenuItem>
          {!serverMode ? (
            <>
              <DropdownMenuItem onClick={handleBackupNow}>
                <HardDriveDownload className="h-4 w-4" />
                {t("data.backupNow")}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem
            data-testid="data-archive"
            onClick={() => setArchiveOpen(true)}
          >
            <Archive className="h-4 w-4" />
            {archivedCount > 0
              ? `${t("data.archiveTitle")} · ${archivedCount}`
              : t("data.archiveTitle")}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="data-workflow-rules"
            onClick={() => setRulesOpen(true)}
          >
            <Workflow className="h-4 w-4" />
            {t("workflow.rules")}
          </DropdownMenuItem>
          {!serverMode ? (
            <DropdownMenuItem
              data-testid="data-backups"
              onClick={() => setBackupsOpen(true)}
            >
              <HardDrive className="h-4 w-4" />
              {backupCount !== null && backupCount > 0
                ? `${t("data.backupTitle")} · ${backupCount}`
                : t("data.backupTitle")}
              {menuOpen && backupCount === null ? (
                <Skeleton
                  width={18}
                  height={10}
                  data-testid="data-backup-count-skeleton"
                />
              ) : null}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
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
      <ArchiveDialog open={archiveOpen} onOpenChange={setArchiveOpen} />
      {!serverMode ? (
        <BackupDialog open={backupsOpen} onOpenChange={setBackupsOpen} />
      ) : null}
      <WorkflowRulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />
    </>
  );
}
