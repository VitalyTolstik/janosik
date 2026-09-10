import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatTime, is12HourLocale, useI18n } from "@/i18n";

interface TimePickerProps {
  /** Current value as "HH:mm" (24h, internal representation). */
  value: string;
  onChange: (value: string) => void;
}

/** Visible rows in each column (drives the column height). */
const ROWS_VISIBLE = 7;
const ROW_H_PX = 32;

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/**
 * The hour labels shown in the picker's hour column. 24h locales read
 * 0–23; 12-hour locales read 12 AM, 1 AM … 11 PM (the internal value
 * stays 0–23 — 12h is a rendering concern only).
 */
function hourOptions(hour12: boolean): { value: number; label: string }[] {
  if (!hour12) {
    return HOURS_24.map((h) => ({ value: h, label: pad(h) }));
  }
  return HOURS_24.map((h) => {
    const suffix = h < 12 ? "AM" : "PM";
    const display = h % 12 === 0 ? 12 : h % 12;
    return { value: h, label: `${display} ${suffix}` };
  });
}

function Column({
  options,
  selected,
  onSelect,
  label,
}: {
  options: { value: number; label: string }[];
  selected: number;
  onSelect: (value: number) => void;
  label: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Center the selected value when the popover opens.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const target = list.querySelector<HTMLElement>(
      `[data-value="${selected}"]`,
    );
    if (target) {
      list.scrollTop = target.offsetTop - list.clientHeight / 2 + ROW_H_PX / 2;
    }
  }, [selected]);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={label}
      className="snap-y overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-1"
      style={{ height: ROWS_VISIBLE * ROW_H_PX }}
    >
      {options.map(({ value, label: optionLabel }) => (
        <button
          key={value}
          type="button"
          role="option"
          aria-selected={value === selected}
          data-value={value}
          onClick={() => onSelect(value)}
          className={cn(
            "flex h-8 w-full snap-center items-center justify-center rounded-sm px-2 text-sm tabular-nums transition-colors",
            value === selected
              ? "bg-primary font-semibold text-primary-foreground"
              : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

/**
 * Premium time picker: a trigger button (clock icon + current value)
 * opening a two-column hour/minute list. The hour column follows the
 * locale convention (24h for ru, 12h with AM/PM for en) while the
 * internal value stays "HH:mm" 24h. Picking an hour applies at once;
 * picking a minute confirms and closes. All colors on design tokens.
 */
export function TimePicker({ value, onChange }: TimePickerProps) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const hour12 = is12HourLocale(lang);
  const { hour, minute } = {
    hour: Number.parseInt(value.split(":")[0], 10) || 0,
    minute: Number.parseInt(value.split(":")[1], 10) || 0,
  };

  const compose = (h: number, m: number) =>
    `${pad(h)}:${pad(m)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="due-date-time"
          aria-label={t("dueDate.timeLabel")}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-border/70 bg-muted/50 px-2.5 text-sm tabular-nums text-foreground/90 transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Clock className="h-3.5 w-3.5 opacity-70" aria-hidden />
          {formatTime(value, lang)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" sideOffset={6}>
        <div className="flex gap-2">
          <Column
            options={hourOptions(hour12)}
            selected={hour}
            onSelect={(h) => onChange(compose(h, minute))}
            label={t("dueDate.hoursLabel")}
          />
          <Column
            options={MINUTES.map((m) => ({ value: m, label: pad(m) }))}
            selected={minute}
            onSelect={(m) => {
              onChange(compose(hour, m));
              setOpen(false);
            }}
            label={t("dueDate.minutesLabel")}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
