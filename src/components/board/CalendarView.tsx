import {
  addDays,
  addMonths,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTime, useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import { LABEL_COLOR_DOT, type Card, type Label } from "@/types/kanban";
import { dueStatus } from "@/utils/due-date";

interface CalendarViewProps {
  /** Per-column card ids with a filter applied — overrides the stored
   *  order while the filter is active. */
  filteredCardIds?: Record<string, string[]>;
  /** Fired on a card chip click — opens the card detail dialog. */
  onCardClick: (cardId: string) => void;
}

/** One calendar entry: a card with a due date plus resolved context. */
interface DayEntry {
  card: Card;
  columnTitle: string;
  labels: Label[];
}

/** Max chips per day cell before collapsing into a "+N" counter. */
const MAX_CHIPS_PER_CELL = 4;

/** Local-time day key — the calendar groups by the user's own calendar day. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Calendar view — cards projected onto a month grid by their due dates.
 * A read-only projection (TASK-14): chips open the card dialog, the grid
 * itself is a plain date-fns month layout (react-day-picker's widget is
 * built for picking one date, not for grids of interactive card chips).
 * The active filter applies exactly as on the board.
 */
export function CalendarView({ filteredCardIds, onCardClick }: CalendarViewProps) {
  const { board } = useBoard();
  const { t, tp, lang } = useI18n();
  const locale = lang.startsWith("ru") ? ruLocale : undefined;
  const weekStartsOn = lang.startsWith("ru") ? 1 : 0;

  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  // Cards with a due date, keyed by their local calendar day.
  const entriesByDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    if (!board) return map;
    for (const column of board.columns) {
      const ids = filteredCardIds?.[column.id] ?? column.cardIds;
      for (const id of ids) {
        const card = board.cards[id];
        if (!card || typeof card.dueDate !== "number") continue;
        const due = new Date(card.dueDate);
        const key = dayKey(due);
        const labels = card.labelIds
          .map((labelId) => board.labels.find((l) => l.id === labelId))
          .filter((l): l is Label => Boolean(l));
        const entry: DayEntry = {
          card,
          columnTitle: column.title,
          labels,
        };
        const list = map.get(key);
        if (list) {
          list.push(entry);
          list.sort((a, b) => (a.card.dueDate ?? 0) - (b.card.dueDate ?? 0));
        } else {
          map.set(key, [entry]);
        }
      }
    }
    return map;
  }, [board, filteredCardIds]);

  const noDueCount = useMemo(() => {
    if (!board) return 0;
    let total = 0;
    for (const column of board.columns) {
      const ids = filteredCardIds?.[column.id] ?? column.cardIds;
      for (const id of ids) {
        const card = board.cards[id];
        if (card && typeof card.dueDate !== "number") total += 1;
      }
    }
    return total;
  }, [board, filteredCardIds]);

  if (!board) return null;

  // Six week rows always fit the largest month (and keep the grid height
  // stable while navigating).
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    addDays(gridStart, i),
  );

  const monthLabel = format(month, "LLLL yyyy", { locale });
  const capitalizedLabel =
    monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
      <header className="flex items-center gap-1 border-b border-border/60 px-3 py-2">
        <h3 className="mr-auto text-sm font-semibold text-foreground">
          {capitalizedLabel}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t("view.calendar.prev")}
          onClick={() => setMonth((m) => addMonths(m, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setMonth(startOfMonth(new Date()))}
        >
          {t("view.calendar.today")}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t("view.calendar.next")}
          onClick={() => setMonth((m) => addMonths(m, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </header>

      <div className="overflow-y-auto">
        <div className="grid grid-cols-7 border-b border-border/60">
          {weekdays.map((day) => (
            <div
              key={day.getTime()}
              className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {format(day, "EEEEEE", { locale })}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const entries = entriesByDay.get(dayKey(day)) ?? [];
            const visible = entries.slice(0, MAX_CHIPS_PER_CELL);
            const overflow = entries.length - visible.length;
            return (
              <div
                key={day.getTime()}
                className={cn(
                  "min-h-24 border-b border-r border-border/40 p-1.5 [&:nth-child(7n)]:border-r-0",
                  !isSameMonth(day, month) && "bg-muted/30",
                )}
              >
                <span
                  className={cn(
                    "mb-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums",
                    isToday(day) && "bg-primary font-semibold text-primary-foreground",
                    !isToday(day) && !isSameMonth(day, month) && "text-muted-foreground/60",
                  )}
                >
                  {format(day, "d")}
                </span>
                <div className="flex flex-col gap-1">
                  {visible.map(({ card, columnTitle, labels }) => {
                    const status = dueStatus(card.dueDate as number);
                    return (
                      <button
                        key={card.id}
                        type="button"
                        title={`${formatTime(
                          `${String(new Date(card.dueDate as number).getHours()).padStart(2, "0")}:${String(new Date(card.dueDate as number).getMinutes()).padStart(2, "0")}`,
                          lang,
                        )} · ${columnTitle} · ${card.title}`}
                        onClick={() => onCardClick(card.id)}
                        className={cn(
                          "flex items-center gap-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight transition-colors hover:border-primary/50",
                          status === "overdue" && "border-danger/40 bg-danger/10 text-danger",
                          status === "soon" && "border-warning/40 bg-warning/10 text-warning",
                          status === "later" && "border-border/60 bg-muted/40 text-foreground/80",
                        )}
                      >
                        {labels.length > 0 ? (
                          <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
                            {labels.slice(0, 3).map((label) => (
                              <span
                                key={label.id}
                                className={cn("h-1.5 w-1.5 rounded-full", LABEL_COLOR_DOT[label.color])}
                              />
                            ))}
                          </span>
                        ) : null}
                        <span className="truncate">{card.title}</span>
                      </button>
                    );
                  })}
                  {overflow > 0 ? (
                    <span className="px-1 text-[10px] text-muted-foreground">
                      {tp("view.calendar.moreCards", overflow)}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {noDueCount > 0 ? (
        <footer className="border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
          {tp("view.calendar.noDueCards", noDueCount)}
        </footer>
      ) : null}
    </div>
  );
}
