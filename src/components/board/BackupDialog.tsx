import { useCallback, useEffect, useState } from "react";
import { Check, RotateCcw, Trash2, X } from "lucide-react";

import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import { formatBackupTimestamp } from "@/utils/backup-timestamp";
import {
  createBackup,
  deleteBackup,
  listBackups,
  loadBackup,
  type BackupMeta,
} from "@/utils/backup";

interface BackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Automatic backups browser (same UI pattern as the card archive): a
 * dedicated dialog opened from the data menu, so the dropdown stays
 * compact. Restore keeps a safety snapshot of the current state first;
 * delete asks an inline ✓ / ✗ confirmation.
 */
export function BackupDialog({ open, onOpenChange }: BackupDialogProps) {
  const { t, tp, lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  const { boards, importBoards } = useBoard();
  const [backups, setBackups] = useState<BackupMeta[] | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBackups(await listBackups());
    } catch {
      setBackups([]);
    }
  }, []);

  // Re-read on every open so restored/deleted entries render accurately.
  useEffect(() => {
    if (open) {
      setConfirmRestoreId(null);
      void refresh();
    }
  }, [open, refresh]);

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
      await refresh();
      toast.success(t("data.restoreSuccess"));
    } catch {
      toast.error(t("data.restoreFailed"));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteBackup(id);
      await refresh();
    } catch {
      toast.error(t("data.backupFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("data.backupTitle")}</DialogTitle>
          <DialogDescription>
            {backups !== null && backups.length > 0
              ? tp("data.backupCount", backups.length)
              : t("data.backupEmpty")}
          </DialogDescription>
        </DialogHeader>

        <div
          className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6"
          data-testid="backup-list"
        >
          {backups === null || backups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("data.backupEmpty")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {backups.map((backup) => {
                const confirming = confirmRestoreId === backup.id;
                return (
                  <li
                    key={backup.id}
                    data-testid="backup-row"
                    className="flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-2"
                  >
                    {confirming ? (
                      <>
                        <span className="flex-1 text-sm">
                          {t("data.restoreConfirm")}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-danger hover:bg-danger/10"
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
                          className="h-6 w-6 text-muted-foreground hover:bg-hover"
                          aria-label={t("data.restoreConfirmCancel")}
                          onClick={() => setConfirmRestoreId(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span
                          className="flex-1 truncate text-sm text-foreground/90"
                          title={formatDate(backup.createdAt, lang, hour12)}
                        >
                          {formatBackupTimestamp(
                            new Date(backup.createdAt).getTime(),
                            Date.now(),
                            lang,
                            hour12,
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          aria-label={t("data.restore")}
                          onClick={() => setConfirmRestoreId(backup.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          aria-label={t("data.deleteBackup")}
                          onClick={() => void handleDelete(backup.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
