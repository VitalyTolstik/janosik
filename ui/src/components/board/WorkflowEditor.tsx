import type { BoardRole, BoardWorkflow, Card, Column } from "@janosik/shared";

import { WorkflowSettings } from "@/components/board/workflow/WorkflowSettings";

interface WorkflowEditorProps {
  columns: Column[];
  cards: Record<string, Card>;
  workflow?: BoardWorkflow;
  /** The stored config exists but failed validation and is fail-closed. */
  workflowInvalid?: boolean;
  /** ADMIN on the board, or a platform master acting for the owner. */
  canEdit: boolean;
  /** Master-panel mode: show the "acting for the owner" banner. */
  masterMode?: boolean;
  role?: BoardRole;
  saving?: boolean;
  onSave: (workflow: BoardWorkflow | undefined) => void | Promise<void>;
  onCancel?: () => void;
  /** Lets a dialog guard outside-click/Escape while the draft is dirty. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Prefix for DOM test ids, so board and admin editors never collide. */
  testIdPrefix?: string;
}

/**
 * Compatibility wrapper for the master panel's `/admin/boards/:id/workflow`
 * page. The board's «Настройки доски» uses the same `WorkflowSettings` body
 * inside a Radix dialog; here it is embedded in an admin panel, without the
 * dialog shell or a second title. All public props and `workflow-*` /
 * `admin-workflow-*` test ids stay intact.
 */
export function WorkflowEditor({
  columns,
  cards,
  workflow,
  workflowInvalid = false,
  canEdit,
  masterMode = false,
  role = "ADMIN",
  saving = false,
  onSave,
  onCancel,
  onDirtyChange,
  testIdPrefix = "workflow",
}: WorkflowEditorProps) {
  return (
    <WorkflowSettings
      columns={columns}
      cards={cards}
      workflow={workflow}
      workflowInvalid={workflowInvalid}
      canEdit={canEdit}
      masterMode={masterMode}
      role={role}
      saving={saving}
      onSave={onSave}
      onCancel={onCancel}
      onDirtyChange={onDirtyChange}
      testIdPrefix={testIdPrefix}
      variant="embedded"
    />
  );
}
