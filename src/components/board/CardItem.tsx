import { AlignLeft, CalendarClock, CopyPlus, ListTodo } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useI18n, formatDate, formatDateOnly, formatTime } from "@/i18n";
import { dueStatus, type DueStatus } from "@/utils/due-date";
import { LABEL_COLOR_CHIP, coverBackground, type Card, type Label } from "@/types/kanban";

interface CardItemProps {
  card: Card;
  /** Labels resolved from the board — the card can carry several. */
  labels: Label[];
  /** True while the card is being dragged (hides the source copy). */
  isDragging?: boolean;
  /** Fired on click — opens the card detail dialog. */
  onClick?: () => void;
  /** Fired by the hover duplicate button — the dialog stays closed. */
  onDuplicate?: () => void;
}

/**
 * A single card inside a column.
 * Hover uses border/shadow changes (no transform) so it stays compatible
 * with the drag layer that @dnd-kit applies on top of it.
 *
 * The description itself is not rendered on the front (Trello-style):
 * a compact badge only signals that the card has one — full text lives
 * in the card dialog.
 */
export function CardItem({ card, labels, isDragging, onClick, onDuplicate }: CardItemProps) {
  const { t, lang } = useI18n();
  const hasDescription = Boolean(card.description?.trim());
  // Checklist progress summed across all of the card's checklists.
  const items = (card.checklists ?? []).flatMap((c) => c.items);
  const done = items.filter((item) => item.done).length;
  const total = items.length;

  // Due-date badge state: overdue (red) / due within 24h (yellow) / later.
  const hasDueDate = typeof card.dueDate === "number";
  const status = hasDueDate ? dueStatus(card.dueDate as number) : null;
  const dueTime = hasDueDate
    ? formatTime(
        `${String(new Date(card.dueDate as number).getHours()).padStart(2, "0")}:${String(new Date(card.dueDate as number).getMinutes()).padStart(2, "0")}`,
        lang,
      )
    : "";

  return (
    <article
      onClick={onClick}
      className={cn(
        "group animate-card-in relative cursor-pointer overflow-hidden rounded-lg border border-border/70 bg-card px-3 py-2.5 shadow-sm transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md",
        isDragging && "opacity-40",
      )}
    >
      {/* Hover duplicate (Trello quick-edit style): a compact icon in the
          top-right corner, visible only while hovered. Hidden while dragging
          and when there is nowhere to put the copy handler. */}
      {onDuplicate && !isDragging ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("card.duplicate")}
              className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-card/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity focus-visible:opacity-100 hover:text-foreground group-hover:opacity-100"
              onClick={(e) => {
                // Don't let the click open the card dialog.
                e.stopPropagation();
                onDuplicate();
              }}
            >
              <CopyPlus className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("card.duplicate")}</TooltipContent>
        </Tooltip>
      ) : null}
      {/* Cover: a slim top strip — same height for colors and gradients
          (matches the label chip row scale). Negative margins bleed it into
          the card padding; the card clips it (overflow-hidden). */}
      {card.cover ? (
        <div
          aria-hidden
          data-testid="card-cover"
          data-cover-type={card.cover.type}
          className="-mx-3 -mt-2.5 mb-2.5 h-1.5 w-[calc(100%+1.5rem)]"
          style={{ background: coverBackground(card.cover) }}
        />
      ) : null}
      {labels.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          {labels.map((label) => (
            <span
              key={label.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                LABEL_COLOR_CHIP[label.color],
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-current"
                aria-hidden
              />
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
      <p className="break-words text-sm leading-snug text-foreground/90">
        {card.title}
      </p>
      {hasDescription || total > 0 || hasDueDate ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {hasDueDate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium tabular-nums transition-colors",
                    status === "overdue" &&
                      "border-danger/40 bg-danger/10 text-danger",
                    status === "soon" &&
                      "border-warning/40 bg-warning/10 text-warning",
                    status === "later" &&
                      "border-border/60 bg-muted/50 text-muted-foreground group-hover:border-primary/40 group-hover:text-primary",
                  )}
                  data-testid="card-due-badge"
                  data-due-status={status}
                >
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  {formatDateOnly(card.dueDate as number, lang)}
                  {" · "}
                  {dueTime}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t(`dueDate.${status as DueStatus}`, {
                  date: formatDate(card.dueDate as number, lang),
                })}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {total > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium tabular-nums transition-colors",
                    done === total
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-border/60 bg-muted/50 text-muted-foreground group-hover:border-primary/40 group-hover:text-primary",
                  )}
                  data-testid="card-checklist-badge"
                >
                  <ListTodo className="h-3.5 w-3.5" aria-hidden />
                  {done}/{total}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t("checklist.badgeTooltip", { done, total })}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {hasDescription ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex h-5 items-center rounded-md border border-border/60 bg-muted/50 px-1.5 text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary"
                  data-testid="card-description-badge"
                >
                  <AlignLeft className="h-3.5 w-3.5" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("card.hasDescription")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
