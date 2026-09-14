import { useState } from "react";
import { CalendarClock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar-lazy";
import {
  TimePickerPanel,
  TimePickerTrigger,
} from "@/components/board/TimePicker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateOnly, formatTime, useHour12, useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";

/** Time-of-day applied when a date is picked without a time set yet. */
const DEFAULT_TIME = "12:00";

function dueParts(due: number): { date: Date; time: string } {
  const d = new Date(due);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function composeTimestamp(date: Date, time: string): number {
  const [hh, mm] = time.split(":").map((v) => Number.parseInt(v, 10));
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hh || 0,
    mm || 0,
  ).getTime();
}

interface DueDatePickerContentProps {
  cardId: string;
  /** Current due date as a Unix timestamp (ms), or absent when unset. */
  dueDate?: number;
  /** Optional callback fired right after the user clears the due date. */
  onRemoved?: () => void;
}

/**
 * The due-date editor body: a calendar, a time field and a remove action.
 * Picking a day or changing the time applies immediately (like the label
 * picker); "remove" clears the field. Shared between the card dialog row
 * (inside CardDueDate) and the table view's inline due editor.
 */
export function DueDatePickerContent({
  cardId,
  dueDate,
  onRemoved,
}: DueDatePickerContentProps) {
  const { setCardDueDate } = useBoard();
  const { t, lang } = useI18n();
  const [timeOpen, setTimeOpen] = useState(false);
  const [time, setTime] = useState(() =>
    typeof dueDate === "number" ? dueParts(dueDate).time : DEFAULT_TIME,
  );
  const due = typeof dueDate === "number" ? dueParts(dueDate) : undefined;

  const applyDate = (date: Date | undefined) => {
    if (!date) return;
    setCardDueDate(cardId, composeTimestamp(date, time));
  };

  const applyTime = (value: string) => {
    setTime(value);
    if (due && value) setCardDueDate(cardId, composeTimestamp(due.date, value));
  };

  const remove = () => {
    setCardDueDate(cardId, undefined);
    onRemoved?.();
  };

  return (
    <>
      {/* The time wheel panel opens to the LEFT of the calendar inside
          the same popover (no nested overlay): bottom edges aligned,
          same card look, zero layout shift. */}
      {timeOpen && (
        <div
          data-testid="due-time-panel"
          className="absolute -bottom-px right-full mr-2 rounded-md border border-border bg-popover p-2 shadow-md animate-in fade-in slide-in-from-right-1"
        >
          <TimePickerPanel
            value={time}
            onChange={applyTime}
            onConfirm={() => setTimeOpen(false)}
          />
        </div>
      )}
      <Calendar
        mode="single"
        localeTag={lang}
        selected={due?.date}
        onSelect={applyDate}
      />
      <div className="mt-1 flex items-center gap-2 border-t border-border/60 pt-2">
        <TimePickerTrigger
          value={time}
          active={timeOpen}
          onToggle={() => setTimeOpen((o) => !o)}
        />
        {due ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={remove}
            data-testid="due-date-remove"
          >
            <X className="h-3.5 w-3.5" />
            {t("dueDate.remove")}
          </Button>
        ) : null}
      </div>
    </>
  );
}

interface CardDueDateProps {
  cardId: string;
  /** Current due date as a Unix timestamp (ms), or absent when unset. */
  dueDate?: number;
}

/**
 * Due-date row in the card dialog: a trigger button with the current
 * deadline (or a "set" placeholder) opening a popover with the shared
 * DueDatePickerContent.
 */
export function CardDueDate({ cardId, dueDate }: CardDueDateProps) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const [open, setOpen] = useState(false);
  const due = typeof dueDate === "number" ? dueParts(dueDate) : undefined;

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {t("dueDate.label")}
      </span>
      <Popover open={open} onOpenChange={(next) => setOpen(next)}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" data-testid="due-date-trigger">
            <CalendarClock className="h-3.5 w-3.5" />
            {due
              ? `${formatDateOnly(dueDate as number, lang)}, ${formatTime(due.time, lang, hour12)}`
              : t("dueDate.set")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="relative w-auto p-3">
          <DueDatePickerContent
            cardId={cardId}
            dueDate={dueDate}
            onRemoved={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
