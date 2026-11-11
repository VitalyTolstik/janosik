import { Plus } from "lucide-react";
import type { Column, WorkflowTransition } from "@janosik/shared";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { ColumnDot, GlobalMark, columnAccent, formatRoles } from "./parts";

interface GlobalTransitionsProps {
  columns: Column[];
  globals: WorkflowTransition[];
  targets: Column[];
  canEdit: boolean;
  onSelect: (transitionId: string) => void;
  onAdd: (columnId: string) => void;
  testIdPrefix: string;
}

/**
 * One compact strip for transitions that start in any column. It never
 * competes with the per-column list: a warning-tinted lead, destination chips
 * and one dashed add button.
 */
export function GlobalTransitions({
  columns,
  globals,
  targets,
  canEdit,
  onSelect,
  onAdd,
  testIdPrefix,
}: GlobalTransitionsProps) {
  const { t } = useI18n();
  return (
    <div
      className="border-t border-border/60 pt-3"
      data-testid={`${testIdPrefix}-globals`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="inline-flex shrink-0 items-center gap-1 pt-1 text-[11px] leading-4 text-muted-foreground">
          <GlobalMark />
          {t("workflow.globalsLead")}
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {globals.map((transition) => {
            const column = columns.find(
              (entry) => entry.id === transition.toColumnId,
            );
            if (!column) return null;
            const index = columns.findIndex((entry) => entry.id === column.id);
            return (
              <button
                key={transition.id}
                type="button"
                data-testid={`${testIdPrefix}-global-${transition.id}`}
                onClick={() => onSelect(transition.id)}
                className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[5px] border border-warning/30 bg-warning/[0.06] px-1.5 text-[11px] text-foreground transition-colors hover:border-warning/50 hover:bg-warning/[0.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover motion-reduce:transition-none"
              >
                <ColumnDot
                  color={columnAccent(column, index)}
                  size={6}
                  ring={false}
                />
                <span>
                  {t("workflow.globalChip", { column: column.title })}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground/80 max-[360px]:hidden">
                  {formatRoles(transition.allowedRoles, t)}
                </span>
              </button>
            );
          })}
          {globals.length === 0 ? (
            <span className="px-1 pt-1 text-[11px] text-muted-foreground/75">
              {t("workflow.globalEmptyShort")}
            </span>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!canEdit || targets.length === 0}
                aria-label={t("workflow.globalAddTarget")}
                data-testid={`${testIdPrefix}-global-add`}
                className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[5px] border border-dashed border-muted-foreground/25 px-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              >
                <Plus className="h-3 w-3" aria-hidden />
                {t("workflow.globalAddShort")}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-64 overflow-y-auto"
            >
              {targets.map((column) => (
                <DropdownMenuItem
                  key={column.id}
                  data-testid={`${testIdPrefix}-global-add-${column.id}`}
                  onSelect={() => onAdd(column.id)}
                >
                  {column.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
