import { Check } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { ColumnDot, SectionLabel, columnAccent } from "./parts";
import type { WorkflowDraftController } from "./useWorkflowDraft";

interface Cell {
  row: string;
  col: string;
}

interface TransitionMatrixProps {
  controller: WorkflowDraftController;
  testIdPrefix: string;
}

/**
 * The full 5×5 (up to 12×12) coverage matrix, now a secondary tab. It keeps
 * the original `workflow-cell-*` contract but adds a roving tabindex, so 25
 * cells are one Tab stop: arrows move, Home/End jump inside a row and
 * Space/Enter activate the focused cell.
 */
export function TransitionMatrix({
  controller,
  testIdPrefix,
}: TransitionMatrixProps) {
  const { t } = useI18n();
  const {
    columns,
    cleanDraft,
    selected,
    selectedId,
    canEdit,
    toggleCell,
    selectTransition,
  } = controller;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const firstCell = (): Cell => {
    const selectedFrom = selected?.fromColumnId;
    if (selectedFrom) {
      return { row: selectedFrom, col: selected.toColumnId };
    }
    const row = columns[0];
    const col = columns.find((column) => column.id !== row?.id);
    return { row: row?.id ?? "", col: col?.id ?? "" };
  };
  const [focusCell, setFocusCell] = useState<Cell>(firstCell);

  useEffect(() => {
    if (selected?.fromColumnId) {
      setFocusCell({
        row: selected.fromColumnId,
        col: selected.toColumnId,
      });
    }
  }, [selectedId, selected?.fromColumnId, selected?.toColumnId]);

  const valid = (row: number, col: number) =>
    row >= 0 &&
    col >= 0 &&
    row < columns.length &&
    col < columns.length &&
    columns[row]?.id !== columns[col]?.id;

  const focusAt = (row: number, col: number) => {
    if (!valid(row, col)) return;
    const from = columns[row];
    const to = columns[col];
    if (!from || !to) return;
    setFocusCell({ row: from.id, col: to.id });
    refs.current[`${from.id}:${to.id}`]?.focus();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    rowIndex: number,
    colIndex: number,
  ) => {
    const count = columns.length;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      for (let offset = 1; offset <= count; offset += 1) {
        const next = (colIndex + step * offset + count) % count;
        if (valid(rowIndex, next)) {
          focusAt(rowIndex, next);
          return;
        }
      }
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      for (let offset = 1; offset <= count; offset += 1) {
        const next = (rowIndex + step * offset + count) % count;
        if (valid(next, colIndex)) {
          focusAt(next, colIndex);
          return;
        }
      }
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const indexes = columns
        .map((_, index) => index)
        .filter((index) => valid(rowIndex, index));
      const next =
        event.key === "Home" ? indexes[0] : indexes[indexes.length - 1];
      if (next !== undefined) focusAt(rowIndex, next);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const from = columns[rowIndex];
      const to = columns[colIndex];
      if (from && to) toggleCell(from.id, to.id);
    }
  };

  const totalRules = cleanDraft.transitions.length;

  return (
    <section
      className="flex min-w-0 flex-col gap-2"
      data-testid={`${testIdPrefix}-matrix`}
    >
      <div className="flex flex-col gap-1">
        <SectionLabel
          title={t("workflow.matrixTitle")}
          aside={t("workflow.rulesCount", { count: totalRules })}
        />
        <p className="max-w-[72ch] text-[11px] leading-[1.5] text-muted-foreground">
          {t("workflow.matrixHintNew")}
        </p>
      </div>

      <div className="min-w-0 overflow-auto rounded-[7px] border border-border/75 bg-card/40">
        <table
          role="grid"
          aria-label={t("workflow.matrix")}
          aria-rowcount={columns.length + 1}
          aria-colcount={columns.length + 1}
          className="w-full min-w-[520px] table-fixed border-separate border-spacing-0 text-[11px]"
          data-testid={`${testIdPrefix}-matrix-grid`}
        >
          <thead>
            <tr aria-rowindex={1}>
              <th
                role="columnheader"
                aria-colindex={1}
                className="w-[126px] border-b border-border/60 bg-surface/90 px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground/75"
              >
                {t("workflow.fromTo")}
              </th>
              {columns.map((column, index) => (
                <th
                  key={column.id}
                  role="columnheader"
                  aria-colindex={index + 2}
                  title={column.title}
                  className="h-[30px] max-w-24 truncate border-b border-border/60 bg-surface/90 px-1 py-1 text-center text-[11px] font-medium text-muted-foreground"
                >
                  <ColumnDot
                    color={columnAccent(column, index)}
                    size={6}
                    ring={false}
                  />
                  <span className="ml-1 max-w-[calc(100%-12px)] truncate align-middle">
                    {column.title}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((from, rowIndex) => (
              <tr key={from.id} aria-rowindex={rowIndex + 2}>
                <th
                  role="rowheader"
                  aria-colindex={1}
                  title={from.title}
                  className="max-w-[126px] truncate border-b border-border/50 bg-surface/60 px-2 py-1.5 text-left text-[11px] font-medium text-foreground"
                >
                  <ColumnDot
                    color={columnAccent(from, rowIndex)}
                    size={6}
                    ring={false}
                  />
                  <span className="ml-1 align-middle">{from.title}</span>
                  <span className="float-right pt-px font-mono text-[11px] font-normal text-muted-foreground/75">
                    {from.cardIds.length}
                  </span>
                </th>
                {columns.map((to, colIndex) => {
                  const transition = cleanDraft.transitions.find(
                    (entry) =>
                      entry.fromColumnId === from.id &&
                      entry.toColumnId === to.id,
                  );
                  const diagonal = from.id === to.id;
                  const on =
                    transition !== undefined && transition.enabled !== false;
                  const conditional =
                    on && (transition?.conditions?.length ?? 0) > 0;
                  const isSelected =
                    transition !== undefined && selectedId === transition.id;
                  const focused =
                    focusCell.row === from.id && focusCell.col === to.id;
                  const label = diagonal
                    ? t("workflow.diagonalHint")
                    : t("workflow.cellLabel", {
                        from: from.title,
                        to: to.title,
                      });
                  return (
                    <td
                      key={to.id}
                      role="gridcell"
                      aria-colindex={colIndex + 2}
                      className="border-b border-border/50 bg-card/20 p-[3px] text-center"
                    >
                      <button
                        ref={(element) => {
                          refs.current[`${from.id}:${to.id}`] = element;
                        }}
                        type="button"
                        disabled={!canEdit || diagonal}
                        aria-pressed={on}
                        aria-label={label}
                        title={
                          diagonal
                            ? t("workflow.diagonalHint")
                            : on
                              ? t("workflow.cellOnHint")
                              : t("workflow.cellOffHint")
                        }
                        tabIndex={focused && !diagonal ? 0 : -1}
                        data-testid={`${testIdPrefix}-cell-${from.id}-${to.id}`}
                        onFocus={() =>
                          setFocusCell({ row: from.id, col: to.id })
                        }
                        onKeyDown={(event) =>
                          onKeyDown(event, rowIndex, colIndex)
                        }
                        onClick={() => {
                          if (diagonal) return;
                          if (transition) {
                            selectTransition(transition.id);
                            if (transition.enabled === false) {
                              toggleCell(from.id, to.id);
                            }
                          } else {
                            toggleCell(from.id, to.id);
                          }
                        }}
                        className={cn(
                          "relative grid h-[26px] w-full min-w-[22px] place-items-center rounded border text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                          diagonal
                            ? "cursor-default border-transparent bg-muted/5 text-muted-foreground/40"
                            : on
                              ? "border-primary/45 bg-primary/[0.16] text-primary"
                              : transition
                                ? "border-dashed border-border/60 bg-transparent text-muted-foreground"
                                : "border-border/60 bg-transparent text-muted-foreground/50 hover:border-primary/40 hover:bg-primary/5",
                          conditional &&
                            "border-warning/50 bg-warning/[0.14] text-warning",
                          isSelected && "ring-1 ring-primary",
                        )}
                      >
                        {diagonal ? (
                          <span className="h-px w-2.5 bg-muted-foreground/40" />
                        ) : on ? (
                          <Check className="h-3 w-3" strokeWidth={2.5} />
                        ) : transition ? (
                          <span className="h-px w-2.5 bg-muted-foreground/60" />
                        ) : (
                          <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/50" />
                        )}
                        {conditional ? (
                          <span
                            aria-hidden
                            className="absolute right-1 top-1 h-1 w-1 rounded-full bg-warning"
                          />
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1.5 text-[11px] text-muted-foreground/75">
        <LegendSwatch kind="on" label={t("workflow.matrixLegend.allowed")} />
        <LegendSwatch kind="off" label={t("workflow.matrixLegend.off")} />
        <LegendSwatch
          kind="conditional"
          label={t("workflow.matrixLegend.conditional")}
        />
        <LegendSwatch
          kind="diagonal"
          label={t("workflow.matrixLegend.diagonal")}
        />
        <LegendSwatch kind="none" label={t("workflow.matrixLegend.none")} />
        <span className="ml-auto hidden text-muted-foreground/60 sm:block">
          {t("workflow.matrixHint")}
        </span>
      </div>
    </section>
  );
}

function LegendSwatch({
  kind,
  label,
}: {
  kind: "on" | "off" | "conditional" | "diagonal" | "none";
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={cn(
          "inline-block h-2 w-2 rounded-[2px] border",
          kind === "on"
            ? "border-primary/55 bg-primary/40"
            : kind === "conditional"
              ? "border-warning/55 bg-warning/40"
              : kind === "off"
                ? "border-dashed border-border bg-transparent"
                : kind === "diagonal"
                  ? "border-transparent bg-muted-foreground/20"
                  : "border-border bg-transparent",
        )}
      />
      {label}
    </span>
  );
}
