import { useVirtualizer } from "@tanstack/react-virtual";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  MAX_CHIPS_PER_CELL,
  MonthYearMenu,
  dayKey,
  dayTimestamp,
  readStoredScale,
  writeStoredScale,
  type CalendarScale,
} from "@/components/board/calendar-parts";
import { ComposerLabelPicker } from "@/components/board/ComposerLabelPicker";
import { useToast } from "@/components/Toast";
import { useCardLabels } from "@/hooks/use-card-labels";
import { cn } from "@/lib/utils";
import { formatDateOnly, formatTime, useHour12, useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import {
  LABEL_COLOR_DOT,
  type Card,
  type Label,
  LIMITS,
} from "@janosik/shared";
import { isColumnFull } from "@janosik/shared";
import {
  cardHref,
  openCardInNewTab,
  shouldLeaveToBrowser,
} from "@/utils/card-nav";
import { CardContextMenu } from "@/components/board/CardContextMenu";
import { dueStatus } from "@/utils/due-date";
import { formatTimeOfDay } from "@/utils/time";

/** Stable empty list, so the label resolver survives a board-less render. */
const NO_LABELS: Label[] = [];

/**
 * Calendar list windowing (TASK-139). The month grid is already bounded (42
 * cells, 3 chips each), but the unscheduled panel, the day panel and the week
 * cells each render every card in the bucket — up to 2400 buttons/chips. The
 * bench measured 2400 unscheduled buttons and 2400 week chips as the two
 * unbounded cases; below this threshold every item mounts (tests, small
 * boards).
 */
const VIRTUALIZE_CALENDAR_FROM = 50;
/** One chip/panel row plus its 4px gap. */
const CALENDAR_ROW_ESTIMATE = 26;
/** Day-number row above a week cell's chips (cell padding + header). */
const WEEK_CELL_OFFSET = 30;

interface CalendarViewProps {
  /** Per-column card ids with a filter applied — overrides the stored
   *  order while the filter is active. */
  filteredCardIds?: Record<string, string[]>;
  /** Fired on a card chip click — opens the card detail dialog. */
  onCardClick: (cardId: string) => void;
  /** VIEWER mode (TASK-35): no drag-to-reschedule, no composers. */
  readOnly?: boolean;
}

/** One calendar entry: a card with a due date plus resolved context. */
interface DayEntry {
  card: Card;
  columnId: string;
  columnTitle: string;
  labels: Label[];
}

/**
 * Week-cell chip list (TASK-139). Week scale is the one calendar bucket
 * that intentionally lists every card of a day; with 2400 cards on one day
 * that was 2400 chips. Each cell has its own virtualizer over the grid's
 * shared scroll element, so only the chips intersecting the grid viewport
 * (plus overscan) mount.
 */
function WeekDayEntries({
  entries,
  scrollRef,
  renderChip,
}: {
  entries: DayEntry[];
  scrollRef: RefObject<HTMLDivElement>;
  renderChip: (entry: DayEntry, withTime: boolean) => ReactNode;
}) {
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CALENDAR_ROW_ESTIMATE,
    overscan: 12,
    getItemKey: (index) => entries[index]?.card.id ?? index,
    scrollMargin: WEEK_CELL_OFFSET,
    initialRect: { width: 0, height: 600 },
  });
  if (entries.length <= VIRTUALIZE_CALENDAR_FROM) {
    return (
      <div className="flex flex-col gap-1">
        {entries.map((entry) => renderChip(entry, true))}
      </div>
    );
  }

  return (
    <div
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
      data-testid="week-day-chips"
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const entry = entries[virtualRow.index];
        return entry ? (
          <div
            key={entry.card.id}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            className="pb-1"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${virtualRow.start - WEEK_CELL_OFFSET}px)`,
            }}
          >
            {renderChip(entry, true)}
          </div>
        ) : null;
      })}
    </div>
  );
}

/**
 * Day-panel card list (TASK-139): a single day can hold every card of the
 * board, so the panel windowed its rows the same way (the panel is opened
 * on demand, but a 2400-row popover was still a multi-second mount).
 */
function DayPanelEntries({
  entries,
  empty,
  renderEntry,
}: {
  entries: DayEntry[];
  empty: ReactNode;
  renderEntry: (entry: DayEntry) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CALENDAR_ROW_ESTIMATE,
    overscan: 12,
    getItemKey: (index) => entries[index]?.card.id ?? index,
    initialRect: { width: 0, height: 224 },
  });
  const windowed = entries.length > VIRTUALIZE_CALENDAR_FROM;

  return (
    <div
      ref={scrollRef}
      className="mt-2 max-h-56 overflow-y-auto border-t border-border/60 pt-2"
      data-testid="day-entries-scroll"
    >
      {entries.length === 0 ? (
        empty
      ) : windowed ? (
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index];
            return entry ? (
              <div
                key={entry.card.id}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className="pb-1"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {renderEntry(entry)}
              </div>
            ) : null;
          })}
        </div>
      ) : (
        <div className="space-y-1">{entries.map(renderEntry)}</div>
      )}
    </div>
  );
}

/**
 * Calendar view (TASK-14.1) — a planning surface, not just a projection:
 *
 * - chips drag between days (HTML5 DnD, undoable SET_CARD_DUE_DATE —
 *   the day changes, the original time-of-day survives);
 * - the "unscheduled" side panel drags cards without a due date onto
 *   days to plan them;
 * - month / week scale, remembered across sessions;
 * - clicking a day opens the day panel: a mini-composer that creates a
 *   card due that day (first column, LIMITS.cardsPerColumn respected)
 *   plus the FULL list of the day's cards (chips may be truncated);
 * - fixed cell heights: the grid never grows with content.
 */
export function CalendarView({
  filteredCardIds,
  onCardClick,
  readOnly = false,
}: CalendarViewProps) {
  const { board, addCard, setCardDueDate } = useBoard();
  const resolveLabels = useCardLabels(board?.labels ?? NO_LABELS);
  const { t, tp, lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  const locale = lang.startsWith("ru") ? ruLocale : undefined;
  const weekStartsOn = lang.startsWith("ru") ? 1 : 0;

  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [scale, setScale] = useState<CalendarScale>(readStoredScale);
  const [unscheduledOpen, setUnscheduledOpen] = useState(true);
  /** Day key whose day panel (composer + full card list) is open. */
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);
  /** Day key currently highlighted as a drag target. */
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  /** Shared scroll container of the month/week grid (week windowing). */
  const calendarGridRef = useRef<HTMLDivElement>(null);

  // Remember the scale next to the view choice (janosik-board-view style).
  useEffect(() => {
    writeStoredScale(scale);
  }, [scale]);

  // A day-panel composer created a card: find the new id (the only id not
  // present before the add), stamp its due date and open its dialog.
  const pendingCreationRef = useRef<{
    columnId: string;
    prevIds: string[];
    dueTs: number;
  } | null>(null);
  useEffect(() => {
    const pending = pendingCreationRef.current;
    if (!pending || !board) return;
    const column = board.columns.find((c) => c.id === pending.columnId);
    const added = column?.cardIds.find((id) => !pending.prevIds.includes(id));
    if (added) {
      pendingCreationRef.current = null;
      setCardDueDate(added, pending.dueTs);
      setOpenDayKey(null);
      onCardClick(added);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to board changes only
  }, [board]);

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
        const labels = resolveLabels(card.labelIds);
        const entry: DayEntry = {
          card,
          columnId: column.id,
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
  }, [board, filteredCardIds, resolveLabels]);

  // Cards without a due date — the unscheduled panel's content.
  const unscheduled = useMemo(() => {
    if (!board) return [];
    const list: { card: Card; columnTitle: string }[] = [];
    for (const column of board.columns) {
      const ids = filteredCardIds?.[column.id] ?? column.cardIds;
      for (const id of ids) {
        const card = board.cards[id];
        if (card && typeof card.dueDate !== "number") {
          list.push({ card, columnTitle: column.title });
        }
      }
    }
    return list;
  }, [board, filteredCardIds]);

  // Unscheduled panel windowing (TASK-139): the side panel is open by
  // default and listed every card without a due date.
  const unscheduledScrollRef = useRef<HTMLDivElement>(null);
  const unscheduledVirtualizer = useVirtualizer({
    count: unscheduled.length,
    getScrollElement: () => unscheduledScrollRef.current,
    estimateSize: () => CALENDAR_ROW_ESTIMATE,
    overscan: 12,
    getItemKey: (index) => unscheduled[index]?.card.id ?? index,
    initialRect: { width: 0, height: 600 },
  });
  const virtualizeUnscheduled = unscheduled.length > VIRTUALIZE_CALENDAR_FROM;
  const unscheduledRows = virtualizeUnscheduled
    ? unscheduledVirtualizer.getVirtualItems()
    : [];

  if (!board) return null;
  const isWeek = scale === "week";
  const gridStart = isWeek
    ? startOfWeek(anchor, { weekStartsOn })
    : startOfWeek(startOfMonth(anchor), { weekStartsOn });
  const gridEnd = endOfWeek(gridStart, { weekStartsOn });
  const days = Array.from({ length: isWeek ? 7 : 42 }, (_, i) =>
    addDays(gridStart, i),
  );
  const weekdays = Array.from({ length: 7 }, (_, i) => addDays(gridStart, i));

  const headerLabel = isWeek
    ? `${format(gridStart, "d LLL", { locale })} – ${format(gridEnd, "d LLL yyyy", { locale })}`
    : (() => {
        const monthLabel = format(anchor, "LLLL yyyy", { locale });
        return monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
      })();

  const step = (dir: 1 | -1) => {
    setAnchor((current) =>
      isWeek ? addWeeks(current, dir) : addMonths(current, dir),
    );
  };

  const stepTo = (date: Date) => {
    setAnchor(isWeek ? startOfWeek(date, { locale }) : startOfMonth(date));
  };

  const handleDrop = (event: React.DragEvent, day: Date) => {
    event.preventDefault();
    if (readOnly) return;
    setDragOverKey(null);
    const cardId = event.dataTransfer.getData("text/plain");
    if (!cardId || !board.cards[cardId]) return;
    const source = board.cards[cardId].dueDate;
    setCardDueDate(
      cardId,
      dayTimestamp(
        day,
        typeof source === "number" ? new Date(source) : undefined,
      ),
    );
  };

  // Read-only days accept nothing: no preventDefault, no highlight, no drop.
  const dragProps = (key: string) =>
    readOnly
      ? {}
      : {
          onDragOver: (event: React.DragEvent) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDragOverKey(key);
          },
          onDragLeave: () => {
            setDragOverKey((current) => (current === key ? null : current));
          },
          onDrop: (event: React.DragEvent) =>
            handleDrop(event, dayKeyToDate(key)),
        };

  // The grid's days array is the source of truth for drop targets; map a
  // key back to its Date for the drop handler.
  const daysByKey = new Map(days.map((day) => [dayKey(day), day]));
  function dayKeyToDate(key: string): Date {
    return daysByKey.get(key) ?? new Date();
  }

  // The right refusal message for a column that cannot take a card: its
  // own WIP limit when that is what filled up, the hard cap otherwise.
  const fullColumnToast = (column: {
    title: string;
    cardIds: string[];
    wipLimit?: number;
  }) =>
    column.wipLimit !== undefined && column.cardIds.length >= column.wipLimit
      ? t("toast.wipLimitBlocked", {
          title: column.title,
          limit: column.wipLimit,
        })
      : t("limits.maxItems", { limit: LIMITS.cardsPerColumn });

  /** Creates a card due on `day` from the day-panel composer. */
  const createCardOn = (
    day: Date,
    title: string,
    labelIds?: string[],
    columnId?: string,
  ) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const column =
      board.columns.find((c) => c.id === columnId) ?? board.columns[0];
    if (!column) return;
    // Both limits, with the matching toast — the composers already disable
    // full columns; this guard is the backstop.
    if (isColumnFull(column)) {
      toast.error(fullColumnToast(column));
      return;
    }
    pendingCreationRef.current = {
      columnId: column.id,
      prevIds: [...column.cardIds],
      dueTs: dayTimestamp(day),
    };
    addCard(column.id, trimmed, labelIds);
  };

  /** Quick-add from the unscheduled panel: the card lands in the first
   *  column with no due date, so it appears right in the panel. */
  const createUnscheduledCard = (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const column = board.columns[0];
    if (!column) return;
    if (isColumnFull(column)) {
      toast.error(fullColumnToast(column));
      return;
    }
    addCard(column.id, trimmed);
  };

  const chipDragStart = (event: React.DragEvent, cardId: string) => {
    event.dataTransfer.setData("text/plain", cardId);
    event.dataTransfer.effectAllowed = "move";
  };

  // Middle-click / Cmd+click open the card in a new tab: the chip carries
  // the card's deep link for the browser, the plain click stays an SPA
  // dialog swap. `boardId` may be missing in tests/local edge renders —
  // then there is simply nothing to hand to a new tab.
  const boardId = board?.id;
  const chipAuxOpen = (event: React.MouseEvent, cardId: string) => {
    if (event.button === 1 && boardId) {
      event.preventDefault();
      openCardInNewTab(boardId, cardId);
    }
  };

  /** One unscheduled-panel row, shared by the plain and windowed lists. */
  const renderUnscheduledCard = ({
    card,
    columnTitle,
  }: {
    card: Card;
    columnTitle: string;
  }) => (
    <CardContextMenu
      key={card.id}
      cardId={card.id}
      readOnly={readOnly}
      onOpen={onCardClick}
    >
      <button
        type="button"
        draggable={!readOnly}
        onDragStart={
          readOnly ? undefined : (event) => chipDragStart(event, card.id)
        }
        onAuxClick={(event) => chipAuxOpen(event, card.id)}
        title={`${columnTitle} · ${card.title}`}
        data-card-href={boardId ? cardHref(boardId, card.id) : undefined}
        onClick={(event) => {
          if (shouldLeaveToBrowser(event)) return;
          onCardClick(card.id);
        }}
        className={cn(
          "block w-full truncate rounded-md border border-border/60 bg-muted/40 px-1.5 py-1 text-left text-[11px] text-foreground/80 transition-colors hover:border-primary/50",
          !readOnly && "cursor-grab active:cursor-grabbing",
        )}
      >
        {card.title}
      </button>
    </CardContextMenu>
  );

  /** One day-panel row — the full-list escape hatch for capped month cells. */
  const renderDayPanelEntry = (entry: DayEntry) => (
    <CardContextMenu
      key={entry.card.id}
      cardId={entry.card.id}
      readOnly={readOnly}
      onOpen={onCardClick}
    >
      <button
        type="button"
        draggable={!readOnly}
        onDragStart={
          readOnly ? undefined : (event) => chipDragStart(event, entry.card.id)
        }
        onAuxClick={(event) => chipAuxOpen(event, entry.card.id)}
        onClick={(event) => {
          if (shouldLeaveToBrowser(event)) return;
          event.stopPropagation();
          onCardClick(entry.card.id);
        }}
        data-card-href={boardId ? cardHref(boardId, entry.card.id) : undefined}
        title={`${entry.columnTitle} · ${entry.card.title}${entry.labels.length > 0 ? ` · ${entry.labels.map((l) => l.name).join(", ")}` : ""}`}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-foreground/80 transition-colors hover:bg-hover"
      >
        {entry.labels.length > 0 ? (
          <span
            className="flex w-[3px] shrink-0 self-stretch flex-col overflow-hidden rounded-full"
            aria-hidden
          >
            {entry.labels.map((label) => (
              <span
                key={label.id}
                className={cn("min-h-0.5 flex-1", LABEL_COLOR_DOT[label.color])}
              />
            ))}
          </span>
        ) : null}
        <span
          className={cn("truncate", entry.labels.length === 0 && "pl-[7px]")}
        >
          {entry.card.title}
        </span>
      </button>
    </CardContextMenu>
  );

  const renderChip = (
    { card, columnTitle, labels }: DayEntry,
    withTime: boolean,
  ) => {
    const status = dueStatus(card.dueDate as number);
    return (
      <CardContextMenu
        key={card.id}
        cardId={card.id}
        readOnly={readOnly}
        onOpen={onCardClick}
      >
        <button
          type="button"
          draggable={!readOnly}
          data-testid="calendar-chip"
          data-card-href={boardId ? cardHref(boardId, card.id) : undefined}
          onDragStart={
            readOnly ? undefined : (event) => chipDragStart(event, card.id)
          }
          onAuxClick={(event) => chipAuxOpen(event, card.id)}
          title={`${
            withTime
              ? `${formatTime(
                  formatTimeOfDay(new Date(card.dueDate as number)),
                  lang,
                  hour12,
                )} · `
              : ""
          }${columnTitle} · ${card.title}${labels.length > 0 ? ` · ${labels.map((l) => l.name).join(", ")}` : ""}`}
          onClick={(event) => {
            // Cmd/Ctrl+click keep the browser gesture (the aux handler and
            // the modifier check cover new-tab); a plain click opens the
            // dialog in place.
            if (shouldLeaveToBrowser(event)) return;
            event.stopPropagation();
            onCardClick(card.id);
          }}
          className={cn(
            "flex items-stretch gap-1 overflow-hidden rounded-md border text-left text-[11px] leading-tight transition-colors hover:border-primary/50",
            status === "overdue" && "border-danger/40 bg-danger/10 text-danger",
            status === "soon" && "border-warning/40 bg-warning/10 text-warning",
            status === "later" &&
              "border-border/60 bg-muted/40 text-foreground/80",
          )}
        >
          {/* Label stripe: one thin bar, segmented per label — every label
            stays visible regardless of count (TASK-14.1). */}
          {labels.length > 0 ? (
            <span
              className="flex w-[3px] shrink-0 flex-col overflow-hidden rounded-l-md"
              aria-hidden
            >
              {labels.map((label) => (
                <span
                  key={label.id}
                  className={cn(
                    "min-h-0.5 flex-1",
                    LABEL_COLOR_DOT[label.color],
                  )}
                />
              ))}
            </span>
          ) : null}
          <span
            className={cn(
              "flex min-w-0 items-center gap-1 py-0.5 pr-1.5",
              // Chips without a stripe start the title at the same offset as
              // striped ones (stripe 3px + gap).
              labels.length === 0 && "pl-[7px]",
            )}
          >
            {withTime ? (
              <span className="shrink-0 tabular-nums opacity-70">
                {formatTime(
                  formatTimeOfDay(new Date(card.dueDate as number)),
                  lang,
                  hour12,
                )}
              </span>
            ) : null}
            <span className="truncate">{card.title}</span>
          </span>
        </button>
      </CardContextMenu>
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
      <header className="flex items-center gap-1 border-b border-border/60 px-3 py-2">
        {/* The period label is interactive: clicking it opens a month/year
            picker popover (same visual language as the filter's date
            calendar, reduced to month + year + arrows). */}
        <MonthYearMenu
          anchor={anchor}
          label={headerLabel}
          locale={locale}
          onPick={stepTo}
        />
        {/* Navigation cluster stays on the left: scale toggle, then the
            arrows with "Today" between them; the right side keeps only
            the helper text. */}
        <div
          role="group"
          aria-label={t("view.calendar.scale")}
          className="ml-1 inline-flex items-center rounded-md border border-border/60 p-0.5"
        >
          <button
            type="button"
            aria-pressed={!isWeek}
            onClick={() => setScale("month")}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors",
              !isWeek
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("view.calendar.scaleMonth")}
          </button>
          <button
            type="button"
            aria-pressed={isWeek}
            onClick={() => setScale("week")}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors",
              isWeek
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("view.calendar.scaleWeek")}
          </button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={
            isWeek ? t("view.calendar.prevWeek") : t("view.calendar.prev")
          }
          onClick={() => step(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() =>
            setAnchor(
              isWeek
                ? startOfWeek(new Date(), { weekStartsOn })
                : startOfMonth(new Date()),
            )
          }
        >
          {t("view.calendar.today")}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={
            isWeek ? t("view.calendar.nextWeek") : t("view.calendar.next")
          }
          onClick={() => step(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="mr-auto" />
        {/* Helper text: the grid's main affordance is not obvious from
            the grid itself. */}
        <span
          className="hidden text-[11px] text-muted-foreground/70 lg:inline"
          data-testid="calendar-hint"
        >
          {t("view.calendar.hint")}
        </span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Unscheduled panel (TASK-14.1): drag a card onto a day to plan it. */}
        <aside
          className={cn(
            "flex shrink-0 flex-col border-r border-border/60 transition-all",
            unscheduledOpen ? "w-56" : "w-11",
          )}
        >
          <button
            type="button"
            aria-expanded={unscheduledOpen}
            data-testid="unscheduled-toggle"
            onClick={() => setUnscheduledOpen((o) => !o)}
            className="flex items-center gap-1.5 border-b border-border/60 px-2 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            {unscheduledOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 shrink-0" />
            )}
            {unscheduledOpen ? (
              <span className="truncate">{t("view.calendar.unscheduled")}</span>
            ) : null}
            <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-hover px-1 text-[10px] font-medium text-muted-foreground">
              {unscheduled.length}
            </span>
          </button>
          {unscheduledOpen ? (
            <>
              {readOnly ? null : (
                <div className="border-b border-border/60 p-2">
                  <UnscheduledComposer
                    disabled={
                      board.columns.length === 0 ||
                      // Quick-add lands in the first column — dead when it
                      // cannot take another card.
                      isColumnFull(board.columns[0])
                    }
                    onCreate={createUnscheduledCard}
                  />
                </div>
              )}
              <div
                ref={unscheduledScrollRef}
                className="flex-1 overflow-y-auto p-2"
                data-testid="unscheduled-list"
              >
                {unscheduled.length === 0 ? (
                  <p className="px-1 text-[11px] text-muted-foreground/70">
                    {t("view.calendar.unscheduledEmpty")}
                  </p>
                ) : virtualizeUnscheduled ? (
                  <div
                    style={{
                      height: unscheduledVirtualizer.getTotalSize(),
                      position: "relative",
                    }}
                  >
                    {unscheduledRows.map((virtualRow) => {
                      const item = unscheduled[virtualRow.index];
                      return item ? (
                        <div
                          key={item.card.id}
                          ref={unscheduledVirtualizer.measureElement}
                          data-index={virtualRow.index}
                          className="pb-1"
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {renderUnscheduledCard(item)}
                        </div>
                      ) : null;
                    })}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {unscheduled.map(renderUnscheduledCard)}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
          <div
            ref={calendarGridRef}
            className={cn(
              "grid grid-cols-7 overflow-y-auto",
              isWeek && "flex-1",
            )}
            data-testid="calendar-grid"
          >
            {days.map((day) => {
              const key = dayKey(day);
              const entries = entriesByDay.get(key) ?? [];
              // Month cells are capped (fixed height); week cells are tall
              // and list everything.
              const visible = isWeek
                ? entries
                : entries.slice(0, MAX_CHIPS_PER_CELL);
              const overflow = isWeek ? 0 : entries.length - visible.length;
              const isDayOpen = openDayKey === key;
              return (
                <Popover
                  key={key}
                  open={isDayOpen}
                  onOpenChange={(open) => setOpenDayKey(open ? key : null)}
                >
                  {/* The icon is the anchor AND the panel's home position —
                      opening the panel (from the icon, the day number or
                      the empty area) always pops it neatly under the
                      top-left corner of the day. */}
                  <div
                    {...dragProps(key)}
                    data-testid="calendar-day"
                    data-date={key}
                    onClick={() => setOpenDayKey(key)}
                    className={cn(
                      "group/cell relative flex flex-col overflow-hidden border-b border-r border-border/40 p-1.5 [&:nth-child(7n)]:border-r-0",
                      isWeek ? "min-h-72" : "h-28",
                      !isSameMonth(day, anchor) && !isWeek && "bg-muted/30",
                      dragOverKey === key &&
                        "bg-primary/10 ring-1 ring-inset ring-primary/40",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1">
                        <span
                          className={cn(
                            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums",
                            isToday(day) &&
                              "bg-primary font-semibold text-primary-foreground",
                            !isToday(day) &&
                              !isSameMonth(day, anchor) &&
                              "text-muted-foreground/60",
                          )}
                        >
                          {format(day, "d")}
                        </span>
                        {readOnly ? null : (
                          <PopoverAnchor asChild>
                            <button
                              type="button"
                              aria-label={t("composer.add")}
                              data-testid="day-add"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenDayKey(isDayOpen ? null : key);
                              }}
                              className={cn(
                                "no-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded-md bg-primary/15 text-primary opacity-0 transition-opacity hover:bg-primary/25 group-hover/cell:opacity-100 focus-visible:opacity-100",
                                isDayOpen && "opacity-100",
                              )}
                            >
                              <Plus className="h-3 w-3" aria-hidden />
                            </button>
                          </PopoverAnchor>
                        )}
                      </span>
                      {overflow > 0 ? (
                        <button
                          type="button"
                          data-testid="day-overflow"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenDayKey(key);
                          }}
                          className="rounded px-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {tp("view.calendar.moreCards", overflow)}
                        </button>
                      ) : null}
                    </div>
                    {isWeek ? (
                      <WeekDayEntries
                        entries={entries}
                        scrollRef={calendarGridRef}
                        renderChip={renderChip}
                      />
                    ) : (
                      <div className="flex flex-col gap-1">
                        {visible.map((entry) => renderChip(entry, isWeek))}
                      </div>
                    )}
                    {/* Fade instead of an open end — a fixed cell height
                          keeps the grid from growing with content. */}
                    {entries.length > MAX_CHIPS_PER_CELL && !isWeek ? (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-card to-transparent" />
                    ) : null}
                  </div>
                  <PopoverContent
                    align="start"
                    side="bottom"
                    className="w-64 p-2"
                    data-testid="day-panel"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <p className="mb-1.5 px-1 text-xs font-semibold text-foreground">
                      {formatDateOnly(day.getTime(), lang)}
                    </p>
                    {readOnly ? null : (
                      <DayComposer
                        columns={board.columns.map((col) => ({
                          id: col.id,
                          title: col.title,
                          full: isColumnFull(col),
                          count: col.cardIds.length,
                          wipLimit: col.wipLimit,
                        }))}
                        labels={board.labels}
                        onSubmit={(title, labelIds, columnId) =>
                          createCardOn(day, title, labelIds, columnId)
                        }
                        onCancel={() => setOpenDayKey(null)}
                      />
                    )}
                    <DayPanelEntries
                      entries={entries}
                      empty={
                        <p className="px-1 text-[11px] text-muted-foreground/70">
                          {t("view.calendar.dayEmpty")}
                        </p>
                      }
                      renderEntry={renderDayPanelEntry}
                    />
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mini-composer at the top of the day panel (TASK-14.1 item 4) — same body
 * as the table composer: title, column chooser, label chips, buttons. */
function DayComposer({
  columns,
  labels,
  onSubmit,
  onCancel,
}: {
  /** `full` marks columns that cannot take another card right now; the
   *  counter `count`/`wipLimit` is shown for WIP-limited ones. */
  columns: {
    id: string;
    title: string;
    full: boolean;
    count?: number;
    wipLimit?: number;
  }[];
  labels?: Label[];
  onSubmit: (title: string, labelIds?: string[], columnId?: string) => void;
  /** Closes the day panel — same contract as the table composer's cancel. */
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  // Default to the first column with room — a full default column would
  // only produce a disabled submit.
  const [columnId, setColumnId] = useState(
    (columns.find((col) => !col.full) ?? columns[0])?.id ?? "",
  );
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const toggleLabel = (labelId: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelId)
        ? prev.filter((id) => id !== labelId)
        : [...prev, labelId],
    );
  };

  const selectedColumn = columns.find((col) => col.id === columnId);
  // The reducer refuses an add into a full column — the composer says so
  // up front instead of letting the user type into a dead submit.
  const selectedFull = selectedColumn?.full ?? true;
  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || selectedFull) return;
    onSubmit(trimmed, selectedLabels, columnId);
    setDraft("");
    setSelectedLabels([]);
  };

  return (
    <div className="space-y-1.5">
      <Input
        name="day-composer"
        value={draft}
        maxLength={LIMITS.cardTitle}
        data-testid="day-composer-input"
        aria-label={t("composer.add")}
        placeholder={t("composer.placeholder")}
        className="h-7 text-xs"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            submit();
          }
          if (e.key === "Escape") {
            setDraft("");
            setSelectedLabels([]);
            (e.target as HTMLElement).blur();
          }
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full justify-start text-xs"
            data-testid="day-composer-column"
          >
            {selectedColumn?.title ?? "—"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-44 w-[var(--radix-dropdown-menu-trigger-width)] min-w-0 overflow-y-auto"
        >
          {columns.map((col) => (
            <DropdownMenuItem
              key={col.id}
              onSelect={() => setColumnId(col.id)}
              disabled={col.full}
              title={
                col.full
                  ? t("limits.columnFull", { limit: LIMITS.cardsPerColumn })
                  : undefined
              }
            >
              <span className="truncate">{col.title}</span>
              {col.wipLimit !== undefined && col.count !== undefined && (
                <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
                  {col.count}/{col.wipLimit}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ComposerLabelPicker
        labels={labels}
        selected={selectedLabels}
        onToggle={toggleLabel}
        testId="day-composer-labels"
      />
      {/* Same Add/Cancel pair as the board composer — Cancel just
          clears the draft, the panel itself stays open. */}
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={!draft.trim() || selectedFull}
          title={
            selectedFull
              ? t("limits.columnFull", { limit: LIMITS.cardsPerColumn })
              : undefined
          }
          onClick={submit}
        >
          {t("composer.submit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setDraft("");
            setSelectedLabels([]);
            onCancel();
          }}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Quick-add row at the top of the unscheduled panel (a dashed "+" button
 * that expands into an input, LabelPicker-style). Created cards have no
 * due date, so they show up right in the panel — ready to be dragged
 * onto a day.
 */
function UnscheduledComposer({
  disabled,
  onCreate,
}: {
  disabled?: boolean;
  onCreate: (title: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        data-testid="unscheduled-add"
        onClick={() => setEditing(true)}
        className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-primary/40 bg-primary/10 px-1.5 py-1.5 text-[11px] font-medium text-primary transition-colors enabled:hover:border-primary/70 enabled:hover:bg-primary/20 disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t("composer.add")}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      name="unscheduled-composer"
      value={draft}
      maxLength={LIMITS.cardTitle}
      data-testid="unscheduled-add-input"
      aria-label={t("composer.add")}
      placeholder={t("composer.placeholder")}
      className="h-7 text-xs"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && draft.trim()) {
          onCreate(draft);
          setDraft("");
          setEditing(false);
        }
        if (e.key === "Escape") {
          setDraft("");
          setEditing(false);
        }
      }}
      onBlur={() => {
        setDraft("");
        setEditing(false);
      }}
    />
  );
}
