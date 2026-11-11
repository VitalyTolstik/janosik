import { useState } from "react";
import type { BoardWorkflow } from "@janosik/shared";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { WorkflowSettings } from "@/components/board/workflow/WorkflowSettings";
import { useToast } from "@/components/Toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
 * «Настройки доски» (board ADMIN only). The dialog is one surface: the
 * workflow settings own the title, rail, body and footer, while this
 * component owns the Radix shell, the save transport and the dirty-close
 * confirmation. It subscribes to board data only while open, so typing in a
 * card never re-renders the header through it.
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

  // Radix restores focus to a DialogTrigger; this dialog is opened by the
  // header's gear button, which is a sibling, so return focus explicitly after
  // every close path (save, X, Escape, discard). The dialog may be unmounted
  // by the parent immediately, so schedule the focus after that commit.
  const closeDialog = () => {
    onOpenChange(false);
    const focusTrigger = () => {
      document
        .querySelector<HTMLElement>('[data-testid="board-settings-trigger"]')
        ?.focus();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(focusTrigger);
    } else {
      focusTrigger();
    }
  };

  const requestOpenChange = (next: boolean) => {
    if (!next && dirty) {
      setConfirmClose(true);
      return;
    }
    if (next) onOpenChange(true);
    else closeDialog();
  };

  const save = async (
    workflow: BoardWorkflow | undefined,
  ): Promise<boolean> => {
    setSaving(true);
    try {
      const outcome = await setBoardWorkflow(workflow);
      // The server refused: the command layer already rolled the optimistic
      // change back and showed the reason. Keep the dialog and its draft open
      // so the admin can fix the config instead of losing it. A transport
      // rejection means the same: no success until the server acknowledged.
      if (outcome === false) return false;
      toast.success(t("workflow.savedToast"));
      closeDialog();
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        hideClose
        className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1040px] gap-0 overflow-hidden p-0 max-md:m-0 max-md:h-[100dvh] max-md:max-h-none max-md:w-full max-md:max-w-none max-md:rounded-none! max-md:border-0!"
        data-testid="board-settings-dialog"
      >
        <WorkflowSettings
          columns={board.columns}
          cards={board.cards}
          workflow={board.workflow}
          workflowInvalid={board.workflowInvalid}
          canEdit={role === "ADMIN"}
          role={role}
          saving={saving}
          onSave={save}
          onDirtyChange={setDirty}
          testIdPrefix="workflow"
          variant="dialog"
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
          closeDialog();
        }}
      />
    </Dialog>
  );
}
