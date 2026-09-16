import { useCallback, useMemo, useRef, useState } from "react";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import {
  Archive,
  Download,
  HardDrive,
  HardDriveDownload,
  LogOut,
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
import { MAX_IMPORT_BYTES } from "@janosik/shared";
import { useBoard } from "@/store/BoardContext";
import { parseExport, serializeExport } from "@janosik/shared";
import { isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { downloadTextFile } from "@/utils/download";
import { createBackup, listBackups } from "@/utils/backup";

/**
 * Data & backups menu — export/import the board data as JSON, create a
 * manual backup copy, plus two entry points that open dedicated dialogs:
 * the card archive and the automatic backups browser (keeps the dropdown
 * compact no matter how many entries pile up). Export failures and import
 * validation errors surface as toasts. With a server (TASK-29) import goes
 * to `POST /boards/import` and the menu also hosts the account row with
 * sign-out.
 */

export function DataMenu() {
  const { t } = useI18n();
  const toast = useToast();
  const { boards, board, importBoards } = useBoard();
  const { user, logout } = useAuth();
  const serverMode = isApiEnabled();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [backupCount, setBackupCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);

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
      downloadTextFile("janosik-boards.json", serializeExport(boards));
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
      // Server mode: the boards land in the database, then the list is
      // re-hydrated; a refusal is caught here like a malformed file.
      await importBoards(boards);
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
          {serverMode ? (
            <>
              <DropdownMenuSeparator />
              {user !== null ? (
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {t("auth.signedInAs", { email: user.email })}
                </DropdownMenuLabel>
              ) : null}
              <DropdownMenuItem
                data-testid="data-logout"
                onClick={() => void logout()}
              >
                <LogOut className="h-4 w-4" />
                {t("auth.logout")}
              </DropdownMenuItem>
            </>
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
      <BackupDialog open={backupsOpen} onOpenChange={setBackupsOpen} />
    </>
  );
}
