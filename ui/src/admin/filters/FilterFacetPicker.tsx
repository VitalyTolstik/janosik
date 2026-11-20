import { useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check } from "lucide-react";
import {
  ADMIN_FILTER_OPTION_LIMITS,
  ADMIN_FILTER_QUERY_MAX_LENGTH,
  parseAdminFilterId,
  adminFilterValueLimit,
  type AdminFilterOptionDto,
} from "@janosik/shared";
import { Button } from "@/components/ui/button";
import type { AdminListFilters } from "../admin-list-query";
import { useAdminT, type AdminT } from "../admin-i18n";
import { FilterColorDot } from "./FilterChip";
import {
  optionIds,
  optionState,
  PRIORITY_CHOICES,
  selectedFilterValues,
  type DraftFacet,
  type LookupFacet,
} from "./filter-registry";
import { FilterRadioGroup } from "./FilterRadioGroup";
import { useFilterOptions } from "./use-filter-options";

export function FilterFacetPicker({
  facet,
  boardId,
  value,
  onSelect,
}: {
  facet: Extract<LookupFacet, { kind: "lookup" }>;
  boardId: string | null;
  value: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useAdminT();
  const { query, setQuery, lookup, options, offeredId } = usePickerLookup(
    facet,
    boardId,
  );
  const itemIds = options.map((option) => option.id);
  if (offeredId) itemIds.push(offeredId);

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
            aria-label={optionName(option, t)}
            className={optionClassName}
          >
            <OptionContent option={option} />
            <Combobox.ItemIndicator>
              <Check className="size-4" aria-hidden />
            </Combobox.ItemIndicator>
          </Combobox.Item>
        ))}
        {offeredId ? (
          <Combobox.Item value={offeredId} className={optionClassName}>
            <span className="break-all">
              {t("admin.filters.useId", { id: offeredId })}
            </span>
          </Combobox.Item>
        ) : null}
      </Combobox.List>
      <LookupStatus lookup={lookup} facet={facet} boardId={boardId} />
    </Combobox.Root>
  );
}

function usePickerLookup(facet: LookupFacet, boardId: string | null) {
  const [query, setQuery] = useState("");
  const lookup = useFilterOptions({
    type: facet.type,
    q: query,
    limit: ADMIN_FILTER_OPTION_LIMITS.default,
    boardId:
      facet.key === "boardId" || facet.key === "assigneeId"
        ? undefined
        : (boardId ?? undefined),
  });
  const options = lookup.data?.items ?? [];
  const exactId = parseAdminFilterId(query);
  const offerId =
    !lookup.loading &&
    exactId !== undefined &&
    !options.some((option) => option.id === exactId);

  return {
    query,
    setQuery,
    lookup,
    options,
    exactId,
    offeredId: offerId ? exactId : undefined,
  };
}

function optionName(option: AdminFilterOptionDto, t: AdminT) {
  return [
    option.label,
    option.sublabel,
    optionIds(option.id, option),
    optionState(t, option.state),
  ]
    .filter(Boolean)
    .join(" · ");
}

function OptionContent({ option }: { option: AdminFilterOptionDto }) {
  const t = useAdminT();
  return (
    <>
      <FilterColorDot color={option.color} />
      <span className="min-w-0 flex-1">
        <span className="block truncate" title={option.label}>
          {option.label}
        </span>
        {option.sublabel ? (
          <span
            className="block truncate text-xs text-muted-foreground"
            title={option.sublabel}
          >
            {option.sublabel}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-right text-[11px] text-muted-foreground">
        <span className="block font-mono">{optionIds(option.id, option)}</span>
        {optionState(t, option.state)}
      </span>
    </>
  );
}

function LookupStatus({
  lookup,
  facet,
  boardId,
  hasPinnedRows = false,
}: {
  lookup: ReturnType<typeof useFilterOptions>;
  facet: LookupFacet;
  boardId: string | null;
  hasPinnedRows?: boolean;
}) {
  const t = useAdminT();
  if (lookup.error) {
    return (
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
    );
  }
  const message = lookup.loading
    ? "admin.filters.loading"
    : !lookup.data?.items.length && !hasPinnedRows
      ? "admin.filters.noOptions"
      : lookup.data?.hasMore
        ? facet.key === "columnId" && boardId === null
          ? "admin.filters.narrowColumn"
          : "admin.filters.refineSearch"
        : undefined;
  return (
    <p
      role="status"
      className="mt-2 text-xs text-muted-foreground empty:hidden"
    >
      {message ? t(message) : null}
    </p>
  );
}

function ChoiceCheckbox({
  name,
  checked,
  disabled,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover has-[:disabled]:cursor-default has-[:disabled]:opacity-60 sm:min-h-8">
      <input
        type="checkbox"
        aria-label={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      {children}
    </label>
  );
}

export function DraftFacetPicker({
  facet,
  draft,
  onChange,
}: {
  facet: DraftFacet;
  draft: AdminListFilters;
  onChange: (patch: Partial<AdminListFilters>) => void;
}) {
  const t = useAdminT();
  const [query, setQuery] = useState("");
  if (facet.key !== "priority") {
    return (
      <MultiLookupPicker facet={facet} draft={draft} onChange={onChange} />
    );
  }
  const priorities = draft.priority ?? [];
  const search = query.trim().toLocaleLowerCase();
  const chosen = PRIORITY_CHOICES.filter(({ value }) =>
    priorities.includes(value),
  );
  const available = PRIORITY_CHOICES.filter(
    ({ value, label }) =>
      !priorities.includes(value) &&
      (value.includes(search) || t(label).toLocaleLowerCase().includes(search)),
  );
  return (
    <>
      <PickerSearch facet={t(facet.label)} query={query} onChange={setQuery} />
      <p className="px-2 pb-1 text-xs text-muted-foreground">
        {t("admin.filters.priority.help")}
      </p>
      <p className="px-2 py-1 text-xs text-muted-foreground">
        {t("admin.filters.selected", { count: priorities.length })}
      </p>
      <div role="group" aria-label={t(facet.label)}>
        {[...chosen, ...available].map(({ value, label }) => (
          <ChoiceCheckbox
            key={value}
            name={t(label)}
            checked={priorities.includes(value)}
            onChange={() =>
              onChange({
                priority: priorities.includes(value)
                  ? priorities.filter((entry) => entry !== value)
                  : [...priorities, value],
              })
            }
          >
            {t(label)}
          </ChoiceCheckbox>
        ))}
      </div>
      {chosen.length + available.length === 0 ? (
        <p role="status" className="px-2 text-xs text-muted-foreground">
          {t("admin.filters.noOptions")}
        </p>
      ) : null}
    </>
  );
}

function MultiLookupPicker({
  facet,
  draft,
  onChange,
}: {
  facet: Extract<LookupFacet, { kind: "multi" }>;
  draft: AdminListFilters;
  onChange: (patch: Partial<AdminListFilters>) => void;
}) {
  const t = useAdminT();
  const { key, type } = facet;
  const { query, setQuery, lookup, options, exactId, offeredId } =
    usePickerLookup(facet, draft.boardId);
  const selected = selectedFilterValues(draft, key);
  const missing = selected.filter(
    (id) => !options.some((option) => option.id === id),
  );
  const pinned = useFilterOptions(
    missing.length > 0 ? { type, ids: [...missing] } : null,
  );
  const labelMode = key === "labelId" && selected.length > 1;
  const max = adminFilterValueLimit(key, "cards");
  const ids = [
    ...new Set([
      ...selected,
      ...options.map(({ id }) => id),
      ...(offeredId ? [offeredId] : []),
    ]),
  ];

  const toggle = (id: string) => {
    const ids = selected.includes(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id];
    onChange(
      key === "assigneeId"
        ? { assigneeId: ids }
        : {
            labelId: ids,
            labelMatch: ids.length > 1 ? draft.labelMatch : undefined,
          },
    );
  };

  return (
    <>
      <PickerSearch facet={t(facet.label)} query={query} onChange={setQuery} />
      <p className="px-2 py-1 text-xs text-muted-foreground">
        {t("admin.filters.selected", {
          count:
            selected.length +
            Number(key === "assigneeId" && draft.unassigned === true),
        })}
      </p>
      {labelMode ? (
        <FilterRadioGroup
          segmented
          label={t("admin.filters.labelMatch.control")}
          options={[
            t("admin.filters.labelMatch.any"),
            t("admin.filters.labelMatch.all"),
          ]}
          selected={draft.labelMatch === "all" ? 1 : 0}
          onSelect={(index) =>
            onChange({ labelMatch: index === 1 ? "all" : undefined })
          }
        />
      ) : null}
      <div role="group" aria-label={t(facet.label)}>
        {ids.map((id) => {
          const option =
            options.find((item) => item.id === id) ??
            pinned.data?.items.find((item) => item.id === id);
          const checked = selected.includes(id);
          const fallbackLabel = pinned.loading
            ? t("admin.filters.loading")
            : t(`admin.filters.unknown.${key}`);
          const fallback =
            checked && (pinned.loading || id !== exactId)
              ? `${fallbackLabel} · ${optionIds(id)}`
              : t("admin.filters.useId", { id });
          return (
            <ChoiceCheckbox
              key={id}
              name={option ? optionName(option, t) : fallback}
              checked={checked}
              disabled={selected.length >= max && !checked}
              onChange={() => toggle(id)}
            >
              {option ? (
                <OptionContent option={option} />
              ) : (
                <span className="break-all" title={id}>
                  {fallback}
                </span>
              )}
            </ChoiceCheckbox>
          );
        })}
        {key === "assigneeId" ? (
          <ChoiceCheckbox
            name={t("admin.filters.unassigned.control")}
            checked={draft.unassigned === true}
            onChange={() =>
              onChange({ unassigned: draft.unassigned ? undefined : true })
            }
          >
            {t("admin.filters.unassigned")}
          </ChoiceCheckbox>
        ) : null}
      </div>
      {selected.length >= max ? (
        <p role="status" className="px-2 text-xs text-muted-foreground">
          {t("admin.filters.maxValues", { count: max })}
        </p>
      ) : null}
      <LookupStatus
        lookup={lookup}
        facet={facet}
        boardId={draft.boardId}
        hasPinnedRows={
          selected.length > 0 ||
          (key === "assigneeId" && draft.unassigned === true)
        }
      />
    </>
  );
}

function PickerSearch({
  facet,
  query,
  onChange,
}: {
  facet: string;
  query: string;
  onChange: (query: string) => void;
}) {
  const t = useAdminT();
  return (
    <input
      autoFocus
      type="search"
      aria-label={t("admin.filters.search", { facet })}
      maxLength={ADMIN_FILTER_QUERY_MAX_LENGTH}
      placeholder={t("admin.common.search")}
      value={query}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
    />
  );
}
