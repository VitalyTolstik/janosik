import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  Trash2,
  Workflow,
} from "lucide-react";
import type { WorkflowRole } from "@janosik/shared";

import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { workflowBlockReason } from "@/utils/workflow";
import { ColumnDot, GlobalMark, WorkflowCheck, columnAccent } from "./parts";
import type { WorkflowDraftController } from "./useWorkflowDraft";

const ROLES: WorkflowRole[] = ["ADMIN", "MEMBER"];

interface TransitionInspectorProps {
  controller: WorkflowDraftController;
  testIdPrefix: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The selected rule's inspector. On desktop it is the fixed 316 px right
 * column; on mobile it becomes an accordion under the list. It edits roles,
 * conditions, the mirror edge and the rule's enabled state, then shows one
 * live card check for the selected route.
 */
export function TransitionInspector({
  controller,
  testIdPrefix,
  open,
  onOpenChange,
}: TransitionInspectorProps) {
  const { t } = useI18n();
  const {
    selected,
    columns,
    cleanDraft,
    canEdit,
    role,
    previewCard,
    setPreviewCardId,
    cardList,
    previewFrom,
    updateTransition,
    deleteTransition,
    toggleRole,
    toggleCondition,
    reverseOf,
    toggleReverse,
    setTransitionEnabled,
  } = controller;

  const fromColumn =
    selected?.fromColumnId != null
      ? columns.find((column) => column.id === selected.fromColumnId)
      : undefined;
  const toColumn = selected
    ? columns.find((column) => column.id === selected.toColumnId)
    : undefined;
  const fromIndex = fromColumn
    ? columns.findIndex((column) => column.id === fromColumn.id)
    : -1;
  const toIndex = toColumn
    ? columns.findIndex((column) => column.id === toColumn.id)
    : -1;
  const active = selected !== undefined && selected.enabled !== false;
  const reason =
    selected && previewCard && previewFrom && toColumn
      ? workflowBlockReason(
          {
            workflow: cleanDraft,
            card: previewCard,
            fromColumnId: previewFrom.id,
            fromTitle: previewFrom.title,
            target: toColumn,
            role,
          },
          t,
        )
      : null;

  return (
    <aside
      id={`${testIdPrefix}-inspector-section`}
      data-testid={`${testIdPrefix}-inspector`}
      className="flex min-w-0 flex-col gap-2.5 border-t border-border bg-card/20 px-4 pb-4 pt-4 motion-reduce:transition-none lg:border-l lg:border-t-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] leading-4 text-muted-foreground">
          {t("workflow.inspectorTitle")}
        </span>
        <div className="flex items-center gap-2">
          {selected ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] leading-4",
                active ? "text-success" : "text-muted-foreground",
              )}
            >
              {active ? (
                <Check className="h-3 w-3" aria-hidden />
              ) : (
                <Lock className="h-3 w-3" aria-hidden />
              )}
              {active ? t("workflow.ruleActive") : t("workflow.ruleInactive")}
            </span>
          ) : null}
          {selected ? (
            <button
              type="button"
              onClick={() => onOpenChange(!open)}
              aria-expanded={open}
              aria-label={
                open
                  ? t("workflow.collapseInspector")
                  : t("workflow.expandInspector")
              }
              data-testid={`${testIdPrefix}-inspector-toggle`}
              className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              {open ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "flex min-w-0 flex-col gap-2.5",
          !open && "hidden md:flex",
        )}
      >
        {!selected ? (
          <div className="flex flex-col items-start gap-1.5 px-0.5 py-3 text-muted-foreground">
            <Workflow
              className="h-4 w-4 text-muted-foreground/70"
              aria-hidden
            />
            <p className="text-xs leading-[1.45] text-muted-foreground">
              {t("workflow.ruleEmptyTitle")}
            </p>
            <span className="text-[11px] leading-[1.45] text-muted-foreground/75">
              {t("workflow.ruleEmpty")}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2.5 border-b border-border/65 pb-2.5">
              <div className="min-w-0">
                <span className="mb-1 block text-[11px] leading-4 text-muted-foreground/80">
                  {selected.fromColumnId === null
                    ? t("workflow.ruleGlobalKicker")
                    : t("workflow.ruleKicker")}
                </span>
                <h3
                  className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] font-semibold leading-[1.3] tracking-[-0.01em] text-foreground"
                  data-testid={`${testIdPrefix}-inspector-title`}
                >
                  {fromColumn ? (
                    <ColumnDot
                      color={columnAccent(fromColumn, fromIndex)}
                      size={7}
                    />
                  ) : (
                    <GlobalMark />
                  )}
                  <span className="min-w-0 truncate">
                    {fromColumn?.title ?? t("workflow.anyColumn")}
                  </span>
                  <ArrowRight
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                    aria-hidden
                  />
                  <span className="sr-only">→</span>
                  {toColumn ? (
                    <ColumnDot
                      color={columnAccent(toColumn, toIndex)}
                      size={7}
                    />
                  ) : null}
                  <span className="min-w-0 truncate">
                    {toColumn?.title ?? ""}
                  </span>
                </h3>
              </div>
              <button
                type="button"
                disabled={!canEdit}
                aria-label={t("workflow.deleteTransition")}
                data-testid={`${testIdPrefix}-delete`}
                onClick={() => deleteTransition(selected.id)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-danger/15 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>

            {selected.fromColumnId === null ? (
              <label className="block text-[11px] text-muted-foreground">
                {t("workflow.globalTarget")}
                <SelectField
                  value={selected.toColumnId}
                  disabled={!canEdit}
                  ariaLabel={t("workflow.globalTarget")}
                  testId={`${testIdPrefix}-global-edit-target`}
                  onChange={(next) =>
                    updateTransition(selected.id, { toColumnId: next })
                  }
                  className="mt-1 h-8 px-2 text-[13px]"
                  options={columns.map((column) => ({
                    value: column.id,
                    label: column.title,
                  }))}
                />
              </label>
            ) : null}

            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-[11px] leading-4 text-muted-foreground">
                {t("workflow.roles")}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {ROLES.map((entry) => {
                  const label = t(`workflow.role.${entry}`);
                  return (
                    <WorkflowCheck
                      key={entry}
                      checked={(selected.allowedRoles ?? ROLES).includes(entry)}
                      disabled={!canEdit}
                      ariaLabel={label}
                      testId={`${testIdPrefix}-role-${entry}`}
                      onCheckedChange={() => toggleRole(selected, entry)}
                    >
                      {label}
                    </WorkflowCheck>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-[11px] leading-4 text-muted-foreground">
                {t("workflow.conditionsShort")}
              </legend>
              <div className="flex flex-col gap-0.5">
                {(
                  [
                    "requireAssignee",
                    "requireDueDate",
                    "requireDescription",
                    "requireChecklistsDone",
                  ] as const
                ).map((condition) => {
                  const label = t(`workflow.conditionShort.${condition}`);
                  return (
                    <WorkflowCheck
                      key={condition}
                      checked={(selected.conditions ?? []).includes(condition)}
                      disabled={!canEdit}
                      variant="plain"
                      ariaLabel={t(`workflow.condition.${condition}`)}
                      testId={`${testIdPrefix}-condition-${condition}`}
                      onCheckedChange={() =>
                        toggleCondition(selected, condition)
                      }
                    >
                      {label}
                    </WorkflowCheck>
                  );
                })}
              </div>
            </fieldset>

            {selected.fromColumnId !== null ? (
              <div className="flex items-start gap-2 border-t border-border/60 pt-2.5">
                <WorkflowCheck
                  checked={reverseOf(selected) !== undefined}
                  disabled={!canEdit}
                  variant="plain"
                  ariaLabel={t("workflow.reverse")}
                  testId={`${testIdPrefix}-reverse`}
                  onCheckedChange={(checked) =>
                    toggleReverse(selected, checked)
                  }
                >
                  <span className="block text-[11px] leading-[1.35]">
                    {t("workflow.reverseShort")}
                  </span>
                  <span className="mt-px block text-[11px] leading-[1.4] text-muted-foreground/75">
                    {t("workflow.reverseHintShort")}
                  </span>
                </WorkflowCheck>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2.5 border-t border-border/60 pt-2.5">
              <span className="min-w-0">
                <span className="block text-[11px] leading-[1.35]">
                  {t("workflow.enabledShort")}
                </span>
                <span className="mt-px block text-[11px] leading-[1.4] text-muted-foreground/75">
                  {t("workflow.enabledHintShort")}
                </span>
              </span>
              <Switch
                checked={selected.enabled !== false}
                disabled={!canEdit}
                aria-label={t("workflow.transitionEnabled")}
                data-testid={`${testIdPrefix}-transition-enabled`}
                onCheckedChange={(checked) =>
                  setTransitionEnabled(selected.id, checked)
                }
              />
            </div>

            <div className="rounded-md border border-border/75 bg-card/50 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-[11px] leading-4 text-muted-foreground/80">
                  {t("workflow.preview")}
                </span>
                {cardList.length > 0 ? (
                  <SelectField
                    value={previewCard?.id ?? ""}
                    onChange={setPreviewCardId}
                    ariaLabel={t("workflow.previewCard")}
                    testId={`${testIdPrefix}-preview-card`}
                    className="h-7 w-[11.5rem] min-w-0 border-transparent bg-transparent px-1.5 text-[13px] hover:border-border/60"
                    options={cardList.map((card) => ({
                      value: card.id,
                      label: card.title,
                    }))}
                  />
                ) : (
                  <span className="text-[11px] text-muted-foreground/75">
                    {t("workflow.previewNoCards")}
                  </span>
                )}
              </div>

              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] text-foreground">
                  {fromColumn ? (
                    <ColumnDot
                      color={columnAccent(fromColumn, fromIndex)}
                      size={7}
                    />
                  ) : (
                    <GlobalMark />
                  )}
                  <span className="truncate">
                    {fromColumn?.title ?? t("workflow.anyColumn")}
                  </span>
                  <ArrowRight
                    className="h-3 w-3 shrink-0 text-muted-foreground/70"
                    aria-hidden
                  />
                  <span className="truncate">{toColumn?.title ?? ""}</span>
                </span>

                {!previewCard ? (
                  <span className="text-[11px] leading-[1.3] text-muted-foreground/75">
                    {t("workflow.previewNoCards")}
                  </span>
                ) : !previewFrom ? (
                  <span className="text-[11px] leading-[1.3] text-muted-foreground/75">
                    {t("workflow.previewNoCard")}
                  </span>
                ) : reason === null ? (
                  <span
                    className="inline-flex min-w-0 items-center gap-1 text-[11px] leading-[1.3] text-success"
                    data-testid={`${testIdPrefix}-preview-result`}
                  >
                    <Check className="h-3 w-3 shrink-0" aria-hidden />
                    {t("workflow.previewReasonAllowed")}
                  </span>
                ) : (
                  <span
                    className="inline-flex min-w-0 items-center gap-1 text-[11px] leading-[1.3] text-warning"
                    data-testid={`${testIdPrefix}-preview-result`}
                  >
                    <Lock className="h-3 w-3 shrink-0" aria-hidden />
                    {reason}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
