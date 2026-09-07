import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronDown, Search, Tag, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { LABEL_COLOR_DOT, type Label, type LabelColor } from "@/types/kanban";
import {
  EMPTY_FILTER,
  isFilterActive,
  type CardFilter,
  type CreatedWindow,
} from "@/utils/filter";

const CREATED_LABEL_KEY: Record<CreatedWindow, MessageKey> = {
  any: "filter.created",
  today: "filter.today",
  "7d": "filter.last7Days",
  "30d": "filter.last30Days",
};

/** Locale-aware "15 June 2025" label for a stored YYYY-MM-DD day. */
function formatDay(on: string, lang: string): string {
  try {
    const day = parseISO(on);
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

/**
 * Board filter toolbar (Trello/Linear-style): free-text search by card name,
 * a multi-select label picker with an optional "no label" facet, a
 * creation-date window, result count, and a reset action.
 *
 * - `/` or Ctrl/Cmd+K focuses the search input (outside of text fields).
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

  const active = isFilterActive(filter);
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
      const kShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";

      if ((slash || kShortcut) && !typing) {
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
          value={query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
          placeholder={t("filter.searchPlaceholder")}
          aria-label={t("filter.searchAria")}
          className="h-9 rounded-lg pl-9 pr-8"
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

      {/* Label filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={t("filter.labelsAria")}
          >
            <Tag className="h-3.5 w-3.5" />
            {t("filter.labels")}
            {filter.labelIds.length > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                {filter.labelIds.length}
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          {labels.map((label) => (
            <DropdownMenuCheckboxItem
              key={label.id}
              checked={filter.labelIds.includes(label.id)}
              onCheckedChange={(checked) =>
                toggleLabel(label.id, checked === true)
              }
            >
              <span
                className={cn(
                  "mr-2 inline-block h-2.5 w-2.5 rounded-full",
                  dotClass(label.color),
                )}
              />
              {label.name}
            </DropdownMenuCheckboxItem>
          ))}
          {labels.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuCheckboxItem
            checked={filter.noLabel}
            onCheckedChange={(checked) =>
              onChange({ ...filter, noLabel: checked === true })
            }
          >
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full border border-dashed border-border bg-transparent" />
            {t("filter.noLabel")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              onChange({ ...filter, labelIds: [], noLabel: false })
            }
          >
            {t("label.pickerClear")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Creation-date window */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={t("filter.createdAria")}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {t(CREATED_LABEL_KEY[filter.created])}
            {filter.created !== "any" && (
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={filter.created}
            onValueChange={(value) =>
              onChange({
                ...filter,
                created: value as CreatedWindow,
                // An exact day and a relative window are mutually exclusive.
                createdOn: null,
              })
            }
          >
            <DropdownMenuRadioItem value="any">
              {t("filter.anyTime")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="today">
              {t("filter.today")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="7d">
              {t("filter.last7Days")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="30d">
              {t("filter.last30Days")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Exact creation day (calendar) */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={filter.createdOn ? "secondary" : "outline"}
            size="sm"
            aria-label={t("filter.dateAria")}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {filter.createdOn
              ? formatDay(filter.createdOn, lang)
              : t("filter.onDate")}
            {filter.createdOn && (
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            aria-label={t("filter.dateTitle")}
            mode="single"
            selected={filter.createdOn ? parseISO(filter.createdOn) : undefined}
            onSelect={(day) =>
              onChange({
                ...filter,
                createdOn: day ? format(day, "yyyy-MM-dd") : null,
              })
            }
            autoFocus
          />
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
            onClick={() => onChange(EMPTY_FILTER)}
          >
            <X className="h-3.5 w-3.5" />
            {t("filter.reset")}
          </Button>
        </div>
      )}

      {/* Selected labels + exact day as removable chips */}
      {(selectedLabels.length > 0 || filter.noLabel || filter.createdOn) && (
        <div className="flex w-full flex-wrap items-center gap-1.5">
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
