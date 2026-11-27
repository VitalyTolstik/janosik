import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { useAdminT } from "../admin-i18n";
import { CopyButton, EntityLink } from "../cells";
import type { AdminListFilters } from "../admin-list-query";
import { AdminFilterPopover } from "./AdminFilterPopover";
import { FilterChip, FilterOptionChip } from "./FilterChip";
import {
  filterFacet,
  isCodeLookup,
  KIND_CHOICES,
  LINK_TYPE_CHOICES,
  offeredFilters,
  RADIO_FILTERS,
  type FilterBarSurface,
  PRIORITY_CHOICES,
  selectedFilterValues,
  shortId,
  type FilterKey,
} from "./filter-registry";
import type { ResolvedFilter } from "./use-list-filter-options";

export function AdminFilterBar({
  renderHeader,
  surface,
  triggerRef,
  chipRowRef,
  filters,
  targetHref,
  resolved,
  filtered,
  canClear,
  total,
  onChange,
  onRemove,
  onClear,
}: {
  renderHeader: (trigger: ReactNode) => ReactNode;
  surface: FilterBarSurface;
  triggerRef: RefObject<HTMLButtonElement>;
  chipRowRef: RefObject<HTMLDivElement>;
  filters: AdminListFilters;
  targetHref?: string | null;
  resolved: ResolvedFilter[];
  filtered: boolean;
  canClear: boolean;
  total: number | undefined;
  onChange: (patch: Partial<AdminListFilters>) => void;
  onRemove: (key: FilterKey, value?: string) => void;
  onClear: () => void;
}) {
  const t = useAdminT();
  const failed = resolved.filter((filter) => filter.error);
  const conflicts = resolved.filter(({ option }) => {
    // A command may have touched the card before it moved columns or boards.
    if (!option || surface === "commands") return false;
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
    key: FilterKey;
    value?: string;
    text: string;
    name?: string;
    context?: string;
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
  for (const [key, choices] of [
    ["priority", PRIORITY_CHOICES],
    ["kind", KIND_CHOICES],
    ...(surface === "cardLinks" ? [["type", LINK_TYPE_CHOICES] as const] : []),
  ] as const) {
    const selected = selectedFilterValues(filters, key);
    for (const { value, label } of choices) {
      if (selected.includes(value))
        choiceChips.push({
          key,
          value,
          text: t(label),
          name: t("admin.filters.remove", {
            facet: t(filterFacet(key).label),
            value: t(label),
          }),
        });
    }
  }
  for (const facet of offeredFilters(surface)) {
    if ("type" in facet && isCodeLookup(facet)) {
      const label = t(facet.label);
      for (const value of selectedFilterValues(filters, facet.key)) {
        choiceChips.push({
          key: facet.key,
          value,
          text: value,
          context: label,
          name: t("admin.filters.remove", { facet: label, value }),
        });
      }
    } else if (facet.kind === "id") {
      const value = filters[facet.key];
      if (!value) continue;
      const label = t(facet.label);
      const targetType =
        filters.targetType?.length === 1 ? filters.targetType[0] : undefined;
      choiceChips.push({
        key: facet.key,
        value,
        text: facet.key === "targetId" ? shortId(value) : value,
        context:
          facet.key === "targetId" && targetType
            ? `${label} · ${targetType}`
            : label,
        name: t("admin.filters.remove", { facet: label, value }),
      });
    }
  }
  for (const key of Object.keys(
    RADIO_FILTERS,
  ) as (keyof typeof RADIO_FILTERS)[]) {
    const choice = RADIO_FILTERS[key].choices.find(
      ({ value }) => value === filters[key],
    );
    if (choice) {
      const text = t(choice.label);
      choiceChips.push({
        key,
        text,
        name:
          key === "verified"
            ? t("admin.filters.remove", {
                facet: t(filterFacet(key).label),
                value: text,
              })
            : undefined,
      });
    }
  }

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
    context,
  }: (typeof choiceChips)[number]) => (
    <FilterChip
      key={`${key}:${value ?? ""}`}
      filterKey={key}
      value={value}
      title={context ? `${context}: ${value ?? text}` : undefined}
      removeLabel={
        name ?? t("admin.filters.removeUnsupported", { facet: text })
      }
      onRemove={() => onRemove(key, value)}
    >
      {context ? (
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate text-muted-foreground">
            {context}
          </span>
          <span
            className={
              key === "commandId" || key === "targetId"
                ? "min-w-0 max-w-[12ch] truncate font-mono"
                : "min-w-0 truncate font-mono"
            }
            title={value ?? text}
          >
            {key === "targetId" && targetHref ? (
              <EntityLink to={targetHref} ariaLabel={value}>
                <>{text}</>
              </EntityLink>
            ) : (
              text
            )}
          </span>
        </span>
      ) : (
        <span className="min-w-0 truncate" title={text}>
          {text}
        </span>
      )}
      {key === "commandId" && value ? (
        <CopyButton value={value} ariaLabel={t("admin.common.copy")} />
      ) : null}
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
          surface={surface}
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
            className="flex shrink-0 flex-wrap items-center gap-x-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-1 text-ui-label"
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1 text-ui-label">
          <p role="status">{t("admin.filters.lookupError")}</p>
          <Button
            size="sm"
            variant="outline"
            className="h-11 sm:h-8"
            onClick={() => {
              const retried = new Set<FilterKey>();
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
