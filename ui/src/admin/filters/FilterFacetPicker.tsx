import { useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check } from "lucide-react";
import {
  ADMIN_FILTER_OPTION_LIMITS,
  ADMIN_FILTER_QUERY_MAX_LENGTH,
  parseAdminFilterId,
} from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { useAdminT } from "../admin-i18n";
import { FilterColorDot } from "./FilterChip";
import {
  optionIds,
  optionState,
  type CardFilterFacet,
} from "./filter-registry";
import { useFilterOptions } from "./use-filter-options";

export function FilterFacetPicker({
  facet,
  boardId,
  value,
  onSelect,
}: {
  facet: CardFilterFacet;
  boardId: string | null;
  value: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useAdminT();
  const [query, setQuery] = useState("");
  const lookup = useFilterOptions({
    type: facet.type,
    q: query,
    limit: ADMIN_FILTER_OPTION_LIMITS.default,
    boardId: facet.key === "boardId" ? undefined : (boardId ?? undefined),
  });
  const options = lookup.data?.items ?? [];
  const exactId = parseAdminFilterId(query);
  const offerId =
    !lookup.loading &&
    exactId !== undefined &&
    !options.some((option) => option.id === exactId);
  const itemIds = options.map((option) => option.id);
  if (offerId) itemIds.push(exactId);

  const optionClassName =
    "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-hover sm:min-h-8";

  return (
    <Combobox.Root
      inline
      open
      items={itemIds}
      filter={null}
      value={value}
      inputValue={query}
      onInputValueChange={setQuery}
      onValueChange={(id) => {
        if (id !== null) onSelect(id);
      }}
    >
      <Combobox.Input
        autoFocus
        aria-label={t("admin.filters.search", { facet: t(facet.label) })}
        maxLength={ADMIN_FILTER_QUERY_MAX_LENGTH}
        placeholder={t("admin.common.search")}
        className="h-11 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
      />
      <Combobox.List className="mt-1 empty:hidden">
        {options.map((option) => (
          <Combobox.Item
            key={option.id}
            value={option.id}
            aria-label={[
              option.label,
              option.sublabel,
              optionIds(option.id, option),
              optionState(t, option.state),
            ]
              .filter(Boolean)
              .join(" · ")}
            className={optionClassName}
          >
            <FilterColorDot color={option.color} />
            <span className="min-w-0 flex-1">
              <span className="block truncate" title={option.label}>
                {option.label}
              </span>
              {option.sublabel ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {option.sublabel}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-right text-[11px] text-muted-foreground">
              <span className="block font-mono">
                {optionIds(option.id, option)}
              </span>
              {optionState(t, option.state)}
            </span>
            <Combobox.ItemIndicator>
              <Check className="size-4" aria-hidden />
            </Combobox.ItemIndicator>
          </Combobox.Item>
        ))}
        {offerId ? (
          <Combobox.Item value={exactId} className={optionClassName}>
            <span className="break-all">
              {t("admin.filters.useId", { id: exactId })}
            </span>
          </Combobox.Item>
        ) : null}
      </Combobox.List>
      {lookup.error ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <p role="status">{t("admin.filters.lookupError")}</p>
          <Button
            variant="outline"
            size="sm"
            className="h-11 sm:h-8"
            onClick={lookup.retry}
          >
            {t("admin.common.retry")}
          </Button>
        </div>
      ) : (
        <p
          role="status"
          className="mt-2 text-xs text-muted-foreground empty:hidden"
        >
          {lookup.loading
            ? t("admin.filters.loading")
            : options.length === 0
              ? t("admin.filters.noOptions")
              : lookup.data?.hasMore
                ? t(
                    facet.key === "columnId" && boardId === null
                      ? "admin.filters.narrowColumn"
                      : "admin.filters.refineSearch",
                  )
                : ""}
        </p>
      )}
    </Combobox.Root>
  );
}
