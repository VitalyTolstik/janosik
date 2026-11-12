import { useMemo, useState } from "react";
import { GitBranch, Shield } from "lucide-react";
import type { BoardSummary, BoardWorkflow } from "@janosik/shared";

import { WorkflowSettings } from "@/components/board/workflow/WorkflowSettings";
import {
  BoardSettingsShell,
  type BoardSettingsRailItem,
  type BoardSettingsSectionId,
} from "@/components/board/settings/BoardSettingsShell";
import { restoreBoardSettingsFocus } from "@/components/board/settings/focus";
import { AgentsAutomationSettings } from "@/components/board/settings/AgentsAutomationSettings";
import { usePendingApprovals } from "@/components/agents/use-pending-approvals";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import {
  useBoardAccess,
  useBoardActions,
  useBoardState,
} from "@/store/BoardContext";

interface BoardSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: BoardSettingsSectionId;
}

/**
 * «Настройки доски» (board ADMIN only). The shell owns the dialog frame and
 * the top-level `Workflow | Agents & automation` rail; this component owns the
 * combined dirty state and the workflow save transport. Both sections stay
 * mounted after their first visit, so switching the rail never drops a draft.
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
  const [section, setSection] =
    useState<BoardSettingsSectionId>(initialSection);
  const [policyMounted, setPolicyMounted] = useState(
    initialSection === "agents",
  );
  const dirty = workflowDirty || policyDirty;
  const boardId = board?.id;
  const boardTitle = board?.title;
  const boardCardCount = board ? Object.keys(board.cards).length : 0;
  const boardColumnCount = board?.columns.length ?? 0;
  const adminBoard = useMemo<BoardSummary[]>(() => {
    if (boardId === undefined || boardTitle === undefined || role !== "ADMIN") {
      return [];
    }
    return [
      {
        id: boardId,
        title: boardTitle,
        role,
        counters: { cards: boardCardCount, columns: boardColumnCount },
      },
    ];
  }, [boardId, boardTitle, boardCardCount, boardColumnCount, role]);
  const pending = usePendingApprovals(adminBoard, adminBoard.length > 0);
  const pendingCount = board ? (pending.counts[board.id] ?? 0) : 0;
  if (!board) return null;

  const sections: BoardSettingsRailItem[] = [
    {
      id: "workflow",
      label: t("board.settings.shell.workflow"),
      icon: GitBranch,
    },
    {
      id: "agents",
      label: t("board.settings.shell.agents"),
      icon: Shield,
      badge:
        role === "ADMIN" && !pending.error && pendingCount > 0
          ? pendingCount > 99
            ? "99+"
            : String(pendingCount)
          : undefined,
    },
  ];

  const selectSection = (next: BoardSettingsSectionId) => {
    if (next === "agents") setPolicyMounted(true);
    setSection(next);
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
      if (!policyDirty) {
        // A successful save bypasses the discard guard: there is nothing left
        // to lose in this section. The policy draft still guards the close.
        onOpenChange(false);
        restoreBoardSettingsFocus();
      }
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Policy edits keep their own wording; workflow-only edits keep the workflow
  // confirmation that the existing tests and e2e flows assert.
  const discardTitle = policyDirty
    ? t("board.settings.shell.discardTitle")
    : t("workflow.discardTitle");
  const discardDescription = policyDirty
    ? t("board.settings.shell.discardDescription")
    : t("workflow.discardDescription");

  return (
    <BoardSettingsShell
      open={open}
      onOpenChange={onOpenChange}
      title={board.title}
      subtitle={t("board.settings.shell.subtitle")}
      sections={sections}
      section={section}
      onSectionChange={selectSection}
      dirty={dirty}
      saving={saving}
      discardTitle={discardTitle}
      discardDescription={discardDescription}
      discardConfirmLabel={t("workflow.discard")}
    >
      <div
        id="board-settings-panel-workflow"
        role="tabpanel"
        aria-labelledby="board-settings-tab-workflow"
        hidden={section !== "workflow"}
        className="h-full min-h-0"
      >
        <div className="flex h-full min-h-0 flex-col">
          <WorkflowSettings
            columns={board.columns}
            cards={board.cards}
            workflow={board.workflow}
            workflowInvalid={board.workflowInvalid}
            canEdit={role === "ADMIN"}
            role={role}
            saving={saving}
            shellDirty={dirty}
            shellSaving={saving}
            onSave={save}
            onDirtyChange={setWorkflowDirty}
            testIdPrefix="workflow"
            variant="dialog"
            insideSettingsShell
          />
        </div>
      </div>
      {policyMounted ? (
        <div
          id="board-settings-panel-agents"
          role="tabpanel"
          aria-labelledby="board-settings-tab-agents"
          hidden={section !== "agents"}
          className="h-full min-h-0"
        >
          <AgentsAutomationSettings
            role={role}
            onDirtyChange={setPolicyDirty}
          />
        </div>
      ) : null}
    </BoardSettingsShell>
  );
}
