import { useCallback, useRef, useState } from "react";
import { ArchiveIcon } from "@/components/ui/archive-icon";
import {
  Archive,
  Download,
  HardDrive,
  HardDriveDownload,
  Upload,
} from "lucide-react";

import { useToast } from "@/components/Toast";
import { ArchiveDialog } from "@/components/board/ArchiveDialog";
import { BackupDialog } from "@/components/board/BackupDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { MAX_IMPORT_BYTES } from "@/types/kanban";
import { useBoard } from "@/store/BoardContext";
import { parseExport, serializeExport } from "@/utils/board-serialization";
import {
  createBackup,
  listBackups,
} from "@/utils/backup";

/**
 * Data & backups menu — export/import the board data as JSON, create a
 * manual backup copy, plus two entry points that open dedicated dialogs:
 * the card archive and the automatic backups browser (keeps the dropdown
 * compact no matter how many entries pile up). Export failures and import
 * validation errors surface as toasts.
 */

export function DataMenu() {
  const { t } = useI18n();
  const toast = useToast();
  const { boards, board, importBoards } = useBoard();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [backupCount, setBackupCount] = useState<number | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);

  const archivedCount = board
    ? Object.values(board.cards).filter((card) => card.archivedAt !== undefined)
        .length
    : 0;

  const refreshBackups = useCallback(async () => {
    try {
      setBackupCount((await listBackups()).length);
    } catch {
      setBackupCount(0);
    }
  }, []);

  const handleExport = () => {
    try {
      const json = serializeExport(boards);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "janosik-boards.json";
      a.click();
      URL.revokeObjectURL(url);
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
      const boards = parseExport(text);
      importBoards(boards);
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
          if (open) void refreshBackups();
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
                <ArchiveIcon size={20} />
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
          <DropdownMenuItem onClick={handleBackupNow}>
            <HardDriveDownload className="h-4 w-4" />
            {t("data.backupNow")}
          </DropdownMenuItem>
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
            data-testid="data-backups"
            onClick={() => setBackupsOpen(true)}
          >
            <HardDrive className="h-4 w-4" />
            {backupCount !== null && backupCount > 0
              ? `${t("data.backupTitle")} · ${backupCount}`
              : t("data.backupTitle")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={inputRef}
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
      <BackupDialog open={backupsOpen} onOpenChange={setBackupsOpen} />
    </>
  );
}
