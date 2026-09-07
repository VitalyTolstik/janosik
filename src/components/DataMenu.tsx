import { useRef } from "react";
import {
  Archive,
  Download,
  HardDriveDownload,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";

import { useToast } from "@/components/Toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import {
  parseExport,
  serializeExport,
} from "@/utils/board-serialization";
import {
  createBackup,
  deleteBackup,
  listBackups,
  loadBackup,
  type BackupMeta,
} from "@/utils/backup";

/**
 * Data & backups menu — export/import the board data as JSON, create a
 * manual backup copy, and restore or delete earlier automatic backups.
 * Export failures and import validation errors surface as toasts.
 */

export function DataMenu() {
  const { t } = useI18n();
  const toast = useToast();
  const { boards, importBoards } = useBoard();
  const inputRef = useRef<HTMLInputElement | null>(null);

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
      toast.success(t("data.backupSaved"));
    } catch {
      toast.error(t("data.backupFailed"));
    }
  };

  const handleRestore = async (id: number) => {
    try {
      const boards = await loadBackup(id);
      if (boards) {
        importBoards(boards);
        toast.success(t("data.restoreSuccess"));
      } else {
        toast.error(t("data.restoreFailed"));
      }
    } catch {
      toast.error(t("data.restoreFailed"));
    }
  };

  const handleDeleteBackup = async (id: number) => {
    try {
      await deleteBackup(id);
      await refreshBackups();
    } catch {
      toast.error(t("data.backupFailed"));
    }
  };

  // The menu stays mounted once opened — a ref keeps the latest list.
  const backupsRef = useRef<BackupMeta[] | null>(null);
  const refreshBackups = async () => {
    try {
      backupsRef.current = await listBackups();
    } catch {
      backupsRef.current = [];
    }
  };
  void refreshBackups();

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("data.tooltip")}
              >
                <Archive className="h-5 w-5" />
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
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t("data.backupTitle")}</DropdownMenuLabel>
          {backupsRef.current === null || backupsRef.current.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("data.backupEmpty")}
            </div>
          ) : (
            backupsRef.current.slice(0, 5).map((backup) => (
              <div
                key={backup.id}
                className="flex items-center gap-1 px-1 py-0.5"
              >
                <span className="flex-1 truncate text-xs text-muted-foreground">
                  {new Date(backup.createdAt).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={t("data.restore")}
                  onClick={() => handleRestore(backup.id)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  aria-label={t("data.deleteBackup")}
                  onClick={() => handleDeleteBackup(backup.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
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
    </>
  );
}