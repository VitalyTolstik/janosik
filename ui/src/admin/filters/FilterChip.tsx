import { X } from "lucide-react";
import type { ReactNode } from "react";
import { LABEL_COLOR_DOT, type LabelColor } from "@janosik/shared";
import { cn } from "@/lib/utils";
import { useAdminT } from "../admin-i18n";
import { optionIds, optionState, type FilterKey } from "./filter-registry";
import type { ResolvedFilter } from "./use-list-filter-options";

export function FilterColorDot({ color }: { color?: string }) {
  if (!color) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        LABEL_COLOR_DOT[color as LabelColor] ?? LABEL_COLOR_DOT.plain,
      )}
    />
  );
}

export function FilterOptionChip({
  filter,
  onRemove,
}: {
  filter: ResolvedFilter;
  onRemove: () => void;
}) {
  const t = useAdminT();
  const { key, id, option, loading, label } = filter;
  const facet = t(label);
  const name =
    option?.label ||
    (loading
      ? "…"
      : filter.data?.missing.includes(id)
        ? t(`admin.filters.unknown.${key}`)
        : facet);
  const state = optionState(t, option?.state);
  const email = filter.type === "user" ? option?.sublabel : null;
  const ids = loading ? undefined : optionIds(id, option);
  const title = `${name} · ${optionIds(id, option, false)}`;
  const value = [loading ? t("admin.filters.loading") : name, email, state, ids]
    .filter(Boolean)
    .join(" · ");

  return (
    <FilterChip
      filterKey={key}
      value={id}
      title={
        loading
          ? undefined
          : [title, option?.sublabel].filter(Boolean).join(" · ")
      }
      removeLabel={t("admin.filters.remove", { facet, value })}
      onRemove={onRemove}
    >
      <span
        className={cn(
          "flex min-w-0 items-center gap-1",
          option?.columnId && "flex-col items-start gap-0",
        )}
      >
        <span className="flex min-w-0 max-w-full items-center gap-1">
          {option || loading ? (
            <span className="shrink-0 text-muted-foreground">{facet}:</span>
          ) : null}
          <FilterColorDot color={option?.color} />
          {email ? (
            <span className="min-w-0">
              <span className="block truncate" title={title}>
                {name}
              </span>
              <span
                className="block truncate text-[10px] text-muted-foreground"
                title={email}
              >
                {email}
              </span>
            </span>
          ) : (
            <span className="min-w-0 truncate" title={title}>
              {name}
            </span>
          )}
          {state ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {state}
            </span>
          ) : null}
        </span>
        {ids ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {option?.columnId ? ids : `· ${ids}`}
          </span>
        ) : null}
      </span>
    </FilterChip>
  );
}

export function FilterChip({
  filterKey,
  value,
  title,
  removeLabel,
  onRemove,
  children,
}: {
  filterKey: FilterKey;
  value?: string;
  title?: string;
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex min-w-0 max-w-[min(20rem,calc(100dvw-2rem))] items-center gap-1 rounded-md border border-border bg-hover/40 pl-2 text-xs text-foreground"
      data-testid={`admin-filter-${filterKey}`}
      title={title}
    >
      {children}
      <button
        type="button"
        className="inline-grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:size-8"
        aria-label={removeLabel}
        data-testid={`admin-filter-clear-${filterKey}`}
        data-filter-key={filterKey}
        data-filter-value={value}
        onClick={onRemove}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}
