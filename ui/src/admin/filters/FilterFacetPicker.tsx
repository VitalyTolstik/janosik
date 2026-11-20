import { useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check } from "lucide-react";
import {
  ADMIN_FILTER_OPTION_LIMITS,
  ADMIN_FILTER_QUERY_MAX_LENGTH,
  parseAdminFilterId,
  parseAdminFilterValue,
  adminFilterValueLimit,
  type AdminFilterOptionDto,
} from "@janosik/shared";
import { Button } from "@/components/ui/button";
import type { AdminListFilters } from "../admin-list-query";
import { useAdminT, type AdminMessageKey, type AdminT } from "../admin-i18n";
import { FilterColorDot } from "./FilterChip";
import {
  optionIds,
  optionState,
  isCodeLookup,
  PRIORITY_CHOICES,
  KIND_CHOICES,
  LINK_TYPE_CHOICES,
  type FilterChoice,
  type FilterFacet,
  selectedFilterValues,
  type DraftFacet,
  type LookupFacet,
} from "./filter-registry";
import { FilterRadioGroup } from "./FilterRadioGroup";
import { useFilterOptions } from "./use-filter-options";

export function FilterIdPicker({
  facet,
  value,
  onSelect,
}: {
  facet: Extract<FilterFacet, { kind: "id" }>;
  value: string;
  onSelect: (id: string) => void;
}) {
  const t = useAdminT();
  const [input, setInput] = useState(value);
  const id = parseAdminFilterValue(facet.key, input);
  return (
    <form
      noValidate
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (typeof id === "string") onSelect(id);
      }}
    >
      <label className="block text-xs text-muted-foreground">
        {t(facet.label)}
        <input
          autoFocus
          className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
          value={input}
          maxLength={facet.key === "targetId" ? 100 : 64}
          onChange={(event) => setInput(event.target.value)}
        />
      </label>
      <Button type="submit" size="sm" className="h-11 sm:h-8" disabled={!id}>
        {t("admin.filters.apply")}
      </Button>
    </form>
  );
}

export function FilterFacetPicker({
  facet,
  boardId,
  columnHint,
  value,
  onSelect,
}: {
  facet: Extract<LookupFacet, { kind: "lookup" }>;
  boardId: string | null;
  columnHint?: AdminMessageKey;
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
      <LookupStatus
        lookup={lookup}
        facet={facet}
        boardId={boardId}
        columnHint={columnHint}
      />
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
      facet.type === "column" || facet.type === "card" || facet.type === "label"
        ? (boardId ?? undefined)
        : undefined,
  });
  const options = lookup.data?.items ?? [];
  const exactId =
    facet.type === "auditActor" || isCodeLookup(facet)
      ? undefined
      : parseAdminFilterId(query);
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
  columnHint = "admin.filters.narrowColumn",
  hasPinnedRows = false,
}: {
  lookup: ReturnType<typeof useFilterOptions>;
  facet: LookupFacet;
  boardId: string | null;
  columnHint?: AdminMessageKey;
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
          ? columnHint
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
  if ("type" in facet) {
    return (
      <MultiLookupPicker facet={facet} draft={draft} onChange={onChange} />
    );
  }
  if (facet.key === "type") {
    return (
      <EnumPicker
        label={facet.label}
        choices={LINK_TYPE_CHOICES}
        selected={draft.type ?? []}
        onChange={(type) => onChange({ type })}
      />
    );
  }
  return facet.key === "priority" ? (
    <EnumPicker
      label={facet.label}
      choices={PRIORITY_CHOICES}
      selected={draft.priority ?? []}
      help="admin.filters.priority.help"
      onChange={(priority) => onChange({ priority })}
    />
  ) : (
    <EnumPicker
      label={facet.label}
      choices={KIND_CHOICES}
      selected={draft.kind ?? []}
      onChange={(kind) => onChange({ kind })}
    />
  );
}

function EnumPicker<Value extends string>({
  label: facetLabel,
  choices,
  selected,
  help,
  onChange,
}: {
  label: AdminMessageKey;
  choices: readonly FilterChoice<Value>[];
  selected: Value[];
  help?: AdminMessageKey;
  onChange: (values: Value[]) => void;
}) {
  const t = useAdminT();
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const chosen = choices.filter(({ value }) => selected.includes(value));
  const available = choices.filter(
    ({ value, label }) =>
      !selected.includes(value) &&
      (value.includes(search) || t(label).toLocaleLowerCase().includes(search)),
  );
  return (
    <>
      <PickerSearch facet={t(facetLabel)} query={query} onChange={setQuery} />
      {help ? (
        <p className="px-2 pb-1 text-xs text-muted-foreground">{t(help)}</p>
      ) : null}
      <p className="px-2 py-1 text-xs text-muted-foreground">
        {t("admin.filters.selected", { count: selected.length })}
      </p>
      <div role="group" aria-label={t(facetLabel)}>
        {[...chosen, ...available].map(({ value, label }) => (
          <ChoiceCheckbox
            key={value}
            name={t(label)}
            checked={selected.includes(value)}
            onChange={() =>
              onChange(
                selected.includes(value)
                  ? selected.filter((entry) => entry !== value)
                  : [...selected, value],
              )
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
  const code = isCodeLookup(facet);
  const { query, setQuery, lookup, options, exactId, offeredId } =
    usePickerLookup(facet, draft.boardId);
  const selected = selectedFilterValues(draft, key);
  const missing = selected.filter(
    (id) => !options.some((option) => option.id === id),
  );
  const pinned = useFilterOptions(
    !code && missing.length > 0 ? { type, ids: [...missing] } : null,
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
      key !== "labelId"
        ? { [key]: ids }
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
            : key === "type" || key === "action" || key === "targetType"
              ? id
              : t(`admin.filters.unknown.${key}`);
          const fallback = code
            ? id
            : checked && (pinned.loading || id !== exactId)
              ? `${fallbackLabel} · ${optionIds(id)}`
              : t("admin.filters.useId", { id });
          return (
            <ChoiceCheckbox
              key={id}
              name={option && !code ? optionName(option, t) : fallback}
              checked={checked}
              disabled={selected.length >= max && !checked}
              onChange={() => toggle(id)}
            >
              {option && !code ? (
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
