import { format, isSameMonth, type Locale } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/**
 * Calendar view helpers (TASK-14.1) — the pure date math and the period
 * picker, split out of `CalendarView` so the view file keeps only the grid
 * rendering (TASK-118).
 */

/** Calendar scale: a month grid or a single week row (TASK-14.1). */
export type CalendarScale = "month" | "week";

const SCALE_STORAGE_KEY = "janosik-calendar-scale";

export function readStoredScale(): CalendarScale {
  try {
    const stored = localStorage.getItem(SCALE_STORAGE_KEY);
    if (stored === "week") return "week";
  } catch {
    /* storage unavailable — the default scale applies */
  }
  return "month";
}

export function writeStoredScale(scale: CalendarScale): void {
  try {
    localStorage.setItem(SCALE_STORAGE_KEY, scale);
  } catch {
    /* storage unavailable — the choice only lasts the session */
  }
}

/** Max chips per month cell before collapsing into a "+N" counter. */
export const MAX_CHIPS_PER_CELL = 3;

/** Local-time day key — the calendar groups by the user's own calendar day. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Timestamp for a day drop: the target day at local noon, keeping the
 * dragged chip's original time-of-day (drag reschedules the DAY, not
 * the time — TASK-14.1).
 */
export function dayTimestamp(target: Date, source?: Date): number {
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
    source?.getHours() ?? 12,
    source?.getMinutes() ?? 0,
  ).getTime();
}

interface MonthYearMenuProps {
  /** Current anchor of the grid — the selected month reads from it. */
  anchor: Date;
  /** Formatted period label (also the trigger's visible text). */
  label: string;
  /** date-fns locale for the month names. */
  locale: Locale | undefined;
  /** Fired with the 1st of the picked month/year. */
  onPick: (date: Date) => void;
}

/**
 * Interactive period label: the "September 2026" caption opens a compact
 * month/year picker — a year row with arrows and a 3×4 month grid, in the
 * same visual language as the filter's date calendar. Picking a month
 * navigates the grid immediately and closes the popover.
 */
export function MonthYearMenu({
  anchor,
  label,
  locale,
  onPick,
}: MonthYearMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(anchor.getFullYear());
  // The year row follows the anchor when it moves via «Today» or the
  // arrows; it stays user-controlled while the popover is open.
  useEffect(() => {
    setYear(anchor.getFullYear());
  }, [anchor]);

  const months = useMemo(
    () => Array.from({ length: 12 }, (_, m) => new Date(year, m, 1)),
    [year],
  );

  const monthName = (date: Date) => {
    const name = format(date, "LLL", { locale });
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("view.calendar.monthYearAria")}
          aria-haspopup="dialog"
          data-testid="month-year-trigger"
          className="-mx-1.5 rounded-md px-1.5 py-0.5 text-sm font-semibold text-foreground transition-colors hover:bg-hover"
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-60 p-0"
        data-testid="month-year-picker"
      >
        <div className="flex items-center justify-between px-2 pt-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t("view.calendar.prevYear")}
            onClick={() => setYear((y) => y - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {year}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t("view.calendar.nextYear")}
            onClick={() => setYear((y) => y + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1 p-2">
          {months.map((month) => {
            const selected = isSameMonth(anchor, month);
            return (
              <button
                key={month.getMonth()}
                type="button"
                aria-pressed={selected}
                data-testid="month-option"
                onClick={() => {
                  onPick(month);
                  setOpen(false);
                }}
                className={cn(
                  "h-8 rounded-md text-xs font-medium transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
              >
                {monthName(month)}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
