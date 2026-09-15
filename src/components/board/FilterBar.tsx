import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar-lazy";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  LABEL_COLOR_DOT,
  LIMITS,
  type Label,
  type LabelColor,
} from "@/types/kanban";
import { LimitCounter } from "@/components/ui/limit-counter";
import { showRemaining } from "@/utils/limit-format";
import {
  activeFacetCount,
  EMPTY_FILTER,
  isFilterActive,
  type CardFilter,
  type CreatedWindow,
  type DueFilter,
  type LabelMatch,
} from "@/utils/filter";

const CREATED_LABEL_KEY: Record<CreatedWindow, MessageKey> = {
  any: "filter.anyTime",
  today: "filter.today",
  "7d": "filter.last7Days",
  "30d": "filter.last30Days",
};

const DUE_LABEL_KEY: Record<DueFilter, MessageKey> = {
  any: "filter.dueAny",
  overdue: "filter.dueOverdue",
  soon: "filter.dueSoon",
  none: "filter.dueNone",
};

const MATCH_LABEL_KEY: Record<LabelMatch, MessageKey> = {
  any: "filter.matchAny",
  all: "filter.matchAll",
};

// Inline YYYY-MM-DD <-> Date helpers — pulling in date-fns here would put
// it (and the whole daypicker chunk) on the critical path (TASK-19).
function parseIsoDate(on: string): Date {
  const [y, m, d] = on.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatIsoDate(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** Locale-aware "15 June 2025" label for a stored YYYY-MM-DD day. */
function formatDay(on: string, lang: string): string {
  try {
    const [y, m, d] = on.split("-").map(Number);
    const day = new Date(y, m - 1, d);
    if (Number.isNaN(day.getTime())) return on;
    return day.toLocaleDateString(lang.startsWith("ru") ? "ru-RU" : "en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return on;
  }
}

interface FilterBarProps {
  filter: CardFilter;
  /** Board labels to offer in the label picker. */
  labels: Label[];
  /** Total number of matching cards across all columns (for the count). */
  matchCount: number;
  onChange: (next: CardFilter) => void;
}

/** Section title inside the filters popover. */
function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border px-3 py-2 last:border-b-0">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

interface OptionRowProps {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}

/** Radio-style row (single-choice facets: due status, creation window). */
function OptionRow({ selected, onSelect, children }: OptionRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover",
        selected ? "font-medium text-foreground" : "text-foreground/90",
      )}
    >
      <span className="flex items-center gap-2">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 text-primary" />}
    </button>
  );
}

interface CheckRowProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
}

/** Checkbox-style row (label facets: pick any combination). */
function CheckRow({ checked, onCheckedChange, children }: CheckRowProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-hover"
    >
      <span className="flex items-center gap-2">{children}</span>
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-transparent",
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
    </button>
  );
}

/**
 * Board filter toolbar (Trello/Linear-style): free-text search by card name
 * stays inline; the faceted filters (labels, due date, creation date) live
 * behind a single "Filters" popover button, with a badge showing how many
 * facets are active.
 *
 * - `/` focuses the search input (outside of text fields). Ctrl/Cmd+K is
 *   owned solely by the global search palette (GlobalSearch).
 * - Esc in the search clears the query, a second Esc blurs.
 * - While a filter is active, drag & drop is disabled (see DndBoard) — a
 *   hint explains why.
 */
export function FilterBar({
  filter,
  labels,
  matchCount,
  onChange,
}: FilterBarProps) {
  const { t, tp, lang } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dayCalendarOpen, setDayCalendarOpen] = useState(false);

  const active = isFilterActive(filter);
  const facetCount = activeFacetCount(filter);
  const query = filter.query;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const slash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;

      if (slash && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        if (query === "") {
          inputRef.current?.blur();
        } else {
          onChange({ ...filter, query: "" });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filter, onChange, query]);

  const toggleLabel = (labelId: string, checked: boolean) => {
    const next = new Set(filter.labelIds);
    if (checked) {
      next.add(labelId);
    } else {
      next.delete(labelId);
    }
    onChange({ ...filter, labelIds: [...next] });
  };

  const selectedLabels = filter.labelIds
    .map((id) => labels.find((label) => label.id === id))
    .filter((label): label is Label => label !== undefined);

  const dotClass = (color: LabelColor) => LABEL_COLOR_DOT[color];

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 p-2 backdrop-blur-sm">
      {/* Search by card name */}
      <div className="relative min-w-0 flex-1 basis-56">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          name="filter-search"
          value={query}
          maxLength={LIMITS.query}
          aria-describedby={
            showRemaining(query.length, LIMITS.query)
              ? "filter-query-limit"
              : undefined
          }
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
          placeholder={t("filter.searchPlaceholder")}
          aria-label={t("filter.searchAria")}
          className="h-9 rounded-lg pl-9 pr-8"
        />
        <LimitCounter
          id="filter-query-limit"
          length={query.length}
          limit={LIMITS.query}
          position="below"
          className="left-7"
          testId="filter-query-limit"
        />
        {query !== "" && (
          <button
            type="button"
            aria-label={t("filter.reset")}
            onClick={() => onChange({ ...filter, query: "" })}
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Faceted filters (labels, due date, creation date) */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={facetCount > 0 ? "secondary" : "outline"}
            size="sm"
            aria-label={t("filter.filtersAria")}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("filter.filters")}
            {facetCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                {facetCount}
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div role="radiogroup" aria-label={t("filter.dueAria")}>
            <FilterSection title={t("filter.due")}>
              {(["any", "overdue", "soon", "none"] as const).map((value) => (
                <OptionRow
                  key={value}
                  selected={filter.due === value}
                  onSelect={() => onChange({ ...filter, due: value })}
                >
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                  {t(DUE_LABEL_KEY[value])}
                </OptionRow>
              ))}
            </FilterSection>
          </div>
          <FilterSection title={t("filter.labels")}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t("filter.match")}
              </span>
              <div
                role="radiogroup"
                aria-label={t("filter.matchAria")}
                className="flex rounded-md border border-border p-0.5"
              >
                {(["any", "all"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={filter.labelMatch === mode}
                    onClick={() => onChange({ ...filter, labelMatch: mode })}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs transition-colors",
                      filter.labelMatch === mode
                        ? "bg-primary/15 font-medium text-primary"
                        : "text-muted-foreground hover:bg-hover",
                    )}
                  >
                    {t(MATCH_LABEL_KEY[mode])}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-44 overflow-y-auto">
              {labels.map((label) => (
                <CheckRow
                  key={label.id}
                  checked={filter.labelIds.includes(label.id)}
                  onCheckedChange={(checked) => toggleLabel(label.id, checked)}
                >
                  <span
                    className={cn(
                      "inline-block h-2.5 w-2.5 rounded-full",
                      dotClass(label.color),
                    )}
                  />
                  {label.name}
                </CheckRow>
              ))}
              <CheckRow
                checked={filter.noLabel}
                onCheckedChange={(checked) =>
                  onChange({ ...filter, noLabel: checked })
                }
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-border bg-transparent" />
                {t("filter.noLabel")}
              </CheckRow>
            </div>
          </FilterSection>
          <FilterSection title={t("filter.created")}>
            <div role="radiogroup" aria-label={t("filter.createdAria")}>
              {(["any", "today", "7d", "30d"] as const).map((value) => (
                <OptionRow
                  key={value}
                  selected={
                    filter.createdOn === null && filter.created === value
                  }
                  onSelect={() =>
                    onChange({
                      ...filter,
                      created: value,
                      // An exact day and a relative window are mutually exclusive.
                      createdOn: null,
                    })
                  }
                >
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  {t(CREATED_LABEL_KEY[value])}
                </OptionRow>
              ))}
              <OptionRow
                selected={filter.createdOn !== null}
                onSelect={() => setDayCalendarOpen((open) => !open)}
              >
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                {filter.createdOn
                  ? formatDay(filter.createdOn, lang)
                  : t("filter.onDate")}
              </OptionRow>
            </div>
            {dayCalendarOpen && (
              <div className="mt-2 border-t border-border pt-2">
                <Calendar
                  aria-label={t("filter.dateTitle")}
                  mode="single"
                  selected={
                    filter.createdOn
                      ? parseIsoDate(filter.createdOn)
                      : undefined
                  }
                  onSelect={(day) => {
                    onChange({
                      ...filter,
                      // Picking a day retires the relative window for good:
                      // leaving it dormant made it resurrect when the day
                      // chip was removed.
                      created: "any",
                      createdOn: day ? formatIsoDate(day) : null,
                    });
                    if (day) setDayCalendarOpen(false);
                  }}
                  autoFocus
                />
              </div>
            )}
          </FilterSection>
        </PopoverContent>
      </Popover>

      {/* Result count + reset */}
      {active && (
        <div className="ml-auto flex items-center gap-2">
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {tp("filter.found", matchCount)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(EMPTY_FILTER);
              setDayCalendarOpen(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
            {t("filter.reset")}
          </Button>
        </div>
      )}

      {/* Selected labels, due status, and creation date as removable chips.
          The relative window (`today`/`7d`/`30d`) gets its own chip — it is
          as much of a live filter as the exact day, hiding it made the only
          way to switch it off the filters popover. */}
      {(selectedLabels.length > 0 ||
        filter.noLabel ||
        filter.created !== "any" ||
        filter.createdOn ||
        filter.due !== "any") && (
        <div className="flex w-full flex-wrap items-center gap-1.5">
          {filter.due !== "any" && (
            <span className="flex items-center gap-1.5 rounded-full bg-hover py-1 pl-2 pr-1 text-xs text-foreground">
              <CalendarClock className="h-3 w-3 text-muted-foreground" />
              {t(DUE_LABEL_KEY[filter.due])}
              <button
                type="button"
                aria-label={t("label.pickerRemove")}
                onClick={() => onChange({ ...filter, due: "any" })}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {selectedLabels.map((label) => (
            <span
              key={label.id}
              className="flex items-center gap-1.5 rounded-full bg-hover py-1 pl-2 pr-1 text-xs text-foreground"
            >
              <span
                className={cn("h-2 w-2 rounded-full", dotClass(label.color))}
              />
              {label.name}
              <button
                type="button"
                aria-label={t("label.pickerRemove")}
                onClick={() => toggleLabel(label.id, false)}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {filter.noLabel && (
            <span className="flex items-center gap-1.5 rounded-full border border-dashed border-border py-1 pl-2 pr-1 text-xs text-muted-foreground">
              {t("filter.noLabel")}
              <button
                type="button"
                aria-label={t("label.pickerRemove")}
                onClick={() => onChange({ ...filter, noLabel: false })}
                className="rounded-full p-0.5 transition-colors hover:bg-hover hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {filter.created !== "any" && filter.createdOn === null && (
            // An exact day overrides the window — only one chip at a time.
            <span className="flex items-center gap-1.5 rounded-full bg-hover py-1 pl-2 pr-1 text-xs text-foreground">
              <CalendarDays className="h-3 w-3 text-muted-foreground" />
              {t(CREATED_LABEL_KEY[filter.created])}
              <button
                type="button"
                aria-label={t("label.pickerRemove")}
                onClick={() => onChange({ ...filter, created: "any" })}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {filter.createdOn && (
            <span className="flex items-center gap-1.5 rounded-full bg-hover py-1 pl-2 pr-1 text-xs text-foreground">
              <CalendarDays className="h-3 w-3 text-muted-foreground" />
              {formatDay(filter.createdOn, lang)}
              <button
                type="button"
                aria-label={t("label.pickerRemove")}
                onClick={() => onChange({ ...filter, createdOn: null })}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Drag & drop hint */}
      {active && (
        <div className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
          {t("filter.dragDisabled")}
        </div>
      )}
    </div>
  );
}
