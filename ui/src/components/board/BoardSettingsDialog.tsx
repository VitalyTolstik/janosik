import { useState } from "react";
import type { BoardWorkflow } from "@janosik/shared";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { WorkflowEditor } from "@/components/board/WorkflowEditor";
import { useToast } from "@/components/Toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import {
  useBoardAccess,
  useBoardActions,
  useBoardState,
} from "@/store/BoardContext";

interface BoardSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * «Настройки доски → Рабочий процесс» (board ADMIN only). The dialog owns no
 * board data until it is open: the header's gear is a plain button, and this
 * component — which subscribes to the board — mounts only while the dialog
 * is shown, so typing in a card never re-renders the header through it.
 *
 * Opening the dialog mounts a fresh `WorkflowEditor`; closing unmounts the
 * Radix content and therefore the draft, which is the project's standard
 * "reset by remount" rule.
 */
export function BoardSettingsDialog({
  open,
  onOpenChange,
}: BoardSettingsDialogProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { board } = useBoardState();
  const { setBoardWorkflow } = useBoardActions();
  const { role } = useBoardAccess();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  if (!board) return null;

  const requestOpenChange = (next: boolean) => {
    if (!next && dirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  };

  const save = async (workflow: BoardWorkflow | undefined) => {
    setSaving(true);
    try {
      const outcome = await setBoardWorkflow(workflow);
      // The server refused: the command layer already rolled the optimistic
      // change back and showed the reason. Keep the dialog and its draft open
      // so the admin can fix the config instead of losing it. A transport
      // rejection means the same: no success until the server acknowledged.
      if (outcome === false) return;
      toast.success(t("workflow.savedToast"));
      onOpenChange(false);
    } catch {
      return;
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto"
        data-testid="board-settings-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("board.settings.title")}</DialogTitle>
          <DialogDescription>{t("board.settings.subtitle")}</DialogDescription>
        </DialogHeader>
        <WorkflowEditor
          columns={board.columns}
          cards={board.cards}
          workflow={board.workflow}
          workflowInvalid={board.workflowInvalid}
          canEdit={role === "ADMIN"}
          role={role}
          saving={saving}
          onSave={save}
          onCancel={() => onOpenChange(false)}
          onDirtyChange={setDirty}
        />
      </DialogContent>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t("workflow.discardTitle")}
        description={t("workflow.discardDescription")}
        confirmLabel={t("workflow.discard")}
        destructive
        onConfirm={() => {
          setConfirmClose(false);
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}
