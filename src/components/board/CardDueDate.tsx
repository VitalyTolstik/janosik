import { useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { ru } from "react-day-picker/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  TimePickerPanel,
  TimePickerTrigger,
} from "@/components/board/TimePicker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateOnly, formatTime, useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";

interface CardDueDateProps {
  cardId: string;
  /** Current due date as a Unix timestamp (ms), or absent when unset. */
  dueDate?: number;
}

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

/**
 * Due-date row in the card dialog: a trigger button with the current
 * deadline (or a "set" placeholder) opening a popover with a calendar,
 * a time field and a remove action. Picking a day or changing the time
 * applies immediately (like the label picker); "remove" clears the field.
 */
export function CardDueDate({ cardId, dueDate }: CardDueDateProps) {
  const { setCardDueDate } = useBoard();
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
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
    setOpen(false);
    setCardDueDate(cardId, undefined);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {t("dueDate.label")}
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTimeOpen(false);
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" data-testid="due-date-trigger">
            <CalendarClock className="h-3.5 w-3.5" />
            {due
              ? `${formatDateOnly(dueDate as number, lang)}, ${formatTime(due.time, lang)}`
              : t("dueDate.set")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="relative w-auto p-3">
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
            locale={lang.startsWith("ru") ? ru : undefined}
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
