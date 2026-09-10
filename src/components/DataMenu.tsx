import { useCallback, useEffect, useRef, useState } from "react";
import { ArchiveIcon } from "@/components/ui/archive-icon";
import {
  Check,
  Download,
  HardDriveDownload,
  RotateCcw,
  Trash2,
  Upload,
  X,
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
import { parseExport, serializeExport } from "@/utils/board-serialization";
import { formatBackupTimestamp } from "@/utils/backup-timestamp";
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
 *
 * The backup list is React state (not a ref) and is re-read every time
 * the menu opens, so restored/deleted entries always render accurately.
 */

export function DataMenu() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { boards, importBoards } = useBoard();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [backups, setBackups] = useState<BackupMeta[] | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Radix locks page scroll (RemoveScroll) and preventDefaults wheel events
  // over the portaled menu at the document level — after any listener on the
  // list itself, so the native scroll never fires. Listen on the document
  // bubble phase and scroll the list manually when the default was
  // suppressed (outside a lock nothing is prevented and the browser
  // scrolls natively). Same workaround as the TimePicker columns.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const list = listRef.current;
      if (e.defaultPrevented && list && list.contains(e.target as Node)) {
        list.scrollTop += e.deltaY;
      }
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  const refreshBackups = useCallback(async () => {
    try {
      setBackups(await listBackups());
    } catch {
      setBackups([]);
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

  const handleRestore = async (id: number) => {
    try {
      const restored = await loadBackup(id);
      if (!restored) {
        toast.error(t("data.restoreFailed"));
        return;
      }
      // Safety net: snapshot the current state before it is overwritten.
      await createBackup(boards);
      importBoards(restored);
      await refreshBackups();
      toast.success(t("data.restoreSuccess"));
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

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            setConfirmRestoreId(null);
            void refreshBackups();
          }
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
          <DropdownMenuSeparator />
          <DropdownMenuLabel>
            {backups !== null && backups.length > 0
              ? `${t("data.backupTitle")} · ${backups.length}`
              : t("data.backupTitle")}
          </DropdownMenuLabel>
          {backups === null || backups.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("data.backupEmpty")}
            </div>
          ) : (
            <div
              ref={listRef}
              className="janosik-backup-list max-h-56 overflow-y-auto"
            >
              {backups.map((backup) => {
                const confirming = confirmRestoreId === backup.id;
                const timestamp = new Date(backup.createdAt).getTime();
                return (
                  <div
                    key={backup.id}
                    className="rounded-md px-1 py-0.5"
                  >
                    {confirming ? (
                      <div className="flex items-center gap-1 rounded-md bg-hover px-1.5 py-1">
                        <span className="flex-1 text-xs">
                          {t("data.restoreConfirm")}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-success hover:text-success"
                          aria-label={t("data.restoreConfirmYes")}
                          onClick={() => {
                            setConfirmRestoreId(null);
                            void handleRestore(backup.id);
                          }}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground"
                          aria-label={t("data.restoreConfirmCancel")}
                          onClick={() => setConfirmRestoreId(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span
                          className="flex-1 truncate text-xs text-muted-foreground"
                          title={new Date(backup.createdAt).toLocaleString()}
                        >
                          {formatBackupTimestamp(
                            timestamp,
                            Date.now(),
                            lang,
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="janosik-restore-btn h-6 w-6"
                          aria-label={t("data.restore")}
                          onClick={() => setConfirmRestoreId(backup.id)}
                        >
                          <RotateCcw className="janosik-icon-restore h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="janosik-delete-btn h-6 w-6 text-muted-foreground hover:text-destructive"
                          aria-label={t("data.deleteBackup")}
                          onClick={() => void handleDeleteBackup(backup.id)}
                        >
                          <Trash2 className="janosik-icon-trash h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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
