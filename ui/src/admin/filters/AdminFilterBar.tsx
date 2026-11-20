import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { useAdminT } from "../admin-i18n";
import type { AdminListFilters } from "../admin-list-query";
import { AdminFilterPopover } from "./AdminFilterPopover";
import { FilterChip, FilterOptionChip } from "./FilterChip";
import {
  ATTACHMENT_CHOICES,
  DUE_CHOICES,
  PRIORITY_CHOICES,
  shortId,
  type CardFilterKey,
} from "./filter-registry";
import type { ResolvedCardFilter } from "./use-card-filter-options";

export function AdminFilterBar({
  renderHeader,
  triggerRef,
  chipRowRef,
  filters,
  resolved,
  filtered,
  canClear,
  total,
  onChange,
  onRemove,
  onClear,
}: {
  renderHeader: (trigger: ReactNode) => ReactNode;
  triggerRef: RefObject<HTMLButtonElement>;
  chipRowRef: RefObject<HTMLDivElement>;
  filters: AdminListFilters;
  resolved: ResolvedCardFilter[];
  filtered: boolean;
  canClear: boolean;
  total: number | undefined;
  onChange: (patch: Partial<AdminListFilters>) => void;
  onRemove: (key: CardFilterKey, value?: string) => void;
  onClear: () => void;
}) {
  const t = useAdminT();
  const failed = resolved.filter((filter) => filter.error);
  const conflicts = resolved.filter(({ option }) => {
    if (!option) return false;
    return (
      (filters.boardId !== null &&
        option.boardId !== null &&
        option.boardId !== filters.boardId) ||
      (filters.columnId !== null &&
        option.columnId !== null &&
        option.columnId !== filters.columnId)
    );
  });

  const choiceChips: {
    key: CardFilterKey;
    value?: string;
    text: string;
    name?: string;
  }[] = [];
  if (filters.labelMatch === "all") {
    choiceChips.push({
      key: "labelMatch",
      text: t("admin.filters.labelMatch.chip"),
      name: t("admin.filters.remove", {
        facet: t("admin.filters.labelMatch"),
        value: t("admin.filters.labelMatch.allValue"),
      }),
    });
  }
  if (filters.unassigned)
    choiceChips.push({
      key: "unassigned",
      text: t("admin.filters.unassigned"),
    });
  for (const { value, label } of PRIORITY_CHOICES) {
    if (filters.priority?.includes(value))
      choiceChips.push({ key: "priority", value, text: t(label) });
  }
  const due = DUE_CHOICES.find(({ value }) => value === filters.due);
  if (due) choiceChips.push({ key: "due", text: t(due.label) });
  const attachments = ATTACHMENT_CHOICES.find(
    ({ value }) => value === filters.hasAttachments,
  );
  if (attachments)
    choiceChips.push({ key: "hasAttachments", text: t(attachments.label) });

  const facets = new Set([
    ...resolved.map(({ key }) => key),
    ...choiceChips.map(({ key }) =>
      key === "unassigned"
        ? "assigneeId"
        : key === "labelMatch"
          ? "labelId"
          : key,
    ),
  ]);
  const renderChoice = ({
    key,
    value,
    text,
    name,
  }: (typeof choiceChips)[number]) => (
    <FilterChip
      key={`${key}:${value ?? ""}`}
      filterKey={key}
      value={value}
      removeLabel={
        name ?? t("admin.filters.removeUnsupported", { facet: text })
      }
      onRemove={() => onRemove(key, value)}
    >
      <span className="min-w-0 truncate" title={text}>
        {text}
      </span>
    </FilterChip>
  );

  const modeChip = choiceChips.find(({ key }) => key === "labelMatch");
  const chips = resolved.flatMap((filter, index) => {
    const chip = (
      <FilterOptionChip
        key={`${filter.key}:${filter.id}`}
        filter={filter}
        onRemove={() => onRemove(filter.key, filter.id)}
      />
    );
    return modeChip &&
      filter.key === "labelId" &&
      resolved[index + 1]?.key !== "labelId"
      ? [chip, renderChoice(modeChip)]
      : [chip];
  });

  return (
    <>
      {renderHeader(
        <AdminFilterPopover
          triggerRef={triggerRef}
          filters={filters}
          count={facets.size}
          onChange={onChange}
        />,
      )}
      {canClear ? (
        <div
          ref={chipRowRef}
          className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5"
          data-testid={facets.size > 0 ? "admin-filter-banner" : undefined}
        >
          {chips}
          {choiceChips
            .filter(({ key }) => key !== "labelMatch")
            .map(renderChoice)}
          <Button
            size="sm"
            variant="ghost"
            className="h-11 px-2 sm:h-8"
            data-testid="admin-filter-clear"
            onClick={onClear}
          >
            {t("admin.filters.clearAll")}
          </Button>
        </div>
      ) : null}
      {conflicts.map(({ key, label, id, option }) => {
        const facet = t(label);
        const name = option?.label ? `${facet} — ${option.label}` : facet;
        const value = `${name} · ${shortId(id)}`;
        return (
          <div
            key={`${key}:${id}`}
            className="flex shrink-0 flex-wrap items-center gap-x-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-1 text-xs"
          >
            <p role="alert" className="min-w-0 wrap-anywhere">
              {t("admin.filters.conflict", { value })}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-auto min-h-11 max-w-full wrap-anywhere whitespace-normal sm:min-h-8"
              onClick={() => onRemove(key, id)}
            >
              {t("admin.filters.removeConflict", { value })}
            </Button>
          </div>
        );
      })}
      {failed.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1 text-xs">
          <p role="status">{t("admin.filters.lookupError")}</p>
          <Button
            size="sm"
            variant="outline"
            className="h-11 sm:h-8"
            onClick={() => {
              const retried = new Set<CardFilterKey>();
              for (const filter of failed) {
                if (retried.has(filter.key)) continue;
                retried.add(filter.key);
                filter.retry();
              }
            }}
          >
            {t("admin.common.retry")}
          </Button>
        </div>
      ) : null}
      <span
        role="status"
        aria-atomic="true"
        className="sr-only"
        data-testid="admin-filter-results"
      >
        {total === undefined
          ? ""
          : t(filtered ? "admin.filters.results" : "admin.filters.total", {
              total,
            })}
      </span>
    </>
  );
}
