import {
  Component,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
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
import { useMediaQuery } from "@/hooks/use-media-query";
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
  retry: () => void;
}

class DateTimePickerBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Date and time picker failed:", error, info.componentStack);
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
  const phone = useMediaQuery("(max-width: 639px)");
  const [open, setOpen] = useState(false);
  const focusAfterRetry = useRef(false);
  const focusRestoredPicker = useCallback((row: HTMLDivElement | null) => {
    if (row && focusAfterRetry.current) {
      focusAfterRetry.current = false;
      row.focus({ preventScroll: true });
    }
  }, []);
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
  const displayValue = parsed
    ? `${formatDateOnly(parsed.getTime(), lang)}, ${formatTime(
        formatTimeOfDay(parsed),
        lang,
        hour12,
      )}`
    : placeholder;

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) focusAfterRetry.current = false;
    setOpen(nextOpen);
  };

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
    <div
      ref={CalendarFallback ? focusRestoredPicker : undefined}
      tabIndex={CalendarFallback ? -1 : undefined}
      className="flex flex-col gap-3 sm:flex-row"
    >
      <CalendarForAttempt {...calendarProps} />
      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
        <p className="text-ui-meta font-medium text-muted-foreground">
          {timeLabel}
        </p>
        <TimePickerPanel value={time} onChange={applyTime} />
      </div>
    </div>
  );

  const retry = () => {
    focusAfterRetry.current = true;
    // A fresh lazy instance retries the load. Let the outer Suspense keep
    // the current fallback and its focus until this attempt can commit.
    const nextCalendar = createCalendar(calendarLoader, false);
    startTransition(() => {
      setCalendarAttempt({
        CalendarForAttempt: nextCalendar,
        attempt: attempt + 1,
      });
    });
  };

  const trigger = (
    <button
      type="button"
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel}
      title={displayValue}
      {...(phone
        ? {
            "aria-expanded": open,
            onClick: () => changeOpen(!open),
          }
        : {})}
      className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-2 text-left text-ui-body text-foreground transition-colors hover:border-ring/50 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 max-lg:h-11"
    >
      <CalendarClock
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className={parsed ? "truncate" : "truncate text-muted-foreground"}>
        {displayValue}
      </span>
    </button>
  );

  const panel = (
    <>
      {CalendarFallback ? (
        <Suspense fallback={null}>
          <DateTimePickerBoundary
            key={attempt}
            fallback={
              <CalendarFallback
                value={value}
                onChange={onChange}
                retry={retry}
              />
            }
          >
            {pickerRow}
          </DateTimePickerBoundary>
        </Suspense>
      ) : (
        pickerRow
      )}
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-2">
        <span className="text-ui-label text-muted-foreground">
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
              changeOpen(false);
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            {clearLabel}
          </Button>
        ) : null}
      </div>
    </>
  );

  // A 626 px popover cannot fit beside a mid-screen trigger on a phone, and
  // Radix may flip it above the viewport. Below sm the picker renders inline
  // under the trigger, inside the dialog's own scroll region, so the whole
  // calendar, time wheel and footer stay reachable without page scrolling.
  if (phone) {
    return (
      <div>
        {trigger}
        {open ? (
          <div
            data-testid={`${testId}-panel`}
            className="mt-2 w-full rounded-md border border-border bg-popover p-3 shadow-md"
          >
            {panel}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        // Radix flips the panel above a trigger that sits near the bottom of a
        // short dialog and exposes only the space it actually found in
        // `--radix-popper-available-height`. Capping to the viewport alone
        // (100dvh) lets the panel grow taller than that space and places its
        // top off-screen; the month header then cannot be scrolled back.
        style={{
          maxHeight:
            "min(calc(100dvh - 1rem), var(--radix-popper-available-height, calc(100dvh - 1rem)))",
        }}
        className="w-auto max-w-[calc(100vw-1rem)] overflow-y-auto p-3"
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}
