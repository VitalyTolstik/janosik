import {
  Component,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { CalendarClock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Calendar,
  createCalendar,
  type CalendarComponent,
  type CalendarProps,
} from "@/components/ui/calendar-lazy";
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
  /** Accessible name for the trigger (the visible value is not a label). */
  ariaLabel?: string;
  placeholder: string;
  clearLabel: string;
  timeLabel: string;
  calendarLoader?: () => Promise<{ Calendar: CalendarComponent }>;
  calendarFallback?: ComponentType<CalendarFallbackState>;
}

export interface CalendarFallbackState {
  value: string;
  onChange: (value: string) => void;
  time: string;
  calendarProps: CalendarProps;
  retry: () => void;
}

class DateTimeCalendarBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
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
  ariaLabel,
  placeholder,
  clearLabel,
  timeLabel,
  calendarLoader,
  calendarFallback: CalendarFallback,
}: DateTimeFieldProps) {
  const { lang } = useI18n();
  const hour12 = useHour12();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [{ CalendarForAttempt, attempt }, setCalendarAttempt] = useState(
    () => ({
      CalendarForAttempt: calendarLoader
        ? createCalendar(calendarLoader)
        : Calendar,
      attempt: 0,
    }),
  );
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

  const calendarProps = {
    mode: "single",
    localeTag: lang,
    selected: parsed ?? undefined,
    onSelect: applyDate,
  } satisfies CalendarProps;
  const pickerRow = (
    <div className="flex flex-col gap-3 sm:flex-row">
      <CalendarForAttempt {...calendarProps} />
      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
        <p className="text-[11px] font-medium text-muted-foreground">
          {timeLabel}
        </p>
        <TimePickerPanel value={time} onChange={applyTime} />
      </div>
    </div>
  );

  const retry = () => {
    trigger.current?.focus({ preventScroll: true });
    // A rejected React.lazy instance keeps its result even after remounting.
    setCalendarAttempt({
      CalendarForAttempt: createCalendar(calendarLoader),
      attempt: attempt + 1,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          disabled={disabled}
          data-testid={testId}
          aria-label={ariaLabel}
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
      <PopoverContent
        align="start"
        className="w-auto max-w-[calc(100vw-1rem)] p-3"
        onFocusOutside={
          CalendarFallback
            ? (event) => {
                // Preserve Radix's focus restoration when Retry focuses the trigger.
                if (event.target === trigger.current) event.preventDefault();
              }
            : undefined
        }
      >
        {CalendarFallback ? (
          <DateTimeCalendarBoundary
            key={attempt}
            fallback={
              <CalendarFallback
                value={value}
                onChange={onChange}
                time={time}
                calendarProps={calendarProps}
                retry={retry}
              />
            }
          >
            {pickerRow}
          </DateTimeCalendarBoundary>
        ) : (
          pickerRow
        )}
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
