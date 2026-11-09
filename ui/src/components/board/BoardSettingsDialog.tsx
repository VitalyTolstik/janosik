import type { BoardWorkflow } from "@janosik/shared";

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
  if (!board) return null;

  const save = (workflow: BoardWorkflow | undefined) => {
    setBoardWorkflow(workflow);
    toast.success(t("workflow.savedToast"));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          canEdit={role === "ADMIN"}
          role={role}
          onSave={save}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
