import { useEffect, useState } from "react";
import { CalendarClock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar-lazy";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TimePickerPanel } from "@/components/board/TimePicker";
import { formatDateOnly, formatTime, useHour12, useI18n } from "@/i18n";
import { composeTimestamp, formatTimeOfDay } from "@/utils/time";

/** Epoch ms → `datetime-local` value (`YYYY-MM-DDTHH:MM`), "" when null. */
function toLocalInput(timestamp: number | null): string {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseValue(value: string): Date | null {
  if (value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

interface DateTimeFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testId: string;
  placeholder: string;
  clearLabel: string;
  timeLabel: string;
}

/**
 * Admin date-time picker for announcement scheduling: the app calendar and the
 * shared time-wheel panel instead of the browser's native `datetime-local`
 * control. The native control follows the OS language (a Russian placeholder
 * in an English UI) and its popup is an OS widget that ignores the app theme.
 * The displayed value is formatted with the UI locale.
 */
export function DateTimeField({
  value,
  onChange,
  disabled = false,
  testId,
  placeholder,
  clearLabel,
  timeLabel,
}: DateTimeFieldProps) {
  const { lang } = useI18n();
  const hour12 = useHour12();
  const [open, setOpen] = useState(false);
  const parsed = parseValue(value);
  const [time, setTime] = useState(() =>
    parsed ? formatTimeOfDay(parsed) : "12:00",
  );

  // Opening or receiving a new value (edit/reset) syncs the time wheel.
  useEffect(() => {
    const next = parseValue(value);
    setTime(next ? formatTimeOfDay(next) : "12:00");
  }, [value]);

  const applyDate = (date: Date | undefined) => {
    if (!date) return;
    onChange(toLocalInput(composeTimestamp(date, time)));
  };

  const applyTime = (next: string) => {
    setTime(next);
    if (parsed) {
      onChange(toLocalInput(composeTimestamp(parsed, next)));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid={testId}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-2 text-left text-sm text-foreground transition-colors hover:border-ring/50 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarClock
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span
            className={parsed ? "truncate" : "truncate text-muted-foreground"}
          >
            {parsed
              ? `${formatDateOnly(parsed.getTime(), lang)}, ${formatTime(
                  formatTimeOfDay(parsed),
                  lang,
                  hour12,
                )}`
              : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="flex gap-3">
          <Calendar
            mode="single"
            localeTag={lang}
            selected={parsed ?? undefined}
            onSelect={applyDate}
          />
          <div className="flex flex-col gap-2 border-l border-border pl-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              {timeLabel}
            </p>
            <TimePickerPanel value={time} onChange={applyTime} />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-2">
          <span className="text-xs text-muted-foreground">
            {parsed
              ? `${formatDateOnly(parsed.getTime(), lang)}, ${formatTime(
                  time,
                  lang,
                  hour12,
                )}`
              : placeholder}
          </span>
          {parsed ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid={`${testId}-clear`}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {clearLabel}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
