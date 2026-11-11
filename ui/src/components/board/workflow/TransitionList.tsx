import { Lock, Plus } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import type { Column, WorkflowTransition } from "@janosik/shared";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  ColumnDot,
  SectionLabel,
  columnAccent,
  directionOf,
  formatConditions,
  formatRoles,
} from "./parts";

interface TransitionListProps {
  columns: Column[];
  source: Column | undefined;
  transitions: WorkflowTransition[];
  enabledCount: number;
  canEdit: boolean;
  selectedId: string | null;
  onSelect: (transitionId: string) => void;
  onToggle: (transitionId: string, enabled: boolean) => void;
  onAllow: (toColumnId: string) => void;
  testIdPrefix: string;
}

/**
 * «Разрешено из «…»»: one row per destination column, in board order. An
 * existing rule keeps its switch and a disabled rule stays visible (dashed);
 * a missing rule offers «Разрешить». ArrowUp/Down move between rows, Space
 * toggles an existing rule and Enter opens it in the inspector.
 */
export function TransitionList({
  columns,
  source,
  transitions,
  enabledCount,
  canEdit,
  selectedId,
  onSelect,
  onToggle,
  onAllow,
  testIdPrefix,
}: TransitionListProps) {
  const { t } = useI18n();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const destinations = columns.filter((column) => column.id !== source?.id);
  const sourceTransitions = transitions.filter(
    (transition) => transition.fromColumnId === source?.id,
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = destinations.findIndex(
      (column) => refs.current[column.id] === document.activeElement,
    );
    if (index === -1) return;
    const focusAt = (next: number) => {
      const column = destinations[next];
      if (!column) return;
      event.preventDefault();
      refs.current[column.id]?.focus();
    };
    if (event.key === "ArrowDown") focusAt((index + 1) % destinations.length);
    else if (event.key === "ArrowUp")
      focusAt((index - 1 + destinations.length) % destinations.length);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(destinations.length - 1);
    else if (event.key === " " || event.key === "Enter") {
      const column = destinations[index];
      const transition = sourceTransitions.find(
        (entry) => entry.toColumnId === column?.id,
      );
      if (!column || !transition) return;
      event.preventDefault();
      if (event.key === " ") {
        onToggle(transition.id, transition.enabled === false);
      } else {
        onSelect(transition.id);
      }
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <SectionLabel
          title={t("workflow.allowedFrom", {
            column: source?.title ?? "",
          })}
          aside={t("workflow.enabledOf", {
            enabled: enabledCount,
            total: Math.max(columns.length - 1, 0),
          })}
          asideTestId={`${testIdPrefix}-rules-count`}
        />
        <p className="max-w-[58ch] text-[11px] leading-[1.5] text-muted-foreground">
          {t("workflow.listHint")}
        </p>
      </div>

      <div
        role="list"
        aria-label={t("workflow.allowedFrom", {
          column: source?.title ?? "",
        })}
        onKeyDown={onKeyDown}
        className="flex flex-col gap-[3px]"
        data-testid={`${testIdPrefix}-rules`}
      >
        {destinations.map((column) => {
          const index = columns.findIndex((entry) => entry.id === column.id);
          const accent = columnAccent(column, index);
          const transition = sourceTransitions.find(
            (entry) => entry.toColumnId === column.id,
          );
          const enabled =
            transition !== undefined && transition.enabled !== false;
          const selected =
            transition !== undefined && transition.id === selectedId;
          const direction = directionOf(columns, source?.id ?? "", column.id);
          const directionLabel =
            direction === "forward"
              ? t("workflow.direction.forward")
              : t("workflow.direction.back");
          const roles = formatRoles(
            transition?.allowedRoles ?? ["ADMIN", "MEMBER"],
            t,
          );
          const conditions = formatConditions(transition?.conditions ?? [], t);
          const summary = transition
            ? `${roles}${conditions ? ` · ${conditions}` : ""}`
            : t("workflow.forbidden");
          return (
            <div
              key={column.id}
              role="listitem"
              data-testid={`${testIdPrefix}-row-${column.id}`}
              className={cn(
                "flex items-center gap-2 rounded-md border pr-1.5 transition-colors motion-reduce:transition-none",
                transition
                  ? "border-border/65 bg-card/30"
                  : "border-dashed border-border/50 bg-transparent",
                selected && "border-primary/45 bg-primary/[0.13]",
                transition?.enabled === false && "border-dashed bg-transparent",
                "hover:border-muted-foreground/25 hover:bg-card/50",
              )}
            >
              <button
                ref={(element) => {
                  refs.current[column.id] = element;
                }}
                type="button"
                aria-pressed={enabled}
                aria-current={selected ? "true" : undefined}
                aria-label={`${column.title}. ${directionLabel}. ${summary}`}
                data-testid={`${testIdPrefix}-row-main-${column.id}`}
                onClick={() => {
                  if (transition) onSelect(transition.id);
                }}
                className="flex min-w-0 flex-1 items-center gap-[7px] rounded-md px-[7px] py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover max-md:gap-1.5"
              >
                <ColumnDot color={accent} size={7} />
                <span className="shrink-0 whitespace-nowrap text-xs font-semibold leading-4 text-foreground">
                  {column.title}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-[3px] px-1 py-px text-[11px] leading-4",
                    direction === "forward"
                      ? "bg-success/15 text-success"
                      : "bg-warning/15 text-warning",
                  )}
                >
                  {directionLabel}
                </span>
                <span className="ml-auto hidden min-w-0 truncate text-right text-[11px] leading-4 text-muted-foreground/75 md:block">
                  {transition ? (
                    <>
                      {summary}
                      {transition.enabled === false ? (
                        <span className="ml-1 text-warning">
                          · {t("workflow.ruleDisabled")}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="h-2.5 w-2.5" aria-hidden />
                      {summary}
                    </span>
                  )}
                </span>
              </button>

              {transition ? (
                <Switch
                  checked={enabled}
                  disabled={!canEdit}
                  aria-label={t("workflow.toggleRule", {
                    column: column.title,
                  })}
                  data-testid={`${testIdPrefix}-row-switch-${column.id}`}
                  onCheckedChange={(checked) =>
                    onToggle(transition.id, checked)
                  }
                />
              ) : (
                <button
                  type="button"
                  disabled={!canEdit}
                  aria-label={t("workflow.allowLabel", {
                    column: column.title,
                  })}
                  data-testid={`${testIdPrefix}-allow-${column.id}`}
                  onClick={() => onAllow(column.id)}
                  className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded border border-dashed border-muted-foreground/25 px-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  {t("workflow.allow")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {columns.length < 2 ? (
        <p
          className="rounded-md border border-border/60 bg-card/30 px-2.5 py-2 text-[11px] text-muted-foreground"
          data-testid={`${testIdPrefix}-empty-columns`}
        >
          {t("workflow.empty.columns")}
        </p>
      ) : null}

      {destinations.length > 0 && sourceTransitions.length === 0 ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          {t("workflow.empty.rules")}
        </p>
      ) : null}
    </div>
  );
}
