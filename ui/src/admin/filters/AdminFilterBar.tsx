import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAdminT } from "../admin-i18n";
import type { AdminListFilters } from "../admin-list-query";
import { AdminFilterPopover } from "./AdminFilterPopover";
import { FilterChip } from "./FilterChip";
import type { CardFilterKey } from "./filter-registry";
import type { ResolvedCardFilter } from "./use-card-filter-options";

export function AdminFilterBar({
  renderHeader,
  filters,
  resolved,
  filtered,
  canClear,
  total,
  onChange,
  onClear,
}: {
  renderHeader: (trigger: ReactNode) => ReactNode;
  filters: AdminListFilters;
  resolved: ResolvedCardFilter[];
  filtered: boolean;
  canClear: boolean;
  total: number | undefined;
  onChange: (key: CardFilterKey, id: string | null) => void;
  onClear: () => void;
}) {
  const t = useAdminT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chipButtons = useRef<
    Partial<Record<CardFilterKey, HTMLButtonElement | null>>
  >({});
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

  const remove = (key: CardFilterKey) => {
    const next =
      resolved[resolved.findIndex((filter) => filter.key === key) + 1];
    const nextButton =
      key !== "boardId" && next ? chipButtons.current[next.key] : null;
    (nextButton ?? triggerRef.current)?.focus();
    onChange(key, null);
  };

  return (
    <>
      {renderHeader(
        <AdminFilterPopover
          triggerRef={triggerRef}
          filters={filters}
          count={resolved.length}
          onChange={onChange}
        />,
      )}
      {canClear ? (
        <div
          className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5"
          data-testid={resolved.length > 0 ? "admin-filter-banner" : undefined}
        >
          {resolved.map((filter) => (
            <FilterChip
              key={filter.key}
              filter={filter}
              buttonRef={(button) => {
                chipButtons.current[filter.key] = button;
              }}
              onRemove={() => remove(filter.key)}
            />
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-11 px-2 sm:h-8"
            data-testid="admin-filter-clear"
            onClick={() => {
              triggerRef.current?.focus();
              onClear();
            }}
          >
            {t("admin.filters.clearAll")}
          </Button>
        </div>
      ) : null}
      {conflicts.length > 0 ? (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-x-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-1 text-xs"
        >
          <p>{t("admin.filters.conflict")}</p>
          {conflicts.map(({ key, label }) => (
            <Button
              key={key}
              size="sm"
              variant="outline"
              className="h-11 sm:h-8"
              onClick={() => remove(key)}
            >
              {t("admin.filters.removeConflict", { facet: t(label) })}
            </Button>
          ))}
        </div>
      ) : null}
      {failed.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1 text-xs">
          <p role="status">{t("admin.filters.lookupError")}</p>
          <Button
            size="sm"
            variant="outline"
            className="h-11 sm:h-8"
            onClick={() => failed.forEach((filter) => filter.retry())}
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
