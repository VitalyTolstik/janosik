import { useState } from "react";
import { Download, HardDrive, ShieldAlert, TriangleAlert } from "lucide-react";

import { useToast } from "@/components/Toast";
import { BackupDialog } from "@/components/board/BackupDialog";
import { Notice } from "@/components/notifications/Notice";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import { serializeExport } from "@janosik/shared";
import { downloadTextFile, timestampedFilename } from "@/utils/download";
import { readRaw } from "@/utils/storage";

/**
 * Data-safety notice (TASK-21.2) — the one place where "your data is at
 * risk" is stated loudly instead of in a toast that disappears.
 *
 * - `save-blocked`: storage refuses writes (quota, private mode). The
 *   notice cannot be dismissed — it goes away only when a write succeeds —
 *   and its single action downloads a backup of what is still in memory.
 * - `quota-warning`: writes succeed, but the data is past 80% of the
 *   assumed storage quota (TASK-21.5). A heads-up, not an emergency: the
 *   export action is the same, and the user can dismiss it until the data
 *   shrinks back under the threshold.
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
  const quotaWarning = dataIssue.kind === "quota-warning";
  const description =
    dataIssue.kind === "quota-warning"
      ? t("safety.quotaDesc")
      : saveBlocked
        ? t("safety.saveBlockedDesc")
        : dataIssue.quarantined
          ? t("safety.corruptQuarantinedDesc")
          : t("safety.corruptKeptDesc");

  const title = quotaWarning
    ? t("safety.quotaTitle")
    : saveBlocked
      ? t("safety.saveBlockedTitle")
      : t("safety.corruptTitle");

  return (
    <>
      <Notice
        tone={quotaWarning ? "warning" : "danger"}
        icon={quotaWarning ? TriangleAlert : ShieldAlert}
        eyebrow={t("safety.eyebrow")}
        title={title}
        body={description}
        testId="data-safety-banner"
        ariaLabel={t("safety.regionAria")}
        actions={
          saveBlocked || quotaWarning ? (
            <Button size="sm" onClick={handleDownloadBackup}>
              <Download className="h-4 w-4" aria-hidden />
              {t("safety.saveBlockedAction")}
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={handleDownloadDamaged}>
                <Download className="h-4 w-4" aria-hidden />
                {t("safety.downloadCorrupt")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBackupsOpen(true)}
              >
                <HardDrive className="h-4 w-4" aria-hidden />
                {t("safety.restoreBackup")}
              </Button>
            </>
          )
        }
        close={
          saveBlocked
            ? undefined
            : {
                onClick: dismissDataIssue,
                label: t("safety.dismiss"),
              }
        }
      />
      <BackupDialog open={backupsOpen} onOpenChange={setBackupsOpen} />
    </>
  );
}
