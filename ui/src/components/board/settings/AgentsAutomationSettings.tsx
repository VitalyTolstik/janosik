import type { BoardRole } from "@janosik/shared";

import { AgentsAutomation } from "./AgentsAutomation";

/**
 * TASK-179.6/179.7 — the Agents & automation slot in Board Settings.
 *
 * The shell owns the dialog frame, the top-level rail and the combined dirty
 * guard; this seam keeps the policy editor independent of the shell and
 * reports its dirty state upward.
 */
export function AgentsAutomationSettings({
  role,
  onDirtyChange,
}: {
  role: BoardRole | undefined;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  return <AgentsAutomation role={role} onDirtyChange={onDirtyChange} />;
}
