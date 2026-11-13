import { ArrowRight } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { Card, Column } from "@janosik/shared";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { ColumnDot, columnAccent } from "./parts";

interface ColumnRailProps {
  columns: Column[];
  cards: Record<string, Card>;
  activeId: string;
  counts: Record<string, number>;
  onSelect: (columnId: string) => void;
  testIdPrefix: string;
}

/**
 * The board's columns as a horizontal tab rail. Selecting a column opens its
 * outgoing rules; the accent underline uses the column's own colour. The
 * roving tabindex keeps the whole rail to one Tab stop; ArrowLeft/Right,
 * Home and End move between columns.
 */
export function ColumnRail({
  columns,
  cards,
  activeId,
  counts,
  onSelect,
  testIdPrefix,
}: ColumnRailProps) {
  const { t } = useI18n();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // The rail becomes a horizontal scroller as soon as the columns stop
  // fitting. Keep the selected column in view when it is opened from the
  // keyboard or from a deep link; `nearest` leaves an already visible tab
  // alone and never scrolls the dialog itself sideways.
  useEffect(() => {
    refs.current[activeId]?.scrollIntoView?.({
      inline: "nearest",
      block: "nearest",
    });
  }, [activeId, columns.length]);

  // A vertical mouse wheel over an overflowing rail moves it sideways. The
  // listener is native and non-passive because React's wheel listener cannot
  // preventDefault the page scroll. It only takes over when the rail can
  // actually move, so a rail at either end and a rail that fits keep the
  // dialog/page scrolling normally.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      if (max <= 1) return;
      const step =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaY;
      const next = Math.min(max, Math.max(0, scroller.scrollLeft + step));
      if (next === scroller.scrollLeft) return;
      event.preventDefault();
      scroller.scrollLeft = next;
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  const move = (direction: 1 | -1) => {
    if (columns.length === 0) return;
    const current = columns.findIndex((column) => column.id === activeId);
    const next =
      (current + direction + columns.length) % Math.max(columns.length, 1);
    const column = columns[next];
    if (!column) return;
    onSelect(column.id);
    refs.current[column.id]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = columns[0];
      if (first) {
        onSelect(first.id);
        refs.current[first.id]?.focus();
      }
    } else if (event.key === "End") {
      event.preventDefault();
      const last = columns[columns.length - 1];
      if (last) {
        onSelect(last.id);
        refs.current[last.id]?.focus();
      }
    }
  };

  return (
    <div
      ref={scrollerRef}
      role={columns.length === 0 ? undefined : "tablist"}
      aria-label={columns.length === 0 ? undefined : t("workflow.rail.label")}
      data-testid={`${testIdPrefix}-rail`}
      className="column-rail-scroll flex w-full min-w-0 max-w-full shrink-0 touch-pan-x snap-x flex-nowrap items-stretch gap-0 overflow-x-auto overscroll-x-contain scroll-px-3 border-b border-border/80 px-3 max-md:scroll-px-1.5 max-md:px-1.5"
    >
      {columns.length === 0 ? (
        <p className="px-2 py-3 text-[11px] text-muted-foreground">
          {t("workflow.empty.columns")}
        </p>
      ) : null}
      {columns.map((column, index) => {
        const active = column.id === activeId;
        const accent = columnAccent(column, index);
        const cardCount = column.cardIds.filter(
          (cardId) => cards[cardId]?.archivedAt === undefined,
        ).length;
        const rulesCount = counts[column.id] ?? 0;
        return (
          <div
            key={column.id}
            role="presentation"
            className="flex shrink-0 snap-start items-center md:flex-1 md:basis-auto"
          >
            <button
              ref={(element) => {
                refs.current[column.id] = element;
              }}
              type="button"
              role="tab"
              id={`${testIdPrefix}-rail-tab-${column.id}`}
              aria-selected={active}
              aria-controls={`${testIdPrefix}-panel`}
              tabIndex={active ? 0 : -1}
              data-active={active || undefined}
              data-testid={`${testIdPrefix}-rail-${column.id}`}
              onClick={() => onSelect(column.id)}
              onKeyDown={onKeyDown}
              className={cn(
                "relative flex min-w-[128px] shrink-0 items-center gap-2 px-[9px] pb-[9px] pt-[10px] text-left text-muted-foreground transition-colors hover:bg-hover/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover data-[active=true]:text-foreground motion-reduce:transition-none max-md:min-w-[138px] max-md:px-2 max-md:py-[9px]",
              )}
            >
              <span
                aria-hidden
                className="absolute -bottom-px left-[7px] right-[7px] h-0.5 rounded-t-[2px] opacity-30 data-[active=true]:opacity-100"
                data-active={active || undefined}
                style={{ background: accent }}
              />
              <span className="flex min-w-0 flex-col gap-px">
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold leading-4">
                  <ColumnDot color={accent} size={5} />
                  <span className="truncate">{column.title}</span>
                </span>
                <span className="truncate text-[11px] leading-4 text-muted-foreground/75">
                  {t("workflow.rail.rules", { count: rulesCount })}
                </span>
              </span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground/75">
                {cardCount}
              </span>
            </button>
            {index < columns.length - 1 ? (
              <ArrowRight
                aria-hidden
                className="h-3 w-3 shrink-0 text-muted-foreground/30"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
