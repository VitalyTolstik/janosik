import { useState } from "react";
import { Bot, GitBranch, X } from "lucide-react";
import type { BoardWorkflow } from "@janosik/shared";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { WorkflowSettings } from "@/components/board/workflow/WorkflowSettings";
import { PolicyPanel } from "@/components/agent-control/PolicyPanel";
import { useToast } from "@/components/Toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  useBoardAccess,
  useBoardActions,
  useBoardState,
} from "@/store/BoardContext";

interface BoardSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: "workflow" | "agents";
}

/**
 * «Настройки доски» (board ADMIN only). The dialog is one surface: the
 * workflow and agent policy share a shell while retaining independent drafts.
 * This component owns the close guard and workflow save transport; each draft
 * stays mounted when switching sections so unsaved edits are preserved.
 */
export function BoardSettingsDialog({
  open,
  onOpenChange,
  initialSection = "workflow",
}: BoardSettingsDialogProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { board } = useBoardState();
  const { setBoardWorkflow } = useBoardActions();
  const { role } = useBoardAccess();
  const [saving, setSaving] = useState(false);
  const [workflowDirty, setWorkflowDirty] = useState(false);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [section, setSection] = useState(initialSection);
  const [policyMounted, setPolicyMounted] = useState(
    initialSection === "agents",
  );
  const dirty = workflowDirty || policyDirty;
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
      if (!policyDirty) closeDialog();
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
        className="h-[min(48rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1040px] gap-0 overflow-hidden p-0 font-agent-surface min-[1200px]:h-[min(56rem,calc(100dvh-4rem))] min-[1200px]:max-w-[min(1360px,calc(100vw-4rem))] max-md:m-0 max-md:h-[100dvh] max-md:max-h-none max-md:w-full max-md:max-w-none max-md:rounded-none! max-md:border-0!"
        data-testid="board-settings-dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-primary/5 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("board.settings.title")}
            </p>
            <DialogTitle className="mt-1 font-display text-[17px] font-bold leading-[1.25] tracking-[-0.025em]">
              {board.title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">
              {t("board.settings.shell.subtitle")}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-hover"
              aria-label={t("common.close")}
              data-testid="workflow-close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="shrink-0 border-b border-border p-3 md:w-48 md:border-r md:border-b-0">
            <p className="hidden px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:block">
              {t("board.settings.shell.settings")}
            </p>
            <nav
              aria-label={t("board.settings.title")}
              className="flex gap-1 md:flex-col"
            >
              <button
                type="button"
                aria-current={section === "workflow" ? "page" : undefined}
                onClick={() => setSection("workflow")}
                data-testid="board-settings-workflow"
                className={cn(
                  "flex min-h-11 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm md:min-h-9 md:flex-none",
                  section === "workflow" && "bg-hover font-medium",
                )}
              >
                <GitBranch className="h-4 w-4" aria-hidden />
                {t("board.settings.shell.workflow")}
              </button>
              <button
                type="button"
                aria-current={section === "agents" ? "page" : undefined}
                onClick={() => {
                  setPolicyMounted(true);
                  setSection("agents");
                }}
                data-testid="board-settings-agents"
                className={cn(
                  "flex min-h-11 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm md:min-h-9 md:flex-none",
                  section === "agents" && "bg-hover font-medium",
                )}
              >
                <Bot className="h-4 w-4" aria-hidden />
                {t("board.settings.shell.agents")}
              </button>
            </nav>
            <p className="mt-4 hidden border-t border-border px-2 pt-3 text-xs leading-5 text-muted-foreground md:block">
              {t("board.settings.shell.hint")}
            </p>
          </aside>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              className={cn(
                "flex h-full min-h-0 flex-col",
                section !== "workflow" && "hidden",
              )}
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
                onDirtyChange={setWorkflowDirty}
                testIdPrefix="workflow"
                variant="dialog"
                insideSettingsShell
              />
            </div>
            {policyMounted ? (
              <div
                className={cn(
                  "h-full min-h-0",
                  section !== "agents" && "hidden",
                )}
              >
                <PolicyPanel role={role} onDirtyChange={setPolicyDirty} />
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t(
          policyDirty
            ? "board.settings.shell.discardTitle"
            : "workflow.discardTitle",
        )}
        description={t(
          policyDirty
            ? "board.settings.shell.discardDescription"
            : "workflow.discardDescription",
        )}
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
