import { useState } from "react";
import { Download, HardDrive, ShieldAlert, X } from "lucide-react";

import { useToast } from "@/components/Toast";
import { BackupDialog } from "@/components/board/BackupDialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import { serializeExport } from "@/utils/board-serialization";
import { downloadTextFile, timestampedFilename } from "@/utils/download";
import { readRaw } from "@/utils/storage";

/**
 * Data-safety banner (TASK-21.2) — the one place where "your data is at
 * risk" is stated loudly instead of in a toast that disappears.
 *
 * - `save-blocked`: storage refuses writes (quota, private mode). The
 *   banner cannot be dismissed — it goes away only when a write succeeds —
 *   and its single action downloads a backup of what is still in memory.
 * - `corrupt-load`: the stored data did not parse. The damaged text is
 *   downloadable, and "restore from a copy" opens the automatic backups.
 */
export function DataSafetyBanner() {
  const { t } = useI18n();
  const toast = useToast();
  const { boards, dataIssue, dismissDataIssue } = useBoard();
  const [backupsOpen, setBackupsOpen] = useState(false);

  if (dataIssue === null) return null;

  const handleDownloadBackup = () => {
    try {
      downloadTextFile(
        timestampedFilename("janosik-boards"),
        serializeExport(boards),
      );
      toast.success(t("data.exportSuccess"));
    } catch {
      toast.error(t("data.exportFailed"));
    }
  };

  const handleDownloadDamaged = () => {
    if (dataIssue.kind !== "corrupt-load") return;
    // The raw text is read at click time: it lives in storage, not in
    // memory, so it survives reloads until the user releases it.
    const raw = readRaw(dataIssue.sourceKey);
    if (raw === null) {
      toast.error(t("safety.corruptDownloadFailed"));
      return;
    }
    try {
      downloadTextFile(timestampedFilename("janosik-damaged"), raw);
      toast.success(t("data.exportSuccess"));
    } catch {
      toast.error(t("data.exportFailed"));
    }
  };

  const saveBlocked = dataIssue.kind === "save-blocked";
  const description = saveBlocked
    ? t("safety.saveBlockedDesc")
    : dataIssue.quarantined
      ? t("safety.corruptQuarantinedDesc")
      : t("safety.corruptKeptDesc");

  return (
    <>
      <div
        role="alert"
        aria-label={t("safety.regionAria")}
        data-testid="data-safety-banner"
        className="flex shrink-0 items-start gap-3 border-b border-danger/40 bg-danger/10 px-4 py-3 text-foreground sm:px-6"
      >
        <ShieldAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-danger"
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-semibold leading-snug">
              {saveBlocked
                ? t("safety.saveBlockedTitle")
                : t("safety.corruptTitle")}
            </p>
            <p className="text-sm leading-snug text-muted-foreground">
              {description}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {saveBlocked ? (
              <Button size="sm" onClick={handleDownloadBackup}>
                <Download className="h-4 w-4" />
                {t("safety.saveBlockedAction")}
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={handleDownloadDamaged}>
                  <Download className="h-4 w-4" />
                  {t("safety.downloadCorrupt")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setBackupsOpen(true)}
                >
                  <HardDrive className="h-4 w-4" />
                  {t("safety.restoreBackup")}
                </Button>
              </>
            )}
          </div>
        </div>
        {saveBlocked ? null : (
          <button
            type="button"
            onClick={dismissDataIssue}
            aria-label={t("safety.dismiss")}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <BackupDialog open={backupsOpen} onOpenChange={setBackupsOpen} />
    </>
  );
}
