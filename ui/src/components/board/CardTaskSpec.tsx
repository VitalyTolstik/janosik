import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { useI18n } from "@/i18n";

/**
 * The card's machine-readable task contract (TASK-157): acceptance criteria
 * and definition of done, set by an agent over MCP/commands. Read-only here —
 * the dialog shows the contract so a human can review what an agent was told
 * to do, without offering an editor the reducer does not back yet.
 */
export function CardTaskSpec({
  acceptanceCriteria,
  definitionOfDone,
}: {
  acceptanceCriteria?: string[];
  definitionOfDone?: string[];
}) {
  const { t } = useI18n();
  const criteria = acceptanceCriteria ?? [];
  const done = definitionOfDone ?? [];
  if (criteria.length === 0 && done.length === 0) return null;

  return (
    <CollapsibleSection
      title={t("card.taskSpec.title")}
      badge={criteria.length + done.length}
      testId="card-task-spec"
      contentClassName="mt-1.5 space-y-2"
    >
      {criteria.length > 0 ? (
        <TaskSpecList
          label={t("card.taskSpec.acceptanceCriteria")}
          items={criteria}
          testId="card-task-spec-acceptance"
        />
      ) : null}
      {done.length > 0 ? (
        <TaskSpecList
          label={t("card.taskSpec.definitionOfDone")}
          items={done}
          testId="card-task-spec-done"
        />
      ) : null}
    </CollapsibleSection>
  );
}

function TaskSpecList({
  label,
  items,
  testId,
}: {
  label: string;
  items: string[];
  testId: string;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <ul
        className="list-disc space-y-0.5 pl-5 text-sm text-foreground"
        data-testid={testId}
      >
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
