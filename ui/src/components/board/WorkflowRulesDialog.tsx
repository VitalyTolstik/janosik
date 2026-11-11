import { Lock, Workflow } from "lucide-react";

import type { BoardWorkflow } from "@janosik/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { useBoardState } from "@/store/BoardContext";
import { conditionLabel } from "@/utils/workflow";

interface WorkflowRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Read-only "Workflow rules" panel for every board member (VIEWER included).
 * Explains who may move where and which card fields a transition requires —
 * the answer to "why can't I move this card?" without opening the admin
 * editor. The config is public to the board's participants; roles are generic
 * ADMIN/MEMBER labels, never a member list.
 */
export function WorkflowRulesDialog({
  open,
  onOpenChange,
}: WorkflowRulesDialogProps) {
  const { t } = useI18n();
  const { board } = useBoardState();
  const workflow = board?.workflow;
  const columnIds = new Set((board?.columns ?? []).map((column) => column.id));
  // A stored config may still name a column deleted elsewhere; don't render
  // a raw id to a reader. The editor/importer cleans these on the next save.
  const transitions = (workflow?.transitions ?? []).filter(
    (transition) =>
      (transition.fromColumnId === null ||
        columnIds.has(transition.fromColumnId)) &&
      columnIds.has(transition.toColumnId),
  );

  const titleOf = (id: string | null): string =>
    id === null
      ? t("workflow.anyColumn")
      : (board?.columns.find((column) => column.id === id)?.title ?? id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto"
        data-testid="workflow-rules-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-primary" aria-hidden />
            {t("workflow.rules")}
          </DialogTitle>
          <DialogDescription>{t("workflow.rulesHint")}</DialogDescription>
        </DialogHeader>
        {!workflow ? (
          <p className="text-sm text-muted-foreground">
            {t("workflow.rulesNotConfigured")}
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            {board?.workflowInvalid ? (
              <p className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
                {t("workflow.error.invalidStored")}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={
                  workflow.enabled
                    ? "rounded-full bg-success/15 px-2 py-0.5 font-medium text-success"
                    : "rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground"
                }
              >
                {workflow.enabled
                  ? t("workflow.enabled")
                  : t("workflow.disabled")}
              </span>
              <span className="text-muted-foreground">
                {t("workflow.transitionCount", {
                  count: transitions.length,
                })}
              </span>
            </div>

            <div className="grid gap-2 rounded-lg border border-border/60 p-3 text-xs sm:grid-cols-2">
              <div>
                <p className="text-[11px] text-muted-foreground">
                  {t("workflow.initialColumn")}
                </p>
                <p className="mt-0.5 text-xs font-medium">
                  {workflow.initialColumnId
                    ? titleOf(workflow.initialColumnId)
                    : t("workflow.initialFallback")}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">
                  {t("workflow.doneColumns")}
                </p>
                <p className="mt-0.5 text-xs font-medium">
                  {workflow.doneColumnIds.length > 0
                    ? workflow.doneColumnIds.map(titleOf).join(", ")
                    : t("workflow.doneFallback")}
                </p>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] text-muted-foreground">
                {t("workflow.transitions")}
              </p>
              {transitions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("workflow.noTransitions")}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {transitions.map((transition) => (
                    <TransitionRow
                      key={transition.id}
                      transition={transition}
                      from={titleOf(transition.fromColumnId)}
                      to={titleOf(transition.toColumnId)}
                    />
                  ))}
                </ul>
              )}
            </div>
            <p className="flex items-start gap-1.5 rounded-md bg-muted/50 p-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px h-3 w-3 shrink-0" aria-hidden />
              {t("workflow.rulesFooter")}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TransitionRow({
  transition,
  from,
  to,
}: {
  transition: NonNullable<BoardWorkflow>["transitions"][number];
  from: string;
  to: string;
}) {
  const { t } = useI18n();
  const roles = transition.allowedRoles ?? ["ADMIN", "MEMBER"];
  const conditions = transition.conditions ?? [];
  const disabled = transition.enabled === false;
  return (
    <li
      className={
        disabled
          ? "rounded-md border border-border/60 px-2 py-1.5 opacity-60"
          : "rounded-md border border-border/60 px-2 py-1.5"
      }
      data-testid={`workflow-rule-${transition.id}`}
    >
      <p className="text-xs font-medium">
        {from} <span className="text-muted-foreground">→</span> {to}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {t("workflow.rolesLabel")}: {roles.join(" / ")}
        {conditions.length > 0
          ? ` · ${conditions.map((condition) => conditionLabel(condition, t)).join(t("workflow.conditionSeparator"))}`
          : ""}
        {disabled ? ` · ${t("workflow.disabled")}` : ""}
      </p>
    </li>
  );
}
