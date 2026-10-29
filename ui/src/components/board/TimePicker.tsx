import { useEffect, useRef, type KeyboardEvent } from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatTime, useHour12, useI18n } from "@/i18n";
import { composeTime, pad2 } from "@/utils/time";

/** Visible rows in each column (drives the column height). */
const ROWS_VISIBLE = 7;
const ROW_H_PX = 32;

const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/**
 * The hour labels shown in the picker's hour column. 24h locales read
 * 0–23; 12-hour locales read 12 AM, 1 AM … 11 PM (the internal value
 * stays 0–23 — 12h is a rendering concern only). The AM/PM suffix is
 * kept separate so it renders as a small inline tag instead of a
 * full-size second word.
 */
function hourOptions(
  hour12: boolean,
): { value: number; label: string; suffix?: string }[] {
  if (!hour12) {
    return HOURS_24.map((h) => ({ value: h, label: pad2(h) }));
  }
  return HOURS_24.map((h) => {
    const suffix = h < 12 ? "AM" : "PM";
    const display = h % 12 === 0 ? 12 : h % 12;
    return { value: h, label: String(display), suffix };
  });
}

function Column({
  options,
  selected,
  onSelect,
  label,
}: {
  options: { value: number; label: string; suffix?: string }[];
  selected: number;
  onSelect: (value: number) => void;
  label: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Center the selected value when the panel opens.
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

  // The modal card dialog locks page scroll (Radix RemoveScroll), which
  // preventDefaults wheel events over this portaled popover — at document
  // level, on the bubble phase, i.e. AFTER any listener on the list itself
  // has run, and the native scroll never fires. So listen on the document
  // bubble phase too: when the default was suppressed for a wheel event
  // over this column, scroll it manually (outside a modal nothing is
  // prevented and the browser scrolls natively).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented && list.contains(e.target as Node)) {
        list.scrollTop += e.deltaY;
      }
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  // Arrow/Home/End navigation (TASK-152, C17): the listbox is one tab stop
  // (roving tabindex on the selected option), arrows move the selection.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let index = options.findIndex((option) => option.value === selected);
    if (event.key === "ArrowDown") index += 1;
    else if (event.key === "ArrowUp") index -= 1;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = options.length - 1;
    else return;
    event.preventDefault();
    const next = options[(index + options.length) % options.length];
    if (!next) return;
    onSelect(next.value);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)
      ?.focus();
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="snap-y overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-1"
      style={{ height: ROWS_VISIBLE * ROW_H_PX }}
    >
      {options.map(({ value, label: optionLabel, suffix }) => (
        <button
          key={value}
          type="button"
          role="option"
          aria-selected={value === selected}
          // Roving tabindex: only the selected option is Tab-reachable.
          tabIndex={value === selected ? 0 : -1}
          data-value={value}
          onClick={() => onSelect(value)}
          className={cn(
            "flex h-8 w-full snap-center items-center justify-center gap-1 rounded-sm px-2 text-sm tabular-nums whitespace-nowrap transition-colors",
            value === selected
              ? "bg-primary font-semibold text-primary-foreground"
              : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {optionLabel}
          {suffix && (
            <span
              className={cn(
                "text-[10px] font-medium tracking-wide",
                value === selected
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground",
              )}
            >
              {suffix}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

interface TimePickerTriggerProps {
  /** Current value as "HH:mm" (24h, internal representation). */
  value: string;
  /** Whether the time panel is currently shown (highlights the trigger). */
  active?: boolean;
  onToggle: () => void;
}

/**
 * The clock button showing the current time; toggles the wheel panel
 * rendered by the owner (next to the calendar, not as a nested popover).
 */
export function TimePickerTrigger({
  value,
  active,
  onToggle,
}: TimePickerTriggerProps) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  return (
    <button
      type="button"
      data-testid="due-date-time"
      aria-label={t("dueDate.timeLabel")}
      aria-expanded={active}
      onClick={onToggle}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-md border border-border/70 bg-muted/50 px-2.5 text-sm tabular-nums transition-colors hover:border-primary/40 hover:text-primary",
        active && "border-primary/40 text-primary",
      )}
    >
      <Clock className="h-3.5 w-3.5 opacity-70" aria-hidden />
      {formatTime(value, lang, hour12)}
    </button>
  );
}

interface TimePickerPanelProps {
  /** Current value as "HH:mm" (24h, internal representation). */
  value: string;
  onChange: (value: string) => void;
  /** Called after a minute is picked — the confirming action. */
  onConfirm?: () => void;
}

/**
 * Premium time picker panel: two scrollable hour/minute columns. The hour
 * column follows the locale convention (24h for ru, 12h with AM/PM for en)
 * while the internal value stays "HH:mm" 24h. Picking an hour applies at
 * once; picking a minute applies and confirms. All colors on design tokens.
 */
export function TimePickerPanel({
  value,
  onChange,
  onConfirm,
}: TimePickerPanelProps) {
  const { t } = useI18n();
  const hour12 = useHour12();
  const hour = Number.parseInt(value.split(":")[0], 10) || 0;
  const minute = Number.parseInt(value.split(":")[1], 10) || 0;

  return (
    <div className="flex gap-2">
      <Column
        options={hourOptions(hour12)}
        selected={hour}
        onSelect={(h) => onChange(composeTime(h, minute))}
        label={t("dueDate.hoursLabel")}
      />
      <Column
        options={MINUTES.map((m) => ({ value: m, label: pad2(m) }))}
        selected={minute}
        onSelect={(m) => {
          onChange(composeTime(hour, m));
          onConfirm?.();
        }}
        label={t("dueDate.minutesLabel")}
      />
    </div>
  );
}
