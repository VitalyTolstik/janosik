import { SelectField } from "@/components/ui/select-field";
import { useI18n } from "@/i18n";
import { ColumnDot, SectionLabel, WorkflowCheck, columnAccent } from "./parts";
import type { WorkflowDraftController } from "./useWorkflowDraft";

interface ColumnSemanticsProps {
  controller: WorkflowDraftController;
  testIdPrefix: string;
}

/**
 * Start/done semantics as one compact footer row, not a fifth card. These are
 * hints for reports and agents; they never restrict creating a card.
 */
export function ColumnSemantics({
  controller,
  testIdPrefix,
}: ColumnSemanticsProps) {
  const { t } = useI18n();
  const {
    columns,
    cleanDraft,
    canEdit,
    outsideProcess,
    setInitialColumn,
    toggleDoneColumn,
  } = controller;

  return (
    <div
      className="flex flex-col gap-2 border-t border-border/60 pt-3"
      data-testid={`${testIdPrefix}-semantics`}
    >
      <SectionLabel title={t("workflow.semanticsTitle")} />
      <div className="grid grid-cols-[minmax(120px,0.7fr)_minmax(0,1.3fr)] gap-x-3 gap-y-2 md:gap-x-[18px]">
        <label className="min-w-0 text-[11px] leading-4 text-muted-foreground">
          <span className="block">{t("workflow.startColumn")}</span>
          <SelectField<string>
            value={cleanDraft.initialColumnId ?? ""}
            disabled={!canEdit}
            ariaLabel={t("workflow.initialColumn")}
            testId={`${testIdPrefix}-initial`}
            onChange={(next) => setInitialColumn(next || undefined)}
            className="mt-1 h-8 px-2 text-[13px]"
            options={[
              { value: "", label: t("workflow.initialFallback") },
              ...columns.map((column) => ({
                value: column.id,
                label: column.title,
              })),
            ]}
          />
        </label>

        <div className="min-w-0 text-[11px] leading-4 text-muted-foreground">
          <span className="block">{t("workflow.doneColumnsShort")}</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {columns.map((column) => {
              const index = columns.findIndex(
                (entry) => entry.id === column.id,
              );
              return (
                <WorkflowCheck
                  key={column.id}
                  checked={cleanDraft.doneColumnIds.includes(column.id)}
                  disabled={!canEdit}
                  ariaLabel={column.title}
                  testId={`${testIdPrefix}-done-${column.id}`}
                  onCheckedChange={() => toggleDoneColumn(column.id)}
                >
                  <span className="inline-flex items-center gap-1">
                    <ColumnDot
                      color={columnAccent(column, index)}
                      size={5}
                      ring={false}
                    />
                    {column.title}
                  </span>
                </WorkflowCheck>
              );
            })}
          </div>
        </div>
      </div>
      <p className="text-[11px] leading-[1.45] text-muted-foreground/75">
        {t("workflow.doneHint")}
      </p>
      {outsideProcess.length > 0 ? (
        <p className="text-[11px] leading-4 text-warning">
          {t("workflow.outsideProcess", {
            columns: outsideProcess.map((column) => column.title).join(", "),
          })}
        </p>
      ) : null}
    </div>
  );
}
