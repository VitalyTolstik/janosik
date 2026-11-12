import type { ComponentProps } from "react";

import { PolicyPanel } from "@/components/agent-control/PolicyPanel";

type PolicyRole = ComponentProps<typeof PolicyPanel>["role"];

/**
 * TASK-179.6 — the Agents & automation slot in Board Settings.
 *
 * TASK-179.7 replaces this body with the field-level policy editor
 * (`AgentsAutomation`). Until then the already merged `PolicyPanel` stays the
 * policy surface; keeping it behind this seam means the shell and the dirty
 * guard do not depend on the panel internals.
 */
export function AgentsAutomationSettings({
  role,
  onDirtyChange,
}: {
  role: PolicyRole;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  return <PolicyPanel role={role} onDirtyChange={onDirtyChange} />;
}
